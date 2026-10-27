use crate::{
    model::{Entry, Root},
    store::{DiskIndex, Snapshot},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    time::Instant,
};

pub(crate) const COMPACT_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct Mutation {
    pub roots: Vec<Root>,
    pub removed: Vec<String>,
    pub entries: Vec<Entry>,
}

#[derive(Serialize, Deserialize)]
struct Record {
    generation: String,
    sequence: u64,
    mutation: Mutation,
}

pub(crate) struct Journal {
    pub generation: String,
    pub sequence: u64,
    pub bytes: u64,
    pub pending: Option<String>,
    pub changed: Instant,
}

impl Mutation {
    pub fn apply(self, snapshots: &mut [Snapshot]) {
        let roots: HashMap<_, _> = self
            .roots
            .into_iter()
            .map(|root| (root.id.clone(), root))
            .collect();
        let removed: HashSet<_> = self.removed.into_iter().collect();
        let mut incoming: HashMap<_, _> = self
            .entries
            .into_iter()
            .map(|entry| (entry.id.clone(), entry))
            .collect();
        for snapshot in snapshots {
            let Some(root) = roots.get(&snapshot.root.id) else {
                continue;
            };
            snapshot.entries.retain_mut(|entry| {
                if let Some(next) = incoming.remove(&entry.id) {
                    *entry = next;
                    true
                } else {
                    !removed.contains(&entry.id)
                }
            });
            let ids: Vec<_> = incoming
                .iter()
                .filter(|(_, entry)| entry.root_id == root.id)
                .map(|(id, _)| id.clone())
                .collect();
            for id in ids {
                snapshot.entries.push(incoming.remove(&id).unwrap());
            }
            snapshot.root = root.clone();
            snapshot.root.count = snapshot.entries.len();
        }
    }
}

impl Journal {
    pub fn empty() -> Self {
        Self { generation: String::new(), sequence: 0, bytes: 0, pending: None, changed: Instant::now() }
    }
    pub fn load(data: &Path, disk: &mut DiskIndex) -> Result<Self, String> {
        let path = data.join("index-journal.jsonl");
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => vec![],
            Err(error) => return Err(error.to_string()),
        };
        // A crash during append may leave only the last line incomplete.
        let complete = bytes.iter().rposition(|b| *b == b'\n').map_or(0, |p| p + 1);
        let mut sequence = disk.sequence;
        let mut roots = HashMap::new();
        let mut removed = HashSet::new();
        let mut entries = HashMap::new();
        for line in bytes[..complete]
            .split(|b| *b == b'\n')
            .filter(|line| !line.is_empty())
        {
            let record: Record = serde_json::from_slice(line)
                .map_err(|error| format!("인덱스 변경 기록을 읽을 수 없습니다: {error}"))?;
            if record.generation != disk.generation || record.sequence <= disk.sequence {
                continue;
            }
            sequence = sequence.max(record.sequence);
            for root in record.mutation.roots {
                roots.insert(root.id.clone(), root);
            }
            for id in record.mutation.removed {
                entries.remove(&id);
                removed.insert(id);
            }
            for entry in record.mutation.entries {
                removed.remove(&entry.id);
                entries.insert(entry.id.clone(), entry);
            }
        }
        Mutation {
            roots: roots.into_values().collect(),
            removed: removed.into_iter().collect(),
            entries: entries.into_values().collect(),
        }
        .apply(&mut disk.snapshots);
        if complete != bytes.len() {
            let file = OpenOptions::new()
                .write(true)
                .open(&path)
                .map_err(|error| error.to_string())?;
            file.set_len(complete as u64)
                .and_then(|_| file.sync_all())
                .map_err(|error| error.to_string())?;
        }
        Ok(Self {
            generation: disk.generation.clone(),
            sequence,
            bytes: complete as u64,
            pending: None,
            changed: Instant::now(),
        })
    }

    // Commit a small durable record before reporting a successful in-memory update.
    pub fn append(&mut self, data: &Path, mutation: &Mutation) -> Result<(), String> {
        #[derive(Serialize)]
        struct BorrowedRecord<'a> {
            generation: &'a str,
            sequence: u64,
            mutation: &'a Mutation,
        }
        let sequence = self.sequence + 1;
        let mut bytes = serde_json::to_vec(&BorrowedRecord {
            generation: &self.generation,
            sequence,
            mutation,
        })
        .map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(data.join("index-journal.jsonl"))
            .map_err(|e| e.to_string())?;
        let length = file.metadata().map_err(|e| e.to_string())?.len();
        if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
            file.set_len(length)
                .map_err(|rollback| format!("{error}; 변경 기록 복구 실패: {rollback}"))?;
            return Err(error.to_string());
        }
        self.sequence = sequence;
        self.bytes = length + bytes.len() as u64;
        self.changed = Instant::now();
        Ok(())
    }

    pub fn reset(&mut self, data: &Path, generation: String) {
        self.generation = generation;
        self.sequence = 0;
        self.pending = None;
        // Stale records are also rejected by their generation if truncation fails.
        self.bytes = match OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(data.join("index-journal.jsonl"))
        {
            Ok(file) => {
                let _ = file.sync_all();
                0
            }
            Err(_) => self.bytes,
        };
    }

    pub fn compact(&mut self, data: &Path, sequence: u64) -> Result<(), String> {
        let bytes = fs::read(data.join("index-journal.jsonl")).map_err(|e| e.to_string())?;
        let mut retained = Vec::new();
        for line in bytes.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
            let record: Record = serde_json::from_slice(line).map_err(|e| e.to_string())?;
            if record.generation == self.generation && record.sequence > sequence {
                retained.extend_from_slice(line);
                retained.push(b'\n');
            }
        }
        let mut temp = tempfile::NamedTempFile::new_in(data).map_err(|e| e.to_string())?;
        temp.write_all(&retained)
            .and_then(|_| temp.as_file().sync_all())
            .map_err(|e| e.to_string())?;
        temp.persist(data.join("index-journal.jsonl"))
            .map_err(|e| e.to_string())?;
        self.bytes = retained.len() as u64;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root() -> Root {
        serde_json::from_value(serde_json::json!({"id":"root","name":"files","absolutePath":"/fixture","count":0,"lastIndexed":0,"skipped":0})).unwrap()
    }
    fn mutation(name: &str) -> Mutation {
        Mutation {
            roots: vec![root()],
            removed: vec![],
            entries: vec![Entry {
                id: format!("root:{name}"),
                root_id: "root".into(),
                name: name.into(),
                path: name.into(),
                parent: String::new(),
                kind: "file".into(),
                extension: "txt".into(),
                size: Some(1),
                modified: 1,
                hidden:false,created:None,accessed:None,readonly:false,
            }],
        }
    }

    #[test]
    fn checkpoint_trimming_keeps_records_committed_while_checkpoint_was_written() {
        let temp = tempfile::tempdir().unwrap();
        let mut disk = DiskIndex {
            format: 1,
            generation: "generation".into(),
            sequence: 0,
            snapshots: vec![Snapshot {
                root: root(),
                entries: vec![],
            }],
        };
        let mut journal = Journal::load(temp.path(), &mut disk).unwrap();
        journal.append(temp.path(), &mutation("first.txt")).unwrap();
        mutation("first.txt").apply(&mut disk.snapshots);
        disk.sequence = journal.sequence;
        // A later mutation lands while the earlier snapshot is being serialized.
        journal.append(temp.path(), &mutation("later.txt")).unwrap();
        crate::store::write_json(&temp.path().join("index.json"), &disk).unwrap();
        journal.compact(temp.path(), disk.sequence).unwrap();
        let reloaded = Journal::load(temp.path(), &mut disk).unwrap();
        assert_eq!(reloaded.sequence, 2);
        let names: HashSet<_> = disk.snapshots[0]
            .entries
            .iter()
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(names, HashSet::from(["first.txt", "later.txt"]));
        assert_eq!(
            fs::read_to_string(temp.path().join("index-journal.jsonl"))
                .unwrap()
                .lines()
                .count(),
            1
        );
    }

    #[test]
    fn complete_corrupt_record_is_reported_instead_of_silently_losing_updates() {
        let temp = tempfile::tempdir().unwrap();
        let mut disk = DiskIndex {
            format: 1,
            generation: "generation".into(),
            sequence: 0,
            snapshots: vec![],
        };
        fs::write(temp.path().join("index-journal.jsonl"), b"{corrupt}\n").unwrap();
        assert!(Journal::load(temp.path(), &mut disk).is_err());
    }
}

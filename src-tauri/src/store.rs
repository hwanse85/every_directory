use crate::{
    journal::{Journal, Mutation, COMPACT_BYTES},
    model::{Entry, Location, Root},
    search::{normalize, Index},
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufWriter, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc, Arc, Condvar, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
use walkdir::WalkDir;

// 저장된 폴더와 파일 목록을 함께 복원한다.
#[derive(Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub root: Root,
    pub entries: Vec<Entry>,
}

#[cfg(test)]
mod checkpoint_tests {
    use super::*;

    #[test]
    fn idle_checkpoint_replays_and_an_older_worker_cannot_restore_a_removed_root() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("files");
        fs::create_dir_all(root.join("target")).unwrap();
        fs::write(root.join("original.txt"), "original").unwrap();
        let engine = Engine::new(temp.path().join("data")).unwrap();
        let id = engine.scan(&json!({"absolutePath":root})).unwrap().id;
        let copy = || {
            crate::dispatch(&engine,"operation",json!({"action":"copy","entries":[{"rootId":id,"path":"original.txt"}],"destination":{"rootId":id,"path":"target"}})).unwrap()
        };
        copy();
        let operation = engine.operations.lock().unwrap();
        engine.journal.lock().unwrap().bytes = COMPACT_BYTES;
        engine.schedule_checkpoint();
        let timeout = std::time::Instant::now() + Duration::from_secs(8);
        while engine.journal.lock().unwrap().pending.is_some() {
            assert!(
                std::time::Instant::now() < timeout,
                "idle checkpoint did not finish"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        let saved: DiskIndex =
            serde_json::from_slice(&fs::read(engine.data.join("index.json")).unwrap()).unwrap();
        assert!(saved.sequence > 0);
        assert_eq!(
            fs::metadata(engine.data.join("index-journal.jsonl"))
                .unwrap()
                .len(),
            0
        );
        assert!(saved.snapshots[0]
            .entries
            .iter()
            .any(|e| e.path == "target/original.txt"));
        drop(operation);
        copy();
        engine.journal.lock().unwrap().bytes = COMPACT_BYTES;
        engine.schedule_checkpoint();
        engine.remove(&id).unwrap();
        std::thread::sleep(Duration::from_millis(2200));
        let reopened = Engine::new(temp.path().join("data")).unwrap();
        assert!(reopened.roots().is_empty());
    }
}

#[cfg(test)]
mod startup_tests {
    use super::*;

    fn saved_index(data: &Path, root: &Path, count: usize) {
        fs::create_dir_all(root).unwrap();
        let entries = (0..count).map(|n| Entry {
            id: format!("root:{n}"), root_id: "root".into(), name: format!("업무 보고서 {n:06}.txt"),
            path: format!("Reports/{n:06}/업무 보고서 {n:06}.txt"), parent: format!("Reports/{n:06}"),
            kind: "file".into(), extension: "txt".into(), size: Some(128), modified: 1, hidden:false,created:None,accessed:None,readonly:false,
        }).collect();
        write_json(&data.join("index.json"), &DiskIndex {format:1,generation:String::new(),sequence:0,snapshots:vec![Snapshot {
            root:Root{id:"root".into(),name:"Fixture".into(),absolute_path:root.to_string_lossy().into_owned(),count,last_indexed:1,skipped:0,watch_error:None,excluded_paths:vec![],..Default::default()}, entries,
        }]}).unwrap();
    }

    #[test]
    fn pending_startup_exposes_status_but_init_waits_without_discarding_saved_roots() {
        let temp = tempfile::tempdir().unwrap();
        let data=temp.path().join("data");saved_index(&data,&temp.path().join("files"),100);
        let engine=Engine::prepare(data).unwrap();
        assert_eq!(engine.status()["ready"],false);
        let (tx,rx)=mpsc::channel();let request=engine.clone();
        std::thread::spawn(move||tx.send(crate::dispatch(&request,"init",json!({}))).unwrap());
        assert!(rx.recv_timeout(Duration::from_millis(60)).is_err());
        let result=engine.restore();engine.finish_startup(result);
        let roots=rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
        assert_eq!(roots[0]["id"],"root");assert_eq!(roots[0]["count"],100);
        assert_eq!(engine.status()["ready"],true);
        assert_eq!(engine.store.lock().unwrap().index.entries.len(),100);
    }

    #[test]
    fn failed_background_restore_preserves_corrupt_data_and_rejects_operations() {
        let temp=tempfile::tempdir().unwrap();let data=temp.path().join("data");fs::create_dir(&data).unwrap();
        fs::write(data.join("index.json"),"{incomplete").unwrap();
        let engine=Engine::start(data.clone(),false).unwrap();
        assert!(engine.wait_ready().is_err());
        assert!(engine.status()["startupError"].is_string());
        assert!(crate::dispatch(&engine,"scan",json!({"absolutePath":temp.path()})).is_err());
        assert_eq!(fs::read_to_string(data.join("index.json")).unwrap(),"{incomplete");
    }

    #[test]
    #[ignore = "100k-entry startup benchmark; run explicitly"]
    fn benchmark_saved_index_startup() {
        let temp=tempfile::tempdir().unwrap();let data=temp.path().join("data");
        saved_index(&data,&temp.path().join("files"),100_000);
        let started=Instant::now();let sync=Engine::new(data.clone()).unwrap();
        let synchronous_ms=started.elapsed().as_millis();drop(sync);
        let started=Instant::now();let background=Engine::start(data,false).unwrap();
        let return_ms=started.elapsed().as_millis();background.wait_ready().unwrap();
        println!("STARTUP_BENCHMARK {{\"entries\":100000,\"blockingSetupMs\":{synchronous_ms},\"backgroundSetupMs\":{return_ms},\"backgroundReadyMs\":{}}}",started.elapsed().as_millis());
        assert_eq!(background.store.lock().unwrap().index.entries.len(),100_000);
    }
}
// 기존 로컬 서버 인덱스도 읽을 수 있는 저장 형식이다.
#[derive(Serialize, Deserialize)]
pub struct DiskIndex {
    pub format: u8,
    pub snapshots: Vec<Snapshot>,
    #[serde(default)]
    pub generation: String,
    #[serde(default)]
    pub sequence: u64,
}
// 검색 스냅샷을 짧은 잠금 안에서 공유한다.
#[derive(Default)]
pub struct Store {
    pub snapshots: Vec<Snapshot>,
    pub index: Index,
    pub version: u64,
}
// 파일 엔진과 진행 상태를 데스크톱 명령 사이에서 공유한다.
pub struct Engine {
    pub data: PathBuf,
    pub store: Mutex<Store>,
    pub operations: Mutex<()>,
    pub quick_access: Mutex<()>,
    pub quick_search_epoch: AtomicU64,
    pub progress: Mutex<Option<Value>>,
    pub busy: AtomicUsize,
    pub analysis_busy: AtomicBool,
    pub analysis_cancel: AtomicBool,
    pub analysis_progress: Mutex<Value>,
    journal: Mutex<Journal>,
    checkpoint_write: Mutex<()>,
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    pub instance: String,
    startup: Mutex<Option<Result<(), String>>>,
    startup_complete: Condvar,
    startup_started: Instant,
    startup_elapsed_ms: AtomicU64,
}

// 유닉스 기준 밀리초를 화면에서 사용하는 시각으로 변환한다.
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
// 내부 상태 폴더와 심볼릭 링크를 인덱싱에서 제외한다.
pub fn excluded(path: &Path, data: &Path) -> bool {
    path.starts_with(data)
        || path.components().any(|p| match p {
            Component::Normal(s) => {
                let s = s.to_string_lossy();
                [".git", "node_modules", ".every-directory-trash"].contains(&s.as_ref())
                    || s.starts_with(".ed-work-")
            }
            _ => false,
        })
}

pub fn user_excluded(root:&Root,path:&Path)->bool {
    let Ok(relative)=path.strip_prefix(Path::new(&root.absolute_path)) else{return false};
    let relative=relative.to_string_lossy().replace('\\',"/");
    #[cfg(windows)]
    let relative=relative.to_lowercase();
    root.excluded_paths.iter().any(|rule|{
        #[cfg(windows)] let rule=rule.to_lowercase();
        relative==rule.as_str()||relative.strip_prefix(rule.as_str()).is_some_and(|tail|tail.starts_with('/'))
    })
}

pub(crate) fn entry_metadata(root:&Root,path:&Path,metadata:&fs::Metadata)->Option<Entry>{
    let relative=path.strip_prefix(&root.absolute_path).ok()?.to_string_lossy().replace('\\',"/");
    let name=path.file_name()?.to_string_lossy().into_owned();let directory=metadata.is_dir();
    let timestamp=|time:Result<SystemTime,std::io::Error>|time.ok().and_then(|time|time.duration_since(UNIX_EPOCH).ok()).map(|time|time.as_millis() as u64);
    #[cfg(windows)] let hidden={use std::os::windows::fs::MetadataExt;metadata.file_attributes()&2!=0};
    #[cfg(not(windows))] let hidden=name.starts_with('.');
    Some(Entry{id:format!("{}:{relative}",root.id),root_id:root.id.clone(),name,parent:relative.rsplit_once('/').map_or("",|(parent,_)|parent).into(),path:relative,kind:if directory{"directory"}else{"file"}.into(),extension:if directory{String::new()}else{path.extension().map_or(String::new(),|ext|ext.to_string_lossy().to_lowercase())},size:if directory{None}else{Some(metadata.len())},modified:timestamp(metadata.modified()).unwrap_or(0),created:timestamp(metadata.created()),accessed:timestamp(metadata.accessed()),readonly:metadata.permissions().readonly(),hidden})
}
// 임시 파일을 완성한 뒤 교체해 저장 중 손상을 방지한다.
pub fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("저장 경로가 올바르지 않습니다.")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    {
        // JSON emits many tiny fragments; buffer them instead of issuing a syscall per token.
        let mut writer = BufWriter::with_capacity(256 * 1024, file.as_file_mut());
        serde_json::to_writer(&mut writer, value).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

impl Engine {
    // 별도 앱 데이터 폴더에서 인덱스를 복원한다.
    pub fn new(data: PathBuf) -> Result<Arc<Self>, String> {
        let engine = Self::prepare(data)?;
        let result = engine.restore();
        engine.finish_startup(result.clone());
        result?;
        Ok(engine)
    }

    // Keep disk parsing, search-key generation and watcher setup off the window thread.
    pub fn start(data: PathBuf, import_legacy: bool) -> Result<Arc<Self>, String> {
        let engine = Self::prepare(data)?;
        let worker = engine.clone();
        std::thread::Builder::new().name("index-startup".into()).spawn(move || {
            if import_legacy { crate::import_legacy(&worker.data); }
            let result = worker.restore();
            worker.finish_startup(result);
        }).map_err(|error| error.to_string())?;
        Ok(engine)
    }

    fn prepare(data: PathBuf) -> Result<Arc<Self>, String> {
        fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        let data = data.canonicalize().map_err(|e| e.to_string())?;
        Ok(Arc::new(Self {
            data,
            store: Mutex::new(Store::default()),
            operations: Mutex::new(()),
            quick_access: Mutex::new(()),
            quick_search_epoch: AtomicU64::new(0),
            progress: Mutex::new(None),
            busy: AtomicUsize::new(0),
            analysis_busy: AtomicBool::new(false),
            analysis_cancel: AtomicBool::new(false),
            analysis_progress: Mutex::new(Value::Null),
            journal: Mutex::new(Journal::empty()),
            checkpoint_write: Mutex::new(()),
            watchers: Mutex::new(HashMap::new()),
            instance: Uuid::new_v4().to_string(),
            startup: Mutex::new(None),
            startup_complete: Condvar::new(),
            startup_started: Instant::now(),
            startup_elapsed_ms: AtomicU64::new(0),
        }))
    }

    fn restore(self: &Arc<Self>) -> Result<(), String> {
        let mut store = Store::default();
        let path = self.data.join("index.json");
        let mut saved = if path.exists() {
            serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?
        } else {
            DiskIndex {
                format: 1,
                snapshots: vec![],
                generation: String::new(),
                sequence: 0,
            }
        };
        if saved.format != 1 {
            return Err("지원하지 않는 인덱스 형식입니다.".into());
        }
        let journal = Journal::load(&self.data, &mut saved)?;
        store.snapshots = saved.snapshots;
        // 웹 버전/이전 버전의 일반 Windows 경로도 내부 canonical 경로와 맞춘다.
        for snapshot in &mut store.snapshots {
            // 끊긴 네트워크 경로를 확인하느라 시작이 멈추지 않도록 원격 경로는 저장된 값을 그대로 쓴다.
            let remote = crate::volumes::is_remote(&snapshot.root.volume) || crate::volumes::looks_remote(&snapshot.root.absolute_path);
            if !remote {
                if let Ok(path) = Path::new(&snapshot.root.absolute_path).canonicalize() {
                    snapshot.root.absolute_path = path.to_string_lossy().into_owned();
                }
            }
            snapshot.root.name = crate::file_clipboard::path_text(Path::new(&snapshot.root.name));
        }
        Self::rebuild(&mut store);
        *self.journal.lock().unwrap() = journal;
        *self.store.lock().unwrap() = store;
        for root in self.roots() {
            self.watch(&root);
        }
        self.schedule_checkpoint();
        Ok(())
    }

    fn finish_startup(&self, result: Result<(), String>) {
        self.startup_elapsed_ms.store(self.startup_started.elapsed().as_millis() as u64, Ordering::Relaxed);
        *self.startup.lock().unwrap() = Some(result);
        self.startup_complete.notify_all();
    }

    pub fn wait_ready(&self) -> Result<(), String> {
        let result = self.startup_complete.wait_while(self.startup.lock().unwrap(), |state| state.is_none()).unwrap();
        result.as_ref().unwrap().clone()
    }

    // 등록된 연결 폴더만 반환한다.
    pub fn roots(&self) -> Vec<Root> {
        self.store
            .lock()
            .unwrap()
            .snapshots
            .iter()
            .map(|s| s.root.clone())
            .collect()
    }
    // 인덱싱 진행 상태와 버전을 전달한다.
    pub fn status(&self) -> Value {
        let startup = self.startup.lock().unwrap();
        let ready = startup.as_ref().is_some_and(|result| result.is_ok());
        let error = startup.as_ref().and_then(|result| result.as_ref().err());
        json!({"ready":ready,"startupError":error,"startupElapsedMs":self.startup_elapsed_ms.load(Ordering::Relaxed),
        "instanceId":self.instance,"roots":self.roots(),"version":self.store.lock().unwrap().version,
        "scanning":self.busy.load(Ordering::SeqCst)>0,"progress":self.progress.lock().unwrap().clone(),"runtime":"tauri"})
    }
    // 스냅샷에서 검색 키를 재구성한다.
    fn rebuild(store: &mut Store) {
        store.index.set_roots(store.snapshots.iter().map(|snapshot|snapshot.root.clone()));
        store.index.replace(
            store
                .snapshots
                .iter()
                .flat_map(|s| s.entries.clone())
                .collect(),
        );
        store.version += 1;
    }
    // 큰 검색 인덱스는 잠금 밖에서 만들고 완성된 버전만 교체한다.
    fn install(&self, snapshots: Vec<Snapshot>) {
        let mut updated = Store {
            snapshots,
            ..Store::default()
        };
        Self::rebuild(&mut updated);
        let previous = {
            let mut store = self.store.lock().unwrap();
            updated.version = store.version + 1;
            std::mem::replace(&mut *store, updated)
        };
        drop(previous);
    }
    // 완성된 스냅샷을 디스크에 원자적으로 저장한다.
    pub fn persist(&self, snapshots: Vec<Snapshot>) -> Result<(), String> {
        let _write = self.checkpoint_write.lock().unwrap();
        let generation = Uuid::new_v4().to_string();
        write_json(
            &self.data.join("index.json"),
            &DiskIndex {
                format: 1,
                snapshots,
                generation: generation.clone(),
                sequence: 0,
            },
        )?;
        self.journal.lock().unwrap().reset(&self.data, generation);
        Ok(())
    }

    // Fold a large journal into a checkpoint while new operations keep appending durable records.
    fn schedule_checkpoint(self: &Arc<Self>) {
        let generation = {
            let mut journal = self.journal.lock().unwrap();
            if journal.bytes < COMPACT_BYTES || journal.pending.is_some() {
                return;
            }
            let generation = journal.generation.clone();
            journal.pending = Some(generation.clone());
            generation
        };
        let weak = Arc::downgrade(self);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_secs(2));
            let Some(engine) = weak.upgrade() else {
                return;
            };
            let write = engine.checkpoint_write.lock().unwrap();
            let checkpoint = {
                let store = engine.store.lock().unwrap();
                let journal = engine.journal.lock().unwrap();
                if journal.generation != generation {
                    return;
                }
                if journal.changed.elapsed() < Duration::from_secs(2) {
                    continue;
                }
                DiskIndex {
                    format: 1,
                    snapshots: store.snapshots.clone(),
                    generation: generation.clone(),
                    sequence: journal.sequence,
                }
            };
            let sequence = checkpoint.sequence;
            let result = write_json(&engine.data.join("index.json"), &checkpoint);
            drop(checkpoint);
            {
                let mut journal = engine.journal.lock().unwrap();
                if journal.generation == generation {
                    if result.is_ok() {
                        let _ = journal.compact(&engine.data, sequence);
                    }
                    journal.pending = None;
                }
            }
            drop(write);
            // A failed checkpoint leaves the durable journal intact; retry on a later change.
            if result.is_ok() {
                engine.schedule_checkpoint();
            }
            return;
        });
    }

    // 폴더를 순회하며 심볼릭 링크와 내부 작업 경로를 제외한다.
    fn collect(&self, root: &Root, start: &Path) -> (Vec<Entry>, usize) {
        let base = Path::new(&root.absolute_path);
        let mut entries = vec![];
        let mut skipped = 0;
        for item in WalkDir::new(start)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !excluded(e.path(), &self.data)&&!user_excluded(root,e.path()))
        {
            let item = match item {
                Ok(v) => v,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            if item.path() == base {
                continue;
            }
            if item.file_type().is_symlink()
                || !(item.file_type().is_file() || item.file_type().is_dir())
            {
                skipped += 1;
                continue;
            }
            let metadata = match item.metadata() {
                Ok(m) => m,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            let relative = match item.path().strip_prefix(base) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let relative = relative.to_string_lossy().replace('\\', "/");
            let name = item.file_name().to_string_lossy().to_string();
            let parent = relative.rsplit_once('/').map_or("", |(p, _)| p).to_string();
            let directory = item.file_type().is_dir();
            #[cfg(windows)]
            let hidden = {
                use std::os::windows::fs::MetadataExt;
                metadata.file_attributes() & 2 != 0
            };
            #[cfg(not(windows))]
            let hidden = name.starts_with('.');
            entries.push(Entry {
                id: format!("{}:{}", root.id, relative),
                root_id: root.id.clone(),
                name,
                hidden,
                created: metadata.created().ok().and_then(|time|time.duration_since(UNIX_EPOCH).ok()).map(|time|time.as_millis() as u64),
                accessed: metadata.accessed().ok().and_then(|time|time.duration_since(UNIX_EPOCH).ok()).map(|time|time.as_millis() as u64),
                readonly: metadata.permissions().readonly(),
                extension: if directory {
                    String::new()
                } else {
                    item.path()
                        .extension()
                        .map_or(String::new(), |e| e.to_string_lossy().to_lowercase())
                },
                path: relative,
                parent,
                kind: if directory { "directory" } else { "file" }.into(),
                size: if directory {
                    None
                } else {
                    Some(metadata.len())
                },
                modified: metadata
                    .modified()
                    .ok()
                    .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |v| v.as_millis() as u64),
            });
            if entries.len() % 128 == 0 {
                *self.progress.lock().unwrap() = Some(
                    json!({"rootId":root.id,"count":entries.len(),"directory":item.path().to_string_lossy()}),
                );
            }
        }
        (entries, skipped)
    }

    // 새 폴더를 인덱싱하고 완료된 결과만 반영한다.
    pub fn scan(self: &Arc<Self>, payload: &Value) -> Result<Root, String> {
        let _operation = self.operations.lock().unwrap();
        self.busy.fetch_add(1, Ordering::SeqCst);
        let result = self.scan_locked(payload);
        self.busy.fetch_sub(1, Ordering::SeqCst);
        *self.progress.lock().unwrap() = None;
        result
    }
    // 직렬 작업 안에서 폴더 전체를 갱신한다.
    fn scan_locked(self: &Arc<Self>, payload: &Value) -> Result<Root, String> {
        let existing = payload
            .get("id")
            .and_then(Value::as_str)
            .and_then(|id| self.roots().into_iter().find(|r| r.id == id));
        let requested = existing
            .as_ref()
            .map(|r| r.absolute_path.as_str())
            .or_else(|| payload.get("absolutePath").and_then(Value::as_str))
            .ok_or("폴더 경로를 선택해 주세요.")?;
        if !Path::new(requested).is_absolute() {
            return Err("폴더의 절대 경로가 필요합니다.".into());
        }
        let absolute = crate::volumes::real_path(Path::new(requested))
            .map_err(|e| format!("폴더를 열 수 없습니다: {e}. 네트워크 드라이브는 운영체제에서 연결(로그인)된 상태인지 확인해 주세요."))?;
        if !absolute.is_dir() || excluded(&absolute, &self.data) {
            return Err("연결할 수 없는 폴더입니다.".into());
        }
        let old = self
            .roots()
            .into_iter()
            .find(|r| Path::new(&r.absolute_path) == absolute);
        let excluded_paths=if let Some(rules)=payload.get("excludedPaths"){
            let rules:Vec<String>=serde_json::from_value(rules.clone()).map_err(|_|"제외 폴더 목록이 올바르지 않습니다.")?;
            if rules.len()>128{return Err("제외 폴더는 연결 폴더당 128개까지 지정할 수 있습니다.".into());}
            let mut normalized=vec![];
            for rule in rules{
                let rule=rule.trim().replace('\\',"/").trim_end_matches('/').to_owned();
                if rule.is_empty()||rule.contains(':')||rule.starts_with('/')||rule.len()>32760||rule.split('/').any(|part|part.is_empty()||part=="."||part=="..") {return Err("연결 폴더 안의 상대 폴더 경로를 입력하세요. 상위 경로(..)는 사용할 수 없습니다.".into());}
                if !normalized.contains(&rule){normalized.push(rule);}
            }
            normalized
        }else{old.as_ref().map_or_else(Vec::new,|root|root.excluded_paths.clone())};
        let mut root = Root {
            id: old.map_or_else(|| Uuid::new_v4().to_string(), |r| r.id),
            name: absolute.file_name().map_or_else(
                || crate::file_clipboard::path_text(&absolute),
                |v| v.to_string_lossy().to_string(),
            ),
            absolute_path: absolute.to_string_lossy().to_string(),
            count: 0,
            last_indexed: now(),
            skipped: 0,
            watch_error: None,
            excluded_paths,
            volume: crate::volumes::kind(&absolute).into(),
            refresh_minutes: None,
        };
        if crate::volumes::is_remote(&root.volume) {
            root.refresh_minutes = Some(crate::volumes::NETWORK_REFRESH_MINUTES);
        }
        *self.progress.lock().unwrap() =
            Some(json!({"rootId":root.id,"count":0,"directory":root.name}));
        self.watch(&root);
        let (entries, skipped) = self.collect(&root, &absolute);
        root.count = entries.len();
        root.skipped = skipped;
        let mut next = self.store.lock().unwrap().snapshots.clone();
        next.retain(|s| s.root.id != root.id);
        next.push(Snapshot {
            root: root.clone(),
            entries,
        });
        self.persist(next.clone())?;
        self.install(next);
        Ok(root)
    }

    // 원본 파일은 남기고 연결 정보만 제거한다.
    pub fn remove(&self, id: &str) -> Result<(), String> {
        let _operation = self.operations.lock().unwrap();
        let mut next = self.store.lock().unwrap().snapshots.clone();
        next.retain(|s| s.root.id != id);
        self.persist(next.clone())?;
        self.watchers.lock().unwrap().remove(id);
        self.install(next);
        Ok(())
    }

    // 연결 폴더 안의 등록된 항목만 실제 경로로 변환한다.
    pub fn resolve(&self, location: &Location) -> Result<PathBuf, String> {
        let store = self.store.lock().unwrap();
        let snapshot = store
            .snapshots
            .iter()
            .find(|s| s.root.id == location.root_id)
            .ok_or("연결되지 않은 폴더입니다.")?;
        let relative = Path::new(&location.path);
        if relative.is_absolute()
            || location.path.contains('\\')
            || relative
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
            || location.path.split('/').any(|p| {
                p == "." || p == ".." || p == ".every-directory-trash" || p.starts_with(".ed-work-")
            })
        {
            return Err("연결 폴더 안의 올바른 경로가 필요합니다.".into());
        }
        if !location.path.is_empty() && !snapshot.entries.iter().any(|e| e.path == location.path)&&!user_excluded(&snapshot.root,&Path::new(&snapshot.root.absolute_path).join(relative)) {
            return Err(format!(
                "인덱스에 없는 항목입니다: {}. 새로고침해 주세요.",
                location.path
            ));
        }
        let base = PathBuf::from(&snapshot.root.absolute_path);
        drop(store);
        let mut current = base.clone();
        for part in relative.components() {
            current.push(part);
            if fs::symlink_metadata(&current)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
            {
                return Err("심볼릭 링크는 제외합니다.".into());
            }
        }
        let absolute = crate::volumes::real_path(&current).map_err(|e| e.to_string())?;
        if !absolute.starts_with(&base) {
            return Err("연결 폴더 밖에 접근할 수 없습니다.".into());
        }
        Ok(absolute)
    }

    // 변경된 경로의 하위 항목만 다시 읽어 인덱스를 갱신한다.
    pub fn refresh(self: &Arc<Self>, paths: &[PathBuf]) -> Result<(), String> {
        let paths: Vec<PathBuf> = paths
            .iter()
            .map(|path| {
                let mut ancestor = path.parent().unwrap_or(path);
                let mut tail = vec![path.file_name().unwrap_or_default().to_os_string()];
                loop {
                    if let Ok(mut absolute) = crate::volumes::real_path(ancestor) {
                        for part in tail.iter().rev() {
                            absolute.push(part);
                        }
                        break absolute;
                    }
                    if let Some(parent) = ancestor.parent() {
                        tail.push(ancestor.file_name().unwrap_or_default().to_os_string());
                        ancestor = parent;
                    } else {
                        break path.clone();
                    }
                }
            })
            .collect();
        let mut gathered = vec![];
        for root in self.roots() {
            let base = Path::new(&root.absolute_path);
            let relevant: Vec<_> = paths
                .iter()
                .filter(|p| p.starts_with(base) && !excluded(p, &self.data)&&!user_excluded(&root,p))
                .collect();
            if relevant.is_empty() {
                continue;
            }
            let mut changed = vec![];
            for path in relevant {
                if changed.iter().any(|p: &PathBuf| path.starts_with(p)) {
                    continue;
                }
                changed.retain(|p| !p.starts_with(path));
                changed.push(path.clone());
            }
            let mut relatives = vec![];
            let mut entries = vec![];
            for path in changed {
                let relative = path
                    .strip_prefix(base)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                relatives.push(relative);
                if path.exists()
                    && !fs::symlink_metadata(&path)
                        .map_err(|e| e.to_string())?
                        .file_type()
                        .is_symlink()
                {
                    let (updated, _) = self.collect(&root, &path);
                    entries.extend(updated);
                }
            }
            gathered.push((root.id, relatives, entries));
        }
        let mut store = self.store.lock().unwrap();
        let mut mutation = Mutation::default();
        for (root_id, relatives, entries) in gathered {
            let Some(snapshot) = store.snapshots.iter().find(|s| s.root.id == root_id) else {
                continue;
            };
            let mut incoming: HashMap<_, _> = entries
                .into_iter()
                .map(|entry| (entry.id.clone(), entry))
                .collect();
            let prefixes: Vec<_> = relatives.iter().map(|p| format!("{p}/")).collect();
            let previous_removed = mutation.removed.len();
            let previous_entries = mutation.entries.len();
            for entry in &snapshot.entries {
                if !relatives.iter().any(|p| p.is_empty() || entry.path == *p)
                    && !prefixes.iter().any(|p| entry.path.starts_with(p))
                {
                    continue;
                }
                match incoming.remove(&entry.id) {
                    Some(next) if next.same_index_data(entry) => {}
                    Some(next) => mutation.entries.push(next),
                    None => mutation.removed.push(entry.id.clone()),
                }
            }
            let added = incoming.len();
            mutation.entries.extend(incoming.into_values());
            if mutation.removed.len() != previous_removed
                || mutation.entries.len() != previous_entries
            {
                let mut root = snapshot.root.clone();
                root.count =
                    snapshot.entries.len() - (mutation.removed.len() - previous_removed) + added;
                root.last_indexed = now();
                mutation.roots.push(root);
            }
        }
        // Duplicate OS notifications do not clone, serialize, or rebuild the index.
        if mutation.roots.is_empty() {
            return Ok(());
        }
        self.journal.lock().unwrap().append(&self.data, &mutation)?;
        store
            .index
            .update(&mutation.removed, mutation.entries.clone());
        mutation.apply(&mut store.snapshots);
        store.version += 1;
        drop(store);
        self.schedule_checkpoint();
        Ok(())
    }

    // 운영체제 변경 이벤트를 묶어 증분 갱신한다.
    fn watch(self: &Arc<Self>, root: &Root) {
        if crate::volumes::is_remote(&root.volume) || crate::volumes::looks_remote(&root.absolute_path) {
            // 네트워크 드라이브는 감시 등록이 오래 걸리거나 다른 PC의 변경을 놓칠 수 있어 별도 스레드에서 주기 확인과 함께 시작한다.
            self.set_refresh_minutes(&root.id, Some(crate::volumes::NETWORK_REFRESH_MINUTES));
            let engine = Arc::downgrade(self);
            let root = root.clone();
            std::thread::spawn(move || {
                if let Some(engine) = engine.upgrade() {
                    engine.start_watcher(&root);
                }
                Self::poll_remote(engine, root);
            });
            return;
        }
        self.start_watcher(root);
        if root.volume.is_empty() {
            // 이전 버전에서 연결한 폴더는 종류를 백그라운드에서 판별하고, 네트워크면 주기 확인을 켠다.
            let engine = Arc::downgrade(self);
            let mut root = root.clone();
            std::thread::spawn(move || {
                root.volume = crate::volumes::kind(Path::new(&root.absolute_path)).into();
                let Some(strong) = engine.upgrade() else { return };
                {
                    let mut store = strong.store.lock().unwrap();
                    if let Some(snapshot) = store.snapshots.iter_mut().find(|s| s.root.id == root.id) {
                        snapshot.root.volume = root.volume.clone();
                    }
                }
                if crate::volumes::is_remote(&root.volume) {
                    strong.set_refresh_minutes(&root.id, Some(crate::volumes::NETWORK_REFRESH_MINUTES));
                    drop(strong);
                    Self::poll_remote(engine, root);
                }
            });
        }
    }

    // 운영체제 변경 알림을 등록하고, 실패하면 연결 폴더에 이유를 남긴다.
    fn start_watcher(self: &Arc<Self>, root: &Root) {
        let mut watchers = self.watchers.lock().unwrap();
        if watchers.contains_key(&root.id) {
            return;
        }
        let (tx, rx) = mpsc::channel();
        let mut watcher = match notify::recommended_watcher(move |event| {
            let _ = tx.send(event);
        }) {
            Ok(w) => w,
            Err(_) => return,
        };
        if let Err(error) = watcher.watch(Path::new(&root.absolute_path), RecursiveMode::Recursive)
        {
            let mut store = self.store.lock().unwrap();
            if let Some(s) = store.snapshots.iter_mut().find(|s| s.root.id == root.id) {
                s.root.watch_error = Some(if crate::volumes::is_remote(&root.volume) {
                    format!("실시간 감시를 지원하지 않는 드라이브라 {}분마다 변경을 확인합니다. ({error})", crate::volumes::NETWORK_REFRESH_MINUTES)
                } else {
                    error.to_string()
                });
            }
            return;
        }
        watchers.insert(root.id.clone(), watcher);
        let engine = Arc::downgrade(self);
        let root_path = PathBuf::from(&root.absolute_path);
        std::thread::spawn(move || {
            while let Ok(event) = rx.recv() {
                let Some(engine) = engine.upgrade() else {
                    break;
                };
                let mut paths = vec![];
                let push_event =
                    |event: notify::Result<notify::Event>, paths: &mut Vec<PathBuf>| match event {
                        Ok(e) => {
                            if !e.need_rescan()&&(e.kind.is_access()||matches!(e.kind,notify::EventKind::Modify(notify::event::ModifyKind::Metadata(notify::event::MetadataKind::AccessTime)))){return;}
                            if e.need_rescan() {
                                paths.push(root_path.clone());
                            } else if !matches!(e.kind, notify::EventKind::Access(_)) {
                                paths.extend(e.paths);
                            }
                        }
                        Err(_) => paths.push(root_path.clone()),
                    };
                push_event(event, &mut paths);
                while let Ok(event) = rx.recv_timeout(Duration::from_millis(180)) {
                    push_event(event, &mut paths);
                    if paths.len() > 1000 {
                        break;
                    }
                }
                paths.retain(|p| !excluded(p, &engine.data));
                if paths.is_empty() {
                    continue;
                }
                let _operation = engine.operations.lock().unwrap();
                let _ = engine.refresh(&paths);
                *engine.progress.lock().unwrap() = None;
            }
        });
    }

    // 연결 폴더의 주기 확인 간격을 기록해 화면에 표시한다.
    fn set_refresh_minutes(&self, id: &str, minutes: Option<u32>) {
        let mut store = self.store.lock().unwrap();
        if let Some(snapshot) = store.snapshots.iter_mut().find(|s| s.root.id == id) {
            snapshot.root.refresh_minutes = minutes;
        }
    }

    // 네트워크 드라이브는 실시간 알림과 별개로 주기적으로 다시 읽어 다른 PC의 변경을 반영한다.
    // 한 번 읽는 데 오래 걸리면 간격을 늘리고, 연결이 끊겼을 때는 마지막 색인을 유지한다.
    fn poll_remote(engine: std::sync::Weak<Self>, root: Root) {
        let minimum = Duration::from_secs(crate::volumes::NETWORK_REFRESH_MINUTES as u64 * 60);
        let mut interval = minimum;
        loop {
            std::thread::sleep(interval);
            let Some(engine) = engine.upgrade() else { break };
            if !engine.roots().iter().any(|item| item.id == root.id) {
                break;
            }
            let path = PathBuf::from(&root.absolute_path);
            let offline = !path.is_dir();
            {
                let mut store = engine.store.lock().unwrap();
                if let Some(snapshot) = store.snapshots.iter_mut().find(|s| s.root.id == root.id) {
                    if offline {
                        snapshot.root.watch_error = Some("네트워크 위치에 연결할 수 없어 마지막 색인을 표시합니다. 다시 연결되면 자동으로 갱신합니다.".into());
                    } else if snapshot.root.watch_error.as_deref().is_some_and(|message| message.starts_with("네트워크 위치에 연결할 수 없어")) {
                        snapshot.root.watch_error = None;
                    }
                }
            }
            if offline {
                continue;
            }
            let started = std::time::Instant::now();
            {
                let _operation = engine.operations.lock().unwrap();
                let _ = engine.refresh(&[path]);
                *engine.progress.lock().unwrap() = None;
            }
            interval = (started.elapsed() * 10).clamp(minimum, Duration::from_secs(60 * 60));
            engine.set_refresh_minutes(&root.id, Some((interval.as_secs() / 60) as u32));
        }
    }

    // Windows 주소 입력은 대소문자가 달라도 인덱스에 저장된 실제 표기로 복원한다.
    pub fn directory_location(&self, location: &Location) -> Result<Location, String> {
        let path = if location.path.is_empty() {
            String::new()
        } else {
            let store = self.store.lock().unwrap();
            let folded_path = location.path.to_lowercase();
            let matches =
                |entry: &&Entry| entry.root_id == location.root_id && entry.kind == "directory";
            let exact = store
                .index
                .entries
                .iter()
                .filter(matches)
                .find(|entry| entry.path == location.path);
            let folded = || {
                store
                    .index
                    .entries
                    .iter()
                    .filter(matches)
                    .find(|entry| cfg!(windows) && entry.path.to_lowercase() == folded_path)
            };
            if let Some(entry)=exact.or_else(folded){entry.path.clone()}
            else if store.snapshots.iter().any(|snapshot|snapshot.root.id==location.root_id&&user_excluded(&snapshot.root,&Path::new(&snapshot.root.absolute_path).join(&location.path))){location.path.clone()}
            else{return Err("인덱스에 없는 폴더입니다. 경로를 확인하거나 새로고침해 주세요.".into());}
        };
        let result = Location {
            root_id: location.root_id.clone(),
            path,
        };
        if !self.resolve(&result)?.is_dir() {
            return Err("폴더 경로를 입력해 주세요.".into());
        }
        Ok(result)
    }

    // 폴더의 직접 자식만 정렬해 탐색창에 전달한다.
    pub fn list(&self, location: &Location) -> Result<Vec<Entry>, String> {
        let directory=self.resolve(location)?;
        let root=self.roots().into_iter().find(|root|root.id==location.root_id).ok_or("연결되지 않은 폴더입니다.")?;
        let mut entries=vec![];
        for item in fs::read_dir(directory).map_err(|error|error.to_string())?{
            let Ok(item)=item else{continue};let path=item.path();
            if excluded(&path,&self.data){continue;}
            let Ok(metadata)=fs::symlink_metadata(&path) else{continue};
            if metadata.file_type().is_symlink()||(!metadata.is_file()&&!metadata.is_dir()){continue;}
            if let Some(entry)=entry_metadata(&root,&path,&metadata){entries.push(entry);}
        }
        entries.sort_by(|a, b| {
            (b.kind == "directory")
                .cmp(&(a.kind == "directory"))
                .then_with(|| normalize(&a.name).cmp(&normalize(&b.name)))
        });
        Ok(entries)
    }
}

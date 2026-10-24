use crate::{
    model::{Entry, Location, Root},
    search::{normalize, Index},
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
use walkdir::WalkDir;

// 저장된 폴더와 파일 목록을 함께 복원한다.
#[derive(Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub root: Root,
    pub entries: Vec<Entry>,
}
// 기존 로컬 서버 인덱스도 읽을 수 있는 저장 형식이다.
#[derive(Serialize, Deserialize)]
pub struct DiskIndex {
    pub format: u8,
    pub snapshots: Vec<Snapshot>,
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
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
    pub instance: String,
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
// 임시 파일을 완성한 뒤 교체해 저장 중 손상을 방지한다.
pub fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("저장 경로가 올바르지 않습니다.")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    serde_json::to_writer(file.as_file_mut(), value).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

impl Engine {
    // 별도 앱 데이터 폴더에서 인덱스를 복원한다.
    pub fn new(data: PathBuf) -> Result<Arc<Self>, String> {
        fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        let data = data.canonicalize().map_err(|e| e.to_string())?;
        let mut store = Store::default();
        let path = data.join("index.json");
        if path.exists() {
            let saved: DiskIndex =
                serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            if saved.format != 1 {
                return Err("지원하지 않는 인덱스 형식입니다.".into());
            }
            store.snapshots = saved.snapshots;
            // 웹 버전/이전 버전의 일반 Windows 경로도 내부 canonical 경로와 맞춘다.
            for snapshot in &mut store.snapshots {
                if let Ok(path) = Path::new(&snapshot.root.absolute_path).canonicalize() {
                    snapshot.root.absolute_path = path.to_string_lossy().into_owned();
                }
                snapshot.root.name =
                    crate::file_clipboard::path_text(Path::new(&snapshot.root.name));
            }
            Self::rebuild(&mut store);
        }
        let engine = Arc::new(Self {
            data,
            store: Mutex::new(store),
            operations: Mutex::new(()),
            quick_access: Mutex::new(()),
            quick_search_epoch: AtomicU64::new(0),
            progress: Mutex::new(None),
            busy: AtomicUsize::new(0),
            analysis_busy: AtomicBool::new(false),
            analysis_cancel: AtomicBool::new(false),
            analysis_progress: Mutex::new(Value::Null),
            watchers: Mutex::new(HashMap::new()),
            instance: Uuid::new_v4().to_string(),
        });
        for root in engine.roots() {
            engine.watch(&root);
        }
        Ok(engine)
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
        json!({"instanceId":self.instance,"roots":self.roots(),"version":self.store.lock().unwrap().version,
        "scanning":self.busy.load(Ordering::SeqCst)>0,"progress":self.progress.lock().unwrap().clone(),"runtime":"tauri"})
    }
    // 스냅샷에서 검색 키를 재구성한다.
    fn rebuild(store: &mut Store) {
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
        write_json(
            &self.data.join("index.json"),
            &DiskIndex {
                format: 1,
                snapshots,
            },
        )
    }

    // 폴더를 순회하며 심볼릭 링크와 내부 작업 경로를 제외한다.
    fn collect(&self, root: &Root, start: &Path) -> (Vec<Entry>, usize) {
        let base = Path::new(&root.absolute_path);
        let mut entries = vec![];
        let mut skipped = 0;
        for item in WalkDir::new(start)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| !excluded(e.path(), &self.data))
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
        let absolute = Path::new(requested)
            .canonicalize()
            .map_err(|e| format!("폴더를 열 수 없습니다: {e}"))?;
        if !absolute.is_dir() || excluded(&absolute, &self.data) {
            return Err("연결할 수 없는 폴더입니다.".into());
        }
        let old = self
            .roots()
            .into_iter()
            .find(|r| Path::new(&r.absolute_path) == absolute);
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
        };
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
        if !location.path.is_empty() && !snapshot.entries.iter().any(|e| e.path == location.path) {
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
        let absolute = current.canonicalize().map_err(|e| e.to_string())?;
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
                    if let Ok(mut absolute) = ancestor.canonicalize() {
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
        let mut next = self.store.lock().unwrap().snapshots.clone();
        for snapshot in &mut next {
            let base = Path::new(&snapshot.root.absolute_path);
            let relevant: Vec<_> = paths
                .iter()
                .filter(|p| p.starts_with(base) && !excluded(p, &self.data))
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
            for path in changed {
                let relative = path
                    .strip_prefix(base)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                snapshot.entries.retain(|e| {
                    !(relative.is_empty()
                        || e.path == relative
                        || e.path.starts_with(&format!("{relative}/")))
                });
                if path.exists()
                    && !fs::symlink_metadata(&path)
                        .map_err(|e| e.to_string())?
                        .file_type()
                        .is_symlink()
                {
                    let (entries, _) = self.collect(&snapshot.root, &path);
                    snapshot.entries.extend(entries);
                }
            }
            snapshot.root.count = snapshot.entries.len();
            snapshot.root.last_indexed = now();
        }
        self.persist(next.clone())?;
        self.install(next);
        Ok(())
    }

    // 운영체제 변경 이벤트를 묶어 증분 갱신한다.
    fn watch(self: &Arc<Self>, root: &Root) {
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
                s.root.watch_error = Some(error.to_string());
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
            exact
                .or_else(folded)
                .ok_or("인덱스에 없는 폴더입니다. 경로를 확인하거나 새로고침해 주세요.")?
                .path
                .clone()
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
        self.resolve(location)?;
        let store = self.store.lock().unwrap();
        let mut entries: Vec<_> = store
            .index
            .entries
            .iter()
            .filter(|e| e.root_id == location.root_id && e.parent == location.path)
            .cloned()
            .collect();
        entries.sort_by(|a, b| {
            (b.kind == "directory")
                .cmp(&(a.kind == "directory"))
                .then_with(|| normalize(&a.name).cmp(&normalize(&b.name)))
        });
        Ok(entries)
    }
}

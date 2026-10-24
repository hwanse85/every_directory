use crate::{
    model::{Entry, Location},
    store::{now, write_json, Engine},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// 파일과 폴더의 즐겨찾기 및 최근 열기 위치를 저장한다.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickItem {
    pub root_id: String,
    pub path: String,
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub opened_at: u64,
}

// 두 창이 공유하는 업무 바로가기와 검색 기록이다.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuickAccess {
    pub initialized: bool,
    pub favorites: Vec<QuickItem>,
    pub opened: Vec<QuickItem>,
    pub recent: Vec<String>,
}

// 인덱스 메타데이터에서 현재 위치를 확인한다.
pub fn entry(engine: &Engine, location: &Location) -> Result<Entry, String> {
    let store = engine.store.lock().unwrap();
    let snapshot = store
        .snapshots
        .iter()
        .find(|s| s.root.id == location.root_id)
        .ok_or("연결되지 않은 폴더입니다.")?;
    if location.path.is_empty() {
        return Ok(Entry {
            id: format!("{}:", location.root_id),
            root_id: location.root_id.clone(),
            path: String::new(),
            parent: String::new(),
            name: snapshot.root.name.clone(),
            kind: "directory".into(),
            extension: String::new(),
            size: None,
            modified: 0,
        });
    }
    snapshot
        .entries
        .iter()
        .find(|e| e.path == location.path)
        .cloned()
        .ok_or_else(|| "파일 위치가 바뀌었습니다. 연결 폴더를 새로고침해 주세요.".into())
}

// 현재 인덱스에서 검증한 항목만 바로가기 데이터로 변환한다.
fn item(engine: &Engine, value: Value) -> Result<QuickItem, String> {
    let location: Location = serde_json::from_value(value).map_err(|e| e.to_string())?;
    let e = entry(engine, &location)?;
    Ok(QuickItem {
        root_id: e.root_id,
        path: e.path,
        name: e.name,
        kind: e.kind,
        opened_at: now(),
    })
}

// 중복 없는 검색어를 최근 순으로 제한해 저장한다.
fn record_query(access: &mut QuickAccess, query: &str) {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 512 {
        return;
    }
    access.recent.retain(|q| q != query);
    access.recent.insert(0, query.to_owned());
    access.recent.truncate(20);
}

// 저장값이 손상된 경우 원본을 보존하고 명확한 오류를 반환한다.
fn read(engine: &Engine) -> Result<QuickAccess, String> {
    let path = engine.data.join("quick-access.json");
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| {
            "즐겨찾기 저장 파일을 읽지 못했습니다. quick-access.json을 확인해 주세요.".into()
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(QuickAccess::default()),
        Err(e) => Err(e.to_string()),
    }
}

// 즐겨찾기 변경과 기록 추가를 직렬화해 창 사이의 덮어쓰기를 막는다.
pub fn request(engine: &Engine, payload: Value) -> Result<Value, String> {
    let _guard = engine.quick_access.lock().unwrap();
    let mut access = read(engine)?;
    let action = payload["action"].as_str().unwrap_or("snapshot");
    match action {
        "snapshot" => {}
        "migrate" => {
            if !access.initialized {
                if let Some(favorites) = payload["favorites"].as_array() {
                    for value in favorites.iter().take(200) {
                        if let Ok(favorite) = item(engine, value.clone()) {
                            if !access
                                .favorites
                                .iter()
                                .any(|f| f.root_id == favorite.root_id && f.path == favorite.path)
                            {
                                access.favorites.push(favorite);
                            }
                        }
                    }
                }
                if let Some(recent) = payload["recent"].as_array() {
                    for query in recent.iter().take(20).rev().filter_map(Value::as_str) {
                        record_query(&mut access, query);
                    }
                }
                access.initialized = true;
            }
        }
        "favorite" => {
            let location: Location =
                serde_json::from_value(payload["location"].clone()).map_err(|e| e.to_string())?;
            if let Some(index) = access
                .favorites
                .iter()
                .position(|f| f.root_id == location.root_id && f.path == location.path)
            {
                access.favorites.remove(index);
            } else {
                if access.favorites.len() >= 200 {
                    return Err("즐겨찾기는 200개까지 추가할 수 있습니다.".into());
                }
                access
                    .favorites
                    .push(item(engine, payload["location"].clone())?);
            }
        }
        "opened" => {
            let opened = item(engine, payload["location"].clone())?;
            access
                .opened
                .retain(|f| f.root_id != opened.root_id || f.path != opened.path);
            access.opened.insert(0, opened);
            access.opened.truncate(30);
            record_query(&mut access, payload["query"].as_str().unwrap_or(""));
        }
        "query" => record_query(&mut access, payload["query"].as_str().unwrap_or("")),
        "clearRecent" => {
            access.opened.clear();
            access.recent.clear();
        }
        _ => return Err("지원하지 않는 바로가기 작업입니다.".into()),
    }
    if action != "snapshot" {
        write_json(&engine.data.join("quick-access.json"), &access)?;
    }
    serde_json::to_value(access).map_err(|e| e.to_string())
}

// 끊긴 위치는 제외하고 바로가기 순서대로 현재 파일 정보를 반환한다.
pub fn suggestions(engine: &Engine) -> Result<Value, String> {
    let (access, warning) = match request(engine, json!({})) {
        Ok(access) => (access, None),
        Err(error) => (json!(QuickAccess::default()), Some(error)),
    };
    let mut entries = Vec::new();
    for value in access["favorites"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(access["opened"].as_array().into_iter().flatten())
    {
        let location: Location =
            serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
        if let Ok(e) = entry(engine, &location) {
            if !entries.iter().any(|old: &Entry| old.id == e.id) {
                entries.push(e);
            }
        }
        if entries.len() >= 12 {
            break;
        }
    }
    Ok(json!({"access":access, "entries":entries, "roots":engine.roots(), "warning":warning}))
}

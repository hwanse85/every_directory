use every_directory_lib::{dispatch, model::SearchOptions, search::Index, store::Engine};
use serde_json::{json, Value};
use std::{fs, sync::Arc};

// 서로 다른 창의 요청을 독립된 임시 저장소에서 검증한다.
fn fixture() -> (tempfile::TempDir, Arc<Engine>, String) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("files");
    fs::create_dir(&root).unwrap();
    fs::create_dir(root.join("설계")).unwrap();
    fs::write(root.join("설계/업무 보고서.txt"), "문서").unwrap();
    let engine = Engine::new(temp.path().join("data")).unwrap();
    let root = engine.scan(&json!({"absolutePath":root})).unwrap();
    (temp, engine, root.id)
}

// 즐겨찾기와 최근 기록을 여러 요청과 재시작 후에도 보존한다.
#[test]
fn shared_access_migrates_and_persists_files_and_folders() {
    let (_temp, engine, root) = fixture();
    let location = json!({"rootId":root,"path":"설계/업무 보고서.txt"});
    let access = dispatch(
        &engine,
        "quickAccess",
        json!({"action":"migrate","favorites":[{"rootId":root,"path":"설계"}],"recent":["보고서"]}),
    )
    .unwrap();
    assert_eq!(access["favorites"][0]["kind"], "directory");
    let access = dispatch(
        &engine,
        "quickAccess",
        json!({"action":"favorite","location":location}),
    )
    .unwrap();
    assert_eq!(access["favorites"][1]["kind"], "file");
    for query in ["설계", "보고서", "보고서"] {
        dispatch(
            &engine,
            "quickAccess",
            json!({"action":"opened","location":location,"query":query}),
        )
        .unwrap();
    }
    let reopened = Engine::new(engine.data.clone()).unwrap();
    let saved = dispatch(&reopened, "quickAccess", json!({})).unwrap();
    assert_eq!(saved["opened"].as_array().unwrap().len(), 1);
    assert_eq!(saved["recent"], json!(["보고서", "설계"]));
    assert_eq!(saved["favorites"].as_array().unwrap().len(), 2);
    dispatch(
        &reopened,
        "quickAccess",
        json!({"action":"migrate","favorites":[]}),
    )
    .unwrap();
    assert_eq!(
        dispatch(&reopened, "quickSuggestions", json!({})).unwrap()["entries"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    dispatch(&engine, "quickAccess", json!({"action":"clearRecent"})).unwrap();
    let cleared = dispatch(&engine, "quickAccess", json!({})).unwrap();
    assert!(cleared["opened"].as_array().unwrap().is_empty());
    assert_eq!(cleared["favorites"].as_array().unwrap().len(), 2);
}

// 동시 추가가 마지막 창의 쓰기로 사라지지 않는지 확인한다.
#[test]
fn concurrent_window_updates_are_not_lost() {
    let (_temp, engine, root) = fixture();
    std::thread::scope(|scope| {
        for n in 0..20 {
            let engine = engine.clone();
            scope.spawn(move || {
                dispatch(
                    &engine,
                    "quickAccess",
                    json!({"action":"query","query":format!("query-{n}")}),
                )
                .unwrap();
            });
        }
    });
    let access = dispatch(&engine, "quickAccess", json!({})).unwrap();
    assert_eq!(access["recent"].as_array().unwrap().len(), 20);
    assert!(dispatch(
        &engine,
        "quickAccess",
        json!({"action":"favorite","location":{"rootId":root,"path":"../outside"}})
    )
    .is_err());
}

// 손상된 저장 파일은 자동 덮어쓰기 없이 오류로 보고한다.
#[test]
fn damaged_preferences_are_preserved() {
    let (_temp, engine, _root) = fixture();
    let path = engine.data.join("quick-access.json");
    fs::write(&path, "damaged").unwrap();
    assert!(dispatch(&engine, "quickAccess", json!({"action":"clearRecent"})).is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "damaged");
    let suggestions = dispatch(&engine, "quickSuggestions", json!({})).unwrap();
    assert_eq!(suggestions["roots"].as_array().unwrap().len(), 1);
    assert!(suggestions["warning"].is_string());
}

// 검색 결과 앞부분 밖의 정확한 이름과 즐겨찾기도 상위에 포함한다.
#[test]
fn quick_ranking_checks_all_candidates_and_supports_cancellation() {
    let entries: Vec<_> = (0..1500).map(|n| serde_json::from_value(json!({"id":format!("r:{n}"),"rootId":"r","path":format!("report-{n}.txt"),"parent":"","name":if n == 1499 { "report".to_owned() } else { format!("report-{n}.txt") },"kind":"file","extension":"txt","size":1,"modified":0})).unwrap()).collect();
    let mut index = Index::default();
    index.replace(entries);
    let options: SearchOptions =
        serde_json::from_value(json!({"query":"report","limit":3})).unwrap();
    let boosts = [("r:1400".to_owned(), 0)].into_iter().collect();
    let result = index.quick_search(&options, &boosts, &|| false).unwrap();
    assert_eq!(result.total, 1500);
    assert_eq!(result.entries[0].id, "r:1499");
    assert_eq!(result.entries[1].id, "r:1400");
    assert_eq!(result.entries.len(), 3);
    assert!(index.quick_search(&options, &boosts, &|| true).is_err());
}

// 원래 파일이 없어지면 운영체제 복사를 실행하기 전에 거부한다.
#[test]
fn clipboard_rejects_unregistered_or_missing_paths() {
    let (_temp, engine, root) = fixture();
    let location = serde_json::from_value::<every_directory_lib::model::Location>(
        json!({"rootId":root,"path":"../outside"}),
    )
    .unwrap();
    assert!(every_directory_lib::file_clipboard::copy(&engine, &[location], 0, false).is_err());
    assert!(every_directory_lib::file_clipboard::copy(&engine, &[], 0, false).is_err());
    let _: Value = dispatch(&engine, "quickAccess", json!({})).unwrap();
}

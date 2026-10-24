use every_directory_lib::{dispatch, model::Location, operations, store::Engine};
use serde_json::json;
use std::{fs, sync::Arc};

// 실제 파일과 연결된 폴더를 격리된 임시 디렉터리에 준비한다.
fn fixture() -> (tempfile::TempDir, Arc<Engine>, String, std::path::PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("files");
    fs::create_dir_all(root.join("대상")).unwrap();
    fs::write(root.join("업무 보고서.txt"), "보고서 내용").unwrap();
    fs::write(root.join("배관 검사.txt"), "도면").unwrap();
    let engine = Engine::new(temp.path().join("data")).unwrap();
    let id = engine.scan(&json!({"absolutePath":root})).unwrap().id;
    (temp, engine, id, root)
}

// 기본 모드는 일반 단어·초성·혼합 음절·IME 겹받침을 구분해 찾는다.
#[test]
fn hybrid_search_preserves_literal_words_and_splits_ime_clusters() {
    let (_temp, engine, id, _) = fixture();
    for (query, expected) in [
        ("ㅂㄳ", "업무 보고서.txt"),
        ("ㅂㄱㅅ", "업무 보고서.txt"),
        ("보고ㅅ", "업무 보고서.txt"),
        ("보고서", "업무 보고서.txt"),
        ("배관", "배관 검사.txt"),
    ] {
        let result = dispatch(&engine, "search", json!({"query":query,"rootId":id})).unwrap();
        assert_eq!(result["total"], 1, "{query}");
        assert_eq!(result["entries"][0]["name"], expected);
    }
}

// 속성은 긴 파일 작업의 잠금을 기다리거나 폴더 전체를 다시 읽지 않는다.
#[test]
fn folder_properties_are_immediate_index_summaries() {
    let (_temp, engine, id, root) = fixture();
    let _held = engine.operations.lock().unwrap();
    fs::write(root.join("아직 색인하지 않은 파일.txt"), "not indexed").unwrap();
    let result = dispatch(
        &engine,
        "operation",
        json!({"action":"properties","entries":[{"rootId":id,"path":""}]}),
    )
    .unwrap();
    assert_eq!(result["files"], 2);
    assert_eq!(result["directories"], 2);
    assert_eq!(result["cached"], true);
    assert_eq!(result["bytes"], "보고서 내용".len() + "도면".len());
}

// OS 클립보드의 외부 파일은 사본으로 가져오고 이름 충돌 시 기존 파일을 지킨다.
#[test]
fn external_paste_preserves_sources_and_existing_destinations() {
    let (temp, engine, id, root) = fixture();
    let source = temp.path().join("외부 문서.txt");
    fs::write(&source, "external bytes").unwrap();
    let destination = Location {
        root_id: id.clone(),
        path: "대상".into(),
    };
    operations::paste_external(&engine, &[source.clone()], &destination).unwrap();
    assert_eq!(
        fs::read(root.join("대상/외부 문서.txt")).unwrap(),
        fs::read(&source).unwrap()
    );
    assert!(source.is_file());
    assert!(operations::paste_external(&engine, &[source], &destination).is_err());
    assert_eq!(engine.list(&destination).unwrap().len(), 1);
}

// 이전 설정 파일에도 새 기본값을 적용하고 사용자의 자동 시작 해제는 유지한다.
#[test]
fn desktop_preferences_migrate_without_discarding_user_choices() {
    use every_directory_lib::desktop::DesktopSettings;
    let old: DesktopSettings =
        serde_json::from_value(json!({"keepRunning":false,"shortcut":"Ctrl+Alt+Space"})).unwrap();
    assert!(!old.keep_running);
    assert!(old.auto_start);
    assert_eq!(old.default_search_mode, "initials");
    let saved: DesktopSettings =
        serde_json::from_value(json!({"autoStart":false,"startInTray":true})).unwrap();
    assert!(!saved.auto_start);
    assert!(saved.start_in_tray);
}

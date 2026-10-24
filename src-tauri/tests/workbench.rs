use every_directory_lib::{dispatch, store::Engine};
use serde_json::{json, Value};
use std::{fs, sync::Arc};

// 두 탐색창에 대응하는 실제 폴더와 독립 인덱스를 준비한다.
fn fixture() -> (tempfile::TempDir, Arc<Engine>, String) {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("files");
    fs::create_dir_all(root.join("left")).unwrap();
    fs::create_dir_all(root.join("right")).unwrap();
    fs::write(root.join("left/원본.txt"), "한글 원본 파일").unwrap();
    let engine = Engine::new(temporary.path().join("data")).unwrap();
    let id = engine.scan(&json!({"absolutePath":root})).unwrap().id;
    (temporary, engine, id)
}

// 화면과 동일한 IPC를 통해 파일 작업을 호출한다.
fn operation(
    engine: &Arc<Engine>,
    id: &str,
    action: &str,
    entries: &[&str],
    name: Option<&str>,
) -> Result<Value, String> {
    dispatch(
        engine,
        "operation",
        json!({"action":action,"entries":entries.iter().map(|path|json!({"rootId":id,"path":path})).collect::<Vec<_>>(),"name":name,"destination":{"rootId":id,"path":"left"}}),
    )
}

// 사본을 연속 생성해도 원본과 기존 사본을 덮어쓰지 않는다.
#[test]
fn duplicate_and_new_file_preserve_existing_content() {
    let (temporary, engine, id) = fixture();
    for _ in 0..2 {
        operation(&engine, &id, "duplicate", &["left/원본.txt"], None).unwrap();
    }
    let root = temporary.path().join("files");
    for name in ["원본.txt", "원본 사본.txt", "원본 사본 2.txt"] {
        assert_eq!(
            fs::read_to_string(root.join("left").join(name)).unwrap(),
            "한글 원본 파일"
        );
    }
    operation(&engine, &id, "mkfile", &[], Some("노트.txt")).unwrap();
    assert_eq!(fs::metadata(root.join("left/노트.txt")).unwrap().len(), 0);
    fs::write(root.join("left/노트.txt"), "보존").unwrap();
    assert!(operation(&engine, &id, "mkfile", &[], Some("노트.txt")).is_err());
    assert_eq!(
        fs::read_to_string(root.join("left/노트.txt")).unwrap(),
        "보존"
    );
    assert!(operation(&engine, &id, "mkfile", &[], Some("../outside.txt")).is_err());
}

// 파일 크기가 같아도 내용이 다른 항목은 중복으로 오인하지 않는다.
#[test]
fn duplicate_analysis_checks_content_and_excludes_internal_files() {
    let (temporary, engine, id) = fixture();
    let root = temporary.path().join("files");
    fs::write(root.join("left/a.txt"), "ABCD").unwrap();
    fs::write(root.join("left/이름이 다른 사본.txt"), "ABCD").unwrap();
    fs::write(root.join("left/not-duplicate.txt"), "DCBA").unwrap();
    fs::create_dir(root.join("left/.every-directory-trash")).unwrap();
    fs::write(root.join("left/.every-directory-trash/ignored.txt"), "ABCD").unwrap();
    let result = dispatch(
        &engine,
        "analysis",
        json!({"action":"duplicates","location":{"rootId":id,"path":"left"}}),
    )
    .unwrap();
    assert_eq!(result["totalGroups"], 1);
    assert_eq!(result["groups"][0]["files"].as_array().unwrap().len(), 2);
    assert_eq!(result["recoverableBytes"], 4);
    assert_eq!(result["partial"], false);
    let stats = dispatch(
        &engine,
        "analysis",
        json!({"action":"stats","location":{"rootId":id,"path":"left"}}),
    )
    .unwrap();
    assert_eq!(stats["files"], 4);
    assert_eq!(stats["bytes"], "한글 원본 파일".len() + 12);
    assert_eq!(stats["extensions"][0]["extension"], "txt");
}

// 같은 이름과 크기의 파일도 내용이 다르면 비교 차이로 분류한다.
#[test]
fn folder_comparison_reports_identical_changed_and_one_sided_files() {
    let (temporary, engine, id) = fixture();
    let root = temporary.path().join("files");
    for folder in ["left", "right"] {
        fs::write(root.join(folder).join("same.txt"), "same").unwrap();
    }
    fs::write(root.join("left/diff.txt"), "left").unwrap();
    fs::write(root.join("right/diff.txt"), "rght").unwrap();
    fs::write(root.join("right/only.txt"), "right only").unwrap();
    let result=dispatch(&engine,"analysis",json!({"action":"compare","location":{"rootId":id,"path":"left"},"other":{"rootId":id,"path":"right"}})).unwrap();
    assert_eq!(result["same"], 1);
    assert_eq!(result["different"], 1);
    assert_eq!(result["leftOnly"], 1);
    assert_eq!(result["rightOnly"], 1);
    assert_eq!(result["unverified"], 0);
    assert_eq!(result["partial"], false);
    assert_eq!(result["rows"].as_array().unwrap().len(), 3);
}

// 내용 검사 한도를 넘는 대용량 파일은 미확인으로 남기고 동일하다고 표시하지 않는다.
#[test]
fn oversized_analysis_is_explicitly_partial() {
    let (temporary, engine, id) = fixture();
    let root = temporary.path().join("files");
    for folder in ["left", "right"] {
        fs::File::create(root.join(folder).join("large.bin"))
            .unwrap()
            .set_len(4 * 1024 * 1024 * 1024 + 1)
            .unwrap();
    }
    let result=dispatch(&engine,"analysis",json!({"action":"compare","location":{"rootId":id,"path":"left"},"other":{"rootId":id,"path":"right"}})).unwrap();
    assert_eq!(result["unverified"], 1);
    assert_eq!(result["partial"], true);
    assert_eq!(result["same"], 0);
    assert_eq!(result["readBytes"], 0);
}

// 이미 실행 중인 분석을 겹쳐 시작하지 않고 취소 요청을 독립적으로 받는다.
#[test]
fn analysis_rejects_overlap_and_accepts_cancellation() {
    let (_temporary, engine, id) = fixture();
    engine
        .analysis_busy
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(dispatch(
        &engine,
        "analysis",
        json!({"action":"stats","location":{"rootId":id,"path":"left"}})
    )
    .unwrap_err()
    .contains("이미 분석"));
    dispatch(&engine, "cancelAnalysis", json!({})).unwrap();
    assert!(engine
        .analysis_cancel
        .load(std::sync::atomic::Ordering::Relaxed));
    engine
        .analysis_busy
        .store(false, std::sync::atomic::Ordering::SeqCst);
    assert!(!dispatch(
        &engine,
        "analysis",
        json!({"action":"stats","location":{"rootId":id,"path":"left"}})
    )
    .unwrap()["partial"]
        .as_bool()
        .unwrap());
    assert!(!engine
        .analysis_busy
        .load(std::sync::atomic::Ordering::Relaxed));
    assert!(!engine
        .analysis_cancel
        .load(std::sync::atomic::Ordering::Relaxed));
}

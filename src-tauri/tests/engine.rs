use every_directory_lib::{dispatch, file_response, model::Location, search::Index, store::Engine};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::http::Request;

// 검증용 디렉터리와 독립된 인덱스를 생성한다.
fn fixture() -> (tempfile::TempDir, Arc<Engine>, String, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("files");
    fs::create_dir(&root).unwrap();
    fs::create_dir(root.join("문서")).unwrap();
    fs::create_dir(root.join("대상")).unwrap();
    fs::write(
        root.join("문서/업무 보고서 2026.txt"),
        "한글 파일 검색\nEvery Directory 2026",
    )
    .unwrap();
    fs::write(root.join("alpha.txt"), "alpha").unwrap();
    fs::write(root.join("beta.txt"), "beta").unwrap();
    let engine = Engine::new(temp.path().join("data")).unwrap();
    let scanned = engine.scan(&json!({"absolutePath":root})).unwrap();
    (temp, engine, scanned.id, root)
}
// 화면과 동일한 요청 형식으로 파일 작업을 실행한다.
fn op(
    engine: &Arc<Engine>,
    id: &str,
    action: &str,
    paths: &[&str],
    extra: Value,
) -> Result<Value, String> {
    let mut request = json!({"action":action,"entries":paths.iter().map(|p|json!({"rootId":id,"path":p})).collect::<Vec<_>>()});
    for (key, value) in extra.as_object().unwrap() {
        request[key] = value.clone();
    }
    dispatch(engine, "operation", request)
}
// 운영체제 감시와 수동 갱신이 서로 덮어쓰지 않도록 직렬화한다.
fn refresh(engine: &Arc<Engine>, paths: &[PathBuf]) {
    let _operation = engine.operations.lock().unwrap();
    engine.refresh(paths).unwrap();
}
// 모든 검색 방식에서 한글 정규화와 필터를 확인한다.
#[test]
fn search_modes_and_filters() {
    let (_temp, engine, id, _) = fixture();
    for (mode, query, expected) in [
        ("normal", "보고서 ext:txt", 1),
        ("normal", "\"업무 보고서\"", 1),
        ("wildcard", "*보고서*.???", 1),
        ("regex", r"^업무.*\.txt$", 1),
        ("initials", "ㅇㅁ ㅂㄱㅅ", 1),
        ("fuzzy", "alhpa", 1),
        ("normal", "없는검색어", 0),
    ] {
        let result = dispatch(
            &engine,
            "search",
            json!({"mode":mode,"query":query,"category":"all","rootId":id,"fullPath":false}),
        )
        .unwrap();
        assert_eq!(result["total"], expected, "{mode}: {query}");
        assert_eq!(result["partial"], false);
    }
    assert!(dispatch(
        &engine,
        "search",
        json!({"mode":"regex","query":"(?=x)","category":"all"})
    )
    .is_err());
    assert_eq!(
        dispatch(
            &engine,
            "search",
            json!({"mode":"normal","query":"ALPHA","caseSensitive":true,"category":"all"})
        )
        .unwrap()["total"],
        0
    );
}
// 초성 검색은 공백을 무시하되 검색 연산자·경로·확장자·폴더 범위를 유지한다.
#[test]
fn initials_ignore_spacing_in_names_queries_and_paths() {
    use unicode_normalization::UnicodeNormalization;
    let mut index = Index::default();
    let names = [
        ("spaced", "데이터분석 발굴.pdf".to_owned(), "r"),
        ("joined", "데이터 분석발굴.pdf".to_owned(), "r"),
        (
            "unicode",
            "데이터\t분석\u{3000}발굴.pdf".nfd().collect(),
            "r",
        ),
        ("different", "데이터분석 발명.pdf".to_owned(), "r"),
        ("text", "데이터분석 발굴.txt".to_owned(), "r"),
        ("other-root", "데이터분석 발굴.pdf".to_owned(), "other"),
    ];
    index.replace(
        names
            .into_iter()
            .map(|(id, name, root)| {
                serde_json::from_value(json!({
                    "id":id, "name":name, "rootId":root,
                    "path":format!("한글 자료/{name}"), "parent":"한글 자료",
                    "kind":"file", "extension":name.rsplit('.').next().unwrap(), "modified":0
                }))
                .unwrap()
            })
            .collect(),
    );
    // 화면과 같은 검색 옵션을 만들고 결과와 완결성을 검사한다.
    let find =
        |query: &str, mode: &str, full_path: bool| {
            let result = index.search(&serde_json::from_value(json!({
            "query":query, "mode":mode, "rootId":"r", "category":"all", "fullPath":full_path
        })).unwrap()).unwrap();
            assert!(!result.partial);
            result
        };
    for query in [
        "ㄷㅇㅌㅂㅅ ㅂㄱ",
        "ㄷㅇㅌㅂㅅㅂㄱ",
        "ㄷ ㅇㅌ ㅂㅅㅂ ㄱ",
        " ㄷㅇㅌㅂㅅ\tㅂㄱ ",
        "\"ㄷㅇㅌㅂㅅㅂㄱ\"",
        "\"ㄷㅇㅌㅂㅅ\u{3000}ㅂㄱ\"",
        "데이터분석발굴",
    ] {
        let result = find(&format!("{query} ext:pdf"), "initials", false);
        let mut ids = result
            .entries
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>();
        ids.sort_unstable();
        assert_eq!(ids, ["joined", "spaced", "unicode"], "{query}");
    }
    for (query, full_path, count) in [
        ("\"ㅎㄱㅈㄹ/ㄷㅇㅌㅂㅅㅂㄱ\" ext:pdf", true, 3),
        ("path:ㅎㄱㅈㄹ ㄷㅇㅌㅂㅅㅂㄱ ext:pdf", false, 3),
        ("ㄷㅇㅌㅂㅅㅂㄱ !ext:txt", false, 3),
        ("ㄷㅇㅌㅂㅅㅂㄱ !ㅂㄱ", false, 0),
        ("<ㄷㅇㅌㅂㅅㅂㄱ|ㅇㅁ> ext:pdf", false, 3),
    ] {
        assert_eq!(find(query, "initials", full_path).total, count, "{query}");
    }
    assert_eq!(find("데이터분석발굴", "normal", false).total, 0);
    assert_eq!(find("\"데이터분석 발굴\"", "normal", false).total, 2);
    assert_eq!(find("^데이터분석발굴", "regex", false).total, 0);
}
// 기본 파일 작업과 ZIP·해시·복구가 실제 디스크에 반영되는지 확인한다.
#[test]
fn file_operations_roundtrip() {
    let (_temp, engine, id, root) = fixture();
    let destination = json!({"rootId":id,"path":"대상"});
    op(
        &engine,
        &id,
        "mkdir",
        &[],
        json!({"destination":destination,"name":"새 폴더"}),
    )
    .unwrap();
    op(
        &engine,
        &id,
        "copy",
        &["alpha.txt"],
        json!({"destination":destination}),
    )
    .unwrap();
    op(
        &engine,
        &id,
        "rename",
        &["대상/alpha.txt"],
        json!({"name":"복사본.txt"}),
    )
    .unwrap();
    op(
        &engine,
        &id,
        "move",
        &["beta.txt"],
        json!({"destination":destination}),
    )
    .unwrap();
    assert!(!root.join("beta.txt").exists());
    let result = op(&engine, &id, "hash", &["대상/복사본.txt"], json!({})).unwrap();
    assert_eq!(result["sha256"].as_str().unwrap().len(), 64);
    op(
        &engine,
        &id,
        "zip",
        &["alpha.txt", "문서"],
        json!({"destination":destination,"name":"자료.zip"}),
    )
    .unwrap();
    op(
        &engine,
        &id,
        "unzip",
        &["대상/자료.zip"],
        json!({"destination":destination,"name":"풀기"}),
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("대상/풀기/alpha.txt")).unwrap(),
        "alpha"
    );
    let result = op(&engine, &id, "trash", &["대상/복사본.txt"], json!({})).unwrap();
    assert!(!root.join("대상/복사본.txt").exists());
    op(
        &engine,
        &id,
        "restore",
        &[],
        json!({"trashId":result["records"][0]["id"]}),
    )
    .unwrap();
    assert!(root.join("대상/복사본.txt").exists());
    assert_eq!(
        engine
            .list(&Location {
                root_id: id,
                path: "대상".into()
            })
            .unwrap()
            .len(),
        5
    );
}
// 일괄 치환과 번호 매기기가 원본 내용을 보존하는지 확인한다.
#[test]
fn batch_rename_and_collision() {
    let (_temp, engine, id, root) = fixture();
    let rule = json!({"find":"","replace":"","regex":false,"caseSensitive":false,"preserveExtension":true,"prefix":"작업_","suffix":"_","number":true,"start":1,"padding":2});
    op(
        &engine,
        &id,
        "batchRename",
        &["alpha.txt", "beta.txt"],
        json!({"rule":rule}),
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("작업_alpha_01.txt")).unwrap(),
        "alpha"
    );
    assert!(op(
        &engine,
        &id,
        "rename",
        &["작업_alpha_01.txt"],
        json!({"name":"작업_beta_02.txt"})
    )
    .is_err());
    assert!(op(
        &engine,
        &id,
        "rename",
        &["작업_alpha_01.txt"],
        json!({"name":"../escape"})
    )
    .is_err());
    assert!(root.join("작업_alpha_01.txt").exists());
}
// 대소문자만 바꾸는 이름 변경도 원본 내용을 보존하는지 확인한다.
#[test]
fn case_only_rename() {
    let (_temp, engine, id, root) = fixture();
    let rule = json!({"find":"alpha","replace":"ALPHA","regex":false,"caseSensitive":true,"preserveExtension":true,"prefix":"","suffix":"","number":false,"start":1,"padding":2});
    op(
        &engine,
        &id,
        "batchRename",
        &["alpha.txt"],
        json!({"rule":rule}),
    )
    .unwrap();
    let names: Vec<_> = fs::read_dir(&root)
        .unwrap()
        .map(|item| item.unwrap().file_name())
        .collect();
    assert!(names.contains(&std::ffi::OsString::from("ALPHA.txt")));
    assert_eq!(fs::read_to_string(root.join("ALPHA.txt")).unwrap(), "alpha");
}
// 덮어쓰기·경로 탈출·루트 이동을 거부한다.
#[test]
fn boundary_and_overwrite_protection() {
    let (_temp, engine, id, root) = fixture();
    assert!(engine
        .resolve(&Location {
            root_id: id.clone(),
            path: "../data".into()
        })
        .is_err());
    assert!(engine
        .resolve(&Location {
            root_id: id.clone(),
            path: "문서/../../alpha.txt".into()
        })
        .is_err());
    assert!(op(&engine, &id, "trash", &[""], json!({})).is_err());
    let dest = json!({"rootId":id,"path":"대상"});
    op(
        &engine,
        &id,
        "copy",
        &["alpha.txt"],
        json!({"destination":dest}),
    )
    .unwrap();
    op(
        &engine,
        &id,
        "copy",
        &["alpha.txt"],
        json!({"destination":dest}),
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("대상/alpha (1).txt")).unwrap(),
        "alpha"
    );
    assert_eq!(
        fs::read_to_string(root.join("대상/alpha.txt")).unwrap(),
        "alpha"
    );
}
// 실제 이미지 사본의 크기와 형식을 확인한다.
#[test]
fn image_resize_preserves_original() {
    let (_temp, engine, id, root) = fixture();
    image::RgbImage::from_pixel(640, 360, image::Rgb([70, 120, 180]))
        .save(root.join("사진.png"))
        .unwrap();
    refresh(&engine, &[root.join("사진.png")]);
    for format in ["png", "jpeg", "webp"] {
        let name = format!("결과_{format}");
        let result=op(&engine,&id,"resizeImages",&["사진.png"],json!({"destination":{"rootId":id,"path":"대상"},"name":name,"image":{"width":320,"height":320,"fit":"inside","format":format,"enlarge":false}})).unwrap();
        assert_eq!(result["count"], 1);
        assert_eq!(
            image::image_dimensions(root.join(format!("대상/{name}/사진.{format}"))).unwrap(),
            (320, 180)
        );
    }
    assert_eq!(
        image::image_dimensions(root.join("사진.png")).unwrap(),
        (640, 360)
    );
}
// 미리보기 범위 응답과 등록되지 않은 파일 차단을 확인한다.
#[test]
fn preview_ranges_and_boundary() {
    let (_temp, engine, id, _) = fixture();
    let response = file_response(
        &engine,
        Request::builder()
            .uri(format!("edfile://localhost/{id}/alpha.txt"))
            .header("Range", "bytes=1-3")
            .body(vec![])
            .unwrap(),
    );
    assert_eq!(response.status(), 206);
    assert_eq!(response.body(), b"lph");
    let response = file_response(
        &engine,
        Request::builder()
            .uri(format!("edfile://localhost/{id}/alpha.txt"))
            .header("Range", "bytes=99-100")
            .body(vec![])
            .unwrap(),
    );
    assert_eq!(response.status(), 416);
    let response = file_response(
        &engine,
        Request::builder()
            .uri(format!(
                "edfile://localhost/{id}/%2e%2e%2fdata%2findex.json"
            ))
            .body(vec![])
            .unwrap(),
    );
    assert_eq!(response.status(), 400);
}
// 저장된 인덱스가 앱 재실행 뒤에도 복원되는지 확인한다.
#[test]
fn persisted_index_reopens() {
    let (temp, engine, id, _) = fixture();
    let loaded = Engine::new(temp.path().join("data")).unwrap();
    assert_eq!(loaded.roots()[0].id, id);
    assert_eq!(loaded.roots()[0].count, engine.roots()[0].count);
}
// 파일 생성·이름 변경·삭제 이벤트가 자동으로 반영되는지 확인한다.
#[test]
fn watcher_updates_changed_paths() {
    let (_temp, engine, id, root) = fixture();
    fs::write(root.join("자동갱신.txt"), "watch").unwrap();
    // 제한 시간 안에 실제 운영체제 감시 결과를 기다린다.
    fn wait_for(engine: &Arc<Engine>, id: &str, name: &str, exists: bool) {
        let start = Instant::now();
        loop {
            let found = engine
                .list(&Location {
                    root_id: id.into(),
                    path: String::new(),
                })
                .unwrap()
                .iter()
                .any(|e| e.name == name);
            if found == exists {
                return;
            }
            assert!(
                start.elapsed() < Duration::from_secs(5),
                "감시 갱신 시간 초과: {name}"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    wait_for(&engine, &id, "자동갱신.txt", true);
    fs::rename(root.join("자동갱신.txt"), root.join("변경.txt")).unwrap();
    wait_for(&engine, &id, "변경.txt", true);
    wait_for(&engine, &id, "자동갱신.txt", false);
    fs::remove_file(root.join("변경.txt")).unwrap();
    wait_for(&engine, &id, "변경.txt", false);
}
// 릴리스 검색 속도를 실제 결과 완결성과 함께 측정한다.
#[test]
#[ignore]
fn benchmark_two_hundred_thousand_entries() {
    let mut index = Index::default();
    let entries = (0..200_000)
        .map(|i| every_directory_lib::model::Entry {
            id: format!("root:{i}"),
            root_id: "root".into(),
            name: format!("프로젝트_보고서_{i:06}.pdf"),
            path: format!("문서/프로젝트_보고서_{i:06}.pdf"),
            parent: "문서".into(),
            kind: "file".into(),
            extension: "pdf".into(),
            size: Some(1024),
            modified: 0,
            hidden: false,
        })
        .collect();
    index.replace(entries);
    for (mode, query) in [
        ("normal", "보고서"),
        ("wildcard", "*0199*.pdf"),
        ("regex", r"보고서_0199\d{2}\.pdf$"),
        ("initials", "ㅂㄱㅅ"),
        ("fuzzy", "프러젝트"),
    ] {
        let options = serde_json::from_value(
            json!({"mode":mode,"query":query,"category":"all","rootId":"","fullPath":false}),
        )
        .unwrap();
        let result = index.search(&options).unwrap();
        println!(
            "{mode}: {:.2}ms; matches={}; scanned={}; partial={}",
            result.elapsed, result.total, result.scanned, result.partial
        );
        assert!(!result.partial);
        assert!(result.elapsed < 1000.0);
    }
}

// 악성 ZIP의 상위 경로 항목을 거부하고 결과 폴더를 남기지 않는다.
#[test]
fn malicious_zip_is_rejected() {
    use std::io::Write;
    let (_temp, engine, id, root) = fixture();
    let mut writer = zip::ZipWriter::new(fs::File::create(root.join("악성.zip")).unwrap());
    writer
        .start_file("../escape.txt", zip::write::SimpleFileOptions::default())
        .unwrap();
    writer.write_all(b"bad").unwrap();
    writer.finish().unwrap();
    refresh(&engine, &[root.join("악성.zip")]);
    assert!(op(
        &engine,
        &id,
        "unzip",
        &["악성.zip"],
        json!({"destination":{"rootId":id,"path":"대상"},"name":"악성결과"})
    )
    .is_err());
    assert!(!root.join("대상/악성결과").exists());
}
// 심볼릭 링크를 통한 연결 폴더 밖 접근을 차단한다.
#[test]
#[cfg(unix)]
fn symlinks_are_rejected() {
    let (_temp, engine, id, root) = fixture();
    std::os::unix::fs::symlink(root.parent().unwrap().join("data"), root.join("외부링크")).unwrap();
    refresh(&engine, &[root.join("외부링크")]);
    assert!(engine
        .resolve(&Location {
            root_id: id,
            path: "외부링크/index.json".into()
        })
        .is_err());
}
// 사본 저장에서 원본 보존과 기존 파일 보호를 확인한다.
#[test]
fn save_copy_does_not_overwrite() {
    let (temp, engine, id, root) = fixture();
    let destination = temp.path().join("사본.txt");
    dispatch(
        &engine,
        "saveCopy",
        json!({"location":{"rootId":id,"path":"alpha.txt"},"destination":destination}),
    )
    .unwrap();
    assert_eq!(fs::read_to_string(&destination).unwrap(), "alpha");
    assert!(root.join("alpha.txt").exists());
    assert!(dispatch(
        &engine,
        "saveCopy",
        json!({"location":{"rootId":id,"path":"beta.txt"},"destination":destination})
    )
    .is_err());
    assert_eq!(fs::read_to_string(destination).unwrap(), "alpha");
}

// 논리식·속성 필터가 결합되어도 후보 축소로 결과가 누락되지 않는지 확인한다.
#[test]
fn advanced_search_expressions() {
    let (_temp, engine, id, _root) = fixture();
    // | 는 Windows 파일명에 쓸 수 없으므로 검색 파서의 가상 항목으로 검증한다.
    {
        let mut store = engine.store.lock().unwrap();
        let mut entries = store.index.entries.clone();
        entries.push(serde_json::from_value(json!({"id":"pipe", "rootId":id, "name":"a|b.txt", "path":"a|b.txt", "parent":"", "kind":"file", "extension":"txt", "size":5, "modified":every_directory_lib::store::now()})).unwrap());
        store.index.replace(entries);
    }
    for (query, expected) in [
        ("alpha|beta ext:txt", 2),
        ("alpha | beta ext:txt", 2),
        ("!alpha ext:txt", 3),
        ("!<alpha|beta> ext:txt", 2),
        ("<alpha ext:txt>|folder:", 3),
        ("\"a|b.txt\"", 1),
        ("*.txt !path:문서", 3),
        ("folder:", 2),
        ("file:alpha", 1),
        ("size:5b", 2),
        ("size:4b..5b", 3),
        ("size:>5b", 1),
        ("size:>=5b !alpha", 2),
        ("dm:today ext:txt", 4),
        ("dm:>2099-01-01", 0),
        ("dm:2020-01-01..2099-01-01", 6),
        ("alpha beta|gamma", 0),
        ("path:문서 ext:txt", 1),
        ("*ALPHA*", 1),
    ] {
        let result = dispatch(
            &engine,
            "search",
            json!({"query":query,"rootId":id,"category":"all"}),
        )
        .unwrap();
        assert_eq!(result["total"], expected, "{query}");
        assert_eq!(result["partial"], false, "{query}");
    }
    for query in [
        "alpha |",
        "<alpha",
        "alpha>",
        "\"alpha",
        "size:xyz",
        "size:10mb..5mb",
        "dm:notadate",
        "ext:",
        "<>",
    ] {
        assert!(
            dispatch(&engine, "search", json!({"query":query})).is_err(),
            "{query}"
        );
    }
    // 정규식의 |와 !는 논리 연산자로 재해석하지 않는다.
    assert_eq!(
        dispatch(
            &engine,
            "search",
            json!({"query":"alpha|beta", "mode":"regex"})
        )
        .unwrap()["total"],
        2
    );
}

// 실행 요청은 변경 작업 잠금에 묶이지 않고 경로 검증 오류를 즉시 반환한다.
#[test]
fn open_validates_without_waiting_for_file_operations() {
    let (_temp, engine, id, _) = fixture();
    let _operation = engine.operations.lock().unwrap();
    assert!(op(&engine, &id, "open", &["missing.pdf"], json!({}))
        .unwrap_err()
        .contains("인덱스"));
    assert!(op(&engine, &id, "open", &["../outside.pdf"], json!({})).is_err());
    assert!(op(&engine, &id, "open", &["alpha.txt", "beta.txt"], json!({})).is_err());
}

// CSV 내보내기는 선택한 새 파일에만 저장하고 기존 파일을 덮어쓰지 않는다.
#[test]
fn export_csv_is_bounded_and_exclusive() {
    let (temp, engine, _, _) = fixture();
    let destination = temp.path().join("한글 결과.csv");
    dispatch(
        &engine,
        "saveExport",
        json!({"destination":destination,"content":"이름,종류\r\n자료.pdf,파일"}),
    )
    .unwrap();
    assert!(fs::read_to_string(&destination)
        .unwrap()
        .contains("자료.pdf"));
    assert!(dispatch(
        &engine,
        "saveExport",
        json!({"destination":destination,"content":"overwrite"})
    )
    .is_err());
    assert!(dispatch(
        &engine,
        "saveExport",
        json!({"destination":temp.path().join("bad.exe"),"content":"invalid"})
    )
    .is_err());
    assert!(dispatch(
        &engine,
        "saveExport",
        json!({"destination":temp.path().join("large.csv"),"content":"x".repeat(4*1024*1024+1)})
    )
    .is_err());
}

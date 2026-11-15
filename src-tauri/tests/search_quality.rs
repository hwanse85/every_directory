// 검색 품질 회귀 표: 실제 업무 파일 이름 300개 표본에서 초성·한/영 오타·영문 약어 검색이 기대한 파일을 찾는지 확인한다.
use every_directory_lib::{
    keyboard,
    model::{Entry, SearchOptions},
    quick_access::{learned, Pick, QuickAccess},
    search::{acronym, initials, Index},
};
use serde_json::json;
use std::collections::HashMap;

// 파일 이름 하나를 색인 항목으로 만든다.
fn entry(name: &str) -> Entry {
    let extension = name.rsplit_once('.').map(|(_, ext)| ext.to_lowercase()).unwrap_or_default();
    Entry {
        id: format!("root:업무/{name}"),
        root_id: "root".into(),
        path: format!("업무/{name}"),
        parent: "업무".into(),
        name: name.into(),
        kind: "file".into(),
        extension,
        size: Some(1),
        modified: 1,
        hidden: false,
        created: None,
        accessed: None,
        readonly: false,
    }
}

// 이름 목록으로 색인을 만든다.
fn index(names: &[&str]) -> Index {
    let mut index = Index::default();
    index.replace(names.iter().map(|name| entry(name)).collect());
    index
}

// 검색 한 번의 결과 이름과 자판 보정 검색어를 구한다.
fn run(index: &Index, query: &str, full_path: bool, quick: bool, boosts: &HashMap<String, usize>) -> (Vec<String>, Option<String>) {
    let options: SearchOptions = serde_json::from_value(
        json!({"query": query, "mode": "initials", "fullPath": full_path, "limit": 1000}),
    )
    .unwrap();
    let result = if quick { index.quick_search(&options, boosts, &|| false) } else { index.search(&options) }
        .unwrap_or_else(|error| panic!("{query}: {error}"));
    (result.entries.into_iter().map(|entry| entry.name).collect(), result.corrected)
}

// 확장자를 뺀 이름
fn stem(name: &str) -> &str {
    name.rsplit_once('.').map_or(name, |(stem, _)| stem)
}

#[test]
fn business_names_regression_table() {
    let text = include_str!("fixtures/business-names.txt");
    let names: Vec<&str> = text.lines().filter(|line| !line.is_empty()).collect();
    assert_eq!(names.len(), 300);
    let index = index(&names);
    let none = HashMap::new();
    let mut checked = 0;
    let mut failures = vec![];
    for name in &names {
        let mut queries: Vec<(String, bool)> = vec![];
        // 1) 한글 이름은 구분 기호를 빼고 친 초성 검색어, 영문만 있는 이름은 이름 그대로
        //    (구분 기호 건너뛰기는 한글이 든 검색어에만 적용한다)
        if stem(name).chars().any(|c| ('가'..='힣').contains(&c)) {
            queries.push((initials(stem(name)), false));
        } else {
            queries.push((stem(name).to_lowercase(), false));
        }
        // 2) 첫 한글 낱말(두 음절 이상)을 영문 자판으로 친 검색어 → 한/영 보정으로 찾아야 한다.
        let word: String = stem(name)
            .split(|c: char| !('가'..='힣').contains(&c))
            .find(|part| part.chars().count() >= 2)
            .unwrap_or_default()
            .into();
        if let Some(typed) = keyboard::hangul_to_english(&word) {
            queries.push((typed, true));
        }
        // 3) 영문 이름의 약어 앞 세 글자
        let short = acronym(name);
        if short.len() >= 3 && stem(name).starts_with(|c: char| c.is_ascii_alphabetic()) {
            queries.push((short[..3].to_owned(), false));
        }
        for (query, correction) in queries {
            for full_path in [false, true] {
                for quick in [false, true] {
                    checked += 1;
                    let (found, corrected) = run(&index, &query, full_path, quick, &none);
                    if !found.iter().any(|n| n == name) || (correction && corrected.is_none()) {
                        failures.push(format!("{query:?} 경로={full_path} 빠른={quick} → {name} 못 찾음 (보정 {corrected:?}, {}건)", found.len()));
                    }
                }
            }
        }
    }
    assert!(checked > 2000, "검사 {checked}건");
    assert!(failures.is_empty(), "실패 {}건 / {checked}건:\n{}", failures.len(), failures.iter().take(40).cloned().collect::<Vec<_>>().join("\n"));
}

#[test]
fn keyboard_layout_correction_finds_korean_and_english() {
    let index = index(&["보고서.txt", "회의록.hwp", "report.pdf", "apm 설정.txt"]);
    let none = HashMap::new();
    for quick in [false, true] {
        let (found, corrected) = run(&index, "qhrhtj", true, quick, &none);
        assert_eq!((found.as_slice(), corrected.as_deref()), (&["보고서.txt".to_owned()][..], Some("보고서")));
        let (found, corrected) = run(&index, "ghldmlfhr", false, quick, &none);
        assert_eq!((found.as_slice(), corrected.as_deref()), (&["회의록.hwp".to_owned()][..], Some("회의록")));
        let (found, corrected) = run(&index, "메ㅡ", false, quick, &none);
        assert_eq!((found.as_slice(), corrected.as_deref()), (&["apm 설정.txt".to_owned()][..], Some("apm")));
        // 결과가 있으면 보정하지 않는다: 영문 파일 report는 보정 때문에 가려지지 않는다.
        let (found, corrected) = run(&index, "report", false, quick, &none);
        assert_eq!((found.as_slice(), corrected), (&["report.pdf".to_owned()][..], None));
    }
    // 원래 검색어로 찾기를 고르면 보정하지 않는다.
    let options: SearchOptions = serde_json::from_value(json!({"query": "qhrhtj", "mode": "initials", "noCorrect": true})).unwrap();
    let result = index.search(&options).unwrap();
    assert_eq!((result.total, result.corrected), (0, None));
}

#[test]
fn english_acronyms_rank_below_name_matches() {
    let index = index(&["MyBigReport.pdf", "user_build_script.sh", "mbr 메모.txt", "HTMLParser.rs", "summary.txt"]);
    let none = HashMap::new();
    for full_path in [false, true] {
        for quick in [false, true] {
            let (found, _) = run(&index, "mbr", full_path, quick, &none);
            assert!(found.contains(&"MyBigReport.pdf".to_owned()), "{found:?}");
            if quick {
                assert_eq!(found[0], "mbr 메모.txt", "이름 일치가 약어 일치보다 앞");
            }
            assert!(run(&index, "ubs", full_path, quick, &none).0.contains(&"user_build_script.sh".to_owned()));
            assert!(run(&index, "hp", full_path, quick, &none).0.contains(&"HTMLParser.rs".to_owned()));
            assert!(!run(&index, "ubs", full_path, quick, &none).0.contains(&"summary.txt".to_owned()));
        }
    }
    assert_eq!(acronym("MyBigReport.pdf"), "mbr");
    assert_eq!(acronym("report2026v2.txt"), "r2v2");
    assert_eq!(acronym("보고서.txt"), "");
}

#[test]
fn learned_picks_move_chosen_file_to_top() {
    let index = index(&["보고서 초안.txt", "보고서 최종.txt", "보고서 검토.txt"]);
    let (before, _) = run(&index, "보고서", false, true, &HashMap::new());
    let chosen = before.last().unwrap().clone();
    let mut access = QuickAccess::default();
    access.picks.push(Pick { query: "보고서".into(), root_id: "root".into(), path: format!("업무/{chosen}"), count: 2, last: 1 });
    access.picks.push(Pick { query: "보고".into(), root_id: "root".into(), path: format!("업무/{}", before[1]), count: 1, last: 2 });
    let boosts: HashMap<String, usize> = learned(&access, "보고서").into_iter().collect();
    let (after, _) = run(&index, "보고서", false, true, &boosts);
    assert_eq!(after[0], chosen, "두 번 고른 파일이 1위: {before:?} → {after:?}");
    // 앞부분이 이어지는 검색어(보고)로 고른 기록도 반영하되, 같은 검색어 기록보다 뒤에 둔다.
    assert_eq!(after[1], before[1]);
    // 관련 없는 검색어의 기록은 쓰지 않는다.
    assert!(learned(&access, "회의록").is_empty());
}

// 만든 날짜·접근일·종류 묶음·속성·Finder 태그 조건을 확인한다.
#[test]
fn metadata_conditions() {
    use every_directory_lib::model::Root;
    let day = |text: &str| {
        chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap().and_hms_opt(12, 0, 0).unwrap()
            .and_local_timezone(chrono::Local).unwrap().timestamp_millis() as u64
    };
    let mut files = vec![entry("계획.docx"), entry("사진.png"), entry("main.rs"), entry("백업.zip"), entry("노래.mp3")];
    files[0].created = Some(day("2026-03-01"));
    files[0].accessed = Some(day("2026-11-01"));
    files[1].created = Some(day("2026-05-10"));
    files[1].readonly = true;
    files[2].hidden = true;
    files[2].readonly = true;
    let mut folder = entry("자료");
    folder.kind = "directory".into();
    folder.extension.clear();
    folder.size = None;
    files.push(folder);
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("업무")).unwrap();
    for file in &files {
        std::fs::write(dir.path().join(&file.path), b"x").ok();
    }
    let mut index = Index::default();
    index.set_roots([Root { id: "root".into(), name: "루트".into(), absolute_path: dir.path().to_string_lossy().into(), ..Default::default() }]);
    index.replace(files);
    let names = |query: &str| -> Vec<String> {
        let options: SearchOptions = serde_json::from_value(json!({"query": query, "mode": "initials", "noCorrect": true, "showHidden": true})).unwrap();
        let mut found: Vec<String> = index.search(&options).unwrap_or_else(|e| panic!("{query}: {e}")).entries.into_iter().map(|e| e.name).collect();
        found.sort();
        found
    };
    assert_eq!(names("dc:2026-03-01"), vec!["계획.docx"]);
    assert_eq!(names("dc:>=2026-04-01"), vec!["사진.png"]);
    assert_eq!(names("dc:2026-01-01..2026-12-31"), vec!["계획.docx", "사진.png"]);
    assert_eq!(names("da:2026-11-01"), vec!["계획.docx"]);
    assert_eq!(names("kind:문서"), vec!["계획.docx"]);
    assert_eq!(names("kind:이미지"), vec!["사진.png"]);
    assert_eq!(names("kind:코드"), vec!["main.rs"]);
    assert_eq!(names("kind:압축"), vec!["백업.zip"]);
    assert_eq!(names("kind:동영상"), vec!["노래.mp3"]);
    assert_eq!(names("kind:폴더"), vec!["자료"]);
    assert_eq!(names("attrib:r"), vec!["main.rs", "사진.png"]);
    assert_eq!(names("attrib:rh"), vec!["main.rs"]);
    assert_eq!(names("attrib:r !kind:코드"), vec!["사진.png"]);
    for wrong in ["kind:모름", "attrib:x", "dc:어제", "tag:"] {
        let options: SearchOptions = serde_json::from_value(json!({"query": wrong, "mode": "initials"})).unwrap();
        assert!(index.search(&options).is_err(), "{wrong}는 오류");
    }
    #[cfg(target_os = "macos")]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let value = every_directory_lib::tags::plist(&["업무 진행\n6", "Work\n0"]);
        let path = CString::new(dir.path().join("업무/계획.docx").as_os_str().as_bytes()).unwrap();
        let written = unsafe { libc::setxattr(path.as_ptr(), c"com.apple.metadata:_kMDItemUserTags".as_ptr(), value.as_ptr().cast(), value.len(), 0, 0) };
        assert_eq!(written, 0);
        assert_eq!(names("tag:업무"), vec!["계획.docx"]);
        assert_eq!(names("tag:work"), vec!["계획.docx"]);
        assert!(names("tag:개인").is_empty());
    }
}

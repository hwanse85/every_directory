use every_directory_lib::{model::Entry, model::SearchOptions, search::Index};
use std::collections::HashMap;

fn fixture(count: usize) -> Index {
    let mut entries: Vec<Entry> = (0..count)
        .map(|n| Entry {
            id: format!("root:{n}"),
            root_id: "root".into(),
            name: format!("asset_{n:08}.dat"),
            path: format!("cache/asset_{n:08}.dat"),
            parent: "cache".into(),
            kind: "file".into(),
            extension: "dat".into(),
            size: Some(1),
            modified: 0,
            hidden:false,created:None,accessed:None,readonly:false,
        })
        .collect();
    for name in ["업무 보고서.txt", "쏠리마인드.txt"] {
        entries.push(Entry {
            id: format!("root:{name}"),
            root_id: "root".into(),
            name: name.into(),
            path: format!("zzzz/{name}"),
            parent: "zzzz".into(),
            kind: "file".into(),
            extension: "txt".into(),
            size: Some(1),
            modified: 0,
            hidden:false,created:None,accessed:None,readonly:false,
        });
    }
    let mut index = Index::default();
    index.replace(entries);
    index
}

fn verify(index: &Index) {
    for query in [
        "ㅂㄱㅅ",
        "ㅂㄱ",
        "보고ㅅ",
        "ㅆㄹㅁㅇㄷ",
        "쏠리ㅁㅇㄷ",
        "ᄇᄀᄉ",
        "ﾲﾡﾵ",
        "ㅂㄱㅅ|ㅆㄹㅁㅇㄷ",
        "ㅂㄱㅅ !ext:pdf",
        "*ㅂㄱㅅ*",
        "path:ㅂㄱㅅ",
    ] {
        let options: SearchOptions =
            serde_json::from_value(serde_json::json!({"query":query,"mode":"initials"})).unwrap();
        for quick in [false, true] {
            let result = if quick {
                index.quick_search(&options, &HashMap::new(), &|| false)
            } else {
                index.search(&options)
            }
            .unwrap();
            assert!(
                !result.partial,
                "{query}, quick={quick}, {}ms",
                result.elapsed
            );
            assert_eq!(
                result.total,
                if query.contains('|') { 2 } else { 1 },
                "{query}"
            );
            assert!(result.scanned <= 2, "{query}: scanned {}", result.scanned);
            println!(
                "{query}, quick={quick}: total={}, scanned={}, elapsed={:.2}ms",
                result.total, result.scanned, result.elapsed
            );
        }
    }
}

#[test]
fn initials_at_end_of_large_index_are_complete_in_main_and_quick_search() {
    verify(&fixture(20_000));
}

#[test]
#[ignore = "explicit million-entry performance verification"]
fn million_entries_initials_and_tense_consonants() {
    verify(&fixture(1_000_000));
}

#[test]
fn candidate_planning_preserves_a_direct_match_oracle() {
    use every_directory_lib::{query::Query, search::normalize};
    let index = fixture(100);
    for mode in ["normal", "wildcard", "initials"] {
        for full_path in [false, true] {
            for text in [
                "ㅂㄱㅅ",
                "ᄇᄀᄉ",
                "report|asset",
                "ㅂㄱㅅ|ㅆㄹㅁㅇㄷ",
                "!ㅂㄱㅅ",
                "<ㅂㄱㅅ|ㅆㄹㅁㅇㄷ> ext:txt",
                "path:zzzz ext:txt",
                "*보고*",
                "asset_000000??.dat",
                "보고ㅅ !ext:pdf",
            ] {
                let expression = Query::parse(text, mode, false).unwrap();
                let expected: Vec<_> = index
                    .entries
                    .iter()
                    .filter(|entry| {
                        expression
                            .matches(
                                entry,
                                &normalize(if full_path { &entry.path } else { &entry.name }),
                                &normalize(&entry.path),
                            )
                            .is_some()
                    })
                    .map(|entry| entry.id.clone())
                    .collect();
                let options: SearchOptions = serde_json::from_value(
                    serde_json::json!({"query":text,"mode":mode,"fullPath":full_path,"limit":1000}),
                )
                .unwrap();
                let result = index.search(&options).unwrap();
                let actual: Vec<_> = result.entries.into_iter().map(|entry| entry.id).collect();
                assert_eq!(
                    actual, expected,
                    "mode={mode} full_path={full_path} text={text}"
                );
                assert!(!result.partial);
            }
        }
    }
}

// 실제 PC처럼 깊은 폴더와 숨김 폴더가 섞인 큰 색인을 만든다.
fn deep_fixture(count: usize) -> Index {
    let mut entries: Vec<Entry> = (0..count)
        .map(|n| {
            let parent = format!("users/me/appdata/local/vendor{}/cache{}/part{}", n % 97, n % 31, n % 7);
            let name = format!("asset_{n:08}.dat");
            Entry {
                id: format!("root:{parent}/{name}"),
                root_id: "root".into(),
                path: format!("{parent}/{name}"),
                name,
                parent,
                kind: "file".into(),
                extension: "dat".into(),
                size: Some(1),
                modified: 0,
                hidden: false, created: None, accessed: None, readonly: false,
            }
        })
        .collect();
    for (path, kind, hidden) in [("users/me/appdata", "directory", true), ("users/me/문서/업무/YK5 정산표.xlsx", "file", false)] {
        let (parent, name) = path.rsplit_once('/').unwrap();
        entries.push(Entry {
            id: format!("root:{path}"),
            root_id: "root".into(),
            name: name.into(),
            path: path.into(),
            parent: parent.into(),
            kind: kind.into(),
            extension: if kind == "file" { "xlsx".into() } else { String::new() },
            size: Some(1),
            modified: 0,
            hidden, created: None, accessed: None, readonly: false,
        });
    }
    let mut index = Index::default();
    index.replace(entries);
    index
}

// 빠른 검색은 기본으로 경로까지 검색하므로, 큰 색인에서도 파일명 일치를 시간 제한 안에 찾아야 한다.
fn verify_quick_full_path(index: &Index) {
    // "업"은 파일명 색인으로 좁힐 수 없고 경로에서만 일치한다.
    for query in ["yk5 xlsx", "yk5", "정산 xlsx", "업무 yk5", "업"] {
        let options: SearchOptions = serde_json::from_value(
            serde_json::json!({"query":query,"mode":"initials","fullPath":true,"limit":12}),
        )
        .unwrap();
        let result = index.quick_search(&options, &HashMap::new(), &|| false).unwrap();
        println!("{query}: total={}, scanned={}, partial={}, elapsed={:.2}ms", result.total, result.scanned, result.partial, result.elapsed);
        assert!(
            result.entries.iter().any(|entry| entry.name == "YK5 정산표.xlsx"),
            "{query}: partial={} scanned={} elapsed={:.2}ms",
            result.partial, result.scanned, result.elapsed
        );
    }
}

#[test]
fn quick_full_path_search_finds_file_names_in_a_large_index() {
    verify_quick_full_path(&deep_fixture(200_000));
}

#[test]
#[ignore = "explicit million-entry performance verification"]
fn million_entries_quick_full_path_search() {
    verify_quick_full_path(&deep_fixture(1_000_000));
}

use every_directory_lib::{
    model::{Entry, SearchOptions},
    search::Index,
};
use serde_json::json;
use std::collections::{HashMap, HashSet};

fn entry(n: usize) -> Entry {
    let name = if n % 5 == 0 {
        format!("업무 보고서_{n:04}.txt")
    } else {
        format!("asset_{n:04}.dat")
    };
    Entry {
        id: format!("root:folder/{name}"),
        root_id: "root".into(),
        path: format!("folder/{name}"),
        parent: "folder".into(),
        name,
        kind: "file".into(),
        extension: if n % 5 == 0 { "txt" } else { "dat" }.into(),
        size: Some(n as u64),
        modified: n as u64,
        hidden:false,created:None,accessed:None,readonly:false,
    }
}

fn verify(index: &Index) {
    let mut fresh = Index::default();
    fresh.replace(index.entries.clone());
    assert_eq!(
        index
            .entries
            .iter()
            .map(|e| &e.id)
            .collect::<HashSet<_>>()
            .len(),
        index.entries.len()
    );
    for mode in ["normal", "initials", "wildcard", "regex", "fuzzy"] {
        for full_path in [false, true] {
            for query in [
                "",
                "asset",
                "report",
                "ㅂㄱㅅ",
                "ㅇㅁㅂㄱㅅ",
                "업무",
                "asset|보고서",
                "!ext:txt",
                "*asset*",
                "folder:",
                "path:folder",
                "asset_0001",
                "assset",
            ] {
                let options: SearchOptions = serde_json::from_value(
                    json!({"query":query,"mode":mode,"fullPath":full_path,"limit":1000}),
                )
                .unwrap();
                for quick in [false, true] {
                    let search = |value: &Index| {
                        if quick {
                            value.quick_search(&options, &HashMap::new(), &|| false)
                        } else {
                            value.search(&options)
                        }
                    };
                    let expected = search(&fresh);
                    let actual = search(index);
                    if expected.is_err() {
                        assert!(actual.is_err());
                        continue;
                    }
                    let expected = expected.unwrap();
                    let actual = actual.unwrap();
                    let mut a: Vec<_> = actual.entries.into_iter().map(|e| e.id).collect();
                    a.sort();
                    let mut b: Vec<_> = expected.entries.into_iter().map(|e| e.id).collect();
                    b.sort();
                    assert_eq!(actual.total, expected.total, "{mode}, {query}");
                    assert_eq!(
                        a, b,
                        "{mode}, {query}, quick={quick}, full_path={full_path}"
                    );
                }
            }
        }
    }
}

#[test]
fn incremental_postings_match_rebuilt_index_after_repeated_dense_slot_changes() {
    let mut index = Index::default();
    index.replace((0..100).map(entry).collect());
    for round in 0..6 {
        let removed: Vec<_> = index
            .entries
            .iter()
            .enumerate()
            .filter(|(n, _)| (n + round) % 3 == 0)
            .map(|(_, e)| e.id.clone())
            .collect();
        let mut additions: Vec<_> = (100 + round * 10..110 + round * 10).map(entry).collect();
        if let Some(old) = index.entries.iter().find(|e| !removed.contains(&e.id)) {
            let mut modified = old.clone();
            modified.size = Some(999);
            modified.hidden = true;
            additions.push(modified);
        }
        index.update(&removed, additions);
        verify(&index);
    }
    let ids = index
        .entries
        .iter()
        .map(|e| e.id.clone())
        .collect::<Vec<_>>();
    index.update(&ids, vec![]);
    verify(&index);
    index.update(&[], vec![entry(999)]);
    verify(&index);
}

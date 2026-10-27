use every_directory_lib::{dispatch, model::Entry, store::Engine};
use serde_json::json;
use std::{fs, time::Instant};

// The large unrelated index models a connected drive without creating hundreds of thousands of files.
#[test]
#[ignore = "explicit large-index file transfer benchmark"]
fn small_transfer_with_large_unrelated_index() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("files");
    fs::create_dir_all(root.join("destination")).unwrap();
    fs::write(root.join("report.txt"), "original bytes").unwrap();
    let engine = Engine::new(temp.path().join("data")).unwrap();
    let id = engine.scan(&json!({"absolutePath":root})).unwrap().id;
    let count = std::env::var("ED_TRANSFER_BENCH_ENTRIES")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(200_000usize);
    {
        let mut store = engine.store.lock().unwrap();
        let snapshot = store
            .snapshots
            .iter_mut()
            .find(|s| s.root.id == id)
            .unwrap();
        snapshot.entries.extend((0..count).map(|n| Entry {
            id: format!("{id}:unrelated/asset_{n:08}.dat"),
            root_id: id.clone(),
            name: format!("asset_{n:08}.dat"),
            path: format!("unrelated/asset_{n:08}.dat"),
            parent: "unrelated".into(),
            kind: "file".into(),
            extension: "dat".into(),
            size: Some(1),
            modified: 0,
            hidden:false,created:None,accessed:None,readonly:false,
        }));
        snapshot.root.count = snapshot.entries.len();
        let entries = snapshot.entries.clone();
        store.index.replace(entries);
    }
    for (action, source, destination) in [
        ("copy", "report.txt", "destination"),
        ("move", "destination/report.txt", ""),
    ] {
        if action == "move" {
            fs::remove_file(root.join("report.txt")).unwrap();
        }
        let started = Instant::now();
        let result = dispatch(&engine,"operation",json!({"action":action,"entries":[{"rootId":id,"path":source}],"destination":{"rootId":id,"path":destination}})).unwrap();
        println!(
            "TRANSFER_BENCH action={action} unrelated={count} total_ms={:.2} result={result}",
            started.elapsed().as_secs_f64() * 1000.0
        );
    }
    assert_eq!(
        fs::read_to_string(root.join("report.txt")).unwrap(),
        "original bytes"
    );
    let store = engine.store.lock().unwrap();
    assert_eq!(store.index.entries.len(), count + 2);
    assert_eq!(store.snapshots[0].entries.len(), count + 2);
    drop(store);
    let started = Instant::now();
    let listing = dispatch(&engine, "list", json!({"rootId":id,"path":""})).unwrap();
    assert!(listing
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["name"] == "report.txt"));
    println!(
        "TRANSFER_BENCH action=list unrelated={count} total_ms={:.2}",
        started.elapsed().as_secs_f64() * 1000.0
    );
}

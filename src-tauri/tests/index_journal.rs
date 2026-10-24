use every_directory_lib::{dispatch, model::Location, store::Engine};
use serde_json::{json, Value};
use std::{fs, io::Write, sync::Arc};

fn setup() -> (tempfile::TempDir, Arc<Engine>, String, std::path::PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("files");
    fs::create_dir_all(root.join("target")).unwrap();
    fs::write(root.join("original.txt"), "original bytes").unwrap();
    let engine = Engine::new(temp.path().join("data")).unwrap();
    let id = engine.scan(&json!({"absolutePath":root})).unwrap().id;
    (temp, engine, id, root)
}
fn copy(engine: &Arc<Engine>, id: &str) -> Value {
    dispatch(engine,"operation",json!({"action":"copy","entries":[{"rootId":id,"path":"original.txt"}],"destination":{"rootId":id,"path":"target"}})).unwrap()
}

#[test]
fn completed_transfers_are_durable_without_rewriting_the_whole_checkpoint() {
    let (temp, engine, id, root) = setup();
    let checkpoint = fs::read(engine.data.join("index.json")).unwrap();
    copy(&engine, &id);
    copy(&engine, &id);
    let _operation = engine.operations.lock().unwrap();
    assert_eq!(
        fs::read(engine.data.join("index.json")).unwrap(),
        checkpoint
    );
    let reopened = Engine::new(temp.path().join("data")).unwrap();
    let names: Vec<_> = reopened
        .list(&Location {
            root_id: id.clone(),
            path: "target".into(),
        })
        .unwrap()
        .into_iter()
        .map(|e| e.name)
        .collect();
    assert_eq!(names, vec!["original (1).txt", "original.txt"]);
    assert_eq!(
        fs::read_to_string(root.join("target/original (1).txt")).unwrap(),
        "original bytes"
    );
}

#[test]
fn duplicate_refreshes_do_not_advance_versions_or_write_records() {
    let (_temp, engine, id, root) = setup();
    copy(&engine, &id);
    let _operation = engine.operations.lock().unwrap();
    // Refresh the parent once to account for its changed directory timestamp.
    engine.refresh(&[root.join("target")]).unwrap();
    let before = fs::read(engine.data.join("index-journal.jsonl")).unwrap();
    let version = engine.store.lock().unwrap().version;
    for _ in 0..5 {
        engine.refresh(&[root.join("target")]).unwrap();
    }
    assert_eq!(engine.store.lock().unwrap().version, version);
    assert_eq!(
        fs::read(engine.data.join("index-journal.jsonl")).unwrap(),
        before
    );
}

#[test]
fn crash_tail_is_discarded_and_pre_checkpoint_records_cannot_undo_a_new_scan() {
    let (temp, engine, id, root) = setup();
    copy(&engine, &id);
    let _operation = engine.operations.lock().unwrap();
    let journal = engine.data.join("index-journal.jsonl");
    let old = fs::read(&journal).unwrap();
    fs::OpenOptions::new()
        .append(true)
        .open(&journal)
        .unwrap()
        .write_all(b"{incomplete")
        .unwrap();
    let reopened = Engine::new(temp.path().join("data")).unwrap();
    assert_eq!(fs::read(&journal).unwrap(), old);
    assert!(reopened
        .list(&Location {
            root_id: id.clone(),
            path: "target".into()
        })
        .unwrap()
        .iter()
        .any(|e| e.name == "original.txt"));
    fs::remove_file(root.join("target/original.txt")).unwrap();
    reopened.scan(&json!({"id":id})).unwrap();
    // Simulate a crash after checkpoint replacement but before old-log truncation.
    fs::write(&journal, old).unwrap();
    let again = Engine::new(temp.path().join("data")).unwrap();
    assert!(again
        .list(&Location {
            root_id: id,
            path: "target".into()
        })
        .unwrap()
        .is_empty());
}

#[test]
fn legacy_checkpoints_without_generation_fields_remain_readable() {
    let (temp, engine, id, _root) = setup();
    let _operation = engine.operations.lock().unwrap();
    let path = engine.data.join("index.json");
    let mut disk: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    disk.as_object_mut().unwrap().remove("generation");
    disk.as_object_mut().unwrap().remove("sequence");
    fs::write(path, serde_json::to_vec(&disk).unwrap()).unwrap();
    let reopened = Engine::new(temp.path().join("data")).unwrap();
    copy(&reopened, &id);
    let again = Engine::new(temp.path().join("data")).unwrap();
    assert_eq!(
        again
            .list(&Location {
                root_id: id,
                path: "target".into()
            })
            .unwrap()
            .len(),
        1
    );
}

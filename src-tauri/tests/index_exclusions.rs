use every_directory_lib::{dispatch,model::Location,store::Engine};
use serde_json::json;
use std::fs;
#[test]
fn exclusions_apply_to_index_but_preserve_browsing_and_file_operations(){
    let temp=tempfile::tempdir().unwrap();let files=temp.path().join("files");
    for name in ["Private/하위","PrivateArchive","대상"]{fs::create_dir_all(files.join(name)).unwrap();}
    fs::write(files.join("Private/하위/비공개.txt"),"private").unwrap();fs::write(files.join("PrivateArchive/공개.txt"),"public").unwrap();
    let data=temp.path().join("data");let engine=Engine::new(data.clone()).unwrap();
    let root=engine.scan(&json!({"absolutePath":files,"excludedPaths":["Private"]})).unwrap();
    assert_eq!(root.excluded_paths,vec!["Private"]);
    let location=|path:&str|Location{root_id:root.id.clone(),path:path.into()};
    let entries=engine.store.lock().unwrap().index.entries.clone();
    assert!(!entries.iter().any(|entry|entry.path=="Private"||entry.path.starts_with("Private/")));
    assert!(entries.iter().any(|entry|entry.path=="PrivateArchive/공개.txt"));
    assert!(engine.list(&location("")).unwrap().iter().any(|entry|entry.name=="Private"));
    let private=engine.list(&location("Private/하위")).unwrap();assert_eq!(private.len(),1);assert!(private[0].created.is_some());assert!(private[0].accessed.is_some());
    assert_eq!(engine.directory_location(&location("Private/하위")).unwrap().path,"Private/하위");
    dispatch(&engine,"operation",json!({"action":"copy","entries":[{"rootId":root.id,"path":"Private/하위/비공개.txt"}],"destination":{"rootId":root.id,"path":"대상"}})).unwrap();
    assert_eq!(fs::read(files.join("대상/비공개.txt")).unwrap(),b"private");
    dispatch(&engine,"quickAccess",json!({"action":"favorite","location":{"rootId":root.id,"path":"Private/하위"}})).unwrap();
    let saved=engine.scan(&json!({"id":root.id})).unwrap();assert_eq!(saved.excluded_paths,root.excluded_paths);
    fs::write(files.join("Private/new.txt"),"new").unwrap();engine.refresh(&[files.join("Private/new.txt")]).unwrap();assert!(!engine.store.lock().unwrap().index.entries.iter().any(|entry|entry.path.starts_with("Private/")));
    let reopened=Engine::new(data).unwrap();assert_eq!(reopened.roots()[0].excluded_paths,root.excluded_paths);
    let included=engine.scan(&json!({"id":root.id,"excludedPaths":[]})).unwrap();assert!(included.excluded_paths.is_empty());assert!(engine.store.lock().unwrap().index.entries.iter().any(|entry|entry.path=="Private/new.txt"));
}
#[test]
fn invalid_exclusion_rules_never_replace_the_current_snapshot(){
    let temp=tempfile::tempdir().unwrap();let files=temp.path().join("files");fs::create_dir(&files).unwrap();fs::write(files.join("keep.txt"),"keep").unwrap();let engine=Engine::new(temp.path().join("data")).unwrap();let root=engine.scan(&json!({"absolutePath":files})).unwrap();
    for rules in [json!([""]),json!(["../secret"]),json!(["C:\\secret"]),json!(["/secret"]),json!(["a//b"]),json!(["a/../b"]),json!(vec!["a";129])]{assert!(engine.scan(&json!({"id":root.id,"excludedPaths":rules})).is_err());assert_eq!(engine.roots()[0].count,1);assert!(engine.roots()[0].excluded_paths.is_empty());}
    assert!(files.join("keep.txt").exists());
}

#[test]
fn access_time_only_refresh_does_not_invalidate_search_pages(){
    let temp=tempfile::tempdir().unwrap();let files=temp.path().join("files");fs::create_dir(&files).unwrap();fs::write(files.join("file.txt"),"content").unwrap();let engine=Engine::new(temp.path().join("data")).unwrap();engine.scan(&json!({"absolutePath":files})).unwrap();
    let version;{
        let mut store=engine.store.lock().unwrap();store.snapshots[0].entries[0].accessed=Some(1);store.index.entries[0].accessed=Some(1);version=store.version;
    }
    engine.refresh(&[files.join("file.txt")]).unwrap();assert_eq!(engine.store.lock().unwrap().version,version);
}

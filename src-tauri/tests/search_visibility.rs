use every_directory_lib::{dispatch,store::Engine};
use serde_json::json;
use std::fs;
#[test]
fn visibility_is_applied_before_counting_and_paging_and_can_be_overridden(){
 let t=tempfile::tempdir().unwrap();let files=t.path().join("files");fs::create_dir_all(files.join("$Recycle.Bin/a")).unwrap();fs::create_dir_all(files.join(".hidden")).unwrap();
 for name in ["report.txt","$budget.txt","~$report.docx","cache.tmp","$Recycle.Bin/a/deleted.txt",".hidden/secret.txt"]{fs::write(files.join(name),"test").unwrap();}
 let engine=Engine::new(t.path().join("data")).unwrap();let root=engine.scan(&json!({"absolutePath":files})).unwrap();
 let search=|extra:serde_json::Value|{let mut p=json!({"query":"","rootId":root.id,"category":"all","fullPath":true});for(k,v)in extra.as_object().unwrap(){p[k]=v.clone();}dispatch(&engine,"search",p).unwrap()};
 let default=search(json!({}));let names:Vec<_>=default["entries"].as_array().unwrap().iter().map(|c|c["name"].as_str().unwrap()).collect();assert_eq!(names.len(),2);assert!(names.contains(&"$budget.txt"));assert!(names.contains(&"report.txt"));assert_eq!(default["total"],2);
 let all=search(json!({"showHidden":true,"showTemporary":true,"showRecycleBin":true}));assert!(all["total"].as_u64().unwrap()>=8);
 let page=search(json!({"limit":1,"offset":1}));assert_eq!(page["total"],2);assert_eq!(page["entries"].as_array().unwrap().len(),1);
}

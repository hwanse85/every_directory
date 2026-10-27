use every_directory_lib::{model::{Entry,SearchOptions,Root},search::Index};
use serde_json::json;
fn index()->Index{
    let mut index=Index::default();
    index.replace((0..1205).map(|n|Entry{id:format!("entry-{n:04}"),root_id:"root".into(),name:format!("보고서 {n}.txt"),path:format!("보고서 {n}.txt"),parent:String::new(),kind:"file".into(),extension:"txt".into(),size:Some(n),modified:n+1,hidden:false,created:None,accessed:None,readonly:false,}).collect());index
}
fn options(value:serde_json::Value)->SearchOptions{serde_json::from_value(value).unwrap()}
#[test]
fn pages_cover_more_than_1000_without_duplicates(){
    let index=index();let first=index.search(&options(json!({"query":"ㅂㄱㅅ","limit":1000}))).unwrap();
    let second=index.search(&options(json!({"query":"ㅂㄱㅅ","limit":1000,"offset":1000}))).unwrap();
    assert_eq!(first.total,1205);assert_eq!(second.entries.len(),205);
    let ids:std::collections::HashSet<_>=first.entries.iter().chain(second.entries.iter()).map(|entry|&entry.id).collect();assert_eq!(ids.len(),1205);
}
#[test]
fn sorting_happens_before_pagination_and_has_stable_ties(){
    let index=index();
    let result=index.search(&options(json!({"query":"","limit":3,"sortBy":"size","descending":true}))).unwrap();
    assert_eq!(result.entries.iter().map(|entry|entry.size.unwrap()).collect::<Vec<_>>(),vec![1204,1203,1202]);
    let result=index.search(&options(json!({"query":"","limit":3,"offset":3,"sortBy":"modified","descending":true}))).unwrap();
    assert_eq!(result.entries.iter().map(|entry|entry.modified).collect::<Vec<_>>(),vec![1202,1201,1200]);
    let result=index.search(&options(json!({"query":"","limit":3,"sortBy":"name"}))).unwrap();
    assert_eq!(result.entries[2].name,"보고서 2.txt");
}
#[test]
fn root_sort_uses_visible_root_names_and_bad_sort_is_rejected(){
    let mut index=index();let mut entries=index.entries[..2].to_vec();entries[0].root_id="a".into();entries[1].root_id="b".into();index.replace(entries);
    index.set_roots([("a","Zulu"),("b","Alpha")].map(|(id,name)|Root{id:id.into(),name:name.into(),absolute_path:format!("C:/{name}"),count:1,last_indexed:0,skipped:0,watch_error:None,excluded_paths:vec![],}));
    let result=index.search(&options(json!({"query":"","sortBy":"root"}))).unwrap();assert_eq!(result.entries[0].root_id,"b");
    assert!(index.search(&options(json!({"query":"","sortBy":"unsupported"}))).is_err());
}

#![cfg(windows)]
use every_directory_lib::{dispatch, model::Location, store::Engine};
use serde_json::json;
use std::{fs, path::PathBuf};

#[test]
#[ignore = "requires ED_CROSS_VOLUME_DIRECTORY on a second writable volume"]
fn shell_moves_files_and_folders_between_actual_volumes_and_refreshes_both_indexes() {
    let other = PathBuf::from(
        std::env::var_os("ED_CROSS_VOLUME_DIRECTORY").expect("second writable volume required"),
    );
    let origin = tempfile::tempdir().unwrap();
    let destination = tempfile::Builder::new()
        .prefix("ed-native-transfer-")
        .tempdir_in(other)
        .unwrap();
    let files = origin.path().join("files");
    fs::create_dir_all(files.join("문서/빈 폴더")).unwrap();
    fs::write(files.join("문서/보고서.txt"), "nested bytes").unwrap();
    let bytes: Vec<_> = (0..8 * 1024 * 1024).map(|n| (n % 251) as u8).collect();
    fs::write(files.join("binary.dat"), &bytes).unwrap();
    let engine = Engine::new(origin.path().join("data")).unwrap();
    let from = engine.scan(&json!({"absolutePath":files})).unwrap().id;
    let to = engine
        .scan(&json!({"absolutePath":destination.path()}))
        .unwrap()
        .id;
    dispatch(&engine,"operation",json!({"action":"move","entries":[{"rootId":from,"path":"binary.dat"},{"rootId":from,"path":"문서"}],"destination":{"rootId":to,"path":""}})).unwrap();
    assert!(!files.join("binary.dat").exists() && !files.join("문서").exists());
    assert_eq!(
        fs::read(destination.path().join("binary.dat")).unwrap(),
        bytes
    );
    assert_eq!(
        fs::read(destination.path().join("문서/보고서.txt")).unwrap(),
        b"nested bytes"
    );
    assert!(destination.path().join("문서/빈 폴더").is_dir());
    assert!(!files.join(".every-directory-trash").exists());
    assert!(engine
        .list(&Location {
            root_id: from.clone(),
            path: String::new()
        })
        .unwrap()
        .is_empty());
    assert_eq!(
        engine
            .list(&Location {
                root_id: to.clone(),
                path: String::new()
            })
            .unwrap()
            .len(),
        2
    );
    for _ in 0..2 {
        dispatch(&engine,"operation",json!({"action":"copy","entries":[{"rootId":to,"path":"문서"}],"destination":{"rootId":from,"path":""}})).unwrap();
    }
    assert_eq!(
        fs::read(files.join("문서 (1)/보고서.txt")).unwrap(),
        b"nested bytes"
    );
    assert_eq!(
        fs::read(destination.path().join("문서/보고서.txt")).unwrap(),
        b"nested bytes"
    );
    // Prove the roots are different volumes, rather than accidentally exercising rename only.
    let probe = files.join("probe.txt");
    fs::write(&probe, "probe").unwrap();
    use std::os::windows::ffi::OsStrExt;
    let from: Vec<u16> = probe.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = destination
        .path()
        .join("probe.txt")
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    assert_eq!(
        unsafe {
            windows_sys::Win32::Storage::FileSystem::MoveFileExW(from.as_ptr(), to.as_ptr(), 0)
        },
        0
    );
    assert_eq!(std::io::Error::last_os_error().raw_os_error(), Some(17));
}

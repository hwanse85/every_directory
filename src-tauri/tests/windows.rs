use every_directory_lib::operations;
#[cfg(windows)]
use every_directory_lib::{dispatch, store::Engine};
#[cfg(windows)]
use serde_json::json;
#[cfg(windows)]
use std::fs;
use std::path::Path;

#[test]
fn portable_reserved_device_names_are_rejected_before_file_operations() {
    for name in [
        "CON",
        "NUL.txt",
        "COM1.pdf",
        "COM¹.txt",
        "LPT²",
        "lpt³.pdf",
        "CONIN$",
        "CONOUT$.txt",
    ] {
        assert!(operations::validate_name(name).is_err(), "{name}");
    }
    for name in ["COM10.txt", "업무 문서.txt", "자료 [1]&'().txt"] {
        assert!(operations::validate_name(name).is_ok(), "{name}");
    }
    assert_eq!(
        operations::windows_terminal_script(Path::new(r"\\?\UNC\server\공유\O'Brien [1]&자료")),
        "Set-Location -LiteralPath '\\\\server\\공유\\O''Brien [1]&자료'"
    );
}

#[test]
fn about_links_reject_local_files_and_untrusted_hosts() {
    for value in [
        "file:///C:/Windows/System32/cmd.exe",
        "http://github.com/hwanse85/every_directory",
        "https://github.com.example.org",
        "https://user:password@github.com/",
    ] {
        assert!(operations::open_external_link(value).is_err());
    }
}

// 기본 Windows 사용자 권한으로 실제 긴 경로·한글·파일 작업을 검증한다.
#[cfg(windows)]
#[test]
fn windows_long_paths_restore_case_navigation_and_legacy_snapshots() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("업무 [1]&'()");
    let relative = format!("Reports/{}/{}/하위", "a".repeat(110), "b".repeat(110));
    fs::create_dir_all(root.join(&relative)).unwrap();
    fs::create_dir_all(root.join("ÜBER")).unwrap();
    fs::write(root.join(&relative).join("보고서.txt"), "원본").unwrap();
    let data = temp.path().join("data");
    let engine = Engine::new(data.clone()).unwrap();
    let connected = dispatch(&engine, "scan", json!({"absolutePath":root})).unwrap();
    let id = connected["id"].as_str().unwrap();
    assert!(!connected["absolutePath"]
        .as_str()
        .unwrap()
        .starts_with(r"\\?\"));
    assert_eq!(
        dispatch(
            &engine,
            "directoryLocation",
            json!({"rootId":id,"path":relative.to_lowercase()})
        )
        .unwrap()["path"],
        relative
    );
    assert_eq!(
        dispatch(
            &engine,
            "directoryLocation",
            json!({"rootId":id,"path":"über"})
        )
        .unwrap()["path"],
        "ÜBER"
    );
    assert!(dispatch(
        &engine,
        "directoryLocation",
        json!({"rootId":id,"path":format!("{relative}/보고서.txt")})
    )
    .is_err());
    let trashed = dispatch(
        &engine,
        "operation",
        json!({"action":"trash","entries":[{"rootId":id,"path":format!("{relative}/보고서.txt")}]}),
    )
    .unwrap();
    assert!(!root.join(&relative).join("보고서.txt").exists());
    dispatch(
        &engine,
        "operation",
        json!({"action":"restore","trashId":trashed["records"][0]["id"]}),
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(root.join(&relative).join("보고서.txt")).unwrap(),
        "원본"
    );

    // 웹 버전이 저장한 일반 경로도 재시작 후 canonical 비교에서 거부되지 않는다.
    let mut disk: serde_json::Value =
        serde_json::from_slice(&fs::read(data.join("index.json")).unwrap()).unwrap();
    disk["snapshots"][0]["root"]["absolutePath"] = json!(root);
    fs::write(data.join("index.json"), serde_json::to_vec(&disk).unwrap()).unwrap();
    let reopened = Engine::new(data).unwrap();
    assert_eq!(
        dispatch(&reopened, "list", json!({"rootId":id,"path":relative}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[cfg(windows)]
#[test]
fn windows_hidden_attribute_and_literal_terminal_paths() {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("O'Brien [1]&한글");
    fs::create_dir(&root).unwrap();
    let hidden = root.join("hidden.txt");
    fs::write(&hidden, "hidden").unwrap();
    let wide: Vec<u16> = hidden.as_os_str().encode_wide().chain(Some(0)).collect();
    assert_ne!(
        unsafe { SetFileAttributesW(wide.as_ptr(), FILE_ATTRIBUTE_HIDDEN) },
        0
    );
    let engine = Engine::new(temp.path().join("data")).unwrap();
    let id = engine.scan(&json!({"absolutePath":root})).unwrap().id;
    let listing = dispatch(&engine, "list", json!({"rootId":id,"path":""})).unwrap();
    assert_eq!(listing[0]["hidden"], true);
    let script = format!("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; {}; [Console]::Write($PWD.ProviderPath)", operations::windows_terminal_script(&root));
    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &script,
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(
        String::from_utf8_lossy(&output.stdout).trim_start_matches('\u{feff}'),
        root.to_string_lossy()
    );
}

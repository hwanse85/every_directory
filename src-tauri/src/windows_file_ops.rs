//! Windows owns recursive transfers, progress, cancellation, metadata and cross-volume moves.
use std::{
    fs, io,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
};
use windows::{
    core::PCWSTR,
    Win32::{
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, IBindCtx, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
        },
        UI::Shell::{
            FileOperation, IFileOperation, IFileOperationProgressSink, IShellItem,
            SHCreateItemFromParsingName, FOFX_DONTDISPLAYDESTPATH, FOFX_EARLYFAILURE,
            FOFX_NOCOPYHOOKS, FOF_NOCONFIRMMKDIR, FOF_NOERRORUI, FOF_NO_CONNECTED_ELEMENTS,
        },
    },
};

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

// Shell parsing names use ordinary drive/UNC paths rather than Win32's verbatim prefix.
pub(crate) fn shell_path(path: &Path) -> Vec<u16> {
    let mut value = wide(path);
    if value.starts_with(&[92, 92, 63, 92, 85, 78, 67, 92]) {
        value.drain(..8);
        value.splice(..0, [92, 92]);
    } else if value.starts_with(&[92, 92, 63, 92]) {
        value.drain(..4);
    }
    value
}

// No replace flag: the existence check and rename cannot overwrite a racing file.
pub(crate) fn rename(source: &Path, target: &Path) -> io::Result<()> {
    let from = wide(source);
    let to = wide(target);
    if unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(from.as_ptr(), to.as_ptr(), 0)
    } == 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn validate_source(source: &Path) -> Result<(), String> {
    // Keep the application's link boundary before handing a tree to the Shell.
    for item in walkdir::WalkDir::new(source).follow_links(false) {
        let item = item.map_err(|error| error.to_string())?;
        if item.file_type().is_symlink() {
            return Err("심볼릭 링크는 파일 작업에서 제외합니다.".into());
        }
        if !item.file_type().is_file() && !item.file_type().is_dir() {
            return Err("일반 파일과 폴더만 처리할 수 있습니다.".into());
        }
    }
    Ok(())
}

pub(crate) fn transfer(plans: &[(PathBuf, PathBuf)], moving: bool) -> Result<(), String> {
    for (source, target) in plans {
        validate_source(source)?;
        crate::operations::unused(target)?;
    }
    if plans.is_empty() {
        return Ok(());
    }
    let plans = plans.to_vec();
    // Tauri commands run on arbitrary worker threads. IFileOperation requires an STA.
    std::thread::Builder::new()
        .name("windows-file-operation".into())
        .spawn(move || perform(&plans, moving))
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|_| "Windows 파일 작업 스레드가 종료되었습니다.".to_string())?
}

fn perform(plans: &[(PathBuf, PathBuf)], moving: bool) -> Result<(), String> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)
            .ok()
            .map_err(|error| error.to_string())?;
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe {
                    CoUninitialize();
                }
            }
        }
        let _apartment = Apartment;
        let operation: IFileOperation =
            CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| error.to_string())?;
        // Native progress/cancel UI stays enabled. Never answer Yes-to-all or enable replacement.
        operation
            .SetOperationFlags(
                FOF_NOERRORUI
                    | FOF_NOCONFIRMMKDIR
                    | FOF_NO_CONNECTED_ELEMENTS
                    | FOFX_EARLYFAILURE
                    | FOFX_NOCOPYHOOKS
                    | FOFX_DONTDISPLAYDESTPATH,
            )
            .map_err(|error| error.to_string())?;
        for (source, target) in plans {
            let from = shell_path(source);
            let folder = shell_path(target.parent().ok_or("대상 폴더가 없습니다.")?);
            let name: Vec<u16> = target
                .file_name()
                .ok_or("대상 이름이 없습니다.")?
                .encode_wide()
                .chain(Some(0))
                .collect();
            let source: IShellItem =
                SHCreateItemFromParsingName(PCWSTR(from.as_ptr()), None::<&IBindCtx>)
                    .map_err(|error| error.to_string())?;
            let folder: IShellItem =
                SHCreateItemFromParsingName(PCWSTR(folder.as_ptr()), None::<&IBindCtx>)
                    .map_err(|error| error.to_string())?;
            let result = if moving {
                operation.MoveItem(
                    &source,
                    &folder,
                    PCWSTR(name.as_ptr()),
                    None::<&IFileOperationProgressSink>,
                )
            } else {
                operation.CopyItem(
                    &source,
                    &folder,
                    PCWSTR(name.as_ptr()),
                    None::<&IFileOperationProgressSink>,
                )
            };
            result.map_err(|error| error.to_string())?;
        }
        operation
            .PerformOperations()
            .map_err(|error| error.to_string())?;
        if operation
            .GetAnyOperationsAborted()
            .map_err(|error| error.to_string())?
            .as_bool()
        {
            return Err("파일 작업이 취소되었거나 일부 항목을 처리하지 못했습니다. 원본과 대상 폴더를 확인해 주세요.".into());
        }
        // A successful HRESULT alone does not imply that all requested targets exist.
        for (source, target) in plans {
            if fs::symlink_metadata(target).is_err() || (moving && source.exists()) {
                return Err("Windows 파일 작업이 모두 완료되지 않았습니다. 원본과 대상 폴더를 확인해 주세요.".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn shell_batch_copies_unicode_trees_metadata_and_alternate_streams() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("원본 폴더");
        let target = temp.path().join("사본 폴더");
        fs::create_dir_all(source.join("빈 폴더")).unwrap();
        let file = source.join("업무 보고서.txt");
        fs::write(&file, "original bytes").unwrap();
        fs::write(format!("{}:annotation", file.display()), "native stream").unwrap();
        let time = UNIX_EPOCH + Duration::from_secs(1_600_000_000);
        fs::OpenOptions::new()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(time)
            .unwrap();
        let second = temp.path().join("second.txt");
        fs::write(&second, "second bytes").unwrap();
        transfer(
            &[
                (source.clone(), target.clone()),
                (second.clone(), temp.path().join("second copy.txt")),
            ],
            false,
        )
        .unwrap();
        let copied = target.join("업무 보고서.txt");
        assert_eq!(fs::read(&copied).unwrap(), b"original bytes");
        assert_eq!(
            fs::read(format!("{}:annotation", copied.display())).unwrap(),
            b"native stream"
        );
        assert_eq!(fs::metadata(copied).unwrap().modified().unwrap(), time);
        assert!(target.join("빈 폴더").is_dir());
        assert!(source.is_dir() && second.is_file());
        assert_eq!(
            fs::read(temp.path().join("second copy.txt")).unwrap(),
            b"second bytes"
        );
    }

    #[test]
    fn shell_move_transfers_a_whole_tree_without_an_app_trash_copy() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("original");
        let target = temp.path().join("moved");
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("nested/file.txt"), "bytes").unwrap();
        transfer(&[(source.clone(), target.clone())], true).unwrap();
        assert!(!source.exists());
        assert_eq!(fs::read(target.join("nested/file.txt")).unwrap(), b"bytes");
        assert!(!temp.path().join(".every-directory-trash").exists());
    }

    #[test]
    fn shell_refuses_existing_targets_before_any_batch_is_changed() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("original.txt");
        let target = temp.path().join("existing.txt");
        fs::write(&source, "original").unwrap();
        fs::write(&target, "existing").unwrap();
        for moving in [false, true] {
            assert!(transfer(&[(source.clone(), target.clone())], moving).is_err());
            assert_eq!(fs::read(&source).unwrap(), b"original");
            assert_eq!(fs::read(&target).unwrap(), b"existing");
        }
    }

    #[test]
    fn shell_reports_locked_sources_without_deleting_them() {
        use std::os::windows::fs::OpenOptionsExt;
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("locked.txt");
        let target = temp.path().join("target.txt");
        fs::write(&source, "original bytes").unwrap();
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&source)
            .unwrap();
        for moving in [false, true] {
            assert!(transfer(&[(source.clone(), target.clone())], moving).is_err());
            assert!(source.exists());
        }
        drop(locked);
        assert_eq!(fs::read(source).unwrap(), b"original bytes");
    }

    #[test]
    fn shell_supports_extended_unicode_paths() {
        let temp = tempfile::tempdir().unwrap();
        let mut source = temp.path().to_path_buf();
        for _ in 0..5 {
            source = source.join("long-component-".repeat(4));
        }
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("보고서.txt"), "long path bytes").unwrap();
        let target = temp.path().join("long copy");
        transfer(&[(source.canonicalize().unwrap(), target.clone())], false).unwrap();
        assert_eq!(
            fs::read(target.join("보고서.txt")).unwrap(),
            b"long path bytes"
        );
    }

    #[test]
    fn shell_does_not_follow_a_junction_outside_the_selected_tree() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let outside = temp.path().join("outside");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("private.txt"), "outside bytes").unwrap();
        let status = std::process::Command::new("powershell.exe")
            .args(["-NoProfile","-NonInteractive","-Command","New-Item -ItemType Junction -Path $env:ED_JUNCTION_LINK -Target $env:ED_JUNCTION_TARGET -ErrorAction Stop | Out-Null"])
            .env("ED_JUNCTION_LINK",source.join("link"))
            .env("ED_JUNCTION_TARGET",&outside).status().unwrap();
        assert!(status.success());
        let target = temp.path().join("target");
        assert!(transfer(&[(source, target.clone())], false).is_err());
        assert!(!target.exists());
        assert_eq!(
            fs::read(outside.join("private.txt")).unwrap(),
            b"outside bytes"
        );
    }
}

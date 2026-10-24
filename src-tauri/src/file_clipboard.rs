use crate::{model::Location, store::Engine};
use std::path::{Path, PathBuf};

// Windows 확장 경로 접두사를 사용자가 붙여넣을 수 있는 경로로 바꾼다.
pub fn path_text(path: &Path) -> String {
    let value = path.to_string_lossy().into_owned();
    if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") {
        return format!("\\\\{unc}");
    }
    if let Some(local) = value.strip_prefix("\\\\?\\") {
        if local.as_bytes().get(1) == Some(&b':') {
            return local.to_owned();
        }
    }
    value
}

// 내부의 긴 Windows 경로는 보존하고 화면으로 전달하는 경로만 정리한다.
pub fn public_paths(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(object) => {
            // 드라이브 루트의 이름에도 이전 인덱스의 확장 접두사가 남을 수 있다.
            if object.contains_key("absolutePath") {
                if let Some(name) = object.get_mut("name") {
                    if let Some(path) = name.as_str() {
                        *name = serde_json::Value::String(path_text(Path::new(path)));
                    }
                }
            }
            for (key, item) in object {
                if ["absolutePath", "path", "parent", "directory", "destination"]
                    .contains(&key.as_str())
                {
                    if let Some(path) = item.as_str() {
                        *item = serde_json::Value::String(path_text(Path::new(path)));
                    }
                } else {
                    public_paths(item);
                }
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(public_paths),
        _ => {}
    }
}

// 등록된 실제 파일과 폴더만 운영체제 클립보드에 전달한다.
pub fn copy(
    engine: &Engine,
    locations: &[Location],
    owner: isize,
    cut: bool,
) -> Result<(), String> {
    if locations.is_empty() || locations.len() > 200 {
        return Err("복사할 항목을 1~200개 선택해 주세요.".into());
    }
    let paths = locations
        .iter()
        .map(|location| engine.resolve(location))
        .collect::<Result<Vec<_>, _>>()?;
    write_files(&paths, owner, cut)
}

pub fn sequence() -> u32 {
    #[cfg(windows)]
    {
        unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() }
    }
    #[cfg(not(windows))]
    {
        0
    }
}

// 긴 이동 중 사용자가 다른 내용을 복사했다면 새 클립보드를 건드리지 않는다.
pub fn finish_cut(owner: isize, expected: u32) {
    #[cfg(windows)]
    if expected != 0 && open_windows_clipboard(owner as windows_sys::Win32::Foundation::HWND) {
        unsafe {
            if sequence() == expected {
                windows_sys::Win32::System::DataExchange::EmptyClipboard();
            }
            windows_sys::Win32::System::DataExchange::CloseClipboard();
        }
    }
    #[cfg(not(windows))]
    let _ = (owner, expected);
}

// macOS 파일 URL 객체를 기록해 Finder 붙여넣기를 지원한다.
#[cfg(target_os = "macos")]
fn write_files(paths: &[PathBuf], _owner: isize, _cut: bool) -> Result<(), String> {
    write_macos(&objc2_app_kit::NSPasteboard::generalPasteboard(), paths)
}

// 파일 URL 목록을 지정한 macOS 붙여넣기 보드에 기록한다.
#[cfg(target_os = "macos")]
fn write_macos(pasteboard: &objc2_app_kit::NSPasteboard, paths: &[PathBuf]) -> Result<(), String> {
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::NSPasteboardWriting;
    use objc2_foundation::{NSArray, NSString, NSURL};
    objc2::rc::autoreleasepool(|_| {
        let urls: Vec<_> = paths
            .iter()
            .map(|path| {
                NSURL::fileURLWithPath_isDirectory(
                    &NSString::from_str(&path.to_string_lossy()),
                    path.is_dir(),
                )
            })
            .collect();
        let objects: Vec<&ProtocolObject<dyn NSPasteboardWriting>> = urls
            .iter()
            .map(|url| ProtocolObject::from_ref(&**url))
            .collect();
        let objects = NSArray::from_slice(&objects);
        pasteboard.clearContents();
        if pasteboard.writeObjects(&objects) {
            Ok(())
        } else {
            Err("파일을 클립보드에 복사하지 못했습니다.".into())
        }
    })
}

// Windows CF_HDROP 규격의 UTF-16 파일 목록을 만든다.
#[cfg(any(windows, test))]
pub fn hdrop_data(paths: &[PathBuf]) -> Vec<u8> {
    let mut bytes = vec![0u8; 20];
    bytes[..4].copy_from_slice(&20u32.to_le_bytes());
    bytes[16..20].copy_from_slice(&1u32.to_le_bytes());
    for path in paths {
        #[cfg(windows)]
        let units: Vec<u16> = {
            use std::os::windows::ffi::OsStrExt;
            Path::new(&path_text(path))
                .as_os_str()
                .encode_wide()
                .collect()
        };
        #[cfg(not(windows))]
        let units: Vec<u16> = path.to_string_lossy().encode_utf16().collect();
        for unit in units.into_iter().chain(Some(0)) {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
    }
    bytes.extend_from_slice(&0u16.to_le_bytes());
    bytes
}

// Windows 탐색기가 읽는 파일 목록을 이동식 전역 메모리로 전달한다.
#[cfg(windows)]
fn write_files(paths: &[PathBuf], owner: isize, cut: bool) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{GlobalFree, HWND},
        System::{
            DataExchange::{
                CloseClipboard, EmptyClipboard, RegisterClipboardFormatW, SetClipboardData,
            },
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
        },
    };
    let bytes = hdrop_data(paths);
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
        if memory.is_null() {
            return Err("클립보드 메모리를 확보하지 못했습니다.".into());
        }
        let target = GlobalLock(memory);
        if target.is_null() {
            GlobalFree(memory);
            return Err("클립보드 메모리에 접근하지 못했습니다.".into());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), target.cast::<u8>(), bytes.len());
        GlobalUnlock(memory);
        if !open_windows_clipboard(owner as HWND) {
            GlobalFree(memory);
            return Err("다른 프로그램이 클립보드를 사용 중입니다. 다시 시도해 주세요.".into());
        }
        let result = if EmptyClipboard() == 0 || SetClipboardData(15, memory).is_null() {
            GlobalFree(memory);
            Err("파일을 클립보드에 복사하지 못했습니다.".into())
        } else {
            // 탐색기에 복사와 잘라내기의 의도를 함께 전달한다.
            let format: Vec<u16> = "Preferred DropEffect\0".encode_utf16().collect();
            let format = RegisterClipboardFormatW(format.as_ptr());
            let effect = GlobalAlloc(GMEM_MOVEABLE, 4);
            if !effect.is_null() {
                let data = GlobalLock(effect);
                if !data.is_null() {
                    std::ptr::write_unaligned(data.cast::<u32>(), if cut { 2 } else { 1 });
                    GlobalUnlock(effect);
                    if SetClipboardData(format, effect).is_null() {
                        GlobalFree(effect);
                    }
                } else {
                    GlobalFree(effect);
                }
            }
            Ok(())
        };
        CloseClipboard();
        result
    }
}

// 지원하지 않는 환경에서는 파일 복사의 제한을 명확히 알린다.
#[cfg(not(any(windows, target_os = "macos")))]
fn write_files(_paths: &[PathBuf], _owner: isize, _cut: bool) -> Result<(), String> {
    Err("운영체제 파일 복사는 macOS와 Windows에서 지원합니다.".into())
}

// 다른 프로그램의 짧은 클립보드 잠금은 제한된 횟수만 재시도한다.
#[cfg(windows)]
fn open_windows_clipboard(owner: windows_sys::Win32::Foundation::HWND) -> bool {
    for _ in 0..10 {
        if unsafe { windows_sys::Win32::System::DataExchange::OpenClipboard(owner) } != 0 {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    false
}

// Finder가 기록한 파일 URL 목록을 읽고 일반 텍스트는 파일로 해석하지 않는다.
#[cfg(target_os = "macos")]
pub fn read_files(_owner: isize) -> Result<Vec<PathBuf>, String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
    use objc2_foundation::NSURL;
    objc2::rc::autoreleasepool(|_| {
        let board = NSPasteboard::generalPasteboard();
        let mut paths = vec![];
        if let Some(items) = board.pasteboardItems() {
            for item in items.iter() {
                if let Some(value) = item.stringForType(unsafe { NSPasteboardTypeFileURL }) {
                    if let Some(url) = NSURL::URLWithString(&value) {
                        if url.isFileURL() {
                            if let Some(path) = url.path() {
                                paths.push(PathBuf::from(path.to_string()));
                            }
                        }
                    }
                }
            }
        }
        Ok(paths)
    })
}

// 탐색기가 기록한 유니코드 파일 목록을 원래 경로로 복원한다.
#[cfg(windows)]
pub fn read_files(owner: isize) -> Result<Vec<PathBuf>, String> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::{
        Foundation::HWND,
        System::DataExchange::{CloseClipboard, GetClipboardData},
        UI::Shell::DragQueryFileW,
    };
    if !open_windows_clipboard(owner as HWND) {
        return Err("클립보드를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.".into());
    }
    let mut paths = vec![];
    unsafe {
        let drop = GetClipboardData(15);
        if !drop.is_null() {
            let count = DragQueryFileW(drop, u32::MAX, std::ptr::null_mut(), 0);
            if count > 200 {
                CloseClipboard();
                return Err("한 번에 200개까지 붙여넣을 수 있습니다.".into());
            }
            for index in 0..count {
                let length = DragQueryFileW(drop, index, std::ptr::null_mut(), 0);
                let mut name = vec![0u16; length as usize + 1];
                DragQueryFileW(drop, index, name.as_mut_ptr(), name.len() as u32);
                paths.push(PathBuf::from(std::ffi::OsString::from_wide(
                    &name[..length as usize],
                )));
            }
        }
        CloseClipboard();
    }
    Ok(paths)
}

// 파일 클립보드를 지원하지 않는 플랫폼은 명확한 오류를 반환한다.
#[cfg(not(any(windows, target_os = "macos")))]
pub fn read_files(_owner: isize) -> Result<Vec<PathBuf>, String> {
    Err("운영체제 파일 붙여넣기는 Windows와 macOS에서 지원합니다.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    // 경로의 드라이브·UNC 구분과 한글·구분자를 그대로 보존한다.
    #[test]
    fn windows_display_paths_preserve_real_separators() {
        assert_eq!(
            path_text(Path::new(r"\\?\C:\Users\직원\업무 문서")),
            r"C:\Users\직원\업무 문서"
        );
        assert_eq!(
            path_text(Path::new(r"\\?\UNC\server\공유\보고서.txt")),
            r"\\server\공유\보고서.txt"
        );
        assert_eq!(path_text(Path::new("/Users/직원/문서")), "/Users/직원/문서");
        let mut value = serde_json::json!({"roots":[{"absolutePath":r"\\?\C:\Users", "name":r"\\?\C:\"}],"progress":{"directory":r"\\?\UNC\server\공유"}});
        public_paths(&mut value);
        assert_eq!(value["roots"][0]["absolutePath"], r"C:\Users");
        assert_eq!(value["roots"][0]["name"], r"C:\");
        assert_eq!(value["progress"]["directory"], r"\\server\공유");
    }

    // 한글·공백·복수 경로가 Windows 클립보드 규격을 지키는지 확인한다.
    #[test]
    fn windows_file_list_has_unicode_header_and_double_terminator() {
        let paths = [
            PathBuf::from("C:\\업무 문서\\도면.pdf"),
            PathBuf::from("\\\\server\\공유\\report.txt"),
        ];
        let data = hdrop_data(&paths);
        assert_eq!(&data[..4], &20u32.to_le_bytes());
        assert_eq!(&data[16..20], &1u32.to_le_bytes());
        let units: Vec<u16> = data[20..]
            .chunks_exact(2)
            .map(|p| u16::from_le_bytes([p[0], p[1]]))
            .collect();
        let expected = paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("\0")
            + "\0\0";
        assert_eq!(String::from_utf16(&units).unwrap(), expected);
    }

    // 사용자 클립보드와 분리된 네이티브 보드에서 실제 파일 URL을 확인한다.
    #[cfg(target_os = "macos")]
    #[test]
    fn macos_pasteboard_contains_file_urls() {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};
        let temp = tempfile::tempdir().unwrap();
        let paths = [
            temp.path().join("업무 보고서.txt"),
            temp.path().join("설계"),
        ];
        std::fs::write(&paths[0], "문서").unwrap();
        std::fs::create_dir(&paths[1]).unwrap();
        let board = NSPasteboard::pasteboardWithUniqueName();
        write_macos(&board, &paths).unwrap();
        let items = board.pasteboardItems().unwrap();
        assert_eq!(items.len(), 2);
        let url = items
            .objectAtIndex(0)
            .stringForType(unsafe { NSPasteboardTypeFileURL })
            .unwrap();
        assert!(url.to_string().starts_with("file://"));
        assert!(url.to_string().contains(".txt"));
        board.clearContents();
    }
}

//! Local, bounded clipboard history. Windows payloads and metadata use per-user DPAPI.
use crate::{
    preferences::{PreferenceStore, Preferences},
    store::Engine,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
const QUOTA: u64 = 200 * 1024 * 1024;
const CAP: usize = 2000;
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub kind: String,
    pub preview: String,
    pub created_at: u64,
    pub used_at: u64,
    pub bytes: u64,
    pub favorite: bool,
    hash: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Content {
    pub kind: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub png: Vec<u8>,
}
#[derive(Default)]
struct History {
    items: Vec<Clip>,
    error: Option<String>,
}
pub struct ClipboardHistory {
    directory: PathBuf,
    state: Mutex<History>,
    skip_sequence: AtomicU32,
}
#[cfg(windows)]
fn protect(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{Foundation::LocalFree, Security::Cryptography::*};
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes
            .len()
            .try_into()
            .map_err(|_| "클립보드 항목이 너무 큽니다.")?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    unsafe {
        let result = if decrypt {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if result == 0 {
            return Err("Windows 사용자 키로 클립보드 이력을 처리하지 못했습니다.".into());
        }
        let value = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData.cast());
        Ok(value)
    }
}
#[cfg(not(windows))]
fn protect(bytes: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Ok(bytes.to_vec())
}
fn write_secure(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let bytes = protect(bytes, false)?;
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("저장 위치가 없습니다.")?)
        .map_err(|e| e.to_string())?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    temp.persist(path).map_err(|e| e.error.to_string())?;
    Ok(())
}
impl ClipboardHistory {
    pub fn load(data: &Path) -> Result<Self, String> {
        let directory = data.join("clipboard-history");
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let mut state = History::default();
        let path = directory.join("index.bin");
        if path.exists() {
            match fs::read(&path)
                .map_err(|e| e.to_string())
                .and_then(|b| protect(&b, true))
                .and_then(|b| {
                    serde_json::from_slice::<Vec<Clip>>(&b)
                        .map_err(|_| "클립보드 이력 목록을 읽지 못했습니다.".to_string())
                }) {
                Ok(items) => state.items = items,
                Err(e) => state.error = Some(e),
            }
        }
        Ok(Self {
            directory,
            state: Mutex::new(state),
            skip_sequence: AtomicU32::new(0),
        })
    }
    fn persist(&self, items: &[Clip]) -> Result<(), String> {
        write_secure(
            &self.directory.join("index.bin"),
            &serde_json::to_vec(items).map_err(|e| e.to_string())?,
        )
    }
    fn payload(&self, id: &str) -> Result<PathBuf, String> {
        uuid::Uuid::parse_str(id).map_err(|_| "잘못된 이력 항목입니다.")?;
        Ok(self.directory.join(format!("{id}.bin")))
    }
    fn prune(&self, state: &mut History, days: u16) -> Result<(), String> {
        let cutoff = now().saturating_sub(days as u64 * 86400000);
        let mut total = 0;
        let mut removed = vec![];
        let mut next = state.items.clone();
        next.retain(|c| {
            total += c.bytes;
            let keep = c.created_at >= cutoff && total <= QUOTA;
            if !keep {
                removed.push(c.id.clone());
            }
            keep
        });
        if next.len() > CAP {
            removed.extend(next.drain(CAP..).map(|c| c.id));
        }
        if !removed.is_empty() {
            self.persist(&next)?;
            state.items = next;
            for id in removed {
                if let Ok(p) = self.payload(&id) {
                    let _ = fs::remove_file(p);
                }
            }
        }
        Ok(())
    }
    pub fn snapshot(&self, p: &Preferences) -> Result<serde_json::Value, String> {
        let mut state = self.state.lock().unwrap();
        self.prune(&mut state, p.clipboard_days)?;
        Ok(
            serde_json::json!({"items":state.items,"error":state.error,"bytes":state.items.iter().map(|c|c.bytes).sum::<u64>(),"quota":QUOTA,"enabled":p.clipboard_enabled,"days":p.clipboard_days}),
        )
    }
    pub fn insert(&self, content: Content, p: &Preferences) -> Result<(), String> {
        if !p.clipboard_enabled {
            return Ok(());
        }
        let accepted = match content.kind.as_str() {
            "text" => p.clipboard_text && !content.text.is_empty(),
            "image" => p.clipboard_images && !content.png.is_empty(),
            "files" => p.clipboard_files && !content.paths.is_empty() && content.paths.len() <= 200,
            _ => false,
        };
        if !accepted {
            return Ok(());
        }
        let bytes = match content.kind.as_str() {
            "image" => content.png.clone(),
            "text" => content.text.as_bytes().to_vec(),
            "files" => serde_json::to_vec(&content.paths).map_err(|e| e.to_string())?,
            _ => return Ok(()),
        };
        if bytes.len() > p.clipboard_max_mb as usize * 1024 * 1024 {
            return Err("클립보드 항목이 설정한 최대 크기를 초과해 기록하지 않았습니다.".into());
        }
        let mut digest = Sha256::new();
        digest.update(content.kind.as_bytes());
        digest.update(&bytes);
        let hash = format!("{:x}", digest.finalize());
        let mut state = self.state.lock().unwrap();
        if let Some(error) = &state.error {
            return Err(error.clone());
        }
        self.prune(&mut state, p.clipboard_days)?;
        let existing = state.items.iter().find(|c| c.hash == hash).cloned();
        let id = existing
            .as_ref()
            .map(|c| c.id.clone())
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        write_secure(&self.payload(&id)?, &bytes)?;
        let preview = if content.kind == "files" {
            content.paths.join("\n")
        } else if content.kind == "image" {
            format!("이미지 / 캡처 · {} KB", content.png.len() / 1024)
        } else {
            content.text.clone()
        };
        let item = Clip {
            id: id.clone(),
            kind: content.kind,
            preview: preview.chars().take(240).collect(),
            created_at: now(),
            used_at: now(),
            bytes: bytes.len() as u64,
            favorite: existing.is_some_and(|c| c.favorite),
            hash,
        };
        let mut next = state.items.clone();
        next.retain(|c| c.id != id);
        next.insert(0, item);
        self.persist(&next)?;
        state.items = next;
        self.prune(&mut state, p.clipboard_days)?;
        Ok(())
    }
    pub fn read(&self, id: &str, p: &Preferences) -> Result<Content, String> {
        let mut state = self.state.lock().unwrap();
        self.prune(&mut state, p.clipboard_days)?;
        let kind = state
            .items
            .iter()
            .find(|c| c.id == id)
            .ok_or("만료되었거나 삭제된 이력입니다.")?
            .kind
            .clone();
        let bytes = protect(
            &fs::read(self.payload(id)?).map_err(|_| "저장된 클립보드 내용을 읽지 못했습니다.")?,
            true,
        )?;
        match kind.as_str() {
            "image" => Ok(Content {
                kind,
                png: bytes,
                ..Default::default()
            }),
            "text" => Ok(Content {
                kind,
                text: String::from_utf8(bytes).map_err(|_| "저장된 텍스트가 손상되었습니다.")?,
                ..Default::default()
            }),
            "files" => Ok(Content {
                kind,
                paths: serde_json::from_slice(&bytes)
                    .map_err(|_| "저장된 파일 경로가 손상되었습니다.")?,
                ..Default::default()
            }),
            _ => Err("저장된 클립보드 형식이 잘못되었습니다.".into()),
        }
    }
    pub fn change(&self, action: &str, id: Option<&str>) -> Result<(), String> {
        let mut s = self.state.lock().unwrap();
        let mut next = s.items.clone();
        let mut removed = vec![];
        match action {
            "used" => {
                let index = next
                    .iter()
                    .position(|c| Some(c.id.as_str()) == id)
                    .ok_or("이력이 없습니다.")?;
                let mut item = next.remove(index);
                item.created_at = now();
                item.used_at = item.created_at;
                next.insert(0, item);
            }
            "clear" => {
                removed = next.iter().map(|c| c.id.clone()).collect();
                next.clear();
            }
            "delete" => {
                let id = id.ok_or("항목을 선택해 주세요.")?;
                removed.push(id.to_owned());
                next.retain(|c| c.id != id);
            }
            "favorite" => {
                let c = next
                    .iter_mut()
                    .find(|c| Some(c.id.as_str()) == id)
                    .ok_or("이력이 없습니다.")?;
                c.favorite = !c.favorite;
            }
            _ => return Err("지원하지 않는 이력 작업입니다.".into()),
        }
        self.persist(&next)?;
        s.items = next;
        if action == "clear" {
            s.error = None;
            for item in fs::read_dir(&self.directory).map_err(|e| e.to_string())? {
                let item = item.map_err(|e| e.to_string())?;
                let path = item.path();
                if path.extension().is_some_and(|e| e == "bin")
                    && path
                        .file_stem()
                        .is_some_and(|n| uuid::Uuid::parse_str(&n.to_string_lossy()).is_ok())
                {
                    fs::remove_file(path).map_err(|e| e.to_string())?;
                }
            }
        }
        for id in removed {
            if let Ok(path) = self.payload(&id) {
                let _ = fs::remove_file(path);
            }
        }
        Ok(())
    }
}

#[cfg(windows)]
fn excluded() -> bool {
    use windows_sys::Win32::System::{DataExchange::*, Memory::*};
    unsafe {
        let name: Vec<u16> = "ExcludeClipboardContentFromMonitorProcessing\0"
            .encode_utf16()
            .collect();
        if IsClipboardFormatAvailable(RegisterClipboardFormatW(name.as_ptr())) != 0 {
            return true;
        }
        let name: Vec<u16> = "CanIncludeInClipboardHistory\0".encode_utf16().collect();
        let format = RegisterClipboardFormatW(name.as_ptr());
        if IsClipboardFormatAvailable(format) == 0 {
            return false;
        }
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return true;
        }
        let data = GetClipboardData(format);
        let mut concealed = false;
        if !data.is_null() && GlobalSize(data) >= 4 {
            let ptr = GlobalLock(data);
            if !ptr.is_null() {
                concealed = std::ptr::read_unaligned(ptr.cast::<u32>()) == 0;
                GlobalUnlock(data);
            }
        }
        CloseClipboard();
        concealed
    }
}
#[cfg(windows)]
fn excluded_app(p: &Preferences) -> bool {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::{DataExchange::GetClipboardOwner, Threading::*},
        UI::WindowsAndMessaging::GetWindowThreadProcessId,
    };
    unsafe {
        let mut pid = 0;
        GetWindowThreadProcessId(GetClipboardOwner(), &mut pid);
        if pid == 0 {
            return false;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return false;
        }
        let mut path = [0u16; 32768];
        let mut n = path.len() as u32;
        let result = QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut n);
        CloseHandle(process);
        if result == 0 {
            return false;
        }
        let value = String::from_utf16_lossy(&path[..n as usize]);
        let name = value.rsplit('\\').next().unwrap_or("");
        p.clipboard_excluded_apps
            .split(';')
            .any(|s| !s.trim().is_empty() && s.trim().eq_ignore_ascii_case(name))
    }
}
pub fn capture(app: &tauri::AppHandle) -> Result<(), String> {
    let p = app.state::<PreferenceStore>().value.lock().unwrap().clone();
    if !p.clipboard_enabled {
        return Ok(());
    }
    #[cfg(windows)]
    {
        if !crate::file_clipboard::open_windows_clipboard(std::ptr::null_mut()) {
            return Err("CLIPBOARD_BUSY".into());
        }
        unsafe {
            windows_sys::Win32::System::DataExchange::CloseClipboard();
        }
    }
    #[cfg(windows)]
    if excluded() || excluded_app(&p) {
        return Ok(());
    }
    let history = app.state::<Arc<ClipboardHistory>>();
    let sequence = crate::file_clipboard::sequence();
    let insert = |content| {
        if crate::file_clipboard::sequence() == sequence {
            history.insert(content, &p)
        } else {
            Ok(())
        }
    };
    if p.clipboard_files {
        if let Ok(paths) = crate::file_clipboard::read_files(0) {
            if !paths.is_empty() {
                return insert(Content {
                    kind: "files".into(),
                    paths: paths
                        .iter()
                        .map(|p| crate::file_clipboard::path_text(p))
                        .collect(),
                    ..Default::default()
                });
            }
        }
    }
    if p.clipboard_images {
        if let Ok(image) = app.clipboard().read_image() {
            if (image.width() as u64) * (image.height() as u64) > 16_777_216 {
                return Err("이미지가 최대 1,677만 픽셀을 초과해 기록하지 않았습니다.".into());
            }
            let rgba =
                image::RgbaImage::from_raw(image.width(), image.height(), image.rgba().to_vec())
                    .ok_or("이미지를 읽지 못했습니다.")?;
            let mut png = std::io::Cursor::new(vec![]);
            image::DynamicImage::ImageRgba8(rgba)
                .write_to(&mut png, image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
            return insert(Content {
                kind: "image".into(),
                png: png.into_inner(),
                ..Default::default()
            });
        }
    }
    if p.clipboard_text {
        if let Ok(text) = app.clipboard().read_text() {
            insert(Content {
                kind: "text".into(),
                text,
                ..Default::default()
            })?;
        }
    }
    Ok(())
}

pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
    let engine = app.state::<Arc<Engine>>();
    let history = Arc::new(ClipboardHistory::load(&engine.data)?);
    let preferences = app.state::<PreferenceStore>().value.lock().unwrap().clone();
    history.snapshot(&preferences)?;
    app.manage(history);
    #[cfg(feature = "smoke-test")]
    let test_monitor = std::env::var_os("EVERY_DIRECTORY_TEST_CLIPBOARD_MONITOR").is_some();
    #[cfg(not(feature = "smoke-test"))]
    let test_monitor = false;
    #[cfg(windows)]
    if (!cfg!(feature = "smoke-test") && std::env::var_os("EVERY_DIRECTORY_DATA").is_none())
        || test_monitor
    {
        let handle = app.clone();
        std::thread::Builder::new()
            .name("clipboard-history".into())
            .spawn(move || {
                let mut sequence = crate::file_clipboard::sequence();
                let mut retries=0;
                let mut last_prune = std::time::Instant::now();
                loop {
                    std::thread::sleep(Duration::from_millis(200));
                    let next = crate::file_clipboard::sequence();
                    let history = handle.state::<Arc<ClipboardHistory>>();
                    if next != sequence {
                        if next != history.skip_sequence.load(Ordering::SeqCst) {
                            let result = capture(&handle);
                            if let Err(mut e) = result {
                                if e=="CLIPBOARD_BUSY"&&retries<4{retries+=1;continue;}
                                if e=="CLIPBOARD_BUSY"{e="다른 앱의 클립보드 잠금 때문에 이번 내용을 기록하지 못했습니다.".into();}
                                let _ = handle.emit("ed-clipboard-error", e);
                            }
                            let _ = handle.emit("ed-clipboard-changed", ());
                        }
                        sequence=next;retries=0;
                    }
                    if last_prune.elapsed() > Duration::from_secs(60) {
                        let p = handle
                            .state::<PreferenceStore>()
                            .value
                            .lock()
                            .unwrap()
                            .clone();
                        let _ = history.snapshot(&p);
                        last_prune = std::time::Instant::now();
                    }
                }
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn save_content(content: &Content, destination: &Path) -> Result<(), String> {
    if content.kind == "files" {
        if !destination.is_dir() {
            return Err("저장할 폴더를 선택해 주세요.".into());
        }
        let mut reserved = std::collections::HashSet::new();
        let mut plans = vec![];
        for name in &content.paths {
            let source = PathBuf::from(name);
            if !source.exists() {
                return Err("원본 파일이 이동되거나 삭제되었습니다.".into());
            }
            let file = source.file_name().ok_or("파일 이름이 없습니다.")?;
            let mut target = destination.join(file);
            for n in 1..=10000 {
                if !target.exists() && !reserved.contains(&target) {
                    break;
                }
                let stem = if source.is_dir() {
                    file.to_string_lossy().into_owned()
                } else {
                    source
                        .file_stem()
                        .unwrap_or(file)
                        .to_string_lossy()
                        .into_owned()
                };
                let ext = if source.is_dir() {
                    String::new()
                } else {
                    source
                        .extension()
                        .map(|e| format!(".{}", e.to_string_lossy()))
                        .unwrap_or_default()
                };
                target = destination.join(format!("{stem} ({n}){ext}"));
            }
            if target.exists() || !reserved.insert(target.clone()) {
                return Err("사용 가능한 파일 이름이 없습니다.".into());
            }
            let canonical = fs::canonicalize(&source).map_err(|e| e.to_string())?;
            let dest = fs::canonicalize(destination).map_err(|e| e.to_string())?;
            if dest.starts_with(&canonical) {
                return Err("원본 폴더 내부에는 사본을 저장할 수 없습니다.".into());
            }
            plans.push((source, target));
        }
        #[cfg(windows)]
        return crate::windows_file_ops::transfer(&plans, false);
        #[cfg(not(windows))]
        return Err(
            "파일 이력의 사본 저장은 Windows에서 지원합니다. 파일 복사를 이용해 주세요.".into(),
        );
    }
    let bytes = if content.kind == "image" {
        content.png.as_slice()
    } else {
        content.text.as_bytes()
    };
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|e| format!("덮어쓰지 않고 저장할 수 없습니다: {e}"))?;
    f.write_all(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clipboard_control(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: String,
    id: Option<String>,
    destination: Option<String>,
    query: Option<String>,
) -> Result<serde_json::Value, String> {
    if !["main", "quick-search"].contains(&window.label()) {
        return Err("허용되지 않는 창입니다.".into());
    }
    let history = app.state::<Arc<ClipboardHistory>>().inner().clone();
    let p = app.state::<PreferenceStore>().value.lock().unwrap().clone();
    #[cfg(all(windows, feature = "smoke-test"))]
    if action == "testImage" {
        app.clipboard()
            .write_image(&tauri::image::Image::new_owned(
                vec![
                    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
                ],
                2,
                2,
            ))
            .map_err(|e| e.to_string())?;
        return Ok(serde_json::Value::Null);
    }
    #[cfg(all(windows, feature = "smoke-test"))]
    if action == "testProtected" {
        use windows_sys::Win32::{
            Foundation::GlobalFree,
            System::{DataExchange::*, Memory::*},
        };
        app.clipboard()
            .write_text("protected test clipboard")
            .map_err(|e| e.to_string())?;
        unsafe {
            if OpenClipboard(window.hwnd().map_err(|e| e.to_string())?.0.cast()) == 0 {
                return Err("검증용 클립보드를 열지 못했습니다.".into());
            }
            let label: Vec<u16> = "ExcludeClipboardContentFromMonitorProcessing\0"
                .encode_utf16()
                .collect();
            let memory = GlobalAlloc(GMEM_MOVEABLE, 4);
            if memory.is_null() {
                CloseClipboard();
                return Err("검증 메모리 오류".into());
            }
            let ptr = GlobalLock(memory);
            if ptr.is_null() {
                GlobalFree(memory);
                CloseClipboard();
                return Err("검증 메모리 잠금 오류".into());
            }
            std::ptr::write_unaligned(ptr.cast::<u32>(), 1);
            GlobalUnlock(memory);
            let ok = !SetClipboardData(RegisterClipboardFormatW(label.as_ptr()), memory).is_null();
            if !ok {
                GlobalFree(memory);
            }
            CloseClipboard();
            if !ok {
                return Err("검증용 보호 형식을 기록하지 못했습니다.".into());
            }
        }
        return Ok(serde_json::Value::Null);
    }
    if action == "copy" {
        let content = history.read(id.as_deref().ok_or("항목을 선택해 주세요.")?, &p)?;
        match content.kind.as_str() {
            "text" => app
                .clipboard()
                .write_text(content.text)
                .map_err(|e| e.to_string())?,
            "image" => {
                let img = image::load_from_memory(&content.png)
                    .map_err(|e| e.to_string())?
                    .to_rgba8();
                app.clipboard()
                    .write_image(&tauri::image::Image::new_owned(
                        img.clone().into_raw(),
                        img.width(),
                        img.height(),
                    ))
                    .map_err(|e| e.to_string())?;
            }
            "files" => {
                if content.paths.iter().any(|p| !Path::new(p).exists()) {
                    return Err("원본 파일이 이동되거나 삭제되었습니다. 텍스트로 경로를 복사할 수 있습니다.".into());
                }
                #[cfg(windows)]
                crate::file_clipboard::write_files(
                    &content.paths.iter().map(PathBuf::from).collect::<Vec<_>>(),
                    window.hwnd().map_err(|e| e.to_string())?.0 as isize,
                    false,
                )?;
                #[cfg(not(windows))]
                return Err("파일 이력 복원은 Windows에서 지원합니다.".into());
            }
            _ => return Err("지원하지 않는 클립보드 형식입니다.".into()),
        }
        history
            .skip_sequence
            .store(crate::file_clipboard::sequence(), Ordering::SeqCst);
        history.change("used", id.as_deref())?;
        let _ = app.emit("ed-clipboard-changed", ());
        return Ok(serde_json::json!({"copied":true}));
    }
    #[cfg(feature = "smoke-test")]
    if action == "capture" {
        capture(&app)?;
        return history.snapshot(&p);
    }
    tauri::async_runtime::spawn_blocking(move || match action.as_str() {
        "list" => {
            let mut value = history.snapshot(&p)?;
            if let Some(query) = query.filter(|q| !q.is_empty()) {
                if query.len() > 512 {
                    return Err("이력 검색어는 512자까지 입력해 주세요.".into());
                }
                let query = query.to_lowercase();
                if let Some(items) = value["items"].as_array_mut() {
                    items.retain(|clip| {
                        clip["preview"]
                            .as_str()
                            .unwrap_or("")
                            .to_lowercase()
                            .contains(&query)
                            || (clip["kind"] == "text"
                                && history
                                    .read(clip["id"].as_str().unwrap_or(""), &p)
                                    .is_ok_and(|c| c.text.to_lowercase().contains(&query)))
                    });
                }
            }
            Ok(value)
        }
        "read" => {
            serde_json::to_value(history.read(id.as_deref().ok_or("항목을 선택해 주세요.")?, &p)?)
                .map_err(|e| e.to_string())
        }
        "clear" | "delete" | "favorite" => {
            history.change(&action, id.as_deref())?;
            let _ = app.emit("ed-clipboard-changed", ());
            history.snapshot(&p)
        }
        "save" => {
            let c = history.read(id.as_deref().ok_or("항목을 선택해 주세요.")?, &p)?;
            save_content(
                &c,
                Path::new(&destination.ok_or("저장 위치를 선택해 주세요.")?),
            )?;
            Ok(serde_json::json!({"saved":true}))
        }
        _ => Err("지원하지 않는 클립보드 작업입니다.".into()),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_deduplicates_expires_and_protects() {
        let temp = tempfile::tempdir().unwrap();
        let h = ClipboardHistory::load(temp.path()).unwrap();
        let mut p = Preferences::default();
        let c = Content {
            kind: "text".into(),
            text: "private test content".into(),
            ..Default::default()
        };
        h.insert(c.clone(), &p).unwrap();
        h.insert(c, &p).unwrap();
        let s = h.snapshot(&p).unwrap();
        assert_eq!(s["items"].as_array().unwrap().len(), 1);
        let id = s["items"][0]["id"].as_str().unwrap();
        h.change("favorite", Some(id)).unwrap();
        assert_eq!(
            ClipboardHistory::load(temp.path())
                .unwrap()
                .read(id, &p)
                .unwrap()
                .text,
            "private test content"
        );
        #[cfg(windows)]
        assert!(!fs::read(h.payload(id).unwrap())
            .unwrap()
            .windows(7)
            .any(|s| s == b"private"));
        {
            h.state.lock().unwrap().items[0].created_at = now() - 11 * 86400000;
        }
        assert!(h.snapshot(&p).unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty());
        p.clipboard_enabled = false;
        h.insert(
            Content {
                kind: "text".into(),
                text: "skip".into(),
                ..Default::default()
            },
            &p,
        )
        .unwrap();
        assert!(h.snapshot(&p).unwrap()["items"]
            .as_array()
            .unwrap()
            .is_empty());
        assert!(h.payload("../outside").is_err());
    }
    #[test]
    fn export_never_overwrites_existing_content() {
        let t = tempfile::tempdir().unwrap();
        let path = t.path().join("clip.txt");
        fs::write(&path, "original").unwrap();
        assert!(save_content(
            &Content {
                kind: "text".into(),
                text: "new".into(),
                ..Default::default()
            },
            &path
        )
        .is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "original");
    }
}

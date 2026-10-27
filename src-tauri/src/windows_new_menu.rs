//! Delegate installed file types, templates, wizards and naming to the Shell New handler.
use crate::{model::Location, store::Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use windows::{
    core::{w, Interface, PCSTR, PCWSTR},
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
        },
        UI::{
            Shell::{
                CLSID_NewMenu, IContextMenu, IContextMenu2, IContextMenu3, IShellExtInit,
                SHParseDisplayName, CMF_NORMAL, CMINVOKECOMMANDINFOEX, SEE_MASK_UNICODE,
            },
            WindowsAndMessaging::*,
        },
    },
};

static OPEN: AtomicBool = AtomicBool::new(false);
#[cfg(any(test, feature = "smoke-test"))]
static NEXT: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
#[cfg(any(test, feature = "smoke-test"))]
static TRACKED: AtomicBool = AtomicBool::new(false);
#[cfg(any(test, feature = "smoke-test"))]
pub fn test_choice(choice: &str) -> Result<(), String> {
    if ![".txt", ".xlsx", "NewFolder", "__cancel", "__popup_cancel"].contains(&choice) {
        return Err("지원하지 않는 검증 명령입니다.".into());
    }
    *NEXT.lock().unwrap() = Some(choice.to_owned());
    TRACKED.store(false, Ordering::SeqCst);
    Ok(())
}
#[cfg(any(test, feature = "smoke-test"))]
pub fn test_tracked() -> bool {
    TRACKED.load(Ordering::SeqCst)
}
const FIRST: u32 = 1;
#[derive(Clone, Copy, Deserialize)]
pub struct MenuPoint {
    pub x: i32,
    pub y: i32,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewResult {
    pub invoked: bool,
    pub created: Vec<Location>,
}
struct Apartment;
impl Apartment {
    unsafe fn new() -> Result<Self, String> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE)
                .ok()
                .map_err(|error| error.to_string())?;
        }
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}
struct Host {
    context2: Option<IContextMenu2>,
    context3: Option<IContextMenu3>,
}
unsafe extern "system" fn procedure(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe {
        let pointer = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const Host;
        if !pointer.is_null()
            && [WM_INITMENUPOPUP, WM_DRAWITEM, WM_MEASUREITEM, WM_MENUCHAR].contains(&message)
        {
            let host = &*pointer;
            if let Some(context) = &host.context3 {
                let mut result = LRESULT(0);
                if context
                    .HandleMenuMsg2(message, wparam, lparam, Some(&mut result))
                    .is_ok()
                {
                    return result;
                }
            } else if let Some(context) = &host.context2 {
                if context.HandleMenuMsg(message, wparam, lparam).is_ok() {
                    return LRESULT(if message == WM_DRAWITEM || message == WM_MEASUREITEM {
                        1
                    } else {
                        0
                    });
                }
            }
        }
        DefWindowProcW(hwnd, message, wparam, lparam)
    }
}
struct NewMenu {
    window: HWND,
    menu: HMENU,
    popup: HMENU,
    context: IContextMenu,
    host: Box<Host>,
}
impl Drop for NewMenu {
    fn drop(&mut self) {
        unsafe {
            SetWindowLongPtrW(self.window, GWLP_USERDATA, 0);
            let _ = DestroyMenu(self.menu);
            let _ = DestroyWindow(self.window);
        }
    }
}
fn shell_path(path: &Path) -> Vec<u16> {
    crate::file_clipboard::path_text(path)
        .encode_utf16()
        .chain(Some(0))
        .collect()
}
impl NewMenu {
    unsafe fn select(&self, owner: HWND, at: POINT) -> Result<u32, String> {
        unsafe {
            #[cfg(any(test, feature = "smoke-test"))]
            let choice = NEXT.lock().unwrap().take();
            #[cfg(any(test, feature = "smoke-test"))]
            if let Some(choice) = choice.as_deref() {
                if choice == "__cancel" {
                    return Ok(0);
                }
                if choice != "__popup_cancel" {
                    return self
                        .items()
                        .into_iter()
                        .find(|(_, _, verb)| verb == choice)
                        .map(|item| item.0)
                        .ok_or_else(|| "이 PC에 검증할 새로 만들기 항목이 없습니다.".into());
                }
            }
            #[cfg(any(test, feature = "smoke-test"))]
            let timer = if choice.as_deref() == Some("__popup_cancel") {
                let handle = self.window.0 as isize;
                let thread = GetWindowThreadProcessId(self.window, None);
                Some(std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    let hwnd = HWND(handle as *mut _);
                    let mut info = GUITHREADINFO {
                        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
                        ..Default::default()
                    };
                    if GetGUIThreadInfo(thread, &mut info).is_ok() {
                        TRACKED.store(info.hwndMenuOwner == hwnd, Ordering::SeqCst);
                    }
                    let _ = PostMessageW(Some(hwnd), WM_CANCELMODE, WPARAM(0), LPARAM(0));
                }))
            } else {
                None
            };
            let _ = SetForegroundWindow(owner);
            let id = TrackPopupMenuEx(
                self.popup,
                (TPM_RETURNCMD | TPM_RIGHTBUTTON).0,
                at.x,
                at.y,
                self.window,
                None,
            )
            .0 as u32;
            #[cfg(any(test, feature = "smoke-test"))]
            if let Some(timer) = timer {
                let _ = timer.join();
            }
            let _ = PostMessageW(Some(owner), WM_NULL, WPARAM(0), LPARAM(0));
            Ok(id)
        }
    }
    unsafe fn new(path: &Path, owner: HWND) -> Result<Self, String> {
        unsafe {
            let context: IContextMenu =
                CoCreateInstance(&CLSID_NewMenu, None, CLSCTX_INPROC_SERVER).map_err(|error| {
                    format!("Windows 새로 만들기를 불러오지 못했습니다: {error}")
                })?;
            let mut pidl = std::ptr::null_mut();
            let wide = shell_path(path);
            SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut pidl, 0, None)
                .map_err(|error| error.to_string())?;
            let initialized = context
                .cast::<IShellExtInit>()
                .and_then(|init| init.Initialize(Some(pidl), None, None));
            CoTaskMemFree(Some(pidl.cast()));
            initialized.map_err(|error| error.to_string())?;
            let window = CreateWindowExW(
                WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("Every Directory Shell New"),
                WS_POPUP,
                0,
                0,
                0,
                0,
                Some(owner),
                None,
                None,
                None,
            )
            .map_err(|error| error.to_string())?;
            let menu = match CreatePopupMenu() {
                Ok(menu) => menu,
                Err(error) => {
                    let _ = DestroyWindow(window);
                    return Err(error.to_string());
                }
            };
            let mut host = Box::new(Host {
                context2: context.cast().ok(),
                context3: context.cast().ok(),
            });
            SetWindowLongPtrW(window, GWLP_USERDATA, (&mut *host as *mut Host) as isize);
            SetWindowLongPtrW(window, GWLP_WNDPROC, procedure as *const () as isize);
            let mut result = Self {
                window,
                menu,
                popup: menu,
                context,
                host,
            };
            result
                .context
                .QueryContextMenu(menu, 0, FIRST, 0x7fff, CMF_NORMAL)
                .ok()
                .map_err(|error| error.to_string())?;
            if GetMenuItemCount(Some(menu)) == 1 {
                let submenu = GetSubMenu(menu, 0);
                if !submenu.is_invalid() {
                    result.popup = submenu;
                }
            }
            if let Some(context) = &result.host.context3 {
                context
                    .HandleMenuMsg2(
                        WM_INITMENUPOPUP,
                        WPARAM(result.popup.0 as usize),
                        LPARAM(0),
                        None,
                    )
                    .map_err(|error| error.to_string())?;
            } else if let Some(context) = &result.host.context2 {
                context
                    .HandleMenuMsg(WM_INITMENUPOPUP, WPARAM(result.popup.0 as usize), LPARAM(0))
                    .map_err(|error| error.to_string())?;
            }
            if GetMenuItemCount(Some(result.popup)) <= 0 {
                return Err("Windows에 등록된 새로 만들기 항목이 없습니다. 기본 탐색기에서 파일 연결을 확인해 주세요.".into());
            }
            Ok(result)
        }
    }
    unsafe fn invoke(&self, id: u32, path: &Path) -> Result<(), String> {
        unsafe {
            let directory = shell_path(path);
            let mut info: CMINVOKECOMMANDINFOEX = std::mem::zeroed();
            info.cbSize = std::mem::size_of_val(&info) as u32;
            info.fMask = SEE_MASK_UNICODE;
            info.hwnd = self.window;
            info.lpVerb = PCSTR((id - FIRST) as usize as *const u8);
            info.lpVerbW = PCWSTR((id - FIRST) as usize as *const u16);
            info.lpDirectoryW = PCWSTR(directory.as_ptr());
            info.nShow = SW_SHOWNORMAL.0;
            self.context
                .InvokeCommand((&info as *const CMINVOKECOMMANDINFOEX).cast())
                .map_err(|error| format!("Windows 새 파일 생성에 실패했습니다: {error}"))
        }
    }
    #[cfg(any(test, feature = "smoke-test"))]
    unsafe fn items(&self) -> Vec<(u32, String, String)> {
        unsafe {
            let mut items = vec![];
            for position in 0..GetMenuItemCount(Some(self.popup)) {
                let mut label = [0u16; 1024];
                let mut item = MENUITEMINFOW {
                    cbSize: std::mem::size_of::<MENUITEMINFOW>() as u32,
                    fMask: MIIM_ID | MIIM_STRING | MIIM_FTYPE | MIIM_STATE,
                    dwTypeData: windows::core::PWSTR(label.as_mut_ptr()),
                    cch: label.len() as u32,
                    ..Default::default()
                };
                if GetMenuItemInfoW(self.popup, position as u32, true, &mut item).is_err()
                    || item.fType.contains(MFT_SEPARATOR)
                    || item.wID < FIRST
                    || item.wID > 0x7fff
                {
                    continue;
                }
                let text = String::from_utf16_lossy(
                    &label[..label
                        .iter()
                        .position(|&char| char == 0)
                        .unwrap_or(label.len())],
                );
                let mut verb = [0u16; 512];
                let _ = self.context.GetCommandString(
                    (item.wID - FIRST) as usize,
                    windows::Win32::UI::Shell::GCS_VERBW,
                    None,
                    windows::core::PSTR(verb.as_mut_ptr().cast()),
                    verb.len() as u32,
                );
                items.push((
                    item.wID,
                    text,
                    String::from_utf16_lossy(
                        &verb[..verb
                            .iter()
                            .position(|&char| char == 0)
                            .unwrap_or(verb.len())],
                    ),
                ));
            }
            items
        }
    }
}

fn names(path: &Path) -> Result<HashSet<std::ffi::OsString>, String> {
    fs::read_dir(path)
        .map_err(|error| error.to_string())?
        .map(|item| {
            item.map(|item| item.file_name())
                .map_err(|error| error.to_string())
        })
        .collect()
}

pub fn show(
    engine: Arc<Engine>,
    location: Location,
    owner: isize,
    point: Option<MenuPoint>,
) -> Result<NewResult, String> {
    if OPEN.swap(true, Ordering::SeqCst) {
        return Err("Windows 새로 만들기 메뉴가 이미 열려 있습니다.".into());
    }
    struct OpenGuard;
    impl Drop for OpenGuard {
        fn drop(&mut self) {
            OPEN.store(false, Ordering::SeqCst);
        }
    }
    let _open = OpenGuard;
    engine.wait_ready()?;
    let path = engine.resolve(&location)?;
    if !path.is_dir() {
        return Err("새 파일을 만들 폴더를 선택해 주세요.".into());
    }
    std::thread::Builder::new()
        .name("windows-shell-new".into())
        .spawn(move || unsafe {
            let _apartment = Apartment::new()?;
            let owner = HWND(owner as *mut _);
            let menu = NewMenu::new(&path, owner)?;
            let mut at = POINT::default();
            if let Some(point) = point {
                at = POINT {
                    x: point.x,
                    y: point.y,
                };
                windows::Win32::Graphics::Gdi::ClientToScreen(owner, &mut at)
                    .ok()
                    .map_err(|error| error.to_string())?;
            } else {
                GetCursorPos(&mut at).map_err(|error| error.to_string())?;
            }
            let id = menu.select(owner, at)?;
            if id == 0 {
                return Ok(NewResult::default());
            }
            if id < FIRST || id > 0x7fff {
                return Err("Windows 메뉴 명령이 올바르지 않습니다.".into());
            }
            let _operation = engine.operations.lock().unwrap();
            if engine.resolve(&location)? != path {
                return Err("메뉴를 연 뒤 폴더 위치가 변경되었습니다. 다시 시도해 주세요.".into());
            }
            let before = names(&path)?;
            let command = menu.invoke(id, &path);
            let created: Vec<PathBuf> = names(&path)?
                .difference(&before)
                .map(|name| path.join(name))
                .collect();
            let refreshed = if created.is_empty() {
                Ok(())
            } else {
                engine.refresh(&created)
            };
            *engine.progress.lock().unwrap() = None;
            command?;
            refreshed?;
            Ok(NewResult {
                invoked: true,
                created: created
                    .iter()
                    .filter_map(|path| path.file_name())
                    .map(|name| Location {
                        root_id: location.root_id.clone(),
                        path: if location.path.is_empty() {
                            name.to_string_lossy().into_owned()
                        } else {
                            format!("{}/{}", location.path, name.to_string_lossy())
                        },
                    })
                    .collect(),
            })
        })
        .map_err(|error| error.to_string())?
        .join()
        .map_err(|_| "Windows 새로 만들기 스레드가 종료되었습니다.".to_owned())?
}

#[cfg(feature = "smoke-test")]
pub fn test_items(
    engine: &Engine,
    location: &Location,
) -> Result<Vec<(u32, String, String)>, String> {
    let path = engine.resolve(location)?;
    if !path.is_dir() {
        return Err("폴더가 필요합니다.".into());
    }
    std::thread::spawn(move || unsafe {
        let _apartment = Apartment::new()?;
        Ok(NewMenu::new(&path, HWND::default())?.items())
    })
    .join()
    .map_err(|_| "검증 메뉴 스레드가 종료되었습니다.".to_owned())?
}

pub async fn show_for_window(
    window: tauri::WebviewWindow,
    engine: tauri::State<'_, Arc<Engine>>,
    location: Location,
    point: Option<MenuPoint>,
) -> Result<NewResult, String> {
    if window.label() != "main" {
        return Err("새 파일은 메인 창에서 만들어 주세요.".into());
    }
    if point
        .is_some_and(|point| point.x.unsigned_abs() > 100_000 || point.y.unsigned_abs() > 100_000)
    {
        return Err("메뉴 위치가 올바르지 않습니다.".into());
    }
    let owner = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || show(engine, location, owner, point))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inspect_system_new_menu() {
        let temp = tempfile::tempdir().unwrap();
        unsafe {
            let _apartment = Apartment::new().unwrap();
            let menu = NewMenu::new(temp.path(), HWND::default()).unwrap();
            let items = menu.items();
            assert!(!items.is_empty());
            for (id, label, verb) in items {
                println!("SHELL_NEW {id}: {label} [{verb}]");
            }
        }
    }
    #[test]
    fn system_new_handler_creates_templates_and_numbered_copies() {
        let temp = tempfile::tempdir().unwrap();
        unsafe {
            let _apartment = Apartment::new().unwrap();
            let menu = NewMenu::new(temp.path(), HWND::default()).unwrap();
            let items = menu.items();
            for verb in [
                "NewFolder",
                ".txt",
                ".bmp",
                ".docx",
                ".xlsx",
                ".pptx",
                ".hwpx",
            ] {
                let Some((id, _, _)) = items.iter().find(|(_, _, item)| item == verb) else {
                    continue;
                };
                let before = names(temp.path()).unwrap();
                menu.invoke(*id, temp.path()).unwrap();
                let after = names(temp.path()).unwrap();
                let created: Vec<_> = after.difference(&before).collect();
                assert_eq!(created.len(), 1, "{verb}");
                let path = temp.path().join(created[0]);
                if verb == "NewFolder" {
                    assert!(path.is_dir());
                    continue;
                }
                std::thread::sleep(std::time::Duration::from_millis(400));
                let bytes = fs::read(&path).unwrap();
                println!("NATIVE_TEMPLATE {verb}: {} bytes", bytes.len());
                if verb == ".bmp" && !bytes.is_empty() {
                    assert!(bytes.starts_with(b"BM"));
                }
                if [".docx", ".xlsx", ".pptx", ".hwpx"].contains(&verb) && !bytes.is_empty() {
                    assert!(
                        bytes.starts_with(b"PK"),
                        "{verb} template must be a document package"
                    );
                }
                if verb == ".txt" {
                    fs::write(&path, b"existing content").unwrap();
                    menu.invoke(*id, temp.path()).unwrap();
                    assert_eq!(fs::read(path).unwrap(), b"existing content");
                    assert_eq!(names(temp.path()).unwrap().len(), after.len() + 1);
                }
            }
        }
    }
    #[test]
    fn native_popup_opens_and_cancels_without_creating_files() {
        let temp = tempfile::tempdir().unwrap();
        unsafe {
            let _apartment = Apartment::new().unwrap();
            let menu = NewMenu::new(temp.path(), HWND::default()).unwrap();
            test_choice("__popup_cancel").unwrap();
            let selected = menu
                .select(HWND::default(), POINT { x: 100, y: 100 })
                .unwrap();
            assert_eq!(selected, 0);
            assert!(
                test_tracked(),
                "TrackPopupMenuEx must enter native menu tracking"
            );
            assert!(names(temp.path()).unwrap().is_empty());
        }
    }
}

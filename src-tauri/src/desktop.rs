use crate::store::{write_json, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// 백그라운드 실행과 사용자 지정 단축키를 함께 보존한다.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopSettings {
    pub keep_running: bool,
    pub shortcut: String,
    pub auto_start: bool,
    pub start_in_tray: bool,
    pub default_search_mode: String,
}
impl Default for DesktopSettings {
    // 플랫폼 공통 기본 검색 단축키를 지정한다.
    fn default() -> Self {
        Self {
            keep_running: true,
            shortcut: "CommandOrControl+Shift+Space".into(),
            auto_start: true,
            start_in_tray: false,
            default_search_mode: "initials".into(),
        }
    }
}

// 창을 닫아도 검색 엔진을 유지할지와 전역 단축키 등록 결과를 보관한다.
pub struct DesktopState {
    pub keep_running: AtomicBool,
    pub settings: Mutex<DesktopSettings>,
    pub previous_app: Mutex<isize>,
    pub shortcut_error: Mutex<Option<String>>,
    pub auto_start_error: Mutex<Option<String>>,
    pub background_item: Mutex<Option<CheckMenuItem<tauri::Wry>>>,
}

// 숨긴 창을 복원하고 요청한 작업에 화면 초점을 보낸다.
pub fn show(app: &AppHandle, action: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        let _ = app.emit_to("main", "ed-desktop", action);
    }
}

// 작은 크기에서도 알아보기 쉬운 폴더 모양의 트레이 아이콘을 만든다.
fn tray_image() -> tauri::image::Image<'static> {
    let mut pixels = vec![0u8; 22 * 22 * 4];
    for y in 0..22 {
        for x in 0..22 {
            let edge = ((3..=18).contains(&x) && (y == 7 || y == 17))
                || ((7..=17).contains(&y) && (x == 3 || x == 18))
                || ((4..=9).contains(&x) && y == 4)
                || (x == 3 && (4..7).contains(&y))
                || (x == 10 && (5..7).contains(&y))
                || ((11..=17).contains(&x) && y == 6);
            if edge {
                let i = (y * 22 + x) * 4;
                let rgb = if cfg!(target_os = "macos") {
                    [20, 25, 32]
                } else {
                    [32, 119, 223]
                };
                pixels[i..i + 3].copy_from_slice(&rgb);
                pixels[i + 3] = 255;
            }
        }
    }
    tauri::image::Image::new_owned(pixels, 22, 22)
}

// 앱 시작 시 트레이 메뉴와 창 복원 단축키를 등록한다.
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let engine = app.state::<Arc<Engine>>();
    let mut settings: DesktopSettings = std::fs::read(engine.data.join("desktop.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if !["normal", "initials", "wildcard", "regex", "fuzzy"]
        .contains(&settings.default_search_mode.as_str())
    {
        settings.default_search_mode = "initials".into();
    }
    app.handle().plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--background"]),
    ))?;
    let isolated =
        cfg!(feature = "smoke-test") || std::env::var_os("EVERY_DIRECTORY_DATA").is_some();
    let auto_start_error = if !isolated {
        let result = if settings.auto_start {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        };
        result.err().map(|error| error.to_string())
    } else {
        None
    };
    let start_hidden = (settings.start_in_tray
        || std::env::args().any(|arg| arg == "--background"))
        && !engine.roots().is_empty();
    let keep_running = settings.keep_running;
    let shortcut = settings.shortcut.clone();
    app.manage(DesktopState {
        keep_running: AtomicBool::new(keep_running),
        settings: Mutex::new(settings),
        previous_app: Mutex::new(0),
        shortcut_error: Mutex::new(None),
        auto_start_error: Mutex::new(auto_start_error),
        background_item: Mutex::new(None),
    });
    let quick_window = WebviewWindowBuilder::new(
        app,
        "quick-search",
        WebviewUrl::App("index.html#quick-search".into()),
    )
    .title("Every Directory · 빠른 검색")
    .inner_size(720.0, 540.0)
    .min_inner_size(480.0, 360.0)
    .visible(false)
    .focused(false)
    .decorations(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible_on_all_workspaces(true)
    .disable_drag_drop_handler();
    // 격리 검증에서는 숨겨진 검색창의 타이머와 저장소를 다른 앱에서 분리한다.
    #[cfg(feature = "smoke-test")]
    let quick_window = quick_window
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        .data_store_identifier(*uuid::Uuid::new_v4().as_bytes())
        .data_directory(engine.data.join("webview-quick"));
    let quick_window = quick_window.build()?;
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
        // 메인 스레드에서 소유 중인 창에만 macOS 전체 화면 보조 동작을 설정한다.
        let pointer = quick_window.ns_window()?;
        let native = unsafe { &*(pointer as *const NSWindow) };
        native.setCollectionBehavior(
            (native.collectionBehavior() & !NSWindowCollectionBehavior::FullScreenPrimary)
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
    }
    #[cfg(not(target_os = "macos"))]
    let _ = quick_window;
    let search = MenuItem::with_id(app, "search", "빠른 파일 검색", true, None::<&str>)?;
    let open = MenuItem::with_id(app, "show", "Every Directory 열기", true, None::<&str>)?;
    let tools = MenuItem::with_id(app, "tools", "파일 도구 열기", true, None::<&str>)?;
    let folders = MenuItem::with_id(app, "folders", "인덱스 폴더 관리", true, None::<&str>)?;
    let preferences = MenuItem::with_id(app, "settings", "프로그램 설정", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "창 숨기기", true, None::<&str>)?;
    let background = CheckMenuItem::with_id(
        app,
        "background",
        "창을 닫아도 계속 실행",
        true,
        keep_running,
        None::<&str>,
    )?;
    *app.state::<DesktopState>().background_item.lock().unwrap() = Some(background.clone());
    let quit = MenuItem::with_id(
        app,
        "quit",
        "Every Directory 완전히 종료",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &search,
            &open,
            &tools,
            &folders,
            &preferences,
            &separator,
            &hide,
            &background,
            &separator2,
            &quit,
        ],
    )?;
    TrayIconBuilder::with_id("main-tray")
        .icon(tray_image())
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Every Directory · 로컬 파일 검색과 탐색")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "search" => {
                let _ = show_quick(app, false);
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "background" => {
                let next = !app
                    .state::<DesktopState>()
                    .keep_running
                    .load(Ordering::Relaxed);
                if let Err(error) = set_background(app, next) {
                    let _ = app.emit("ed-desktop-error", error);
                }
            }
            action => show(app, action),
        })
        .on_tray_icon_event(|tray, event| {
            if !cfg!(target_os = "macos")
                && matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                )
            {
                let _ = show_quick(tray.app_handle(), true);
            }
        })
        .build(app)?;
    app.handle().plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, _, event| {
                if event.state() == ShortcutState::Pressed {
                    let _ = show_quick(app, true);
                }
            })
            .build(),
    )?;
    // 기존 앱과 충돌하는 단축키는 강제로 빼앗지 않고 설정 화면에 오류를 알린다.
    if !cfg!(feature = "smoke-test") {
        if let Err(error) = app.global_shortcut().register(shortcut.as_str()) {
            *app.state::<DesktopState>().shortcut_error.lock().unwrap() = Some(error.to_string());
        }
    }
    if start_hidden {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
    Ok(())
}

// 백그라운드 실행 설정을 디스크와 트레이 체크 상태에 함께 반영한다.
fn set_background(app: &AppHandle, value: bool) -> Result<(), String> {
    let engine = app.state::<Arc<Engine>>();
    let state = app.state::<DesktopState>();
    let mut settings = state.settings.lock().unwrap();
    let mut next = settings.clone();
    next.keep_running = value;
    write_json(&engine.data.join("desktop.json"), &next)?;
    *settings = next;
    drop(settings);
    app.state::<DesktopState>()
        .keep_running
        .store(value, Ordering::Relaxed);
    if let Some(item) = app
        .state::<DesktopState>()
        .background_item
        .lock()
        .unwrap()
        .as_ref()
    {
        item.set_checked(value).map_err(|e| e.to_string())?;
    }
    let _ = app.emit("ed-desktop", "settings-changed");
    Ok(())
}

// 화면에서 트레이 상태 확인과 창 숨기기 설정만 변경하도록 제한한다.
#[tauri::command]
pub async fn desktop_control(
    app: AppHandle,
    window: tauri::WebviewWindow,
    action: String,
    value: Option<bool>,
    shortcut: Option<String>,
    mode: Option<String>,
) -> Result<Value, String> {
    if window.label() != "main" && action != "status" {
        return Err("설정은 메인 창에서 변경해 주세요.".into());
    }
    match action.as_str() {
        "status" => {}
        "autoStart" | "startInTray" | "searchMode" => set_preference(&app, &action, value, mode)?,
        "shortcut" => set_shortcut(&app, shortcut.ok_or("단축키가 필요합니다.")?)?,
        "quick" => show_quick(&app, false)?,
        "background" => set_background(&app, value.ok_or("실행 설정이 필요합니다.")?)?,
        "hide" => {
            app.get_webview_window("main")
                .ok_or("창이 없습니다.")?
                .hide()
                .map_err(|e| e.to_string())?;
        }
        "show" => show(&app, "show"),
        "quit" => app.exit(0),
        _ => return Err("지원하지 않는 창 작업입니다.".into()),
    }
    let state = app.state::<DesktopState>();
    let settings = state.settings.lock().unwrap().clone();
    let auto_start_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    Ok(
        json!({"shortcut":settings.shortcut, "keepRunning":state.keep_running.load(Ordering::Relaxed), "shortcutError":*state.shortcut_error.lock().unwrap(), "tray":app.tray_by_id("main-tray").is_some(), "visible":app.get_webview_window("main").and_then(|window|window.is_visible().ok()).unwrap_or(false), "autoStart":settings.auto_start,"autoStartEnabled":auto_start_enabled,"autoStartError":*state.auto_start_error.lock().unwrap(),"startInTray":settings.start_in_tray,"defaultSearchMode":settings.default_search_mode}),
    )
}

// 시작 옵션과 기본 검색을 저장하고 자동 시작 등록 실패는 화면에 알린다.
fn set_preference(
    app: &AppHandle,
    action: &str,
    value: Option<bool>,
    mode: Option<String>,
) -> Result<(), String> {
    let state = app.state::<DesktopState>();
    let mut settings = state.settings.lock().unwrap();
    let old = settings.clone();
    let mut next = old.clone();
    match action {
        "autoStart" => next.auto_start = value.ok_or("자동 시작 설정이 필요합니다.")?,
        "startInTray" => next.start_in_tray = value.ok_or("시작 화면 설정이 필요합니다.")?,
        "searchMode" => {
            let mode = mode.ok_or("검색 방식을 선택해 주세요.")?;
            if !["normal", "initials", "wildcard", "regex", "fuzzy"].contains(&mode.as_str()) {
                return Err("지원하지 않는 검색 방식입니다.".into());
            }
            next.default_search_mode = mode;
        }
        _ => return Err("지원하지 않는 설정입니다.".into()),
    }
    let isolated =
        cfg!(feature = "smoke-test") || std::env::var_os("EVERY_DIRECTORY_DATA").is_some();
    if action == "autoStart" && !isolated {
        let result = if next.auto_start {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        };
        if let Err(error) = result {
            *state.auto_start_error.lock().unwrap() = Some(error.to_string());
            return Err(format!(
                "자동 시작을 변경하지 못했습니다. 회사 PC 정책을 확인해 주세요: {error}"
            ));
        }
        *state.auto_start_error.lock().unwrap() = None;
    }
    let engine = app.state::<Arc<Engine>>();
    if let Err(error) = write_json(&engine.data.join("desktop.json"), &next) {
        if action == "autoStart" && !isolated {
            let _ = if old.auto_start {
                app.autolaunch().enable()
            } else {
                app.autolaunch().disable()
            };
        }
        return Err(error);
    }
    *settings = next;
    drop(settings);
    let _ = app.emit("ed-desktop", "settings-changed");
    Ok(())
}

// 단축키 충돌이나 저장 실패가 발생하면 기존 등록을 유지한다.
fn set_shortcut(app: &AppHandle, shortcut: String) -> Result<(), String> {
    if shortcut.len() > 100 || !shortcut.contains('+') {
        return Err("수정 키를 포함한 단축키를 입력해 주세요. 예: Ctrl+Shift+Space".into());
    }
    let state = app.state::<DesktopState>();
    let mut settings = state.settings.lock().unwrap();
    let old = settings.shortcut.clone();
    let parsed = shortcut
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .map_err(|e| format!("올바른 단축키가 아닙니다: {e}"))?;
    let same = old
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .is_ok_and(|value| value.id() == parsed.id());
    if same && state.shortcut_error.lock().unwrap().is_none() {
        return Ok(());
    }
    app.global_shortcut()
        .register(shortcut.as_str())
        .map_err(|e| format!("단축키를 등록하지 못했습니다. 다른 조합을 선택해 주세요: {e}"))?;
    let mut next = settings.clone();
    next.shortcut = shortcut.clone();
    let engine = app.state::<Arc<Engine>>();
    if let Err(error) = write_json(&engine.data.join("desktop.json"), &next) {
        let _ = app.global_shortcut().unregister(shortcut.as_str());
        return Err(error);
    }
    if old != shortcut {
        let _ = app.global_shortcut().unregister(old.as_str());
    }
    *settings = next;
    *state.shortcut_error.lock().unwrap() = None;
    drop(settings);
    let _ = app.emit_to("main", "ed-desktop", "settings-changed");
    Ok(())
}

// 커서가 있는 모니터의 작업 영역 안에 검색창을 배치한다.
pub fn show_quick(app: &AppHandle, toggle: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("quick-search")
        .ok_or("빠른 검색창을 찾지 못했습니다.")?;
    if toggle && window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
        window.hide().map_err(|e| e.to_string())?;
        restore_previous(app);
        return Ok(());
    }
    if !window.is_focused().unwrap_or(false) {
        *app.state::<DesktopState>().previous_app.lock().unwrap() = active_app();
    }
    if let Ok(position) = app.cursor_position() {
        if let Ok(Some(monitor)) = app.monitor_from_point(position.x, position.y) {
            let area = monitor.work_area();
            let scale = monitor.scale_factor();
            let width = 720.0f64
                .min(area.size.width as f64 / scale - 24.0)
                .max(320.0);
            let height = 540.0f64
                .min(area.size.height as f64 / scale - 24.0)
                .max(280.0);
            let _ = window.set_size(tauri::LogicalSize::new(width, height));
            let x = area.position.x + ((area.size.width as f64 - width * scale) / 2.0) as i32;
            let y = area.position.y
                + ((area.size.height as f64 - height * scale) / 3.0).max(0.0) as i32;
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    app.emit_to("quick-search", "ed-quick-show", ())
        .map_err(|e| e.to_string())
}

// 검색창의 숨김과 메인 탐색창 연결만 허용한다.
#[tauri::command]
pub async fn quick_control(
    app: AppHandle,
    action: String,
    location: Option<crate::model::Location>,
) -> Result<(), String> {
    match action.as_str() {
        "dismiss" => {
            if let Some(window) = app.get_webview_window("quick-search") {
                window.hide().map_err(|e| e.to_string())?;
            }
            restore_previous(&app);
        }
        "hide" => {
            if let Some(window) = app.get_webview_window("quick-search") {
                window.hide().map_err(|e| e.to_string())?;
            }
        }
        "show" => show_quick(&app, false)?,
        "main" | "folders" | "reveal" => {
            let target = if action == "reveal" {
                let engine = app.state::<Arc<Engine>>();
                Some(crate::quick_access::entry(
                    &engine,
                    &location.ok_or("위치를 선택해 주세요.")?,
                )?)
            } else {
                None
            };
            if let Some(window) = app.get_webview_window("quick-search") {
                let _ = window.hide();
            }
            show(
                &app,
                if action == "folders" {
                    "folders"
                } else {
                    "show"
                },
            );
            if let Some(target) = target {
                app.emit_to("main", "ed-quick-reveal", target)
                    .map_err(|e| e.to_string())?;
            }
        }
        _ => return Err("지원하지 않는 검색창 작업입니다.".into()),
    }
    Ok(())
}

// 호출 직전 작업 중이던 앱의 식별자를 운영체제에서 읽는다.
fn active_app() -> isize {
    #[cfg(target_os = "macos")]
    {
        objc2_app_kit::NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .map_or(0, |app| app.processIdentifier() as isize)
    }
    #[cfg(windows)]
    {
        unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() as isize }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        0
    }
}

// 사용자가 검색을 취소하면 직전 앱으로 입력 초점을 돌린다.
fn restore_previous(app: &AppHandle) {
    let previous = *app.state::<DesktopState>().previous_app.lock().unwrap();
    if previous == 0 {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        if previous == std::process::id() as isize {
            if let Some(main) = app
                .get_webview_window("main")
                .filter(|w| w.is_visible().unwrap_or(false))
            {
                let _ = main.set_focus();
            }
        } else if let Some(target) =
            objc2_app_kit::NSRunningApplication::runningApplicationWithProcessIdentifier(
                previous as i32,
            )
        {
            #[allow(deprecated)]
            let _ = target.activateWithOptions(
                objc2_app_kit::NSApplicationActivationOptions::ActivateIgnoringOtherApps,
            );
        }
    }
    #[cfg(windows)]
    unsafe {
        let _ = windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow(previous as _);
    }
}

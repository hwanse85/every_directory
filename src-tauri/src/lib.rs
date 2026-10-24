pub mod analysis;
pub mod desktop;
pub mod file_clipboard;
mod journal;
pub mod model;
pub mod operations;
pub mod query;
pub mod quick_access;
pub mod search;
pub mod store;
#[cfg(windows)]
mod windows_file_ops;

use crate::{
    model::{Location, Operation, SearchOptions},
    store::Engine,
};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    sync::Arc,
};
use tauri::{
    http::{Request, Response},
    Manager, State,
};

// 화면 요청을 Rust 검색·파일 엔진의 동작으로 연결한다.
pub fn dispatch(engine: &Arc<Engine>, kind: &str, payload: Value) -> Result<Value, String> {
    let mut result = match kind {
        "analysis" => analysis::run(
            engine,
            serde_json::from_value(payload).map_err(|e| e.to_string())?,
        ),
        "analysisStatus" => Ok(
            json!({"busy":engine.analysis_busy.load(std::sync::atomic::Ordering::Relaxed),"progress":*engine.analysis_progress.lock().unwrap()}),
        ),
        "cancelAnalysis" => {
            engine
                .analysis_cancel
                .store(true, std::sync::atomic::Ordering::Relaxed);
            Ok(Value::Null)
        }
        #[cfg(feature = "smoke-test")]
        "smokeOpens" => Ok(fs::read(engine.data.join("native-opens.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(json!([]))),
        #[cfg(feature = "smoke-test")]
        "smokeReport" => {
            if payload.is_null() {
                return Ok(fs::read(engine.data.join("smoke-report.json"))
                    .ok()
                    .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                    .unwrap_or(Value::Null));
            }
            fs::write(
                engine.data.join("smoke-report.json"),
                serde_json::to_vec_pretty(&payload).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "init" => serde_json::to_value(engine.roots()).map_err(|e| e.to_string()),
        "licenseNotices" => Ok(json!(include_str!("../../THIRD_PARTY_NOTICES.txt"))),
        "openExternalLink" => {
            operations::open_external_link(payload["url"].as_str().ok_or("링크가 필요합니다.")?)?;
            Ok(Value::Null)
        }
        "status" => Ok(engine.status()),
        "quickAccess" => quick_access::request(engine, payload),
        "quickSuggestions" => quick_access::suggestions(engine),
        "quickEntry" => {
            let location: Location = serde_json::from_value(payload).map_err(|e| e.to_string())?;
            serde_json::to_value(quick_access::entry(engine, &location)?).map_err(|e| e.to_string())
        }
        "quickPath" => {
            let location: Location = serde_json::from_value(payload).map_err(|e| e.to_string())?;
            Ok(json!(file_clipboard::path_text(
                &engine.resolve(&location)?
            )))
        }
        "scan" => serde_json::to_value(engine.scan(&payload)?).map_err(|e| e.to_string()),
        "remove" => {
            engine.remove(payload.as_str().ok_or("폴더 번호가 필요합니다.")?)?;
            Ok(Value::Null)
        }
        "search" => {
            let options: SearchOptions =
                serde_json::from_value(payload).map_err(|e| e.to_string())?;
            serde_json::to_value(engine.store.lock().unwrap().index.search(&options)?)
                .map_err(|e| e.to_string())
        }
        "directoryLocation" => {
            let location: Location = serde_json::from_value(payload).map_err(|e| e.to_string())?;
            serde_json::to_value(engine.directory_location(&location)?).map_err(|e| e.to_string())
        }
        "list" => {
            let location: Location = serde_json::from_value(payload).map_err(|e| e.to_string())?;
            serde_json::to_value(engine.list(&location)?).map_err(|e| e.to_string())
        }
        "operation" => operations::operate(
            engine,
            serde_json::from_value::<Operation>(payload).map_err(|e| e.to_string())?,
        ),
        "trash" => serde_json::to_value(operations::list_trash(engine)?).map_err(|e| e.to_string()),
        "saveCopy" => {
            let location: Location =
                serde_json::from_value(payload["location"].clone()).map_err(|e| e.to_string())?;
            let destination = payload["destination"]
                .as_str()
                .ok_or("저장 경로가 필요합니다.")?;
            operations::save_copy(engine, &location, Path::new(destination))?;
            Ok(json!({"count":1}))
        }
        "saveExport" => {
            let destination = Path::new(
                payload["destination"]
                    .as_str()
                    .ok_or("저장 경로가 필요합니다.")?,
            );
            let content = payload["content"]
                .as_str()
                .ok_or("내보낼 내용이 필요합니다.")?;
            if destination
                .extension()
                .is_none_or(|s| !s.eq_ignore_ascii_case("csv"))
                || content.len() > 4 * 1024 * 1024
            {
                return Err("CSV 파일로 최대 4MB까지 저장할 수 있습니다.".into());
            }
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(destination)
                .map_err(|e| format!("저장하지 못했습니다. 다른 파일명을 선택해 주세요: {e}"))?;
            file.write_all(content.as_bytes())
                .map_err(|e| e.to_string())?;
            Ok(json!({"count":1}))
        }
        "directories" => {
            let path = payload
                .get("path")
                .and_then(Value::as_str)
                .map(std::path::PathBuf::from)
                .or_else(dirs::home_dir)
                .ok_or("홈 폴더를 찾지 못했습니다.")?;
            let path = path.canonicalize().map_err(|e| e.to_string())?;
            let mut directories = vec![];
            for item in fs::read_dir(&path).map_err(|e| e.to_string())? {
                let item = item.map_err(|e| e.to_string())?;
                if item.file_type().map_err(|e| e.to_string())?.is_dir()
                    && !store::excluded(&item.path(), &engine.data)
                {
                    directories.push(
                        json!({"name":item.file_name().to_string_lossy(),"path":item.path()}),
                    );
                }
            }
            directories.sort_by_key(|v| v["name"].as_str().unwrap_or("").to_lowercase());
            Ok(
                json!({"path":path,"parent":path.parent().unwrap_or(&path),"directories":directories}),
            )
        }
        _ => Err("지원하지 않는 요청입니다.".into()),
    }?;
    file_clipboard::public_paths(&mut result);
    Ok(result)
}

// 긴 파일 작업을 화면 스레드 밖에서 실행한다.
#[tauri::command]
async fn ed_request(
    window: tauri::WebviewWindow,
    kind: String,
    payload: Value,
    engine: State<'_, Arc<Engine>>,
) -> Result<Value, String> {
    let smoke_report = cfg!(feature = "smoke-test") && kind == "smokeReport";
    if window.label() == "quick-search"
        && !smoke_report
        && !matches!(
            kind.as_str(),
            "init"
                | "quickAccess"
                | "quickSuggestions"
                | "quickEntry"
                | "quickPath"
                | "list"
                | "operation"
        )
    {
        return Err("빠른 검색창에서 허용되지 않는 요청입니다.".into());
    }
    if window.label() == "quick-search"
        && kind == "operation"
        && !matches!(payload["action"].as_str(), Some("open" | "reveal" | "copy"))
    {
        return Err("빠른 검색창에서 허용되지 않는 파일 작업입니다.".into());
    }
    let changed =
        kind == "quickAccess" && payload["action"].as_str().is_some_and(|a| a != "snapshot");
    let engine = engine.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || dispatch(&engine, &kind, payload))
        .await
        .map_err(|e| e.to_string())??;
    if changed {
        use tauri::Emitter;
        let _ = window.app_handle().emit("ed-quick-changed", &result);
    }
    Ok(result)
}

// 최신 검색만 실행하고 즐겨찾기와 최근 사용 순위를 검색 엔진에 전달한다.
#[tauri::command]
async fn quick_search(
    engine: State<'_, Arc<Engine>>,
    options: SearchOptions,
) -> Result<Value, String> {
    use std::sync::atomic::Ordering;
    let engine = engine.inner().clone();
    let epoch = engine.quick_search_epoch.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || {
        let access = quick_access::request(&engine, json!({}))
            .unwrap_or_else(|_| json!(quick_access::QuickAccess::default()));
        let mut boosts = std::collections::HashMap::new();
        for (n, value) in access["opened"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            boosts.insert(
                format!(
                    "{}:{}",
                    value["rootId"].as_str().unwrap_or(""),
                    value["path"].as_str().unwrap_or("")
                ),
                100 + n,
            );
        }
        for value in access["favorites"].as_array().into_iter().flatten() {
            boosts.insert(
                format!(
                    "{}:{}",
                    value["rootId"].as_str().unwrap_or(""),
                    value["path"].as_str().unwrap_or("")
                ),
                0,
            );
        }
        let cancelled = || engine.quick_search_epoch.load(Ordering::SeqCst) != epoch;
        if cancelled() {
            return Err("검색 요청이 취소되었습니다.".into());
        }
        let mut options = options;
        options.limit = Some(options.limit.unwrap_or(12).clamp(1, 20));
        let store = engine.store.lock().unwrap();
        if cancelled() {
            return Err("검색 요청이 취소되었습니다.".into());
        }
        serde_json::to_value(store.index.quick_search(&options, &boosts, &cancelled)?)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// 현재 창을 클립보드 소유자로 사용해 네이티브 파일 복사를 실행한다.
#[tauri::command]
async fn copy_files(
    window: tauri::WebviewWindow,
    engine: State<'_, Arc<Engine>>,
    locations: Vec<Location>,
    cut: Option<bool>,
) -> Result<(), String> {
    #[cfg(windows)]
    let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    #[cfg(not(windows))]
    let owner = {
        let _ = window;
        0
    };
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        file_clipboard::copy(&engine, &locations, owner, cut.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}

// 운영체제에서 복사한 파일을 연결된 폴더에 붙여넣고 앱 내부 잘라내기도 확인한다.
#[tauri::command]
async fn paste_files(
    window: tauri::WebviewWindow,
    engine: State<'_, Arc<Engine>>,
    destination: Location,
    clipboard: Option<model::FileClipboard>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("붙여넣기는 메인 탐색창에서 실행해 주세요.".into());
    }
    #[cfg(windows)]
    let owner = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
    #[cfg(not(windows))]
    let owner = 0;
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let sequence = file_clipboard::sequence();
        let paths = file_clipboard::read_files(owner)?;
        if paths.is_empty() { return Err("복사된 파일이 없습니다. Finder 또는 탐색기에서 파일을 먼저 복사해 주세요.".into()); }
        if let Some(clipboard) = clipboard {
            let selected = clipboard.entries.iter().map(|location| engine.resolve(location)).collect::<Result<Vec<_>, _>>();
            let native = paths.iter().map(|path| path.canonicalize().map_err(|error| error.to_string())).collect::<Result<Vec<_>, _>>()?;
            if selected.as_ref().is_ok_and(|selected| selected.len() == native.len() && selected.iter().all(|path| native.contains(path))) {
                let result = operations::operate(&engine, serde_json::from_value(json!({"action":if clipboard.cut { "move" } else { "copy" },"entries":clipboard.entries,"destination":destination})).map_err(|error| error.to_string())?)?;
                if clipboard.cut { file_clipboard::finish_cut(owner, sequence); }
                return Ok(json!({"result":result,"cut":clipboard.cut}));
            }
        }
        operations::paste_external(&engine, &paths, &destination)
    }).await.map_err(|error| error.to_string())?
}

// 등록된 파일만 범위 요청으로 읽어 미리보기로 전달한다.
#[tauri::command]
async fn import_files(
    window: tauri::WebviewWindow,
    engine: State<'_, Arc<Engine>>,
    paths: Vec<std::path::PathBuf>,
    destination: Location,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("파일 가져오기는 메인 탐색창에서 실행해 주세요.".into());
    }
    let engine = engine.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        operations::paste_external(&engine, &paths, &destination)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn file_response(engine: &Engine, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let result = (|| -> Result<Response<Vec<u8>>, String> {
        let decoded =
            percent_encoding::percent_decode_str(request.uri().path().trim_start_matches('/'))
                .decode_utf8()
                .map_err(|e| e.to_string())?;
        let (root_id, path) = decoded
            .split_once('/')
            .ok_or("파일 경로가 올바르지 않습니다.")?;
        let filename = engine.resolve(&Location {
            root_id: root_id.into(),
            path: path.into(),
        })?;
        let metadata = fs::metadata(&filename).map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            return Err("파일을 선택해 주세요.".into());
        }
        let size = metadata.len();
        let range = request.headers().get("range").and_then(|v| v.to_str().ok());
        let (start, end, partial) = if let Some(range) = range {
            let Some((start, end)) = range.strip_prefix("bytes=").and_then(|v| v.split_once('-'))
            else {
                return Err("범위 요청이 올바르지 않습니다.".into());
            };
            let start = start
                .parse::<u64>()
                .map_err(|_| "범위 시작이 올바르지 않습니다.")?;
            let end = if end.is_empty() {
                size.saturating_sub(1)
            } else {
                end.parse::<u64>()
                    .map_err(|_| "범위 끝이 올바르지 않습니다.")?
                    .min(size.saturating_sub(1))
            };
            if start >= size || start > end {
                return Ok(Response::builder()
                    .status(416)
                    .header("Content-Range", format!("bytes */{size}"))
                    .header("Access-Control-Allow-Origin", "*")
                    .body(vec![])
                    .unwrap());
            }
            (start, end, true)
        } else {
            (0, size.saturating_sub(1), false)
        };
        let count = if size == 0 { 0 } else { end - start + 1 };
        if count > 256 * 1024 * 1024 {
            return Err("미리보기는 한 번에 256MB까지 읽을 수 있습니다.".into());
        }
        let mut bytes = Vec::with_capacity(count as usize);
        if request.method() != tauri::http::Method::HEAD {
            let mut file = File::open(&filename).map_err(|e| e.to_string())?;
            file.seek(SeekFrom::Start(start))
                .map_err(|e| e.to_string())?;
            file.take(count)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
        }
        let mut response = Response::builder()
            .status(if partial { 206 } else { 200 })
            .header(
                "Content-Type",
                mime_guess::from_path(&filename)
                    .first_or_octet_stream()
                    .as_ref(),
            )
            .header("Content-Length", count)
            .header("Accept-Ranges", "bytes")
            .header("Access-Control-Allow-Origin", "*")
            .header(
                "Access-Control-Expose-Headers",
                "Content-Length, Content-Range, Accept-Ranges",
            )
            .header("X-Content-Type-Options", "nosniff")
            .header(
                "Content-Security-Policy",
                "sandbox; default-src 'none'; style-src 'unsafe-inline'",
            );
        if partial {
            response = response.header("Content-Range", format!("bytes {start}-{end}/{size}"));
        }
        Ok(response.body(bytes).unwrap())
    })();
    result.unwrap_or_else(|error| {
        Response::builder()
            .status(400)
            .header("Content-Type", "application/json")
            .header("Access-Control-Allow-Origin", "*")
            .body(json!({"error":error}).to_string().into_bytes())
            .unwrap()
    })
}

// 기존 인덱스가 있으면 별도 앱 데이터 공간에 한 번만 가져온다.
fn import_legacy(data: &Path) {
    if data.join("index.json").exists() {
        return;
    }
    if let Some(home) = dirs::home_dir() {
        let legacy = home.join(".every-directory/index.json");
        if let Ok(bytes) = fs::read(legacy) {
            if serde_json::from_slice::<store::DiskIndex>(&bytes).is_ok() {
                let _ = fs::create_dir_all(data);
                let _ = fs::write(data.join("index.json"), bytes);
            }
        }
    }
}

// 외부 서버 없이 앱 창과 검증된 Rust 명령만 시작한다.
pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(feature = "smoke-test")]
    let context = {
        let mut context = context;
        // 자동 검증에서 숨겨진 WebView의 타이머가 중단되지 않도록 한다.
        for window in &mut context.config_mut().app.windows {
            window.background_throttling =
                Some(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
            window.data_store_identifier = Some(*uuid::Uuid::new_v4().as_bytes());
            if let Some(data) = std::env::var_os("EVERY_DIRECTORY_DATA") {
                window.data_directory = Some(std::path::PathBuf::from(data).join("webview"));
            }
            if std::env::var_os("EVERY_DIRECTORY_WINDOWS_UI").is_some()
                || std::env::var_os("EVERY_DIRECTORY_E2E_SUITE").is_some()
            {
                window.visible = false;
            }
        }
        context
    };
    let builder = tauri::Builder::default();
    #[cfg(not(feature = "smoke-test"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        desktop::show(app, "search")
    }));
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let data = std::env::var_os("EVERY_DIRECTORY_DATA")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            if std::env::var_os("EVERY_DIRECTORY_DATA").is_none() {
                import_legacy(&data);
            }
            let engine = Engine::new(data).map_err(std::io::Error::other)?;
            #[cfg(feature = "smoke-test")]
            if let Some(root) = std::env::var_os("EVERY_DIRECTORY_SMOKE_ROOT") {
                engine
                    .scan(&json!({"absolutePath":root.to_string_lossy()}))
                    .map_err(std::io::Error::other)?;
            }
            app.manage(engine);
            desktop::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "quick-search" {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); let _ = window.hide(); },
                    tauri::WindowEvent::Focused(false) => { let _ = window.hide(); },
                    _ => {},
                }
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<desktop::DesktopState>().keep_running.load(std::sync::atomic::Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .on_page_load(|webview, payload| {
            #[cfg(feature = "smoke-test")]
            {
                let engine = webview.state::<Arc<Engine>>();
                let _ = fs::write(engine.data.join("smoke-page.json"), json!({"event":format!("{:?}",payload.event()),"url":payload.url().as_str()}).to_string());
            }
            #[cfg(feature = "smoke-test")]
            if webview.label() == "main" && std::env::var_os("EVERY_DIRECTORY_SKIP_SMOKE").is_none() && payload.event() == tauri::webview::PageLoadEvent::Finished
                && (std::env::var_os("EVERY_DIRECTORY_SMOKE_ROOT").is_some() || std::env::var_os("EVERY_DIRECTORY_SMOKE_EMPTY").is_some())
            {
                if std::env::var_os("EVERY_DIRECTORY_SMOKE_EMPTY").is_some() {
                    let _ = webview.eval("window.__edSmokeEmpty=true;");
                }
                let data = webview.state::<Arc<Engine>>().data.clone();
                let _ = webview.eval_with_callback("JSON.stringify({native:!!window.__TAURI_INTERNALS__,body:document.body.innerText})", move |value| { let _ = fs::write(data.join("smoke-dom.json"), value); });
                let _ = webview.eval(include_str!("../../scripts/desktop-smoke.js"));
            }
            #[cfg(feature = "smoke-test")]
            if std::env::var_os("EVERY_DIRECTORY_QUICK_SMOKE").is_some() && payload.event() == tauri::webview::PageLoadEvent::Finished {
                let script = if webview.label() == "main" { include_str!("../../scripts/quick-smoke-main.js") } else { include_str!("../../scripts/quick-smoke-window.js") };
                let _ = webview.eval(script);
            }
            #[cfg(feature = "smoke-test")]
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Finished {
                if let Some(root) = std::env::var_os("EVERY_DIRECTORY_RELIABILITY_ROOT") {
                    let root = serde_json::to_string(&root.to_string_lossy()).unwrap();
                    let _ = webview.eval(format!("window.__edReliabilityRoot={root};").as_str());
                    let _ = webview.eval(include_str!("../../scripts/reliability-smoke.js"));
                }
            }
            #[cfg(not(feature = "smoke-test"))]
            let _ = (webview, payload);
            #[cfg(all(windows, feature = "smoke-test"))]
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Finished && std::env::var("EVERY_DIRECTORY_E2E_SUITE").as_deref() == Ok("transfer") {
                let _ = webview.eval(include_str!("../../scripts/transfer-e2e.js"));
            }
            #[cfg(all(windows, feature = "smoke-test"))]
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Finished && std::env::var("EVERY_DIRECTORY_E2E_SUITE").as_deref() == Ok("drag") {
                let _ = webview.eval(include_str!("../../scripts/drag-e2e.js"));
            }
            #[cfg(all(windows, feature = "smoke-test"))]
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Finished && std::env::var("EVERY_DIRECTORY_E2E_SUITE").as_deref() == Ok("grid") {
                let _ = webview.eval(include_str!("../../scripts/grid-e2e.js"));
            }
            #[cfg(all(windows, feature = "smoke-test"))]
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Finished && std::env::var("EVERY_DIRECTORY_E2E_SUITE").as_deref() == Ok("clipboard") {
                let _ = webview.eval(include_str!("../../scripts/clipboard-e2e.js"));
            }
            #[cfg(all(windows, feature = "smoke-test"))]
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Finished && std::env::var("EVERY_DIRECTORY_E2E_SUITE").as_deref() == Ok("actions") {
                let _ = webview.eval(include_str!("../../scripts/actions-e2e.js"));
            }
            #[cfg(all(windows, feature = "smoke-test"))]
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Finished && std::env::var("EVERY_DIRECTORY_E2E_SUITE").as_deref() == Ok("desktop") {
                let _ = webview.eval("window.__edE2E=true;");
                let _ = webview.eval(include_str!("../../scripts/desktop-smoke.js"));
            }
            #[cfg(all(windows, feature = "smoke-test"))]
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Finished && std::env::var("EVERY_DIRECTORY_E2E_SUITE").as_deref() == Ok("search") {
                let _ = webview.eval(include_str!("../../scripts/search-e2e.js"));
            }
            #[cfg(all(windows, feature = "smoke-test"))]
            if webview.label() == "main" && payload.event() == tauri::webview::PageLoadEvent::Finished && std::env::var_os("EVERY_DIRECTORY_WINDOWS_UI").is_some() {
                let _ = webview.eval(include_str!("../../scripts/windows-ui-smoke.js"));
            }
        })
        .invoke_handler(tauri::generate_handler![ed_request, quick_search, copy_files, paste_files, import_files, desktop::desktop_control, desktop::quick_control])
        .register_asynchronous_uri_scheme_protocol("edfile", |context, request, responder| {
            let engine = context.app_handle().state::<Arc<Engine>>().inner().clone();
            std::thread::spawn(move || responder.respond(file_response(&engine, request)));
        })
        .build(context)
        .map(|app| app.run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = event { desktop::show(app, "show"); }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        }))
        .expect("Every Directory를 시작하지 못했습니다.");
}

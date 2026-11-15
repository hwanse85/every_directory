// 런처 기능: GitHub 릴리스로 새 버전 확인, 빠른 검색에서 설치된 앱 찾기·실행.
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{Duration, Instant},
};

// 최신 릴리스 정보를 주는 GitHub API 주소(공개 저장소)
const RELEASES: &str = "https://api.github.com/repos/hwanse85/every_directory/releases/latest";

// "v1.2.3" 같은 버전을 비교할 수 있는 숫자 셋으로 바꾼다.
pub fn version(text: &str) -> Option<(u64, u64, u64)> {
    let mut parts = text.trim().trim_start_matches(['v', 'V']).split(['.', '-', '+']).map(|p| p.parse::<u64>());
    Some((parts.next()?.ok()?, parts.next().and_then(Result::ok).unwrap_or(0), parts.next().and_then(Result::ok).unwrap_or(0)))
}

// GitHub 최신 릴리스를 확인한다. 운영체제의 curl을 써서 별도 네트워크 의존성을 두지 않는다.
pub fn check_update() -> Result<Value, String> {
    let current = env!("CARGO_PKG_VERSION");
    // 검증 빌드는 시험용 릴리스 정보(file://)를 읽을 수 있다.
    #[cfg(feature = "smoke-test")]
    let feed = std::env::var("EVERY_DIRECTORY_UPDATE_FEED").unwrap_or_else(|_| RELEASES.to_owned());
    #[cfg(not(feature = "smoke-test"))]
    let feed = RELEASES.to_owned();
    let curl = if cfg!(windows) { "curl.exe" } else { "/usr/bin/curl" };
    let mut command = Command::new(curl);
    command.args(["-sSL", "--max-time", "10", "-H", "Accept: application/vnd.github+json", "-H", "User-Agent: EveryDirectory-update-check", "-w", "\n%{http_code}"]).arg(&feed);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().map_err(|e| format!("업데이트를 확인하지 못했습니다(curl 실행 실패): {e}"))?;
    if !output.status.success() {
        return Err(format!("업데이트 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요. {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let (body, code) = text.rsplit_once('\n').unwrap_or((&text, ""));
    if code == "404" {
        return Ok(json!({"current": current, "latest": null, "newer": false, "message": "아직 배포한 릴리스가 없습니다."}));
    }
    if !["200", "000"].contains(&code.trim()) {
        return Err(format!("업데이트 서버 응답 오류({code})"));
    }
    let release: Value = serde_json::from_str(body).map_err(|_| "릴리스 정보를 읽지 못했습니다.".to_owned())?;
    let latest = release["tag_name"].as_str().unwrap_or("").to_owned();
    let newer = match (version(&latest), version(current)) {
        (Some(remote), Some(local)) => remote > local,
        _ => false,
    };
    Ok(json!({
        "current": current,
        "latest": latest,
        "newer": newer,
        "url": release["html_url"].as_str().unwrap_or("https://github.com/hwanse85/every_directory/releases"),
        "published": release["published_at"],
        "notes": release["body"].as_str().map(|b| b.chars().take(600).collect::<String>()),
    }))
}

// 설치된 앱 하나
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct App {
    // 화면에 보이는 이름(macOS는 현지화된 이름, 예: 계산기)
    pub name: String,
    // 파일 이름(예: Calculator)
    pub stem: String,
    pub path: PathBuf,
}

// 앱 목록은 10분 동안 다시 읽지 않는다.
static CACHE: Mutex<Option<(Instant, Vec<App>)>> = Mutex::new(None);

// 앱을 찾을 폴더
fn app_folders() -> Vec<PathBuf> {
    #[cfg(feature = "smoke-test")]
    if let Some(paths) = std::env::var_os("EVERY_DIRECTORY_APP_DIRS") {
        return std::env::split_paths(&paths).collect();
    }
    let mut folders = vec![];
    #[cfg(target_os = "macos")]
    {
        folders.extend(["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities"].map(PathBuf::from));
        if let Some(home) = dirs::home_dir() {
            folders.push(home.join("Applications"));
        }
    }
    #[cfg(windows)]
    {
        for base in [std::env::var_os("ProgramData"), std::env::var_os("APPDATA")].into_iter().flatten() {
            folders.push(PathBuf::from(base).join("Microsoft\\Windows\\Start Menu\\Programs"));
        }
    }
    folders
}

// macOS 앱의 현지화된 이름
#[cfg(target_os = "macos")]
fn display_name(path: &Path) -> Option<String> {
    use objc2_foundation::{NSFileManager, NSString};
    let name = NSFileManager::defaultManager().displayNameAtPath(&NSString::from_str(&path.to_string_lossy())).to_string();
    Some(name.trim_end_matches(".app").to_owned())
}

#[cfg(not(target_os = "macos"))]
fn display_name(_path: &Path) -> Option<String> {
    None
}

// 설치된 앱 목록(macOS .app, Windows 시작 메뉴 바로가기)
pub fn apps() -> Vec<App> {
    let mut cache = CACHE.lock().unwrap();
    if let Some((at, list)) = cache.as_ref() {
        if at.elapsed() < Duration::from_secs(600) {
            return list.clone();
        }
    }
    // 폴더를 3단계까지 내려가며 .app(폴더 자체가 앱)과 .lnk(바로가기)를 모은다.
    fn visit(folder: &Path, depth: usize, found: &mut Vec<PathBuf>) {
        for item in std::fs::read_dir(folder).into_iter().flatten().flatten() {
            let path = item.path();
            let extension = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            if extension == "app" || extension == "lnk" {
                found.push(path);
            } else if depth < 3 && item.file_type().is_ok_and(|t| t.is_dir()) {
                visit(&path, depth + 1, found);
            }
        }
    }
    let mut found = vec![];
    for folder in app_folders() {
        visit(&folder, 1, &mut found);
    }
    let mut list: Vec<App> = vec![];
    for path in found {
        let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        // 제거 프로그램 바로가기는 빼고 같은 이름은 한 번만 둔다.
        if stem.to_lowercase().contains("uninstall") || stem.contains("제거") || list.iter().any(|app| app.stem == stem) {
            continue;
        }
        let name = display_name(&path).unwrap_or_else(|| stem.clone());
        list.push(App { name, stem, path });
    }
    list.sort_by_key(|app| app.name.to_lowercase());
    *cache = Some((Instant::now(), list.clone()));
    list
}

// 목록에 있는 앱만 실행한다(임의 경로 실행 방지).
pub fn launch(path: &Path, data: &Path) -> Result<(), String> {
    if !apps().iter().any(|app| app.path == path) {
        return Err("앱 목록에 없는 항목입니다. 빠른 검색을 다시 열어 주세요.".into());
    }
    #[cfg(feature = "smoke-test")]
    if std::env::var_os("EVERY_DIRECTORY_E2E_SUITE").is_some() {
        // 검증 중에는 앱을 띄우지 않고 요청만 기록한다.
        let filename = data.join("native-opens.json");
        let mut opened: Vec<Value> = std::fs::read(&filename).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        opened.push(json!({"path": path, "launch": true, "accepted": true}));
        return std::fs::write(filename, serde_json::to_vec_pretty(&opened).map_err(|e| e.to_string())?).map_err(|e| e.to_string());
    }
    let _ = data;
    crate::operations::native_open(path, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(version("v0.13.0") > version("0.12.6"));
        assert!(version("v1.0") > version("0.99.99"));
        assert_eq!(version("0.12.6"), Some((0, 12, 6)));
        assert_eq!(version("release"), None);
    }
}

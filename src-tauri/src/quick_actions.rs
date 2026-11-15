// 빠른 검색 작업 메뉴의 추가 동작: 경로 형식 복사, 다른 앱으로 열기, 압축해서 보내기, 사용자 동작.
use crate::{model::Location, store::Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

// 사용자가 설정에 등록한 동작: 이름 + 실행할 프로그램 + 인자 틀
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserAction {
    pub name: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

// 사용자 동작 목록이 허용 범위 안인지 확인한다.
pub fn validate_actions(actions: &[UserAction]) -> Result<(), String> {
    if actions.len() > 20 {
        return Err("사용자 동작은 20개까지 등록할 수 있습니다.".into());
    }
    for action in actions {
        let name = action.name.trim();
        if name.is_empty() || name.chars().count() > 40 {
            return Err("사용자 동작 이름은 1~40자로 입력해 주세요.".into());
        }
        if action.program.trim().is_empty() || action.program.len() > 1024 || action.program.contains('\0') {
            return Err(format!("‘{name}’의 실행할 프로그램을 입력해 주세요."));
        }
        if action.args.len() > 20 || action.args.iter().any(|arg| arg.len() > 1024 || arg.contains('\0')) {
            return Err(format!("‘{name}’의 인자는 20줄, 줄마다 1024자까지 입력할 수 있습니다."));
        }
    }
    Ok(())
}

// 인자 틀의 {path}·{dir}·{name}·{stem}·{ext}를 실제 값으로 바꾼다.
// 셸을 거치지 않고 인자 배열 그대로 넘기므로 파일 이름의 따옴표·;·&&는 글자 그대로 전달된다.
pub fn expand(args: &[String], path: &Path) -> Vec<String> {
    let text = crate::file_clipboard::path_text(path);
    let dir = path.parent().map(crate::file_clipboard::path_text).unwrap_or_default();
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let stem = path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    args.iter()
        .map(|arg| {
            // 한 번만 훑어 바꿔서, 파일 이름에 든 {name} 같은 글자가 다시 바뀌지 않게 한다.
            let mut out = String::new();
            let mut rest = arg.as_str();
            while let Some(start) = rest.find('{') {
                out.push_str(&rest[..start]);
                let tail = &rest[start..];
                let (value, used) = [("{path}", &text), ("{dir}", &dir), ("{name}", &name), ("{stem}", &stem), ("{ext}", &ext)]
                    .iter()
                    .find(|(token, _)| tail.starts_with(token))
                    .map(|(token, value)| (value.as_str(), token.len()))
                    .unwrap_or(("{", 1));
                out.push_str(value);
                rest = &tail[used..];
            }
            out.push_str(rest);
            out
        })
        .collect()
}

// 확인을 받은 동작을 구별하는 값(프로그램과 인자 틀이 바뀌면 다시 묻는다)
fn action_key(action: &UserAction) -> String {
    let mut hasher = Sha256::new();
    hasher.update(action.program.as_bytes());
    for arg in &action.args {
        hasher.update([0]);
        hasher.update(arg.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

// 사용자 동작을 실행한다. 처음 실행하는 동작은 실행할 명령을 돌려주고 확인을 받은 뒤 실행한다.
pub fn run_user_action(engine: &Engine, action: &UserAction, location: &Location, confirm: bool) -> Result<Value, String> {
    validate_actions(std::slice::from_ref(action))?;
    let path = engine.resolve(location)?;
    // 빈 줄은 인자로 넘기지 않는다.
    let template: Vec<String> = action.args.iter().filter(|arg| !arg.trim().is_empty()).cloned().collect();
    let args = expand(&template, &path);
    let store = engine.data.join("user-actions.json");
    let mut confirmed: Vec<String> = std::fs::read(&store)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let key = action_key(action);
    if !confirmed.contains(&key) {
        if !confirm {
            return Ok(json!({"confirm": true, "program": action.program, "args": args}));
        }
        confirmed.push(key);
        crate::store::write_json(&store, &confirmed)?;
    }
    Command::new(action.program.trim())
        .args(&args)
        .spawn()
        .map_err(|error| format!("‘{}’을(를) 실행하지 못했습니다: {error}", action.program))?;
    Ok(json!({"ran": true}))
}

// file:// 주소의 경로 조각에서 그대로 둘 글자
const URL_SAFE: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~')
    .remove(b'/')
    .remove(b':');

// 경로를 file:// 주소로 바꾼다. Windows 네트워크 경로는 file://서버/공유 형식이다.
pub fn file_url(text: &str) -> String {
    let slashed = text.replace('\\', "/");
    let encoded = percent_encoding::utf8_percent_encode(&slashed, URL_SAFE).to_string();
    if let Some(unc) = encoded.strip_prefix("//") {
        format!("file://{unc}")
    } else if encoded.starts_with('/') {
        format!("file://{encoded}")
    } else {
        format!("file:///{encoded}")
    }
}

// 연결된 네트워크 드라이브·볼륨이면 서버 주소 형식의 경로를 구한다.
#[cfg(windows)]
fn network_path(path: &Path, text: &str) -> Option<String> {
    use windows_sys::Win32::NetworkManagement::WNet::{WNetGetUniversalNameW, UNIVERSAL_NAME_INFOW, UNIVERSAL_NAME_INFO_LEVEL};
    if text.starts_with("\\\\") {
        return Some(text.to_owned());
    }
    let _ = path;
    let wide: Vec<u16> = text.encode_utf16().chain([0]).collect();
    let mut buffer = vec![0u8; 4096];
    let mut size = buffer.len() as u32;
    // SAFETY: 버퍼 크기를 함께 넘기고, 성공하면 버퍼 앞에 UNIVERSAL_NAME_INFOW가 채워진다.
    let status = unsafe { WNetGetUniversalNameW(wide.as_ptr(), UNIVERSAL_NAME_INFO_LEVEL, buffer.as_mut_ptr().cast(), &mut size) };
    if status != 0 {
        return None;
    }
    let info = unsafe { &*(buffer.as_ptr() as *const UNIVERSAL_NAME_INFOW) };
    let mut end = info.lpUniversalName;
    // SAFETY: 운영체제가 NUL로 끝나는 문자열을 버퍼 안에 넣었다.
    unsafe {
        while *end != 0 {
            end = end.add(1);
        }
        let units = std::slice::from_raw_parts(info.lpUniversalName, end.offset_from(info.lpUniversalName) as usize);
        Some(String::from_utf16_lossy(units))
    }
}

#[cfg(target_os = "macos")]
fn network_path(path: &Path, _text: &str) -> Option<String> {
    use std::{ffi::CStr, os::unix::ffi::OsStrExt};
    let name = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut info: libc::statfs = unsafe { std::mem::zeroed() };
    // SAFETY: NUL로 끝나는 경로와 0으로 채운 구조체를 넘긴다.
    if unsafe { libc::statfs(name.as_ptr(), &mut info) } != 0 {
        return None;
    }
    let system = unsafe { CStr::from_ptr(info.f_fstypename.as_ptr()) }.to_string_lossy().to_lowercase();
    let scheme = match system.as_str() {
        "smbfs" => "smb",
        "afpfs" => "afp",
        "nfs" => "nfs",
        "webdav" => "https",
        _ => return None,
    };
    let from = unsafe { CStr::from_ptr(info.f_mntfromname.as_ptr()) }.to_string_lossy().into_owned();
    let mounted = unsafe { CStr::from_ptr(info.f_mntonname.as_ptr()) }.to_string_lossy().into_owned();
    // //사용자@서버/공유 → 서버/공유 (사용자 이름은 빼고 알려 준다)
    let server = from.trim_start_matches("//");
    let server = server.rsplit_once('@').map_or(server, |(_, host)| host);
    let rest = path.strip_prefix(&mounted).ok()?.to_string_lossy().into_owned();
    Some(format!("{scheme}://{}{}{}", server.trim_end_matches('/'), if rest.is_empty() { "" } else { "/" }, rest))
}

#[cfg(not(any(windows, target_os = "macos")))]
fn network_path(_path: &Path, _text: &str) -> Option<String> {
    None
}

// 경로 복사 형식들: 전체 경로, 따옴표 경로, file:// 주소, 네트워크 경로, 연결 폴더 기준 경로
pub fn path_formats(engine: &Engine, location: &Location) -> Result<Value, String> {
    let path = engine.resolve(location)?;
    let plain = crate::file_clipboard::path_text(&path);
    Ok(json!({
        "plain": plain,
        "quoted": format!("\"{plain}\""),
        "url": file_url(&plain),
        "network": network_path(&path, &plain),
        "relative": location.path,
    }))
}

// 파일을 열 수 있는 앱 목록(macOS). 기본 앱이 맨 앞이다. Windows는 운영체제 ‘연결 프로그램’ 창을 쓴다.
#[cfg(target_os = "macos")]
pub fn open_with_apps(path: &Path) -> Vec<Value> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSString, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let workspace = NSWorkspace::sharedWorkspace();
    let default = workspace.URLForApplicationToOpenURL(&url).and_then(|app| app.path()).map(|p| p.to_string());
    let mut apps: Vec<Value> = vec![];
    for app in workspace.URLsForApplicationsToOpenURL(&url).iter() {
        let Some(location) = app.path().map(|p| p.to_string()) else { continue };
        if apps.iter().any(|known| known["path"] == location.as_str()) {
            continue;
        }
        let name = Path::new(&location).file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        apps.push(json!({"name": name, "path": location, "default": Some(&location) == default.as_ref()}));
    }
    apps.sort_by_key(|app| (!app["default"].as_bool().unwrap_or(false), app["name"].as_str().unwrap_or("").to_lowercase()));
    apps.truncate(30);
    apps
}

#[cfg(not(target_os = "macos"))]
pub fn open_with_apps(_path: &Path) -> Vec<Value> {
    vec![]
}

// 고른 앱으로 파일을 연다. Windows는 앱을 고르는 운영체제 창을 띄운다.
pub fn open_with(engine: &Engine, location: &Location, app: Option<&str>, owner: isize) -> Result<(), String> {
    let path = engine.resolve(location)?;
    #[cfg(feature = "smoke-test")]
    if std::env::var_os("EVERY_DIRECTORY_E2E_SUITE").is_some() {
        // 검증 중에는 실제 앱을 띄우지 않고 요청만 기록한다.
        let filename = engine.data.join("native-opens.json");
        let mut opened: Vec<Value> = std::fs::read(&filename).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        opened.push(json!({"path": path, "app": app, "accepted": true}));
        std::fs::write(filename, serde_json::to_vec_pretty(&opened).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let _ = owner;
        let app = app.ok_or("열 앱을 선택해 주세요.")?;
        let bundle = Path::new(app);
        if bundle.extension().is_none_or(|ext| ext != "app") || !bundle.is_dir() {
            return Err("앱을 찾지 못했습니다.".into());
        }
        let output = Command::new("/usr/bin/open").arg("-a").arg(bundle).arg(&path).output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!("앱으로 열지 못했습니다. {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::{SHOpenWithDialog, OAIF_ALLOW_REGISTRATION, OAIF_EXEC, OAIF_REGISTER_EXT, OPENASINFO};
        let _ = app;
        let file: Vec<u16> = crate::file_clipboard::path_text(&path).encode_utf16().chain([0]).collect();
        let info = OPENASINFO { pcszFile: file.as_ptr(), pcszClass: std::ptr::null(), oaifInFlags: OAIF_ALLOW_REGISTRATION | OAIF_REGISTER_EXT | OAIF_EXEC };
        // SAFETY: 창 핸들과 NUL로 끝나는 경로를 넘기며, 대화상자가 닫힐 때까지 file이 살아 있다.
        let result = unsafe { SHOpenWithDialog(owner as _, &info) };
        // 사용자가 취소하면 0x800704C7(ERROR_CANCELLED)이 돌아온다.
        if result < 0 && result as u32 != 0x800704C7 {
            return Err(format!("연결 프로그램 창을 열지 못했습니다(0x{:08X}).", result as u32));
        }
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (app, owner, path);
        Err("이 운영체제에서는 지원하지 않습니다.".into())
    }
}

// 선택한 항목을 ZIP으로 묶어 앱 데이터의 보내기 폴더에 만든다. 하루 지난 이전 파일은 지운다.
pub fn zip_for_sending(engine: &Engine, locations: &[Location]) -> Result<PathBuf, String> {
    if locations.is_empty() || locations.len() > 200 {
        return Err("압축할 항목을 1~200개 선택해 주세요.".into());
    }
    let sources = locations.iter().map(|location| engine.resolve(location)).collect::<Result<Vec<_>, _>>()?;
    let outbox = engine.data.join("outbox");
    std::fs::create_dir_all(&outbox).map_err(|e| e.to_string())?;
    if let Ok(items) = std::fs::read_dir(&outbox) {
        for item in items.flatten() {
            let old = item.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_secs() > 86_400);
            if old {
                let _ = std::fs::remove_file(item.path());
            }
        }
    }
    let stem = if sources.len() == 1 {
        sources[0].file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "보내기".into())
    } else {
        format!("묶음 {}개", sources.len())
    };
    // 같은 이름이 있으면 번호를 붙여 이전 보내기 파일을 덮어쓰지 않는다.
    let mut output = outbox.join(format!("{stem}.zip"));
    let mut n = 2;
    while output.exists() {
        output = outbox.join(format!("{stem} ({n}).zip"));
        n += 1;
    }
    crate::operations::zip_sources(&sources, &output).inspect_err(|_| {
        let _ = std::fs::remove_file(&output);
    })?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn templates_keep_hostile_names_as_single_arguments() {
        let path = Path::new("/tmp/폴더/a\"; rm -rf ~ && echo {name}.txt");
        let args = expand(&["--open".into(), "{path}".into(), "{dir}/out-{stem}.log".into(), "{ext}".into(), "{unknown}".into()], path);
        assert_eq!(args[0], "--open");
        assert_eq!(args[1], "/tmp/폴더/a\"; rm -rf ~ && echo {name}.txt");
        assert_eq!(args[2], "/tmp/폴더/out-a\"; rm -rf ~ && echo {name}.log");
        assert_eq!(args[3], "txt");
        assert_eq!(args[4], "{unknown}");
    }

    #[test]
    fn file_urls_encode_spaces_and_korean() {
        assert_eq!(file_url("/Users/me/업무 자료/a b.txt"), "file:///Users/me/%EC%97%85%EB%AC%B4%20%EC%9E%90%EB%A3%8C/a%20b.txt");
        assert_eq!(file_url("C:\\업무\\a b.txt"), "file:///C:/%EC%97%85%EB%AC%B4/a%20b.txt");
        assert_eq!(file_url("\\\\server\\share\\a.txt"), "file://server/share/a.txt");
    }

    #[test]
    fn validates_user_actions() {
        let ok = UserAction { name: "VS Code".into(), program: "code".into(), args: vec!["{path}".into()] };
        assert!(validate_actions(std::slice::from_ref(&ok)).is_ok());
        assert!(validate_actions(&[UserAction { name: "".into(), ..ok.clone() }]).is_err());
        assert!(validate_actions(&[UserAction { program: " ".into(), ..ok.clone() }]).is_err());
        assert!(validate_actions(&vec![ok; 21]).is_err());
    }
}

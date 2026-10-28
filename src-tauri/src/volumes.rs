// 연결 폴더가 놓인 드라이브 종류를 판별하고, 네트워크·웹 드라이브 주소를 운영체제 경로로 연결한다.
use std::path::{Path, PathBuf};

/// 네트워크 드라이브는 실시간 감시가 다른 PC의 변경을 놓칠 수 있어 이 간격으로 다시 확인한다.
pub const NETWORK_REFRESH_MINUTES: u32 = 5;

// canonicalize가 실패하는 WebDAV·일부 네트워크 리디렉터 경로는 존재를 확인한 뒤 절대 경로로 쓴다.
pub fn real_path(path: &Path) -> std::io::Result<PathBuf> {
    match path.canonicalize() {
        Ok(path) => Ok(path),
        Err(error) => {
            if std::fs::symlink_metadata(path).is_ok() {
                std::path::absolute(path)
            } else {
                Err(error)
            }
        }
    }
}

// 경로 문자열만으로 판별할 수 있는 네트워크(UNC)·WebDAV 경로인지 확인한다. 디스크 접근이 없어 시작 시에도 쓴다.
pub fn looks_remote(path: &str) -> bool {
    let plain = path.trim_start_matches(r"\\?\");
    plain.starts_with(r"UNC\") || (path.starts_with(r"\\") && !path.starts_with(r"\\?\"))
}

/// 실시간 감시만으로는 부족해 주기적으로 다시 확인해야 하는 종류인지 알려 준다.
pub fn is_remote(kind: &str) -> bool {
    matches!(kind, "network" | "webdav")
}

// local·network·webdav·cloud·removable 중 하나를 돌려준다.
pub fn kind(path: &Path) -> &'static str {
    let text = path.to_string_lossy();
    let lower = text.to_lowercase().replace('\\', "/");
    if lower.contains("/davwwwroot") || lower.contains("@ssl/") || lower.contains("@ssl@") {
        return "webdav";
    }
    if looks_remote(&text) {
        return "network";
    }
    if let Some(kind) = native_kind(path) {
        return kind;
    }
    let cloud = ["/library/cloudstorage/", "/library/mobile documents/", "/onedrive", "/google drive", "/dropbox", "/icloud drive", "/icloudrive", "/box/"];
    if cloud.iter().any(|marker| lower.contains(marker)) {
        return "cloud";
    }
    "local"
}

#[cfg(windows)]
fn native_kind(path: &Path) -> Option<&'static str> {
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;
    let text = path.to_string_lossy();
    let plain = text.trim_start_matches(r"\\?\");
    let drive = plain.get(..2).filter(|d| d.as_bytes()[0].is_ascii_alphabetic() && d.ends_with(':'))?;
    let root: Vec<u16> = format!("{drive}\\").encode_utf16().chain([0]).collect();
    // DRIVE_REMOVABLE=2, DRIVE_REMOTE=4, DRIVE_CDROM=5
    match unsafe { GetDriveTypeW(root.as_ptr()) } {
        4 => Some("network"),
        2 | 5 => Some("removable"),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn native_kind(path: &Path) -> Option<&'static str> {
    use std::{ffi::CStr, os::unix::ffi::OsStrExt};
    let name = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
    let mut info: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(name.as_ptr(), &mut info) } != 0 {
        return None;
    }
    let system = unsafe { CStr::from_ptr(info.f_fstypename.as_ptr()) }.to_string_lossy().to_lowercase();
    if system == "webdav" {
        Some("webdav")
    } else if info.f_flags & libc::MNT_LOCAL as u32 == 0 {
        Some("network")
    } else {
        None
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn native_kind(_: &Path) -> Option<&'static str> {
    None
}

/// 사용자가 입력한 네트워크 주소(smb://, https:// 등)를 나눈 결과다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkAddress {
    pub scheme: String,
    pub host: String,
    pub port: Option<u16>,
    pub segments: Vec<String>,
}

// `scheme://[사용자@]호스트[:포트]/경로` 주소를 해석한다. 비밀번호가 든 주소는 받지 않는다.
pub fn parse_address(input: &str) -> Result<Option<NetworkAddress>, String> {
    let Some((scheme, rest)) = input.trim().split_once("://") else { return Ok(None) };
    let scheme = scheme.to_lowercase();
    if !["smb", "cifs", "afp", "nfs", "http", "https", "webdav", "webdavs", "dav", "davs"].contains(&scheme.as_str()) {
        return Err("smb://, afp://, nfs://, https://(WebDAV) 주소만 연결할 수 있습니다.".into());
    }
    let (authority, path) = rest.split_once('/').unwrap_or((rest, ""));
    if authority.contains(':') && authority.contains('@') && authority.split('@').next().is_some_and(|user| user.contains(':')) {
        return Err("비밀번호가 포함된 주소는 사용할 수 없습니다. 연결할 때 운영체제 창에서 입력해 주세요.".into());
    }
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    let (host, port) = match host_port.rsplit_once(':') {
        Some((host, port)) if !host.is_empty() && !host_port.starts_with('[') => (host, Some(port.parse::<u16>().map_err(|_| "포트 번호가 올바르지 않습니다.")?)),
        _ => (host_port, None),
    };
    if host.is_empty() || host.contains(['\\', '"', ' ']) {
        return Err("서버 이름을 확인해 주세요.".into());
    }
    let segments = path
        .split('/')
        .filter(|part| !part.is_empty())
        .map(|part| percent_encoding::percent_decode_str(part).decode_utf8().map(|s| s.into_owned()).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    if segments.iter().any(|part| part == "." || part == ".." || part.contains(['\\', '"'])) {
        return Err("주소의 경로를 확인해 주세요.".into());
    }
    Ok(Some(NetworkAddress { scheme, host: host.into(), port, segments }))
}

// Windows는 SMB 주소를 UNC로, WebDAV 주소를 WebClient의 DavWWWRoot UNC로 바꾼다.
pub fn windows_unc(address: &NetworkAddress) -> Result<String, String> {
    let rest = address.segments.join("\\");
    match address.scheme.as_str() {
        "smb" | "cifs" => {
            if address.segments.is_empty() {
                return Err("공유 폴더 이름까지 입력해 주세요. 예: smb://서버/공유".into());
            }
            Ok(format!(r"\\{}\{rest}", address.host))
        }
        "http" | "https" | "webdav" | "webdavs" | "dav" | "davs" => {
            let secure = matches!(address.scheme.as_str(), "https" | "webdavs" | "davs");
            let mut host = address.host.clone();
            if secure {
                host.push_str("@SSL");
            }
            if let Some(port) = address.port {
                host.push_str(&format!("@{port}"));
            }
            Ok(if rest.is_empty() { format!(r"\\{host}\DavWWWRoot") } else { format!(r"\\{host}\DavWWWRoot\{rest}") })
        }
        _ => Err("Windows에서는 SMB와 WebDAV 주소를 연결할 수 있습니다. NFS·AFP는 탐색기에서 드라이브로 연결한 뒤 선택해 주세요.".into()),
    }
}

// macOS mount volume에 넘길 주소. WebDAV 별칭은 http(s)로 바꾼다.
pub fn mac_mount_url(address: &NetworkAddress) -> String {
    let scheme = match address.scheme.as_str() {
        "webdav" | "dav" => "http",
        "webdavs" | "davs" => "https",
        "cifs" => "smb",
        other => other,
    };
    let port = address.port.map_or(String::new(), |port| format!(":{port}"));
    let path: Vec<String> = address
        .segments
        .iter()
        .map(|part| percent_encoding::utf8_percent_encode(part, percent_encoding::NON_ALPHANUMERIC).to_string())
        .collect();
    format!("{scheme}://{}{port}/{}", address.host, path.join("/"))
}

// UNC 경로의 서버·공유 부분(\\서버\공유)만 남긴다. WebDAV는 \\서버@SSL\DavWWWRoot까지다.
pub fn unc_share(unc: &str) -> Option<String> {
    let trimmed = unc.trim_start_matches(r"\\");
    let mut parts = trimmed.split('\\').filter(|part| !part.is_empty());
    let server = parts.next()?;
    let share = parts.next()?;
    Some(format!(r"\\{server}\{share}"))
}

// 입력한 경로·주소를 색인할 수 있는 운영체제 경로로 만든다. 필요하면 운영체제 연결(로그인) 창을 띄운다.
// owner는 Windows 자격 증명 창의 부모 창 핸들이다.
pub fn connect(target: &str, owner: isize) -> Result<String, String> {
    let target = target.trim().trim_matches('"');
    if target.is_empty() {
        return Err("연결할 경로나 주소를 입력해 주세요.".into());
    }
    let address = parse_address(target)?;
    #[cfg(target_os = "macos")]
    {
        let _ = owner;
        if let Some(address) = address {
            return mount_mac(&address);
        }
    }
    #[cfg(windows)]
    {
        let unc = match address {
            Some(address) => Some(windows_unc(&address)?),
            None if target.starts_with(r"\\") || target.starts_with("//") => Some(target.replace('/', r"\")),
            None => None,
        };
        if let Some(unc) = unc {
            ensure_windows_connection(&unc, owner)?;
            return Ok(unc);
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = owner;
        if address.is_some() {
            return Err("이 운영체제에서는 네트워크 주소 연결을 지원하지 않습니다. 먼저 마운트한 폴더를 선택해 주세요.".into());
        }
    }
    let path = Path::new(target);
    if !path.is_absolute() {
        return Err("폴더의 전체 경로를 입력해 주세요.".into());
    }
    if !path.is_dir() {
        return Err("폴더를 찾을 수 없습니다. 네트워크 드라이브는 연결(로그인)된 상태인지 확인해 주세요.".into());
    }
    Ok(target.into())
}

// Finder의 서버 연결과 같은 mount volume으로 연결하고, 마운트된 폴더 아래 하위 경로를 붙인다.
#[cfg(target_os = "macos")]
fn mount_mac(address: &NetworkAddress) -> Result<String, String> {
    let url = mac_mount_url(address);
    let script = format!("POSIX path of (mount volume \"{}\")", url.replace('\\', "\\\\").replace('"', "\\\""));
    let output = std::process::Command::new("/usr/bin/osascript").arg("-e").arg(&script).output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr);
        return Err(if message.contains("-128") { "서버 연결을 취소했습니다.".into() } else { format!("서버에 연결하지 못했습니다: {}", message.trim()) });
    }
    let mounted = String::from_utf8_lossy(&output.stdout).trim().trim_end_matches('/').to_owned();
    let mut path = PathBuf::from(if mounted.is_empty() { format!("/Volumes/{}", address.segments.first().cloned().unwrap_or_default()) } else { mounted });
    // SMB·AFP는 공유 폴더가 마운트되므로 그 아래 경로를 이어 붙인다. WebDAV는 주소 전체가 하나의 볼륨이다.
    if matches!(address.scheme.as_str(), "smb" | "cifs" | "afp") {
        for part in address.segments.iter().skip(1) {
            path.push(part);
        }
    }
    if !path.is_dir() {
        return Err(format!("연결은 했지만 폴더를 찾지 못했습니다: {}", path.display()));
    }
    Ok(path.to_string_lossy().into_owned())
}

// UNC 공유에 접근할 수 없으면 Windows 자격 증명 창으로 연결을 만든다(WNetAddConnection3W).
#[cfg(windows)]
fn ensure_windows_connection(unc: &str, owner: isize) -> Result<(), String> {
    use windows_sys::Win32::NetworkManagement::WNet::{WNetAddConnection3W, CONNECT_INTERACTIVE, CONNECT_PROMPT, NETRESOURCEW, RESOURCETYPE_DISK};
    if Path::new(unc).is_dir() {
        return Ok(());
    }
    let share = unc_share(unc).ok_or("서버와 공유 폴더 이름까지 입력해 주세요. 예: \\\\서버\\공유")?;
    let mut remote: Vec<u16> = share.encode_utf16().chain([0]).collect();
    let mut resource: NETRESOURCEW = unsafe { std::mem::zeroed() };
    resource.dwType = RESOURCETYPE_DISK;
    resource.lpRemoteName = remote.as_mut_ptr();
    let code = unsafe { WNetAddConnection3W(owner as _, &resource, std::ptr::null(), std::ptr::null(), CONNECT_INTERACTIVE | CONNECT_PROMPT) };
    // 1219: 같은 서버에 다른 계정으로 이미 연결됨, 1223: 사용자가 취소함
    match code {
        0 | 85 if Path::new(unc).is_dir() => Ok(()),
        1223 => Err("네트워크 로그인을 취소했습니다.".into()),
        1219 => Err("이 서버에 이미 다른 계정으로 연결되어 있습니다. 탐색기에서 기존 연결을 끊은 뒤 다시 시도해 주세요.".into()),
        0 | 85 => Err("연결했지만 폴더를 찾지 못했습니다. 경로를 확인해 주세요.".into()),
        code => Err(format!("네트워크 위치에 연결하지 못했습니다(오류 {code}). WebDAV는 Windows WebClient 서비스가 켜져 있어야 합니다.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_network_addresses_for_each_platform() {
        let smb = parse_address("smb://nas.local/공유/업무%20자료").unwrap().unwrap();
        assert_eq!(smb.segments, vec!["공유", "업무 자료"]);
        assert_eq!(windows_unc(&smb).unwrap(), r"\\nas.local\공유\업무 자료");
        assert_eq!(mac_mount_url(&smb), "smb://nas.local/%EA%B3%B5%EC%9C%A0/%EC%97%85%EB%AC%B4%20%EC%9E%90%EB%A3%8C");
        let dav = parse_address("https://files.example.com:8443/remote.php/dav").unwrap().unwrap();
        assert_eq!(windows_unc(&dav).unwrap(), r"\\files.example.com@SSL@8443\DavWWWRoot\remote.php\dav");
        assert_eq!(mac_mount_url(&parse_address("webdavs://h/x").unwrap().unwrap()), "https://h/x");
        assert_eq!(unc_share(r"\\nas\share\a\b").as_deref(), Some(r"\\nas\share"));
        assert_eq!(unc_share(r"\\h@SSL\DavWWWRoot\x").as_deref(), Some(r"\\h@SSL\DavWWWRoot"));
        assert!(parse_address("C:\\Data").unwrap().is_none());
        assert!(parse_address("ftp://host/x").is_err());
        assert!(parse_address("smb://user:secret@host/share").is_err());
        assert!(parse_address("smb://host/../etc").is_err());
        assert!(windows_unc(&parse_address("smb://host").unwrap().unwrap()).is_err());
    }

    #[test]
    fn recognizes_remote_and_cloud_paths_without_disk_access() {
        assert!(looks_remote(r"\\?\UNC\nas\share\docs"));
        assert!(looks_remote(r"\\nas\share"));
        assert!(!looks_remote(r"\\?\C:\Data"));
        assert_eq!(kind(Path::new(r"\\?\UNC\files@SSL\DavWWWRoot\docs")), "webdav");
        assert_eq!(kind(Path::new(r"\\nas\share")), "network");
        assert!(is_remote("network") && is_remote("webdav") && !is_remote("cloud"));
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(kind(temp.path()), "local");
        assert_eq!(real_path(temp.path()).unwrap(), temp.path().canonicalize().unwrap());
    }
}

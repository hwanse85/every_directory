// 운영체제 탐색기와 같은 파일·폴더 아이콘을 PNG로 만들어 화면에 제공한다.
use crate::{model::Location, store::Engine};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};
use tauri::http::{Request, Response};

/// 화면이 요청하는 아이콘 하나의 종류와 크기다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IconRequest {
    pub size: u32,
    pub target: IconTarget,
}

/// 형식별 공용 아이콘과 실행 파일처럼 파일마다 다른 아이콘을 구분한다.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IconTarget {
    Folder,
    Extension(String),
    File(Location),
}

static CACHE: OnceLock<Mutex<HashMap<String, Vec<u8>>>> = OnceLock::new();
// 느린 네트워크 바로 가기 하나가 공용 형식 아이콘까지 막지 않도록 잠금을 나눈다.
static RENDER_TYPE: Mutex<()> = Mutex::new(());
static RENDER_FILE: Mutex<()> = Mutex::new(());

// 렌더 중 패닉이 나도 이후 요청이 멈추지 않도록 독성 잠금을 그대로 회복한다.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// `크기/종류/값` 형식의 주소를 해석한다. 크기는 지원하는 값으로 맞춘다.
pub fn parse(path: &str) -> Result<IconRequest, String> {
    let decoded = percent_encoding::percent_decode_str(path.trim_start_matches('/'))
        .decode_utf8()
        .map_err(|e| e.to_string())?;
    let mut parts = decoded.splitn(3, '/');
    let size = parts.next().and_then(|v| v.parse::<u32>().ok()).ok_or("아이콘 크기가 올바르지 않습니다.")?;
    let size = [16, 32, 48, 256].into_iter().find(|s| *s >= size).unwrap_or(256);
    let target = match (parts.next(), parts.next().unwrap_or("")) {
        (Some("folder"), _) => IconTarget::Folder,
        (Some("ext"), ext) => {
            let ext = ext.trim().to_lowercase();
            if ext.len() > 32 || !ext.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
                return Err("확장자가 올바르지 않습니다.".into());
            }
            IconTarget::Extension(ext)
        }
        (Some("file"), rest) => {
            let (root_id, path) = rest.split_once('/').unwrap_or((rest, ""));
            IconTarget::File(Location { root_id: root_id.into(), path: path.into() })
        }
        _ => return Err("아이콘 종류가 올바르지 않습니다.".into()),
    };
    Ok(IconRequest { size, target })
}

// 캐시를 먼저 확인하고 없으면 운영체제에서 아이콘을 읽어 PNG로 응답한다.
// render는 플랫폼 제약(macOS 주 스레드)에 맞춰 native_png를 실행한다.
pub fn response(
    engine: &Engine,
    request: &Request<Vec<u8>>,
    render: &dyn Fn(IconTarget, Option<PathBuf>, u32) -> Option<Vec<u8>>,
) -> Response<Vec<u8>> {
    let png = parse(request.uri().path()).and_then(|icon| {
        // 캐시는 경로 확인보다 먼저 조회해 같은 아이콘 요청의 비용을 줄인다.
        let key = match &icon.target {
            IconTarget::Folder => format!("folder:{}", icon.size),
            IconTarget::Extension(ext) => format!("ext:{ext}:{}", icon.size),
            IconTarget::File(location) => format!("file:{}/{}:{}", location.root_id, location.path, icon.size),
        };
        let cache = CACHE.get_or_init(Default::default);
        if let Some(cached) = lock(cache).get(&key) {
            return Ok(cached.clone());
        }
        let path = match &icon.target {
            IconTarget::File(location) => Some(engine.resolve(location)?),
            _ => None,
        };
        let _render = lock(if path.is_some() { &RENDER_FILE } else { &RENDER_TYPE });
        if let Some(cached) = lock(cache).get(&key) {
            return Ok(cached.clone());
        }
        // 실패는 저장하지 않아 색인·파일 준비가 끝난 뒤 다시 시도할 수 있다.
        let png = render(icon.target.clone(), path, icon.size).ok_or("아이콘을 만들지 못했습니다.")?;
        let mut cache = lock(cache);
        if cache.len() > 2048 {
            cache.clear();
        }
        cache.insert(key, png.clone());
        Ok(png)
    });
    match png {
        Ok(bytes) => Response::builder()
            .status(200)
            .header("Content-Type", "image/png")
            .header("Cache-Control", "max-age=86400")
            .header("Access-Control-Allow-Origin", "*")
            .body(bytes)
            .unwrap(),
        Err(message) => Response::builder()
            .status(404)
            .header("Content-Type", "text/plain; charset=utf-8")
            .header("Cache-Control", "no-store")
            .header("Access-Control-Allow-Origin", "*")
            .body(message.into_bytes())
            .unwrap(),
    }
}

#[cfg(windows)]
pub fn native_png(target: &IconTarget, path: Option<PathBuf>, size: u32) -> Option<Vec<u8>> {
    windows_icon::png(target, path, size)
}

#[cfg(target_os = "macos")]
pub fn native_png(target: &IconTarget, path: Option<PathBuf>, size: u32) -> Option<Vec<u8>> {
    mac_icon::png(target, path, size)
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn native_png(_: &IconTarget, _: Option<PathBuf>, _: u32) -> Option<Vec<u8>> {
    None
}

#[cfg(target_os = "macos")]
mod mac_icon {
    use super::IconTarget;
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};
    use std::path::PathBuf;

    // Finder가 쓰는 NSWorkspace 아이콘을 요청한 픽셀 크기의 PNG로 바꾼다.
    pub fn png(target: &IconTarget, path: Option<PathBuf>, size: u32) -> Option<Vec<u8>> {
        objc2::rc::autoreleasepool(|_| {
            let workspace = NSWorkspace::sharedWorkspace();
            #[allow(deprecated)]
            let image = match target {
                IconTarget::Folder => workspace.iconForFileType(&NSString::from_str("public.folder")),
                IconTarget::Extension(ext) if ext.is_empty() => workspace.iconForFileType(&NSString::from_str("public.data")),
                IconTarget::Extension(ext) => workspace.iconForFileType(&NSString::from_str(ext)),
                IconTarget::File(_) => workspace.iconForFile(&NSString::from_str(&path?.to_string_lossy())),
            };
            let pixels = size.max(16) as f64;
            image.setSize(NSSize::new(pixels, pixels));
            let mut rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(pixels, pixels));
            let cg = unsafe { image.CGImageForProposedRect_context_hints(&mut rect, None, None) }?;
            let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &cg);
            let data = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
            Some(data.to_vec())
        })
    }
}

#[cfg(windows)]
mod windows_icon {
    use super::IconTarget;
    use std::{os::windows::ffi::OsStrExt, path::PathBuf};
    use windows::{
        core::PCWSTR,
        Win32::{
            Graphics::Gdi::{DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ},
            Storage::FileSystem::{FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_NORMAL, FILE_FLAGS_AND_ATTRIBUTES},
            System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
            UI::{
                Controls::{IImageList, ILD_TRANSPARENT},
                Shell::{SHGetFileInfoW, SHGetImageList, SHFILEINFOW, SHGFI_FLAGS, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_LINKOVERLAY, SHGFI_OVERLAYINDEX, SHGFI_SMALLICON, SHGFI_SYSICONINDEX, SHGFI_USEFILEATTRIBUTES, SHIL_EXTRALARGE, SHIL_JUMBO},
                WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO},
            },
        },
    };

    // 탐색기의 시스템 이미지 목록에서 형식 또는 파일 아이콘을 꺼내 PNG로 바꾼다.
    pub fn png(target: &IconTarget, path: Option<PathBuf>, size: u32) -> Option<Vec<u8>> {
        unsafe {
            let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let result = render(target, path, size);
            if initialized {
                CoUninitialize();
            }
            result
        }
    }

    unsafe fn render(target: &IconTarget, path: Option<PathBuf>, size: u32) -> Option<Vec<u8>> {
        let (name, attributes, generic) = match target {
            IconTarget::Folder => ("folder".to_string(), FILE_ATTRIBUTE_DIRECTORY, true),
            IconTarget::Extension(ext) => (if ext.is_empty() { "file".into() } else { format!("file.{ext}") }, FILE_ATTRIBUTE_NORMAL, true),
            IconTarget::File(_) => (path?.to_string_lossy().into_owned(), FILE_FLAGS_AND_ATTRIBUTES(0), false),
        };
        let wide: Vec<u16> = std::ffi::OsStr::new(&name).encode_wide().chain([0]).collect();
        let mut flags = if generic { SHGFI_USEFILEATTRIBUTES } else { SHGFI_FLAGS(0) };
        let shortcut = name.to_lowercase().ends_with(".lnk");
        if shortcut {
            flags |= SHGFI_LINKOVERLAY;
        }
        let mut info = SHFILEINFOW::default();
        let icon = if size <= 32 {
            flags |= SHGFI_ICON | if size <= 16 { SHGFI_SMALLICON } else { SHGFI_LARGEICON };
            if SHGetFileInfoW(PCWSTR(wide.as_ptr()), attributes, Some(&mut info), std::mem::size_of::<SHFILEINFOW>() as u32, flags) == 0 {
                return None;
            }
            info.hIcon
        } else {
            // 큰 이미지 목록에서는 바로 가기 화살표를 오버레이 번호로 직접 그린다(INDEXTOOVERLAYMASK).
            let overlay = if shortcut { SHGFI_OVERLAYINDEX } else { SHGFI_FLAGS(0) };
            if SHGetFileInfoW(PCWSTR(wide.as_ptr()), attributes, Some(&mut info), std::mem::size_of::<SHFILEINFOW>() as u32, (flags & !SHGFI_LINKOVERLAY) | SHGFI_SYSICONINDEX | overlay) == 0 {
                return None;
            }
            let (index, overlay_index) = if shortcut { (info.iIcon & 0x00FF_FFFF, ((info.iIcon as u32) >> 24) & 0x0F) } else { (info.iIcon, 0) };
            let list: IImageList = SHGetImageList(if size <= 48 { SHIL_EXTRALARGE } else { SHIL_JUMBO } as i32).ok()?;
            list.GetIcon(index, ILD_TRANSPARENT.0 | (overlay_index << 8)).ok()?
        };
        if icon.is_invalid() {
            return None;
        }
        let pixels = icon_pixels(icon);
        let _ = DestroyIcon(icon);
        let (mut width, mut height, mut rgba) = pixels?;
        // 큰 아이콘이 없는 형식은 256 캔버스의 왼쪽 위에만 그려지므로, 그림 영역을 정사각형 가운데로 옮긴다.
        if width == 256 && height == 256 {
            let (mut left, mut top, mut right, mut bottom) = (width, height, 0, 0);
            for (i, pixel) in rgba.chunks(4).enumerate() {
                if pixel[3] > 0 {
                    let (x, y) = (i % width, i / width);
                    left = left.min(x);
                    top = top.min(y);
                    right = right.max(x + 1);
                    bottom = bottom.max(y + 1);
                }
            }
            if right > left && bottom > top && right <= 64 && bottom <= 64 {
                let side = (right - left).max(bottom - top);
                let mut square = vec![0u8; side * side * 4];
                let (dx, dy) = ((side - (right - left)) / 2, (side - (bottom - top)) / 2);
                for y in top..bottom {
                    let from = (y * width + left) * 4;
                    let to = ((y - top + dy) * side + dx) * 4;
                    square[to..to + (right - left) * 4].copy_from_slice(&rgba[from..from + (right - left) * 4]);
                }
                rgba = square;
                width = side;
                height = side;
            }
        }
        let image = image::RgbaImage::from_raw(width as u32, height as u32, rgba)?;
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image).write_to(&mut png, image::ImageFormat::Png).ok()?;
        Some(png.into_inner())
    }

    // HICON의 색상·마스크 비트맵을 투명도가 있는 RGBA 픽셀로 읽는다.
    unsafe fn icon_pixels(icon: HICON) -> Option<(usize, usize, Vec<u8>)> {
        let mut info = ICONINFO::default();
        GetIconInfo(icon, &mut info).ok()?;
        let read = |bitmap: windows::Win32::Graphics::Gdi::HBITMAP, width: i32, height: i32| -> Option<Vec<u8>> {
            let mut header = BITMAPINFO::default();
            header.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            };
            let mut buffer = vec![0u8; (width * height * 4) as usize];
            let dc = GetDC(None);
            let lines = GetDIBits(dc, bitmap, 0, height as u32, Some(buffer.as_mut_ptr().cast()), &mut header, DIB_RGB_COLORS);
            ReleaseDC(None, dc);
            (lines == height).then_some(buffer)
        };
        let mut bitmap = BITMAP::default();
        let result = (|| {
            if info.hbmColor.is_invalid() {
                return None;
            }
            GetObjectW(HGDIOBJ(info.hbmColor.0), std::mem::size_of::<BITMAP>() as i32, Some((&mut bitmap as *mut BITMAP).cast()));
            let (width, height) = (bitmap.bmWidth, bitmap.bmHeight);
            if width <= 0 || height <= 0 || width > 512 || height > 512 {
                return None;
            }
            let mut pixels = read(info.hbmColor, width, height)?;
            if pixels.chunks(4).all(|p| p[3] == 0) {
                // 알파가 없는 오래된 아이콘은 마스크 비트맵으로 투명 영역을 정한다.
                let mask = read(info.hbmMask, width, height)?;
                for (pixel, mask) in pixels.chunks_mut(4).zip(mask.chunks(4)) {
                    pixel[3] = if mask[0] == 0 { 255 } else { 0 };
                }
            }
            for pixel in pixels.chunks_mut(4) {
                pixel.swap(0, 2);
            }
            Some((width as usize, height as usize, pixels))
        })();
        if !info.hbmColor.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(info.hbmColor.0));
        }
        if !info.hbmMask.is_invalid() {
            let _ = DeleteObject(HGDIOBJ(info.hbmMask.0));
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_icon_addresses_and_rejects_unsafe_values() {
        assert_eq!(parse("/32/folder/").unwrap(), IconRequest { size: 32, target: IconTarget::Folder });
        assert_eq!(parse("20/ext/PDF").unwrap(), IconRequest { size: 32, target: IconTarget::Extension("pdf".into()) });
        assert_eq!(parse("999/ext/").unwrap().size, 256);
        let file = parse("/48/file/root%3A1/%ED%8F%B4%EB%8D%94/a.exe").unwrap();
        assert_eq!(file.target, IconTarget::File(Location { root_id: "root:1".into(), path: "폴더/a.exe".into() }));
        assert!(parse("32/ext/../../x").is_err());
        assert!(parse("abc/ext/pdf").is_err());
        assert!(parse("32/other/x").is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn renders_mac_type_icons_as_png() {
        let png = native_png(&IconTarget::Extension("pdf".into()), None, 32).expect("pdf 아이콘");
        assert_eq!(&png[1..4], b"PNG");
        let folder = native_png(&IconTarget::Folder, None, 48).expect("폴더 아이콘");
        assert_eq!(&folder[1..4], b"PNG");
    }
}

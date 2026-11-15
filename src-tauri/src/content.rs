// 본문 검색: 설정에서 켜면 연결 폴더의 문서 글자를 뽑아 메모리 색인에 두고,
// 앱 데이터의 content-index.bin에 압축해 저장한다. 끄면 색인과 파일을 지운다.
use crate::store::Engine;
use flate2::{read::ZlibDecoder, write::ZlibEncoder, Compression};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

// 글자를 그대로 읽는 형식
const TEXT_TYPES: &[&str] = &[
    "txt", "md", "markdown", "csv", "tsv", "log", "json", "xml", "html", "htm", "css", "js", "jsx", "ts", "tsx", "py", "rs", "go", "java", "kt",
    "swift", "c", "h", "cpp", "hpp", "cs", "sh", "bat", "ps1", "yml", "yaml", "ini", "toml", "sql", "rtf",
];
// 압축 안의 XML에서 글자를 뽑는 형식
const OFFICE_TYPES: &[&str] = &["docx", "xlsx", "pptx", "hwpx"];
// 파일 하나의 최대 크기와 뽑아 둘 최대 글자 바이트
const MAX_FILE: u64 = 20 * 1024 * 1024;
const MAX_TEXT: usize = 64 * 1024;
// 전체 본문 색인 한도(메모리)
const MAX_TOTAL: usize = 256 * 1024 * 1024;

// 본문 색인 대상 확장자인지 확인한다.
pub fn supported(extension: &str) -> bool {
    TEXT_TYPES.contains(&extension) || OFFICE_TYPES.contains(&extension) || extension == "pdf"
}

// UTF-8·UTF-16(BOM)·CP949(완성형 한글) 순서로 바이트를 글자로 바꾼다.
pub fn decode(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little = bytes[0] == 0xff;
        let units: Vec<u16> = bytes[2..].chunks(2).filter(|p| p.len() == 2).map(|p| if little { u16::from_le_bytes([p[0], p[1]]) } else { u16::from_be_bytes([p[0], p[1]]) }).collect();
        return String::from_utf16_lossy(&units);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        // 잘린 끝(여러 바이트 글자의 중간)만 틀렸으면 UTF-8로 본다.
        Err(error) if error.error_len().is_none() => String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned(),
        Err(_) => cp949(bytes).unwrap_or_else(|| String::from_utf8_lossy(bytes).into_owned()),
    }
}

// 운영체제 변환기로 CP949(EUC-KR 확장) 바이트를 바꾼다.
#[cfg(target_os = "macos")]
fn cp949(bytes: &[u8]) -> Option<String> {
    use objc2::AllocAnyThread;
    use objc2_foundation::{NSData, NSString};
    // kCFStringEncodingDOSKorean(0x0422)을 NSStringEncoding으로 바꾼 값
    const KOREAN: usize = 0x8000_0422;
    let data = NSData::with_bytes(bytes);
    let text = NSString::initWithData_encoding(NSString::alloc(), &data, KOREAN)?;
    Some(text.to_string())
}

#[cfg(windows)]
fn cp949(bytes: &[u8]) -> Option<String> {
    use windows_sys::Win32::Globalization::MultiByteToWideChar;
    if bytes.is_empty() || bytes.len() > i32::MAX as usize {
        return None;
    }
    // SAFETY: 길이를 함께 넘기고, 첫 호출로 구한 크기만큼 버퍼를 만든다.
    unsafe {
        let size = MultiByteToWideChar(949, 0, bytes.as_ptr(), bytes.len() as i32, std::ptr::null_mut(), 0);
        if size <= 0 {
            return None;
        }
        let mut wide = vec![0u16; size as usize];
        MultiByteToWideChar(949, 0, bytes.as_ptr(), bytes.len() as i32, wide.as_mut_ptr(), size);
        Some(String::from_utf16_lossy(&wide))
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn cp949(_bytes: &[u8]) -> Option<String> {
    None
}

// XML에서 태그를 빼고 글자만 남긴다. 문단·셀 끝은 줄바꿈으로 둔다.
pub fn xml_text(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len() / 3);
    let mut rest = xml;
    while let Some(start) = rest.find('<') {
        entities(&rest[..start], &mut out);
        let Some(end) = rest[start..].find('>') else { break };
        let tag = &rest[start + 1..start + end];
        // 문단(w:p, a:p, hp:p, text:p)·표 셀·줄바꿈·탭은 낱말이 붙지 않도록 띄운다.
        let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("");
        let local = name.rsplit(':').next().unwrap_or(name);
        if (tag.starts_with('/') && ["p", "tc", "si", "c", "row", "tr", "td", "li"].contains(&local)) || ["br", "tab", "cr", "lineBreak"].contains(&local) {
            if !out.ends_with('\n') {
                out.push('\n');
            }
        }
        rest = &rest[start + end + 1..];
    }
    entities(rest, &mut out);
    out
}

// XML 문자 참조(&amp; &#44228; 등)를 풀어 덧붙인다.
fn entities(text: &str, out: &mut String) {
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        let Some(end) = tail.find(';').filter(|e| *e <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let name = &tail[1..end];
        let value = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if name.starts_with("#x") => u32::from_str_radix(&name[2..], 16).ok().and_then(char::from_u32),
            _ if name.starts_with('#') => name[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match value {
            Some(c) => out.push(c),
            None => out.push_str(&tail[..=end]),
        }
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
}

// docx·xlsx·pptx·hwpx 압축에서 본문 XML을 골라 글자를 뽑는다.
fn office(path: &Path, extension: &str) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut names: Vec<String> = archive
        .file_names()
        .filter(|name| match extension {
            "docx" => name.starts_with("word/") && (name.ends_with("document.xml") || name.contains("/header") || name.contains("/footer") || name.ends_with("footnotes.xml")),
            "xlsx" => *name == "xl/sharedStrings.xml" || (name.starts_with("xl/worksheets/sheet") && name.ends_with(".xml")),
            "pptx" => name.starts_with("ppt/slides/slide") && name.ends_with(".xml"),
            "hwpx" => name.starts_with("Contents/section") && name.ends_with(".xml"),
            _ => false,
        })
        .map(str::to_owned)
        .collect();
    // 슬라이드·구역은 번호 순서대로 읽는다.
    names.sort_by_key(|name| (name.len(), name.clone()));
    let mut out = String::new();
    for name in names {
        let mut entry = archive.by_name(&name).map_err(|e| e.to_string())?;
        let mut xml = String::new();
        // 압축 폭탄을 막으려고 항목 하나는 16MB까지만 읽는다.
        (&mut entry).take(16 * 1024 * 1024).read_to_string(&mut xml).map_err(|e| e.to_string())?;
        out.push_str(&xml_text(&xml));
        out.push('\n');
        if out.len() >= MAX_TEXT {
            break;
        }
    }
    Ok(out)
}

// 파일 하나의 본문을 검색용(소문자·NFC)으로 뽑는다. 너무 크면 앞부분만 둔다.
pub fn extract(path: &Path, extension: &str) -> Result<String, String> {
    let text = if OFFICE_TYPES.contains(&extension) {
        office(path, extension)?
    } else if extension == "pdf" {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        crate::pdf_text::extract(&bytes, MAX_TEXT)
    } else {
        let mut bytes = vec![];
        std::fs::File::open(path).map_err(|e| e.to_string())?.take(MAX_TEXT as u64 * 2).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        decode(&bytes)
    };
    // 연속 공백을 하나로 줄여 색인 크기를 줄인다.
    let mut compact = String::with_capacity(text.len().min(MAX_TEXT));
    for word in text.split_whitespace() {
        if compact.len() + word.len() + 1 > MAX_TEXT {
            break;
        }
        if !compact.is_empty() {
            compact.push(' ');
        }
        compact.push_str(word);
    }
    Ok(crate::search::normalize(&compact))
}

// 저장 파일 한 줄: 항목 id, 수정 시각, 크기, 본문
#[derive(Serialize, Deserialize)]
struct Saved {
    id: String,
    modified: u64,
    size: u64,
    text: String,
}

// 본문 색인 작업 상태
#[derive(Default)]
pub struct ContentState {
    pub enabled: AtomicBool,
    running: AtomicBool,
    // 색인한 항목 id → (수정 시각, 크기)
    known: Mutex<HashMap<String, (u64, u64)>>,
    pub pending: AtomicUsize,
    pub failed: AtomicUsize,
    // 색인한 원본 파일 크기 합
    source_bytes: AtomicUsize,
    wake: Mutex<bool>,
    signal: std::sync::Condvar,
}

// 저장 파일 위치
fn saved_path(engine: &Engine) -> std::path::PathBuf {
    engine.data.join("content-index.bin")
}

// 본문 색인을 켜거나 끈다. 끄면 메모리와 저장 파일을 지운다.
pub fn set_enabled(engine: &Arc<Engine>, enabled: bool) {
    let state = &engine.content;
    let before = state.enabled.swap(enabled, Ordering::SeqCst);
    if !enabled {
        state.known.lock().unwrap().clear();
        state.source_bytes.store(0, Ordering::SeqCst);
        state.pending.store(0, Ordering::SeqCst);
        engine.store.lock().unwrap().index.set_content(HashMap::new());
        let _ = std::fs::remove_file(saved_path(engine));
        wake(engine);
        return;
    }
    if !before && !state.running.swap(true, Ordering::SeqCst) {
        let engine = engine.clone();
        let _ = std::thread::Builder::new().name("content-index".into()).spawn(move || worker(engine));
    } else {
        wake(engine);
    }
}

// 작업 스레드를 바로 깨워 변경을 반영한다.
pub fn wake(engine: &Engine) {
    *engine.content.wake.lock().unwrap() = true;
    engine.content.signal.notify_all();
}

// 저장해 둔 본문 색인을 읽어 메모리 색인에 넣는다.
fn load(engine: &Engine) {
    let Ok(file) = std::fs::File::open(saved_path(engine)) else { return };
    let mut json = String::new();
    if ZlibDecoder::new(file).read_to_string(&mut json).is_err() {
        return;
    }
    let Ok(saved) = serde_json::from_str::<Vec<Saved>>(&json) else { return };
    let mut known = engine.content.known.lock().unwrap();
    let mut texts = HashMap::with_capacity(saved.len());
    let mut bytes = 0usize;
    for item in saved {
        bytes += item.size as usize;
        known.insert(item.id.clone(), (item.modified, item.size));
        texts.insert(item.id, item.text);
    }
    engine.content.source_bytes.store(bytes, Ordering::SeqCst);
    engine.store.lock().unwrap().index.set_content(texts);
}

// 메모리 색인을 압축해 저장한다.
fn save(engine: &Engine) -> Result<(), String> {
    let saved: Vec<Saved> = {
        let known = engine.content.known.lock().unwrap();
        let store = engine.store.lock().unwrap();
        store
            .index
            .content_entries()
            .filter_map(|(id, text)| known.get(id).map(|(modified, size)| Saved { id: id.clone(), modified: *modified, size: *size, text: text.clone() }))
            .collect()
    };
    let path = saved_path(engine);
    let mut file = tempfile::NamedTempFile::new_in(&engine.data).map_err(|e| e.to_string())?;
    {
        let mut encoder = ZlibEncoder::new(file.as_file_mut(), Compression::default());
        serde_json::to_writer(&mut encoder, &saved).map_err(|e| e.to_string())?;
        encoder.finish().map_err(|e| e.to_string())?.flush().map_err(|e| e.to_string())?;
    }
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}

// 색인 항목과 본문 색인을 비교해 새로 뽑을 문서와 지울 문서를 고른다.
fn plan(engine: &Engine) -> (Vec<(String, std::path::PathBuf, String, u64, u64)>, Vec<String>) {
    let store = engine.store.lock().unwrap();
    let roots: HashMap<String, String> = store.snapshots.iter().map(|s| (s.root.id.clone(), s.root.absolute_path.clone())).collect();
    let known = engine.content.known.lock().unwrap();
    let mut todo = vec![];
    let mut seen = std::collections::HashSet::new();
    for entry in &store.index.entries {
        if entry.kind != "file" || !supported(&entry.extension) || entry.size.unwrap_or(0) > MAX_FILE {
            continue;
        }
        let Some(root) = roots.get(&entry.root_id) else { continue };
        seen.insert(entry.id.as_str());
        let size = entry.size.unwrap_or(0);
        if known.get(&entry.id) != Some(&(entry.modified, size)) {
            todo.push((entry.id.clone(), Path::new(root).join(&entry.path), entry.extension.clone(), entry.modified, size));
        }
    }
    let removed = known.keys().filter(|id| !seen.contains(id.as_str())).cloned().collect();
    (todo, removed)
}

// 본문 색인 작업 스레드: 처음에 저장본을 읽고, 이후 변경을 주기적으로 반영한다.
fn worker(engine: Arc<Engine>) {
    let _ = engine.wait_ready();
    if engine.content.enabled.load(Ordering::SeqCst) {
        load(&engine);
    }
    let mut dirty = false;
    let mut last_save = Instant::now();
    loop {
        if engine.content.enabled.load(Ordering::SeqCst) {
            let (todo, removed) = plan(&engine);
            engine.content.pending.store(todo.len(), Ordering::SeqCst);
            if !removed.is_empty() {
                let mut known = engine.content.known.lock().unwrap();
                for id in &removed {
                    if let Some((_, size)) = known.remove(id) {
                        engine.content.source_bytes.fetch_sub(size as usize, Ordering::SeqCst);
                    }
                }
                drop(known);
                engine.store.lock().unwrap().index.update_content(&removed, vec![]);
                dirty = true;
            }
            // 100개씩 뽑아 넣어서 진행 중에도 검색할 수 있게 한다.
            for chunk in todo.chunks(100) {
                if !engine.content.enabled.load(Ordering::SeqCst) {
                    break;
                }
                let mut added = vec![];
                let mut stamps = vec![];
                for (id, path, extension, modified, size) in chunk {
                    match extract(path, extension) {
                        Ok(text) => added.push((id.clone(), text)),
                        // 읽지 못한 문서(암호·손상)도 같은 버전은 다시 시도하지 않는다.
                        Err(_) => {
                            engine.content.failed.fetch_add(1, Ordering::SeqCst);
                            added.push((id.clone(), String::new()));
                        }
                    }
                    stamps.push((id.clone(), (*modified, *size)));
                }
                let total: usize = engine.store.lock().unwrap().index.content_size().1;
                if total > MAX_TOTAL {
                    break;
                }
                {
                    let mut known = engine.content.known.lock().unwrap();
                    for (id, stamp) in stamps {
                        if let Some((_, old)) = known.insert(id, stamp) {
                            engine.content.source_bytes.fetch_sub(old as usize, Ordering::SeqCst);
                        }
                        engine.content.source_bytes.fetch_add(stamp.1 as usize, Ordering::SeqCst);
                    }
                }
                engine.store.lock().unwrap().index.update_content(&[], added);
                engine.content.pending.fetch_sub(chunk.len().min(engine.content.pending.load(Ordering::SeqCst)), Ordering::SeqCst);
                dirty = true;
            }
            engine.content.pending.store(0, Ordering::SeqCst);
            if dirty && (last_save.elapsed() > Duration::from_secs(30) || plan(&engine).0.is_empty()) {
                let _ = save(&engine);
                dirty = false;
                last_save = Instant::now();
            }
        }
        // 15초마다 또는 깨울 때까지 기다린다.
        let guard = engine.content.wake.lock().unwrap();
        let (mut guard, _) = engine.content.signal.wait_timeout_while(guard, Duration::from_secs(15), |woken| !*woken).unwrap();
        *guard = false;
    }
}

// 설정 화면에 보여 줄 본문 색인 상태
pub fn status(engine: &Engine) -> Value {
    let (documents, text_bytes) = engine.store.lock().unwrap().index.content_size();
    let disk = std::fs::metadata(saved_path(engine)).map(|m| m.len()).unwrap_or(0);
    json!({
        "enabled": engine.content.enabled.load(Ordering::SeqCst),
        "documents": documents,
        "textBytes": text_bytes,
        "diskBytes": disk,
        "sourceBytes": engine.content.source_bytes.load(Ordering::SeqCst),
        "pending": engine.content.pending.load(Ordering::SeqCst),
        "failed": engine.content.failed.load(Ordering::SeqCst),
    })
}

// macOS Spotlight(mdfind)로 연결 폴더 안에서 본문이 일치하는 파일 경로를 찾는다.
#[cfg(target_os = "macos")]
pub fn spotlight(roots: &[String], term: &str) -> Vec<std::path::PathBuf> {
    let term: String = term.chars().filter(|c| !matches!(c, '"' | '\\' | '*')).collect();
    if term.trim().is_empty() {
        return vec![];
    }
    let mut found = vec![];
    for root in roots {
        let Ok(output) = std::process::Command::new("/usr/bin/mdfind")
            .arg("-onlyin")
            .arg(root)
            .arg(format!("kMDItemTextContent == \"*{term}*\"cd"))
            .output()
        else {
            continue;
        };
        found.extend(String::from_utf8_lossy(&output.stdout).lines().filter(|line| !line.is_empty()).map(std::path::PathBuf::from).take(5000));
    }
    found
}

#[cfg(not(target_os = "macos"))]
pub fn spotlight(_roots: &[String], _term: &str) -> Vec<std::path::PathBuf> {
    vec![]
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    // 압축 안에 XML 하나를 넣은 시험 문서를 만든다.
    fn office_file(dir: &Path, name: &str, inner: &str, xml: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        writer.start_file(inner, SimpleFileOptions::default()).unwrap();
        writer.write_all(xml.as_bytes()).unwrap();
        writer.finish().unwrap();
        path
    }

    #[test]
    fn extracts_office_documents_and_text() {
        let dir = tempfile::tempdir().unwrap();
        let docx = office_file(dir.path(), "a.docx", "word/document.xml", r#"<w:document><w:body><w:p><w:r><w:t>계약 </w:t></w:r><w:r><w:t>해지</w:t></w:r></w:p><w:p><w:r><w:t>조건 &amp; 위약금</w:t></w:r></w:p></w:body></w:document>"#);
        assert_eq!(extract(&docx, "docx").unwrap(), "계약 해지 조건 & 위약금");
        let xlsx = office_file(dir.path(), "a.xlsx", "xl/sharedStrings.xml", r#"<sst><si><t>Invoice</t></si><si><t>합계</t></si></sst>"#);
        assert_eq!(extract(&xlsx, "xlsx").unwrap(), "invoice 합계");
        let pptx = office_file(dir.path(), "a.pptx", "ppt/slides/slide1.xml", r#"<p:sld><a:p><a:r><a:t>분기 실적</a:t></a:r></a:p></p:sld>"#);
        assert_eq!(extract(&pptx, "pptx").unwrap(), "분기 실적");
        let hwpx = office_file(dir.path(), "a.hwpx", "Contents/section0.xml", r#"<hs:sec><hp:p><hp:run><hp:t>설계 검토</hp:t></hp:run></hp:p></hs:sec>"#);
        assert_eq!(extract(&hwpx, "hwpx").unwrap(), "설계 검토");
        let text = dir.path().join("a.txt");
        std::fs::write(&text, "  여러   줄\n\n본문\n").unwrap();
        assert_eq!(extract(&text, "txt").unwrap(), "여러 줄 본문");
    }

    #[test]
    fn decodes_utf16_and_cp949() {
        let utf16: Vec<u8> = [0xff, 0xfe].into_iter().chain("계약".encode_utf16().flat_map(u16::to_le_bytes)).collect();
        assert_eq!(decode(&utf16), "계약");
        // "계약 해지"의 CP949 바이트
        let korean = [0xb0, 0xe8, 0xbe, 0xe0, 0x20, 0xc7, 0xd8, 0xc1, 0xf6];
        if cfg!(any(windows, target_os = "macos")) {
            assert_eq!(decode(&korean), "계약 해지");
        }
    }
}

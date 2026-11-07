// 파일·폴더를 uuencode 텍스트로 바꾸고(폴더는 ZIP으로 묶은 뒤), uudecode로 되살린다.
// 큰 파일도 화면이 멈추지 않도록 백그라운드에서 실행하고 진행률을 ed-job 이벤트로 보낸다.
use crate::{model::Location, operations::validate_name, store::Engine};
use serde_json::json;
use std::{
    collections::HashSet,
    fs::File,
    io::{BufRead, BufReader, BufWriter, Read, Write},
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tauri::{Emitter, Manager, State};

/// 한 줄에 담는 원본 바이트 수(uuencode 표준).
const LINE_BYTES: usize = 45;

// 실행 중인 작업 번호와 취소 요청을 보관한다.
#[derive(Default)]
pub struct Jobs {
    next: AtomicU64,
    cancelled: Mutex<HashSet<u64>>,
}

// 6비트 값을 uuencode 문자로 바꾼다. 0은 공백 대신 `를 써 줄 끝 공백이 잘려도 안전하다.
fn encode_char(value: u8) -> u8 {
    if value == 0 { b'`' } else { value + 32 }
}

// uuencode 문자를 6비트 값으로 되돌린다.
fn decode_char(value: u8) -> u8 {
    value.wrapping_sub(32) & 63
}

// 원본 한 줄(최대 45바이트)을 uuencode 한 줄로 만든다.
pub fn encode_line(chunk: &[u8]) -> Vec<u8> {
    let mut line = Vec::with_capacity(2 + chunk.len().div_ceil(3) * 4);
    line.push(encode_char(chunk.len() as u8));
    for group in chunk.chunks(3) {
        let (a, b, c) = (group[0], *group.get(1).unwrap_or(&0), *group.get(2).unwrap_or(&0));
        for value in [a >> 2, ((a & 3) << 4) | (b >> 4), ((b & 15) << 2) | (c >> 6), c & 63] {
            line.push(encode_char(value));
        }
    }
    line.push(b'\n');
    line
}

// uuencode 한 줄을 원본 바이트로 되돌린다. 끝 공백이 잘린 줄도 받는다.
pub fn decode_line(line: &[u8]) -> Result<Vec<u8>, String> {
    let Some(&first) = line.first() else { return Ok(vec![]) };
    let length = decode_char(first) as usize;
    let body = &line[1..];
    // 필요한 글자보다 2자 넘게 모자라면 줄 끝 공백이 잘린 정도가 아니라 손상된 것이다.
    if body.len() + 2 < (length * 4).div_ceil(3) {
        return Err("uuencode 줄이 너무 짧습니다. 파일이 손상되었을 수 있습니다.".into());
    }
    let value = |index: usize| body.get(index).map_or(0, |&c| decode_char(c));
    let mut output = Vec::with_capacity(length);
    let mut index = 0;
    while output.len() < length {
        let (a, b, c, d) = (value(index), value(index + 1), value(index + 2), value(index + 3));
        for byte in [(a << 2) | (b >> 4), (b << 4) | (c >> 2), (c << 6) | d] {
            if output.len() < length {
                output.push(byte);
            }
        }
        index += 4;
    }
    Ok(output)
}

// 진행률을 너무 자주 보내지 않도록 0.1초마다 한 번만 알린다.
struct Progress<'a> {
    app: &'a tauri::AppHandle,
    id: u64,
    kind: &'a str,
    name: &'a str,
    total: u64,
    last: Instant,
}
impl Progress<'_> {
    fn send(&mut self, done: u64, state: &str, force: bool) {
        if force || self.last.elapsed().as_millis() >= 100 {
            self.last = Instant::now();
            let _ = self.app.emit("ed-job", json!({"id":self.id,"kind":self.kind,"name":self.name,"done":done,"total":self.total,"state":state}));
        }
    }
}

// 원본 파일을 uuencode로 써 내려간다. 취소되면 Err("cancelled")를 돌려준다.
// tick은 읽은 바이트 수를 받아 진행률을 알리고, 취소되었으면 Err를 돌려준다.
fn encode_file(source: &Path, header: &str, output: &mut impl Write, tick: &mut dyn FnMut(u64) -> Result<(), String>) -> Result<(), String> {
    let mut reader = BufReader::with_capacity(1 << 16, File::open(source).map_err(|e| e.to_string())?);
    writeln!(output, "begin 644 {header}").map_err(|e| e.to_string())?;
    let mut chunk = [0u8; LINE_BYTES];
    let mut done = 0u64;
    loop {
        // 한 줄 분량을 끝까지 채워 읽는다(마지막 줄만 짧다).
        let mut filled = 0;
        while filled < LINE_BYTES {
            let read = reader.read(&mut chunk[filled..]).map_err(|e| e.to_string())?;
            if read == 0 { break; }
            filled += read;
        }
        if filled == 0 { break; }
        output.write_all(&encode_line(&chunk[..filled])).map_err(|e| e.to_string())?;
        done += filled as u64;
        if done % (LINE_BYTES as u64 * 512) == 0 {
            tick(done)?;
        }
    }
    output.write_all(b"`\nend\n").map_err(|e| e.to_string())
}

// uuencode 텍스트에서 begin~end 사이를 원본으로 되돌린다. 앞뒤의 메일 머리글 같은 다른 줄은 건너뛴다.
fn decode_file(source: &Path, output: &mut impl Write, tick: &mut dyn FnMut(u64) -> Result<(), String>) -> Result<String, String> {
    let mut reader = BufReader::with_capacity(1 << 16, File::open(source).map_err(|e| e.to_string())?);
    let (mut line, mut done, mut header, mut lines) = (Vec::new(), 0u64, None::<String>, 0u64);
    loop {
        line.clear();
        let read = reader.read_until(b'\n', &mut line).map_err(|e| e.to_string())?;
        if read == 0 { break; }
        done += read as u64;
        while matches!(line.last(), Some(b'\n' | b'\r')) { line.pop(); }
        match &header {
            None => {
                if let Some(rest) = line.strip_prefix(b"begin ") {
                    let text = String::from_utf8_lossy(rest).to_string();
                    let name = text.split_once(' ').map(|(_, name)| name.trim().to_string()).unwrap_or_default();
                    header = Some(name);
                }
            }
            Some(name) => {
                if line == b"end" { return Ok(name.clone()); }
                output.write_all(&decode_line(&line)?).map_err(|e| e.to_string())?;
                lines += 1;
                if lines % 512 == 0 {
                    tick(done)?;
                }
            }
        }
    }
    Err(if header.is_some() { "end 줄이 없습니다. 파일이 중간에 끊겼을 수 있습니다." } else { "begin 줄을 찾지 못했습니다. uuencode 파일이 아닙니다." }.into())
}

// 작업 하나를 끝까지 실행한다. 결과는 같은 폴더의 임시 파일에 쓴 뒤 다 되면 새 이름으로 옮긴다.
fn run(engine: &Arc<Engine>, kind: &str, source: &Path, target: &Path, progress: &mut Progress, cancelled: &dyn Fn() -> bool) -> Result<(), String> {
    let folder = target.parent().ok_or("저장할 폴더가 없습니다.")?;
    let mut staging = tempfile::Builder::new().prefix(".ed-work-").tempfile_in(folder).map_err(|e| e.to_string())?;
    {
        let mut writer = BufWriter::with_capacity(1 << 16, staging.as_file_mut());
        // 진행률 전송과 취소 확인을 한곳에서 한다.
        let mut tick = |done: u64| -> Result<(), String> {
            if cancelled() { return Err("cancelled".into()); }
            progress.send(done, "running", false);
            Ok(())
        };
        if kind == "uuencode" {
            if source.is_dir() {
                // 폴더는 ZIP 하나로 묶어 그 ZIP을 인코딩한다. 디코딩하면 같은 ZIP이 나온다.
                tick(0)?;
                let packed = tempfile::Builder::new().prefix(".ed-work-").suffix(".zip").tempfile_in(folder).map_err(|e| e.to_string())?;
                crate::operations::zip_sources(&[source.to_path_buf()], packed.path())?;
                let size = packed.as_file().metadata().map_err(|e| e.to_string())?.len();
                let header = format!("{}.zip", source.file_name().unwrap_or_default().to_string_lossy());
                let mut tick = |done: u64| -> Result<(), String> {
                    if cancelled() { return Err("cancelled".into()); }
                    progress.total = size;
                    progress.send(done, "running", false);
                    Ok(())
                };
                tick(0)?;
                encode_file(packed.path(), &header, &mut writer, &mut tick)?;
            } else {
                encode_file(source, &source.file_name().unwrap_or_default().to_string_lossy(), &mut writer, &mut tick)?;
            }
        } else {
            decode_file(source, &mut writer, &mut tick)?;
        }
        writer.flush().map_err(|e| e.to_string())?;
    }
    if std::fs::symlink_metadata(target).is_ok() {
        return Err(format!("같은 이름이 이미 있습니다: {}", target.file_name().unwrap_or_default().to_string_lossy()));
    }
    staging.persist_noclobber(target).map_err(|e| e.error.to_string())?;
    let _ = engine.refresh(&[target.to_path_buf()]);
    Ok(())
}

// uuencode·uudecode 작업을 시작하고 작업 번호를 돌려준다. 결과 파일은 원본과 같은 폴더에 만든다.
#[tauri::command]
pub fn codec_job(window: tauri::WebviewWindow, engine: State<'_, Arc<Engine>>, jobs: State<'_, Arc<Jobs>>, action: String, source: Location, name: String) -> Result<u64, String> {
    if window.label() != "main" {
        return Err("인코딩은 메인 창에서 실행해 주세요.".into());
    }
    if !["uuencode", "uudecode"].contains(&action.as_str()) {
        return Err("지원하지 않는 작업입니다.".into());
    }
    let name = name.trim().to_string();
    validate_name(&name)?;
    let path = engine.resolve(&source)?;
    if action == "uudecode" && !path.is_file() {
        return Err("디코딩할 uuencode 파일 하나를 선택해 주세요.".into());
    }
    let target = path.parent().ok_or("상위 폴더가 없습니다.")?.join(&name);
    if std::fs::symlink_metadata(&target).is_ok() {
        return Err(format!("같은 이름이 이미 있습니다: {name}"));
    }
    let total = if path.is_file() { path.metadata().map_err(|e| e.to_string())?.len() } else { 0 };
    let jobs = jobs.inner().clone();
    let id = jobs.next.fetch_add(1, Ordering::Relaxed) + 1;
    let (engine, app) = (engine.inner().clone(), window.app_handle().clone());
    std::thread::spawn(move || {
        let mut progress = Progress { app: &app, id, kind: &action, name: &name, total, last: Instant::now() };
        progress.send(0, "running", true);
        let cancelled = || jobs.cancelled.lock().unwrap().contains(&id);
        let result = run(&engine, &action, &path, &target, &mut progress, &cancelled);
        jobs.cancelled.lock().unwrap().remove(&id);
        let (state, message) = match &result {
            Ok(()) => ("done", String::new()),
            Err(error) if error == "cancelled" => ("cancelled", String::new()),
            Err(error) => ("error", error.clone()),
        };
        let total = progress.total;
        let _ = app.emit("ed-job", json!({"id":id,"kind":action,"name":name,"done":if state=="done"{total}else{0},"total":total,"state":state,"message":message,"output":target}));
    });
    Ok(id)
}

// 실행 중인 작업에 취소를 요청한다. 다음 확인 지점에서 멈추고 임시 파일을 지운다.
#[tauri::command]
pub fn codec_cancel(jobs: State<'_, Arc<Jobs>>, id: u64) {
    jobs.cancelled.lock().unwrap().insert(id);
}

#[cfg(test)]
mod tests {
    use super::*;

    // 표준 예시: "Cat"은 #0V%T로 인코딩된다.
    #[test]
    fn encodes_known_line() {
        assert_eq!(encode_line(b"Cat"), b"#0V%T\n");
        assert_eq!(decode_line(b"#0V%T").unwrap(), b"Cat");
    }

    // 파일 전체: 여러 줄·빈 파일·CRLF 줄바꿈·앞뒤의 다른 줄이 있어도 원본과 같게 되돌린다.
    #[test]
    fn round_trips_whole_files() {
        let dir = tempfile::tempdir().unwrap();
        for size in [0usize, 1, 45, 46, 100_000] {
            let source = dir.path().join(format!("원본 {size}.bin"));
            let data: Vec<u8> = (0..size).map(|n| (n * 7 % 256) as u8).collect();
            std::fs::write(&source, &data).unwrap();
            let mut encoded = Vec::new();
            encode_file(&source, "원본.bin", &mut encoded, &mut |_| Ok(())).unwrap();
            let text = format!("Subject: 첨부\r\n\r\n{}trailer\r\n", String::from_utf8(encoded).unwrap().replace('\n', "\r\n"));
            let uue = dir.path().join(format!("인코딩 {size}.uue"));
            std::fs::write(&uue, text).unwrap();
            let mut decoded = Vec::new();
            assert_eq!(decode_file(&uue, &mut decoded, &mut |_| Ok(())).unwrap(), "원본.bin");
            assert_eq!(decoded, data, "크기 {size}");
        }
        let broken = dir.path().join("끊김.uue");
        std::fs::write(&broken, "begin 644 a.txt\n#0V%T\n").unwrap();
        assert!(decode_file(&broken, &mut Vec::new(), &mut |_| Ok(())).unwrap_err().contains("end"));
        let plain = dir.path().join("보통.txt");
        std::fs::write(&plain, "hello").unwrap();
        assert!(decode_file(&plain, &mut Vec::new(), &mut |_| Ok(())).unwrap_err().contains("begin"));
        let cancelled = encode_file(&dir.path().join("원본 100000.bin"), "a", &mut Vec::new(), &mut |_| Err("cancelled".into()));
        assert_eq!(cancelled.unwrap_err(), "cancelled");
    }

    // 모든 길이(0~45)와 모든 바이트 값이 그대로 되돌아오고, 줄 끝 공백이 잘려도 복원된다.
    #[test]
    fn round_trips_every_length_and_byte() {
        let data: Vec<u8> = (0..=255u8).cycle().take(300).collect();
        for length in 0..=LINE_BYTES {
            let chunk = &data[..length];
            let line = encode_line(chunk);
            assert_eq!(decode_line(&line[..line.len() - 1]).unwrap(), chunk);
        }
        assert_eq!(decode_line(b"!``").unwrap(), [0]);
        assert_eq!(decode_line(b"!").unwrap(), [0]);
    }
}

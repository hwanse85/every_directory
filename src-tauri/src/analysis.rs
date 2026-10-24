use crate::{
    model::Location,
    store::{excluded, Engine},
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    fs::File,
    io::Read,
    path::PathBuf,
    sync::{atomic::Ordering, Arc},
    time::{Instant, UNIX_EPOCH},
};
use walkdir::WalkDir;

const MAX_FILES: usize = 100_000;
const MAX_HASH_BYTES: u64 = 4 * 1024 * 1024 * 1024;

// 분석할 폴더와 비교할 다른 폴더를 명시적으로 전달한다.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRequest {
    pub action: String,
    pub location: Location,
    pub other: Option<Location>,
}

// 분석 중에 수집한 파일 경로와 읽기 전용 메타데이터다.
struct FileInfo {
    path: PathBuf,
    location: Location,
    relative: String,
    size: u64,
    modified: u64,
}

// 오류나 취소가 발생해도 분석 실행 상태를 해제한다.
struct JobGuard<'a>(&'a Engine);
impl Drop for JobGuard<'_> {
    // 현재 분석만 완료 상태로 바꾼다.
    fn drop(&mut self) {
        self.0.analysis_busy.store(false, Ordering::Relaxed);
    }
}

// 취소와 시간 제한을 긴 디스크 읽기 사이에서도 확인한다.
fn check(engine: &Engine, started: Instant) -> Result<(), String> {
    if engine.analysis_cancel.load(Ordering::Relaxed) {
        return Err("분석을 취소했습니다.".into());
    }
    if started.elapsed().as_secs() >= 120 {
        return Err("분석 시간 120초를 초과했습니다. 더 작은 폴더를 선택해 주세요.".into());
    }
    Ok(())
}

// 파일을 메모리에 통째로 올리지 않고 SHA-256을 계산한다.
fn hash(
    engine: &Engine,
    file: &FileInfo,
    started: Instant,
    read_bytes: &mut u64,
) -> Result<Option<String>, String> {
    if read_bytes.saturating_add(file.size) > MAX_HASH_BYTES {
        return Ok(None);
    }
    let mut input = File::open(&file.path).map_err(|e| e.to_string())?;
    let before = input.metadata().map_err(|e| e.to_string())?;
    if before.len() != file.size {
        return Err("분석 중 파일 크기가 바뀌었습니다. 다시 실행해 주세요.".into());
    }
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        check(engine, started)?;
        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        *read_bytes += count as u64;
        if *read_bytes > MAX_HASH_BYTES {
            return Ok(None);
        }
        digest.update(&buffer[..count]);
    }
    let after = input.metadata().map_err(|e| e.to_string())?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("분석 중 파일 내용이 바뀌었습니다. 다시 실행해 주세요.".into());
    }
    Ok(Some(format!("{:x}", digest.finalize())))
}

// 연결 폴더 안에서 링크와 내부 폴더를 제외한 파일을 수집한다.
fn collect(
    engine: &Engine,
    location: &Location,
    started: Instant,
) -> Result<(Vec<FileInfo>, usize, usize, bool), String> {
    let base = engine.resolve(location)?;
    if !base.is_dir() {
        return Err("분석할 폴더를 선택해 주세요.".into());
    }
    let mut files = vec![];
    let mut directories: usize = 0;
    let mut skipped = 0;
    let mut partial = false;
    for item in WalkDir::new(&base)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            !excluded(entry.path(), &engine.data) && !entry.file_type().is_symlink()
        })
    {
        check(engine, started)?;
        let item = match item {
            Ok(item) => item,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        if item.file_type().is_dir() {
            directories += 1;
            continue;
        }
        if !item.file_type().is_file() {
            continue;
        }
        if files.len() >= MAX_FILES {
            partial = true;
            break;
        }
        let metadata = match item.metadata() {
            Ok(value) => value,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let relative = item
            .path()
            .strip_prefix(&base)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let relative_path = if location.path.is_empty() {
            relative.clone()
        } else {
            format!("{}/{relative}", location.path)
        };
        files.push(FileInfo {
            path: item.path().to_owned(),
            location: Location {
                root_id: location.root_id.clone(),
                path: relative_path,
            },
            relative,
            size: metadata.len(),
            modified: metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |value| value.as_millis() as u64),
        });
        if files.len() % 100 == 0 {
            *engine.analysis_progress.lock().unwrap() =
                json!({"stage":"collect", "files":files.len()});
        }
    }
    Ok((files, directories.saturating_sub(1), skipped, partial))
}

// 분석 결과에서 실제 파일 위치로 이동할 수 있는 행을 만든다.
fn record(file: &FileInfo) -> Value {
    json!({"location":file.location, "name":file.path.file_name().unwrap_or_default().to_string_lossy(), "relative":file.relative, "bytes":file.size, "modified":file.modified})
}

// 폴더 용량·중복 파일·두 폴더의 내용 차이를 읽기 전용으로 분석한다.
pub fn run(engine: &Arc<Engine>, request: AnalysisRequest) -> Result<Value, String> {
    if !["stats", "duplicates", "compare"].contains(&request.action.as_str()) {
        return Err("지원하지 않는 분석입니다.".into());
    }
    if engine
        .analysis_busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("이미 분석 중입니다. 완료하거나 취소한 뒤 다시 실행해 주세요.".into());
    }
    let _guard = JobGuard(engine);
    engine.analysis_cancel.store(false, Ordering::Relaxed);
    *engine.analysis_progress.lock().unwrap() = json!({"stage":"collect","files":0});
    let started = Instant::now();
    let (mut files, directories, skipped, mut partial) =
        collect(engine, &request.location, started)?;
    let bytes: u64 = files.iter().map(|file| file.size).sum();
    let mut read_bytes = 0;
    let result = match request.action.as_str() {
        "stats" => {
            let mut extensions: HashMap<String, (usize, u64)> = HashMap::new();
            for file in &files {
                let extension = file
                    .path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("확장자 없음")
                    .to_lowercase();
                let entry = extensions.entry(extension).or_default();
                entry.0 += 1;
                entry.1 += file.size;
            }
            let mut extensions:Vec<_> = extensions.into_iter().map(|(extension,(count,bytes))|json!({"extension":extension,"count":count,"bytes":bytes})).collect();
            extensions.sort_by_key(|value| {
                std::cmp::Reverse(value["bytes"].as_u64().unwrap_or_default())
            });
            files.sort_by_key(|file| std::cmp::Reverse(file.size));
            json!({"files":files.len(),"directories":directories,"bytes":bytes,"extensions":extensions.into_iter().take(30).collect::<Vec<_>>(),"largest":files.iter().take(30).map(record).collect::<Vec<_>>()})
        }
        "duplicates" => {
            let mut sizes: BTreeMap<u64, Vec<&FileInfo>> = BTreeMap::new();
            for file in &files {
                sizes.entry(file.size).or_default().push(file);
            }
            let mut groups = vec![];
            let mut count = 0;
            let mut displayed = 0;
            let mut display_limited = false;
            let mut wasted = 0;
            let mut unverified = 0;
            for (size, candidates) in sizes {
                if candidates.len() < 2 {
                    continue;
                }
                let mut hashes: BTreeMap<String, Vec<Value>> = BTreeMap::new();
                for file in candidates {
                    check(engine, started)?;
                    if let Some(hash) = hash(engine, file, started, &mut read_bytes)? {
                        hashes.entry(hash).or_default().push(record(file));
                    } else {
                        unverified += 1;
                        partial = true;
                    }
                    *engine.analysis_progress.lock().unwrap() =
                        json!({"stage":"hash","files":files.len(),"readBytes":read_bytes});
                }
                for (sha256, duplicates) in hashes {
                    if duplicates.len() < 2 {
                        continue;
                    }
                    count += 1;
                    wasted += size * (duplicates.len() as u64 - 1);
                    let total_files = duplicates.len();
                    let available = 1000_usize.saturating_sub(displayed);
                    if groups.len() < 100 && available >= 2 {
                        let visible: Vec<_> = duplicates.into_iter().take(available).collect();
                        displayed += visible.len();
                        display_limited |= visible.len() < total_files;
                        groups.push(json!({"sha256":sha256,"bytes":size,"files":visible,"totalFiles":total_files}));
                    } else {
                        display_limited = true;
                    }
                }
            }
            json!({"files":files.len(),"bytes":bytes,"groups":groups,"totalGroups":count,"recoverableBytes":wasted,"unverified":unverified,"displayLimited":display_limited})
        }
        _ => {
            let other = request
                .other
                .as_ref()
                .ok_or("비교할 다른 탐색창의 폴더가 필요합니다.")?;
            let (others, _, other_skipped, other_partial) = collect(engine, other, started)?;
            partial |= other_partial || other_skipped > 0;
            let mut right: BTreeMap<&str, &FileInfo> = others
                .iter()
                .map(|file| (file.relative.as_str(), file))
                .collect();
            let mut rows = vec![];
            let (mut same, mut different, mut left_only, mut right_only, mut unverified) =
                (0, 0, 0, 0, 0);
            for file in &files {
                check(engine, started)?;
                let other = right.remove(file.relative.as_str());
                let status = if let Some(other) = other {
                    if file.size != other.size {
                        different += 1;
                        "different"
                    } else if let (Some(left), Some(right)) = (
                        hash(engine, file, started, &mut read_bytes)?,
                        hash(engine, other, started, &mut read_bytes)?,
                    ) {
                        if left == right {
                            same += 1;
                            "same"
                        } else {
                            different += 1;
                            "different"
                        }
                    } else {
                        unverified += 1;
                        partial = true;
                        "unverified"
                    }
                } else {
                    left_only += 1;
                    "leftOnly"
                };
                if status != "same" && rows.len() < 1000 {
                    rows.push(
                        json!({"status":status,"left":record(file),"right":other.map(record)}),
                    );
                }
                *engine.analysis_progress.lock().unwrap() = json!({"stage":"compare","files":files.len()+others.len(),"readBytes":read_bytes});
            }
            for file in right.values() {
                right_only += 1;
                if rows.len() < 1000 {
                    rows.push(json!({"status":"rightOnly","right":record(file)}));
                }
            }
            json!({"same":same,"different":different,"leftOnly":left_only,"rightOnly":right_only,"unverified":unverified,"rows":rows,"displayLimited":different+left_only+right_only+unverified>1000,"otherSkipped":other_skipped})
        }
    };
    let mut result = result;
    result["partial"] = json!(partial || skipped > 0);
    result["skipped"] = json!(skipped);
    result["elapsed"] = json!(started.elapsed().as_millis());
    result["readBytes"] = json!(read_bytes);
    *engine.analysis_progress.lock().unwrap() = json!({"stage":"done"});
    Ok(result)
}

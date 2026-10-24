use crate::{
    model::{Location, Operation, RenameRule, TrashItem},
    store::{now, write_json, Engine},
};
use image::{imageops::FilterType, GenericImageView, ImageFormat};
use regex::RegexBuilder;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::Arc,
    time::{Instant, UNIX_EPOCH},
};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

// 두 운영체제에서 사용할 수 있는 파일명만 허용한다.
pub fn validate_name(name: &str) -> Result<(), String> {
    let lower = name.to_lowercase();
    let stem = lower.split('.').next().unwrap_or("");
    if name.is_empty()
        || name.len() > 240
        || name.chars().any(|c| c < ' ' || "<>:\"/\\|?*".contains(c))
        || name.ends_with(['.', ' '])
        || ["con", "prn", "aux", "nul", "conin$", "conout$"].contains(&stem)
        || ((stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.chars().count() == 4
            && matches!(stem.chars().nth(3), Some('1'..='9' | '¹' | '²' | '³')))
        || name == ".every-directory-trash"
        || name.starts_with(".ed-work-")
    {
        return Err("파일명에 사용할 수 없는 문자 또는 예약 이름이 있습니다.".into());
    }
    Ok(())
}
// 기존 파일이나 링크를 덮어쓰지 않도록 검사한다.
pub fn unused(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path).is_ok() {
        Err(format!("이미 존재하는 이름입니다: {}", path.display()))
    } else {
        Ok(())
    }
}
// 파일 확장자와 폴더 이름을 보존하고 디스크 및 이번 작업의 예약 이름을 모두 확인한다.
fn copy_target(
    source: &Path,
    destination: &Path,
    reserved: &mut HashSet<String>,
) -> Result<PathBuf, String> {
    let name = source
        .file_name()
        .ok_or("드라이브 전체는 복사할 수 없습니다.")?
        .to_string_lossy();
    validate_name(&name)?;
    let (stem, extension) = if source.is_file() {
        (
            source.file_stem().unwrap().to_string_lossy().to_string(),
            source
                .extension()
                .map(|ext| format!(".{}", ext.to_string_lossy()))
                .unwrap_or_default(),
        )
    } else {
        (name.to_string(), String::new())
    };
    for number in 0..=99999 {
        let candidate = if number == 0 {
            name.to_string()
        } else {
            format!("{stem} ({number}){extension}")
        };
        let target = destination.join(&candidate);
        if reserved.contains(&candidate.to_lowercase()) {
            continue;
        }
        match fs::symlink_metadata(&target) {
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        validate_name(&candidate)?;
        reserved.insert(candidate.to_lowercase());
        return Ok(target);
    }
    Err("사용할 수 있는 사본 이름이 없습니다.".into())
}
// 동일 파일시스템 안에서 기존 대상 없이 이동한다.
fn move_unused(source: &Path, target: &Path) -> Result<(), String> {
    unused(target)?;
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStrExt;
        let from =
            std::ffi::CString::new(source.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        let to =
            std::ffi::CString::new(target.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
        // 운영체제의 배타적 이동으로 검사 이후의 덮어쓰기도 막는다.
        if unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) } != 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        crate::windows_file_ops::rename(source, target).map_err(|error| error.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        fs::rename(source, target).map_err(|e| e.to_string())
    }
}
// 외부 파일이 끼어들지 않도록 새 파일을 생성해 내용을 복사한다.
fn copy_file(source: &Path, target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        // Let Windows optimize local/SMB copies and preserve metadata, without replacement.
        if unsafe {
            windows_sys::Win32::Storage::FileSystem::CopyFileW(from.as_ptr(), to.as_ptr(), 1)
        } == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let mut input = File::open(source).map_err(|e| e.to_string())?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(|e| e.to_string())?;
        std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
        Ok(())
    }
}
// 사용자가 OS 클립보드에 복사한 외부 파일을 기존 파일을 덮어쓰지 않고 가져온다.
pub fn paste_external(
    engine: &Arc<Engine>,
    paths: &[PathBuf],
    location: &Location,
) -> Result<Value, String> {
    if paths.is_empty() || paths.len() > 200 {
        return Err("붙여넣을 파일을 1~200개 선택해 주세요.".into());
    }
    let _operation = engine.operations.lock().unwrap();
    let destination = engine.resolve(location)?;
    if !destination.is_dir() {
        return Err("붙여넣을 폴더를 선택해 주세요.".into());
    }
    let mut sources = vec![];
    for path in paths {
        if fs::symlink_metadata(path)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("심볼릭 링크는 붙여넣기에서 제외합니다.".into());
        }
        let source = path.canonicalize().map_err(|error| error.to_string())?;
        if !sources.contains(&source) {
            sources.push(source);
        }
    }
    let selected = sources.clone();
    sources.retain(|path| {
        !selected
            .iter()
            .any(|parent| parent != path && path.starts_with(parent))
    });
    let mut targets = vec![];
    let mut names = HashSet::new();
    for source in &sources {
        let name = source
            .file_name()
            .ok_or("드라이브 전체는 붙여넣을 수 없습니다.")?;
        validate_name(&name.to_string_lossy())?;
        if source.is_dir() && destination.starts_with(source) {
            return Err("같은 위치나 중복된 이름으로 붙여넣을 수 없습니다.".into());
        }
        let target = copy_target(source, &destination, &mut names)?;
        targets.push(target);
    }
    let mut changed = vec![];
    let result = (|| {
        copy_prepared(&sources, &targets, &mut changed)?;
        Ok(json!({"count":changed.len(),"cut":false}))
    })();
    if !changed.is_empty() {
        engine.refresh(&changed)?;
    }
    result
}

// 선택한 파일을 저장 대화상자의 새 경로에 사본으로 저장한다.
pub fn save_copy(engine: &Engine, location: &Location, destination: &Path) -> Result<(), String> {
    let source = engine.resolve(location)?;
    if !source.is_file() || !destination.is_absolute() {
        return Err("올바른 파일과 저장 경로가 필요합니다.".into());
    }
    let parent = destination.parent().ok_or("저장 폴더가 없습니다.")?;
    let staging = tempfile::Builder::new()
        .prefix(".ed-work-")
        .tempdir_in(parent)
        .map_err(|e| e.to_string())?;
    let output = staging.path().join("result");
    copy_file(&source, &output)?;
    move_unused(&output, destination)
}
// 심볼릭 링크 없이 파일 또는 디렉터리 트리를 복사한다.
fn copy_node(source: &Path, target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::windows_file_ops::transfer(&[(source.into(), target.into())], false)
    }
    #[cfg(not(windows))]
    {
        let metadata = fs::symlink_metadata(source).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("심볼릭 링크는 파일 작업에서 제외합니다.".into());
        }
        if metadata.is_file() {
            return copy_file(source, target);
        }
        if !metadata.is_dir() {
            return Err("일반 파일과 폴더만 처리할 수 있습니다.".into());
        }
        fs::create_dir(target).map_err(|e| e.to_string())?;
        for item in fs::read_dir(source).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            copy_node(&item.path(), &target.join(item.file_name()))?;
        }
        Ok(())
    }
}

// One native batch gives Windows one progress/cancel window for the entire selection.
// Commit completed copies by exclusive same-volume rename; failed copies leave originals intact.
fn copy_prepared(
    sources: &[PathBuf],
    targets: &[PathBuf],
    changed: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if sources.is_empty() {
        return Ok(());
    }
    let destination = targets[0].parent().ok_or("대상 폴더가 없습니다.")?;
    let staging = tempfile::Builder::new()
        .prefix(".ed-work-")
        .tempdir_in(destination)
        .map_err(|error| error.to_string())?;
    let plans: Vec<_> = sources
        .iter()
        .zip(targets)
        .map(|(source, target)| {
            Ok((
                source.clone(),
                staging
                    .path()
                    .join(target.file_name().ok_or("대상 이름이 없습니다.")?),
            ))
        })
        .collect::<Result<_, String>>()?;
    #[cfg(windows)]
    crate::windows_file_ops::transfer(&plans, false)?;
    #[cfg(not(windows))]
    for (source, output) in &plans {
        copy_node(source, output)?;
    }
    for ((_, output), target) in plans.iter().zip(targets) {
        move_unused(output, target)?;
        changed.push(target.clone());
    }
    Ok(())
}

#[cfg(windows)]
fn move_prepared(
    sources: &[PathBuf],
    targets: &[PathBuf],
    changed: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let mut cross_volume = vec![];
    for (source, target) in sources.iter().zip(targets) {
        if source == target {
            continue;
        }
        match crate::windows_file_ops::rename(source, target) {
            Ok(()) => {
                changed.extend([source.clone(), target.clone()]);
            }
            Err(error)
                if error.raw_os_error()
                    == Some(windows_sys::Win32::Foundation::ERROR_NOT_SAME_DEVICE as i32) =>
            {
                cross_volume.push((source.clone(), target.clone()));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    // The Shell can leave completed items on either side when a move is cancelled.
    // Refresh both locations even on failure and keep all partial output visible and intact.
    for (source, target) in &cross_volume {
        changed.extend([source.clone(), target.clone()]);
    }
    crate::windows_file_ops::transfer(&cross_volume, true)
}
// 등록된 루트와 다른 연결 폴더의 상위 항목을 보호한다.
fn protect(engine: &Engine, path: &Path) -> Result<(), String> {
    if engine
        .roots()
        .iter()
        .any(|r| Path::new(&r.absolute_path).starts_with(path))
    {
        return Err("연결 폴더 자체와 다른 연결 폴더의 상위 항목은 변경할 수 없습니다.".into());
    }
    Ok(())
}
// 루트 안에 앱 휴지통을 안전하게 생성한다.
fn trash_dir(root: &Path) -> Result<PathBuf, String> {
    let path = root.join(".every-directory-trash");
    if !path.exists() {
        fs::create_dir(&path).map_err(|e| e.to_string())?;
    }
    if fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
        || !path.is_dir()
    {
        return Err("휴지통 경로가 올바르지 않습니다.".into());
    }
    Ok(path)
}
// 복구 정보를 먼저 기록한 다음 원본을 앱 휴지통으로 옮긴다.
fn trash(engine: &Engine, location: &Location, source: &Path) -> Result<TrashItem, String> {
    protect(engine, source)?;
    let root = engine
        .roots()
        .into_iter()
        .find(|r| r.id == location.root_id)
        .ok_or("연결 폴더가 없습니다.")?;
    let directory = trash_dir(Path::new(&root.absolute_path))?;
    let id = Uuid::new_v4().to_string();
    let item = TrashItem {
        id: id.clone(),
        root_id: root.id,
        path: location.path.clone(),
        name: source.file_name().unwrap().to_string_lossy().to_string(),
        deleted_at: now(),
    };
    let record = directory.join(format!("{id}.json"));
    write_json(&record, &item)?;
    if let Err(error) = move_unused(source, &directory.join(&id)) {
        let _ = fs::remove_file(record);
        return Err(error);
    }
    Ok(item)
}
// 복구할 수 있는 앱 휴지통 항목만 반환한다.
pub fn list_trash(engine: &Engine) -> Result<Vec<TrashItem>, String> {
    let mut result = vec![];
    for root in engine.roots() {
        let directory = Path::new(&root.absolute_path).join(".every-directory-trash");
        if !directory.exists() {
            continue;
        }
        if fs::symlink_metadata(&directory)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            continue;
        }
        for item in fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let path = item.map_err(|e| e.to_string())?.path();
            if path.extension().is_none_or(|e| e != "json") {
                continue;
            }
            if let Ok(item) =
                serde_json::from_slice::<TrashItem>(&fs::read(&path).map_err(|e| e.to_string())?)
            {
                if Uuid::parse_str(&item.id).is_ok()
                    && item.root_id == root.id
                    && directory.join(&item.id).exists()
                {
                    result.push(item);
                }
            }
        }
    }
    result.sort_by_key(|i| std::cmp::Reverse(i.deleted_at));
    Ok(result)
}
// 이름 변경 규칙을 미리 계산하고 중복을 검사한다.
pub fn rename_names(sources: &[PathBuf], rule: &RenameRule) -> Result<Vec<String>, String> {
    if rule.find.len() > 512
        || rule.replace.len() > 240
        || rule.start > 1_000_000
        || !(1..=8).contains(&rule.padding)
    {
        return Err("이름 변경 규칙이 올바르지 않습니다.".into());
    }
    let pattern = if rule.find.is_empty() {
        None
    } else {
        Some(
            RegexBuilder::new(&if rule.regex {
                rule.find.clone()
            } else {
                regex::escape(&rule.find)
            })
            .case_insensitive(!rule.case_sensitive)
            .size_limit(4_000_000)
            .build()
            .map_err(|e| format!("정규식 오류: {e}"))?,
        )
    };
    let mut names = vec![];
    let mut unique = HashSet::new();
    for (i, source) in sources.iter().enumerate() {
        let name = source.file_name().unwrap().to_string_lossy();
        let dot = if source.is_file() && rule.preserve_extension {
            name.rfind('.').filter(|i| *i > 0)
        } else {
            None
        };
        let (stem, extension) = dot.map_or((name.as_ref(), ""), |i| name.split_at(i));
        let replaced = pattern.as_ref().map_or_else(
            || stem.to_string(),
            |p| {
                if rule.regex {
                    p.replace_all(stem, rule.replace.as_str()).to_string()
                } else {
                    p.replace_all(stem, regex::NoExpand(&rule.replace))
                        .to_string()
                }
            },
        );
        let sequence = if rule.number {
            format!("{:0width$}", rule.start + i, width = rule.padding)
        } else {
            String::new()
        };
        let name = format!(
            "{}{replaced}{}{sequence}{extension}",
            rule.prefix, rule.suffix
        );
        validate_name(&name)?;
        if !unique.insert(name.nfc().collect::<String>().to_lowercase()) {
            return Err("변경 후 이름이 중복됩니다.".into());
        }
        names.push(name);
    }
    Ok(names)
}
// 임시 이름을 거쳐 이름 교환을 지원하고 오류 시 원래 이름으로 되돌린다.
fn batch_rename(sources: &[PathBuf], names: &[String]) -> Result<(), String> {
    let targets: Vec<_> = sources
        .iter()
        .zip(names)
        .map(|(p, n)| p.parent().unwrap().join(n))
        .collect();
    for target in &targets {
        let selected = sources.contains(target)
            || target.canonicalize().is_ok_and(|absolute| {
                sources
                    .iter()
                    .any(|source| source.canonicalize().is_ok_and(|p| p == absolute))
            });
        if !selected {
            unused(target)?;
        }
    }
    let staged: Vec<_> = sources
        .iter()
        .map(|p| {
            p.parent()
                .unwrap()
                .join(format!(".ed-work-{}", Uuid::new_v4()))
        })
        .collect();
    let mut staged_count = 0;
    let mut moved_count = 0;
    let result = (|| {
        for (source, stage) in sources.iter().zip(&staged) {
            move_unused(source, stage)?;
            staged_count += 1;
        }
        for (stage, target) in staged.iter().zip(&targets) {
            move_unused(stage, target)?;
            moved_count += 1;
        }
        Ok::<_, String>(())
    })();
    if let Err(error) = result {
        let mut recovery = vec![];
        for i in (0..moved_count).rev() {
            if let Err(e) = move_unused(&targets[i], &staged[i]) {
                recovery.push(e);
            }
        }
        for i in (0..staged_count).rev() {
            if staged[i].exists() {
                if let Err(e) = move_unused(&staged[i], &sources[i]) {
                    recovery.push(e);
                }
            }
        }
        return Err(if recovery.is_empty() {
            error
        } else {
            format!(
                "{error}; 복구하지 못한 임시 파일이 있습니다: {}",
                recovery.join(", ")
            )
        });
    }
    Ok(())
}
// ZIP을 생성하면서 링크와 특수 파일을 거부한다.
fn zip_sources(sources: &[PathBuf], output: &Path) -> Result<(), String> {
    let mut writer = ZipWriter::new(File::create(output).map_err(|e| e.to_string())?);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut names = HashSet::new();
    for source in sources {
        let base = source.parent().ok_or("원본 경로가 올바르지 않습니다.")?;
        for item in WalkDir::new(source)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                !e.path().components().any(|p| {
                    p.as_os_str() == ".every-directory-trash"
                        || p.as_os_str().to_string_lossy().starts_with(".ed-work-")
                })
            })
        {
            let item = item.map_err(|e| e.to_string())?;
            if item.file_type().is_symlink() {
                return Err("링크를 포함한 폴더는 압축할 수 없습니다.".into());
            }
            if item.file_name() == ".every-directory-trash" {
                continue;
            }
            let name = item
                .path()
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if !names.insert(name.to_lowercase()) {
                return Err("압축할 이름이 중복됩니다.".into());
            }
            if item.file_type().is_dir() {
                writer
                    .add_directory(format!("{name}/"), options)
                    .map_err(|e| e.to_string())?;
            } else if item.file_type().is_file() {
                writer
                    .start_file(name, options)
                    .map_err(|e| e.to_string())?;
                std::io::copy(
                    &mut File::open(item.path()).map_err(|e| e.to_string())?,
                    &mut writer,
                )
                .map_err(|e| e.to_string())?;
            } else {
                return Err("일반 파일만 압축할 수 있습니다.".into());
            }
        }
    }
    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}
// 경로 탈출·링크·과도한 압축 해제를 제한한다.
fn unzip(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(File::open(source).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if archive.len() > 10000 {
        return Err("ZIP 항목 수가 10,000개를 초과합니다.".into());
    }
    let mut bytes = 0u64;
    let mut names = HashSet::new();
    for i in 0..archive.len() {
        let mut item = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = item.name().to_string();
        let relative = item
            .enclosed_name()
            .ok_or("ZIP 경로가 폴더 밖을 가리킵니다.")?;
        if name.contains('\\')
            || name.starts_with('/')
            || item.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err("ZIP에 허용하지 않는 경로나 링크가 있습니다.".into());
        }
        for part in relative.components() {
            match part {
                std::path::Component::Normal(s) => validate_name(&s.to_string_lossy())?,
                _ => return Err("ZIP 경로가 올바르지 않습니다.".into()),
            }
        }
        if !names.insert(
            relative
                .to_string_lossy()
                .trim_end_matches('/')
                .to_lowercase(),
        ) {
            return Err("ZIP 항목 이름이 중복됩니다.".into());
        }
        bytes = bytes.checked_add(item.size()).ok_or("ZIP 크기 한도 초과")?;
        if bytes > 500_000_000 {
            return Err("압축 해제 크기는 500MB까지 지원합니다.".into());
        }
        let target = destination.join(relative);
        if item.is_dir() {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
            let mut out = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&target)
                .map_err(|e| e.to_string())?;
            let expected = item.size();
            let copied = std::io::copy(&mut item.by_ref().take(expected + 1), &mut out)
                .map_err(|e| e.to_string())?;
            if copied != expected {
                return Err("ZIP 항목 크기가 올바르지 않습니다.".into());
            }
        }
    }
    Ok(())
}
// 이미지 크기와 형식을 바꾼 사본을 새 폴더에 저장한다.
fn resize(
    sources: &[PathBuf],
    destination: &Path,
    name: &str,
    options: &crate::model::ImageOptions,
) -> Result<Value, String> {
    if sources.is_empty()
        || sources.len() > 50
        || options.width == 0
        || options.height == 0
        || options.width > 8192
        || options.height > 8192
        || u64::from(options.width) * u64::from(options.height) > 40_000_000
        || !["inside", "cover", "fill"].contains(&options.fit.as_str())
    {
        return Err("이미지 크기 또는 처리 개수가 올바르지 않습니다.".into());
    }
    let format = match options.format.as_str() {
        "png" => ImageFormat::Png,
        "jpeg" => ImageFormat::Jpeg,
        "webp" => ImageFormat::WebP,
        _ => return Err("지원하지 않는 출력 형식입니다.".into()),
    };
    let target = destination.join(name);
    unused(&target)?;
    let staging = tempfile::Builder::new()
        .prefix(".ed-work-")
        .tempdir_in(destination)
        .map_err(|e| e.to_string())?;
    let output = staging.path().join("result");
    fs::create_dir(&output).map_err(|e| e.to_string())?;
    let mut names = HashSet::new();
    let mut results = vec![];
    for source in sources {
        if fs::metadata(source).map_err(|e| e.to_string())?.len() > 50_000_000 {
            return Err("이미지는 파일당 50MB까지 지원합니다.".into());
        }
        let reader = image::ImageReader::open(source)
            .map_err(|e| e.to_string())?
            .with_guessed_format()
            .map_err(|e| e.to_string())?;
        let (w, h) = reader
            .into_dimensions()
            .map_err(|e| format!("지원하지 않는 이미지입니다: {e}"))?;
        if u64::from(w) * u64::from(h) > 40_000_000 {
            return Err("이미지는 4천만 화소까지 지원합니다.".into());
        }
        let image = image::open(source).map_err(|e| e.to_string())?;
        let (width, height) = if options.enlarge {
            (options.width, options.height)
        } else {
            (options.width.min(w), options.height.min(h))
        };
        let image = match options.fit.as_str() {
            "fill" => image.resize_exact(width, height, FilterType::Lanczos3),
            "cover" => image.resize_to_fill(width, height, FilterType::Lanczos3),
            _ => image.resize(width, height, FilterType::Lanczos3),
        };
        let filename = format!(
            "{}.{}",
            source.file_stem().unwrap().to_string_lossy(),
            options.format
        );
        validate_name(&filename)?;
        if !names.insert(filename.to_lowercase()) {
            return Err("변환 후 파일 이름이 중복됩니다.".into());
        }
        let (width, height) = image.dimensions();
        let image = if format == ImageFormat::Jpeg {
            image::DynamicImage::ImageRgb8(image.to_rgb8())
        } else {
            image
        };
        image
            .save_with_format(output.join(&filename), format)
            .map_err(|e| e.to_string())?;
        results.push(json!({"name":filename,"width":width,"height":height}));
    }
    move_unused(&output, &target)?;
    Ok(json!({"count":results.len(),"files":results,"directory":target}))
}
// 폴더 속성은 인덱스에서 즉시 계산하고 파일 해시는 요청할 때만 읽는다.
fn properties(engine: &Engine, request: &Operation) -> Result<Value, String> {
    if request.entries.is_empty() || request.entries.len() > 200 {
        return Err("속성을 볼 항목을 1~200개 선택해 주세요.".into());
    }
    let sources = request
        .entries
        .iter()
        .map(|location| engine.resolve(location))
        .collect::<Result<Vec<_>, _>>()?;
    if request.action == "hash" && (sources.len() != 1 || !sources[0].is_file()) {
        return Err("해시를 계산할 파일 하나를 선택해 주세요.".into());
    }
    let mut files = 0usize;
    let mut directories = 0usize;
    let mut bytes = 0u64;
    let mut modified = 0;
    let mut folders = vec![];
    for (location, source) in request.entries.iter().zip(&sources) {
        let metadata = fs::metadata(source).map_err(|e| e.to_string())?;
        modified = modified.max(
            metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |time| time.as_millis() as u64),
        );
        if metadata.is_dir() {
            folders.push(location);
            if location.path.is_empty() {
                directories += 1;
            }
        } else if !request.entries.iter().any(|parent| {
            parent.root_id == location.root_id
                && parent.path != location.path
                && (parent.path.is_empty()
                    || location.path.starts_with(&format!("{}/", parent.path)))
        }) {
            files += 1;
            bytes = bytes.saturating_add(metadata.len());
        }
    }
    let store = engine.store.lock().unwrap();
    for entry in &store.index.entries {
        if folders.iter().any(|folder| {
            folder.root_id == entry.root_id
                && (folder.path.is_empty()
                    || folder.path == entry.path
                    || entry.path.starts_with(&format!("{}/", folder.path)))
        }) {
            if entry.kind == "directory" {
                directories += 1;
            } else {
                files += 1;
                bytes = bytes.saturating_add(entry.size.unwrap_or(0));
            }
        }
    }
    let indexed_at = store
        .snapshots
        .iter()
        .filter(|snapshot| {
            request
                .entries
                .iter()
                .any(|location| location.root_id == snapshot.root.id)
        })
        .map(|snapshot| snapshot.root.last_indexed)
        .min();
    drop(store);
    let hash = if request.action == "hash" {
        let mut input = File::open(&sources[0]).map_err(|e| e.to_string())?;
        let mut digest = Sha256::new();
        let mut buffer = [0; 65536];
        loop {
            let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            digest.update(&buffer[..count]);
        }
        Some(format!("{:x}", digest.finalize()))
    } else {
        None
    };
    Ok(
        json!({"path":crate::file_clipboard::path_text(&sources[0]),"files":files,"directories":directories,"bytes":bytes,"modified":modified,"sha256":hash,"cached":!folders.is_empty(),"indexedAt":indexed_at}),
    )
}

// 셸 문자열 없이 운영체제의 기본 앱 또는 탐색기를 실행한다.
fn native_open(path: &Path, reveal: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/usr/bin/open");
        if reveal {
            command.arg("-R");
        }
        command.arg(path);
        check_opener(&mut command)?;
    }
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::{
            System::Com::{
                CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
                COINIT_DISABLE_OLE1DDE,
            },
            UI::{
                Shell::{SHOpenFolderAndSelectItems, SHParseDisplayName, ShellExecuteW},
                WindowsAndMessaging::SW_SHOWNORMAL,
            },
        };
        let display = crate::file_clipboard::path_text(path);
        let file: Vec<u16> = display.encode_utf16().chain(Some(0)).collect();
        let initialized = unsafe {
            CoInitializeEx(
                std::ptr::null(),
                (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
            )
        };
        // 이미 초기화된 스레드도 사용할 수 있지만 성공한 초기화만 정리한다.
        if initialized < 0 && initialized != 0x80010106u32 as i32 {
            return Err(format!(
                "파일 실행 환경을 초기화하지 못했습니다: {initialized:#x}"
            ));
        }
        let result = if reveal && !path.is_dir() {
            // 명령행의 쉼표·따옴표 해석 없이 실제 파일을 선택한 탐색기를 연다.
            let mut item = std::ptr::null_mut();
            let parsed = unsafe {
                SHParseDisplayName(
                    file.as_ptr(),
                    std::ptr::null_mut(),
                    &mut item,
                    0,
                    std::ptr::null_mut(),
                )
            };
            if parsed < 0 {
                Err(format!("탐색기 경로를 읽지 못했습니다: {parsed:#x}"))
            } else {
                let opened = unsafe { SHOpenFolderAndSelectItems(item, 0, std::ptr::null(), 0) };
                unsafe {
                    CoTaskMemFree(item.cast());
                }
                if opened < 0 {
                    Err(format!("파일 위치를 열지 못했습니다: {opened:#x}"))
                } else {
                    Ok(())
                }
            }
        } else {
            let verb: Vec<u16> = "open\0".encode_utf16().collect();
            let opened = unsafe {
                ShellExecuteW(
                    std::ptr::null_mut(),
                    verb.as_ptr(),
                    file.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    SW_SHOWNORMAL,
                )
            } as isize;
            if opened <= 32 {
                Err(format!("기본 앱 또는 폴더를 열지 못했습니다 (Windows 오류 {opened}). 파일 연결과 접근 권한을 확인해 주세요."))
            } else {
                Ok(())
            }
        };
        if initialized >= 0 {
            unsafe {
                CoUninitialize();
            }
        }
        result?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        check_opener(Command::new("xdg-open").arg(if reveal {
            path.parent().unwrap_or(path)
        } else {
            path
        }))?;
    }
    Ok(())
}
// 앱 정보의 프로젝트·의존성 원본 링크만 브라우저에서 연다.
pub fn open_external_link(value: &str) -> Result<(), String> {
    let url = tauri::Url::parse(value).map_err(|_| "올바른 링크가 아닙니다.")?;
    if url.scheme() != "https"
        || !matches!(
            url.host_str(),
            Some("github.com" | "crates.io" | "registry.npmjs.org")
        )
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("허용되지 않은 외부 링크입니다.".into());
    }
    native_open(Path::new(url.as_str()), false)
}

// 기본 앱 전달 명령의 종료 상태와 오류 메시지를 확인한다.
#[cfg(not(target_os = "windows"))]
fn check_opener(command: &mut Command) -> Result<(), String> {
    let output = command
        .output()
        .map_err(|e| format!("기본 앱을 실행하지 못했습니다: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(format!(
        "기본 앱으로 열지 못했습니다. {}",
        if detail.is_empty() {
            "파일 연결과 접근 권한을 확인해 주세요.".to_owned()
        } else {
            detail.chars().take(500).collect()
        }
    ))
}
// 검증된 연결 폴더 안에서 파일 작업을 직렬 실행한다.
pub fn operate(engine: &Arc<Engine>, request: Operation) -> Result<Value, String> {
    let started = Instant::now();
    if ["properties", "hash"].contains(&request.action.as_str()) {
        return properties(engine, &request);
    }
    if request.action == "terminal" {
        let path = engine.resolve(
            request
                .destination
                .as_ref()
                .ok_or("폴더를 선택해 주세요.")?,
        )?;
        if !path.is_dir() {
            return Err("터미널은 폴더에서 열 수 있습니다.".into());
        }
        #[cfg(target_os = "macos")]
        check_opener(
            Command::new("/usr/bin/open")
                .args(["-a", "Terminal"])
                .arg(&path),
        )?;
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            Command::new("powershell.exe")
                .args(["-NoLogo", "-NoProfile", "-NoExit", "-Command"])
                .arg(windows_terminal_script(&path))
                .creation_flags(0x00000010)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Command::new("x-terminal-emulator")
                .current_dir(&path)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        return Ok(json!({"count":1}));
    }
    // 읽기 전용 실행은 긴 복사나 인덱스 갱신의 작업 잠금을 기다리지 않는다.
    if ["open", "reveal"].contains(&request.action.as_str()) {
        if request.entries.len() != 1 {
            return Err("항목 하나를 선택해 주세요.".into());
        }
        let path = engine.resolve(&request.entries[0])?;
        native_open(&path, request.action == "reveal")?;
        #[cfg(feature = "smoke-test")]
        if request.action == "open" {
            let filename = engine.data.join("native-opens.json");
            let mut opened: Vec<Value> = fs::read(&filename)
                .ok()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                .unwrap_or_default();
            opened.push(json!({"path":path,"accepted":true}));
            fs::write(
                filename,
                serde_json::to_vec_pretty(&opened).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }
        return Ok(json!({"count":1}));
    }
    let _operation = engine.operations.lock().unwrap();
    let acquired = Instant::now();
    if request.entries.len() > 200 {
        return Err("한 번에 200개까지 선택해 주세요.".into());
    }
    let mut locations = vec![];
    let mut sources = vec![];
    for location in &request.entries {
        let source = engine.resolve(location)?;
        if !sources.contains(&source) {
            locations.push(location.clone());
            sources.push(source);
        }
    }
    let selected = sources.clone();
    let filtered: Vec<_> = sources
        .iter()
        .enumerate()
        .filter(|(_, p)| {
            !selected
                .iter()
                .any(|other| other != *p && p.starts_with(other))
        })
        .map(|(i, p)| (locations[i].clone(), p.clone()))
        .collect();
    let locations: Vec<_> = filtered.iter().map(|(l, _)| l.clone()).collect();
    let sources: Vec<_> = filtered.into_iter().map(|(_, p)| p).collect();
    let mut changed = vec![];
    let result = (|| {
        if request.action == "restore" {
            let id = request
                .trash_id
                .as_deref()
                .ok_or("복구 항목을 선택해 주세요.")?;
            Uuid::parse_str(id).map_err(|_| "휴지통 번호가 올바르지 않습니다.")?;
            let item = list_trash(engine)?
                .into_iter()
                .find(|i| i.id == id)
                .ok_or("휴지통 항목이 없습니다.")?;
            let root = engine
                .roots()
                .into_iter()
                .find(|r| r.id == item.root_id)
                .ok_or("연결 폴더가 없습니다.")?;
            let relative = Path::new(&item.path);
            if relative.is_absolute()
                || item.path.contains('\\')
                || relative
                    .components()
                    .any(|c| !matches!(c, std::path::Component::Normal(_)))
            {
                return Err("복구 경로가 올바르지 않습니다.".into());
            }
            let parent = relative.parent().unwrap_or(Path::new(""));
            let destination = engine.resolve(&Location {
                root_id: item.root_id.clone(),
                path: parent.to_string_lossy().replace('\\', "/"),
            })?;
            let target = destination.join(relative.file_name().ok_or("복구 파일명이 없습니다.")?);
            validate_name(&target.file_name().unwrap().to_string_lossy())?;
            let directory = trash_dir(Path::new(&root.absolute_path))?;
            let source = directory.join(id);
            if fs::symlink_metadata(&source)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
            {
                return Err("링크는 복구할 수 없습니다.".into());
            }
            move_unused(&source, &target)?;
            changed.push(target);
            fs::remove_file(directory.join(format!("{id}.json"))).map_err(|e| e.to_string())?;
            return Ok(json!({"count":1}));
        }
        if sources.is_empty() && !["mkdir", "mkfile"].contains(&request.action.as_str()) {
            return Err("파일이나 폴더를 선택해 주세요.".into());
        }
        if ["move", "trash", "rename", "batchRename", "duplicate"]
            .contains(&request.action.as_str())
        {
            for source in &sources {
                protect(engine, source)?;
            }
        }
        if request.action == "duplicate" {
            let mut names = vec![];
            for source in &sources {
                let parent = source.parent().ok_or("상위 폴더가 없습니다.")?;
                let extension = if source.is_file() {
                    source
                        .extension()
                        .and_then(|s| s.to_str())
                        .map(|s| format!(".{s}"))
                        .unwrap_or_default()
                } else {
                    String::new()
                };
                let stem = if source.is_file() {
                    source.file_stem()
                } else {
                    source.file_name()
                }
                .ok_or("파일명이 없습니다.")?
                .to_string_lossy();
                let target = (1..=9999)
                    .map(|number| {
                        parent.join(format!(
                            "{stem} 사본{}{extension}",
                            if number == 1 {
                                String::new()
                            } else {
                                format!(" {number}")
                            }
                        ))
                    })
                    .find(|target| {
                        fs::symlink_metadata(target)
                            .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
                    })
                    .ok_or("사본 이름을 만들 수 없습니다.")?;
                validate_name(&target.file_name().unwrap().to_string_lossy())?;
                let staging = tempfile::Builder::new()
                    .prefix(".ed-work-")
                    .tempdir_in(parent)
                    .map_err(|e| e.to_string())?;
                let output = staging.path().join("result");
                copy_node(source, &output)?;
                move_unused(&output, &target)?;
                names.push(target.file_name().unwrap().to_string_lossy().to_string());
                changed.push(target);
            }
            return Ok(json!({"count":names.len(), "names":names}));
        }
        if request.action == "trash" {
            let mut records = vec![];
            for (location, source) in locations.iter().zip(&sources) {
                records.push(trash(engine, location, source)?);
                changed.push(source.clone());
            }
            return Ok(json!({"count":records.len(),"records":records}));
        }
        if ["rename", "batchRename"].contains(&request.action.as_str()) {
            let names = if request.action == "rename" {
                if sources.len() != 1 {
                    return Err("이름을 바꿀 항목 하나를 선택해 주세요.".into());
                }
                vec![request.name.clone().ok_or("새 이름을 입력해 주세요.")?]
            } else {
                rename_names(
                    &sources,
                    request.rule.as_ref().ok_or("이름 변경 규칙이 없습니다.")?,
                )?
            };
            for name in &names {
                validate_name(name)?;
            }
            batch_rename(&sources, &names)?;
            for (source, name) in sources.iter().zip(&names) {
                changed.push(source.clone());
                changed.push(source.parent().unwrap().join(name));
            }
            return Ok(json!({"count":sources.len(),"names":names}));
        }
        let destination = engine.resolve(
            request
                .destination
                .as_ref()
                .ok_or("대상 폴더를 선택해 주세요.")?,
        )?;
        if !destination.is_dir() {
            return Err("대상은 폴더여야 합니다.".into());
        }
        if ["mkdir", "mkfile", "zip", "unzip", "resizeImages"].contains(&request.action.as_str()) {
            let name = request.name.as_deref().ok_or("이름을 입력해 주세요.")?;
            validate_name(name)?;
            let target = destination.join(name);
            unused(&target)?;
            if sources.iter().any(|s| target.starts_with(s)) {
                return Err("원본 내부에 결과를 만들 수 없습니다.".into());
            }
            if request.action == "mkdir" {
                fs::create_dir(&target).map_err(|e| e.to_string())?;
                changed.push(target);
                return Ok(json!({"count":1}));
            }
            if request.action == "mkfile" {
                OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&target)
                    .map_err(|e| e.to_string())?;
                changed.push(target);
                return Ok(json!({"count":1}));
            }
            if request.action == "resizeImages" {
                let result = resize(
                    &sources,
                    &destination,
                    name,
                    request.image.as_ref().ok_or("이미지 옵션이 없습니다.")?,
                )?;
                changed.push(target);
                return Ok(result);
            }
            let staging = tempfile::Builder::new()
                .prefix(".ed-work-")
                .tempdir_in(&destination)
                .map_err(|e| e.to_string())?;
            let output = staging.path().join("result");
            if request.action == "zip" {
                if !name.to_lowercase().ends_with(".zip") {
                    return Err("압축 파일 이름은 .zip으로 끝나야 합니다.".into());
                }
                zip_sources(&sources, &output)?;
            } else {
                if sources.len() != 1 {
                    return Err("ZIP 파일 하나를 선택해 주세요.".into());
                }
                unzip(&sources[0], &output)?;
            }
            move_unused(&output, &target)?;
            changed.push(target);
            return Ok(json!({"count":sources.len()}));
        }
        if !["copy", "move"].contains(&request.action.as_str()) {
            return Err("지원하지 않는 파일 작업입니다.".into());
        }
        let mut unique = HashSet::new();
        let mut targets = vec![];
        for source in &sources {
            if source.is_dir() && destination.starts_with(source) {
                return Err("원본 폴더 내부로 복사하거나 이동할 수 없습니다.".into());
            }
            if request.action == "copy" {
                targets.push(copy_target(source, &destination, &mut unique)?);
            } else {
                targets.push(destination.join(source.file_name().unwrap()));
            }
        }
        unique.clear();
        for (source, target) in sources.iter().zip(&targets) {
            if request.action == "move" && source == target {
                continue;
            }
            unused(target)?;
            if target.starts_with(source) || !unique.insert(target.to_string_lossy().to_lowercase())
            {
                return Err("원본 내부 또는 중복된 대상으로 복사할 수 없습니다.".into());
            }
        }
        if request.action == "copy" {
            copy_prepared(&sources, &targets, &mut changed)?;
            return Ok(json!({"count":sources.len()}));
        }
        #[cfg(windows)]
        {
            move_prepared(&sources, &targets, &mut changed)?;
            return Ok(json!({"count":sources.len()}));
        }
        #[cfg(not(windows))]
        for (i, (source, target)) in sources.iter().zip(&targets).enumerate() {
            if request.action == "move" && source == target {
                continue;
            }
            let staging = tempfile::Builder::new()
                .prefix(".ed-work-")
                .tempdir_in(&destination)
                .map_err(|e| e.to_string())?;
            let output = staging.path().join("result");
            if request.action == "move" && move_unused(source, &output).is_ok() {
                if let Err(error) = move_unused(&output, target) {
                    if let Err(recovery) = move_unused(&output, source) {
                        let kept = staging.keep();
                        return Err(format!(
                            "{error}; 원본 복구 실패: {recovery}. 보관 위치: {}",
                            kept.display()
                        ));
                    }
                    return Err(error);
                }
                changed.push(source.clone());
            } else {
                copy_node(source, &output)?;
                move_unused(&output, target)?;
                if request.action == "move" {
                    changed.push(target.clone());
                    trash(engine, &locations[i], source)?;
                    changed.push(source.clone());
                }
            }
            changed.push(target.clone());
        }
        #[cfg(not(windows))]
        Ok(json!({"count":sources.len()}))
    })();
    let transferred = Instant::now();
    if !changed.is_empty() {
        let refreshed = engine.refresh(&changed);
        if result.is_ok() {
            refreshed?;
        }
    }
    result.map(|mut result| {
        if let Some(object) = result.as_object_mut() {
            object.insert(
                "timings".into(),
                json!({
                    "queueMs":(acquired-started).as_secs_f64()*1000.0,
                    "fileMs":(transferred-acquired).as_secs_f64()*1000.0,
                    "indexMs":transferred.elapsed().as_secs_f64()*1000.0,
                }),
            );
        }
        result
    })
}

// LiteralPath와 작은따옴표 이스케이프로 UNC·공백·대괄호·따옴표가 든 경로를 연다.
pub fn windows_terminal_script(path: &Path) -> String {
    format!(
        "Set-Location -LiteralPath '{}'",
        crate::file_clipboard::path_text(path).replace('\'', "''")
    )
}

#[cfg(all(test, not(target_os = "windows")))]
mod opener_tests {
    use super::*;
    // 프로세스 생성 성공과 파일 연결 명령 성공을 구분한다.
    #[test]
    fn reports_launcher_exit_failure() {
        let error = check_opener(
            Command::new("/bin/sh").args(["-c", "printf 'no application' >&2; exit 1"]),
        )
        .unwrap_err();
        assert!(error.contains("no application"));
        assert!(check_opener(&mut Command::new("/usr/bin/true")).is_ok());
    }
}

// MFT 해석 함수는 Windows에서만 쓰고, 다른 운영체제에서는 단위 테스트에만 쓴다.
#![cfg_attr(not(windows), allow(dead_code))]
// Windows NTFS 빠른 첫 색인: 관리자 권한이 있으면 볼륨의 MFT(마스터 파일 표)를 한 번에 읽어
// 폴더를 하나씩 열지 않고 이름·크기·시각·속성을 모은다. 권한이 없거나 NTFS가 아니면 None을 돌려주고,
// 호출한 쪽은 기존 폴더 순회로 색인한다. 이후의 변경 반영은 기존 실시간 감시가 맡는다.
use crate::model::{Entry, Root};
use std::{collections::HashMap, path::Path};

// MFT 레코드 하나에서 모은 정보
#[derive(Default, Clone)]
struct Node {
    parent: u64,
    name: String,
    namespace: u8,
    directory: bool,
    size: Option<u64>,
    created: u64,
    modified: u64,
    accessed: u64,
    attributes: u32,
}

// 작은 끝(little-endian) 정수를 읽는다.
fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}
fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}
fn u64_at(b: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(at..at + 8)?.try_into().ok()?))
}

// FILETIME(1601년 기준 100ns)을 유닉스 밀리초로 바꾼다.
fn unix_ms(filetime: u64) -> u64 {
    (filetime / 10_000).saturating_sub(11_644_473_600_000)
}

// 섹터 끝 2바이트에 덮어쓴 갱신 순서 값을 원래 값으로 되돌린다(fixup). 손상이면 false.
fn fixup(record: &mut [u8], sector: usize) -> bool {
    let (Some(offset), Some(count)) = (u16_at(record, 4), u16_at(record, 6)) else { return false };
    let (offset, count) = (offset as usize, count as usize);
    if count == 0 || offset + count * 2 > record.len() {
        return false;
    }
    let usn = [record[offset], record[offset + 1]];
    for i in 1..count {
        let end = i * sector;
        if end > record.len() || record[end - 2..end] != usn {
            return false;
        }
        record[end - 2] = record[offset + i * 2];
        record[end - 1] = record[offset + i * 2 + 1];
    }
    true
}

// 비상주 속성의 실행 목록(runlist)을 (시작 클러스터, 길이) 목록으로 푼다.
fn runs(bytes: &[u8]) -> Vec<(i64, u64)> {
    let mut out = vec![];
    let mut at = 0;
    let mut lcn = 0i64;
    while let Some(&head) = bytes.get(at) {
        if head == 0 {
            break;
        }
        let (len_size, off_size) = ((head & 0x0f) as usize, (head >> 4) as usize);
        at += 1;
        let Some(len_bytes) = bytes.get(at..at + len_size) else { break };
        let length = len_bytes.iter().rev().fold(0u64, |v, b| (v << 8) | *b as u64);
        at += len_size;
        if off_size > 0 {
            let Some(off_bytes) = bytes.get(at..at + off_size) else { break };
            let mut delta = off_bytes.iter().rev().fold(0i64, |v, b| (v << 8) | *b as i64);
            // 부호 확장
            if off_bytes.last().is_some_and(|b| b & 0x80 != 0) {
                delta -= 1i64 << (off_size * 8);
            }
            lcn += delta;
            out.push((lcn, length));
        }
        at += off_size;
    }
    out
}

// 레코드 하나의 속성을 읽어 정보에 더한다. 확장 레코드면 기본 레코드 번호를 돌려준다.
fn parse(record: &[u8], nodes: &mut HashMap<u64, Node>, number: u64) {
    if record.get(..4) != Some(b"FILE") {
        return;
    }
    let flags = u16_at(record, 22).unwrap_or(0);
    if flags & 1 == 0 {
        return;
    }
    let base = u64_at(record, 32).unwrap_or(0) & 0x0000_ffff_ffff_ffff;
    let owner = if base != 0 { base } else { number };
    let node = nodes.entry(owner).or_default();
    if base == 0 {
        node.directory = flags & 2 != 0;
    }
    let mut at = u16_at(record, 20).unwrap_or(0) as usize;
    while let (Some(kind), Some(length)) = (u32_at(record, at), u32_at(record, at + 4)) {
        if kind == 0xffff_ffff || length == 0 || at + length as usize > record.len() {
            break;
        }
        let attribute = &record[at..at + length as usize];
        let resident = attribute[8] == 0;
        let name_length = attribute[9];
        let value = || -> Option<&[u8]> {
            let size = u32_at(attribute, 16)? as usize;
            let offset = u16_at(attribute, 20)? as usize;
            attribute.get(offset..offset + size)
        };
        match kind {
            0x10 if resident => {
                if let Some(v) = value() {
                    node.created = unix_ms(u64_at(v, 0).unwrap_or(0));
                    node.modified = unix_ms(u64_at(v, 8).unwrap_or(0));
                    node.accessed = unix_ms(u64_at(v, 24).unwrap_or(0));
                    node.attributes = u32_at(v, 32).unwrap_or(0);
                }
            }
            0x30 if resident => {
                if let Some(v) = value() {
                    let namespace = v.get(65).copied().unwrap_or(0);
                    let length = v.get(64).copied().unwrap_or(0) as usize;
                    // DOS 8.3 짧은 이름(2)은 긴 이름이 있으면 쓰지 않는다.
                    if namespace != 2 || node.name.is_empty() {
                        if let Some(raw) = v.get(66..66 + length * 2) {
                            let units: Vec<u16> = raw.chunks(2).map(|p| u16::from_le_bytes([p[0], p[1]])).collect();
                            node.name = String::from_utf16_lossy(&units);
                            node.namespace = namespace;
                            node.parent = u64_at(v, 0).unwrap_or(0) & 0x0000_ffff_ffff_ffff;
                        }
                    }
                }
            }
            // 이름 없는 기본 데이터 흐름의 크기
            0x80 if name_length == 0 => {
                node.size = if resident { u32_at(attribute, 16).map(u64::from) } else { u64_at(attribute, 48) };
            }
            _ => {}
        }
        at += length as usize;
    }
}

#[cfg(windows)]
mod volume {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GENERIC_READ, HANDLE, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{CreateFileW, ReadFile, SetFilePointerEx, FILE_BEGIN, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING},
        System::{
            Ioctl::{FSCTL_GET_NTFS_VOLUME_DATA, NTFS_VOLUME_DATA_BUFFER},
            IO::DeviceIoControl,
        },
    };

    // 열린 볼륨 핸들. 끝나면 닫는다.
    pub struct Volume(pub HANDLE);
    impl Drop for Volume {
        fn drop(&mut self) {
            // SAFETY: CreateFileW가 돌려준 유효한 핸들이다.
            unsafe { CloseHandle(self.0) };
        }
    }

    // 아직 디스크에 쓰지 않은 파일 표 변경을 내려 쓴다(쓰기 권한으로 잠깐 열어 비운다).
    pub fn flush(letter: char) {
        use windows_sys::Win32::{Foundation::GENERIC_WRITE, Storage::FileSystem::FlushFileBuffers};
        let name: Vec<u16> = format!("\\\\.\\{letter}:").encode_utf16().chain([0]).collect();
        // SAFETY: NUL로 끝나는 이름을 넘기고, 연 핸들은 Volume이 닫는다.
        let handle = unsafe { CreateFileW(name.as_ptr(), GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, std::ptr::null(), OPEN_EXISTING, 0, std::ptr::null_mut()) };
        if handle != INVALID_HANDLE_VALUE {
            let volume = Volume(handle);
            unsafe { FlushFileBuffers(volume.0) };
        }
    }

    // \\.\C: 형식으로 볼륨을 연다(관리자 권한 필요).
    pub fn open(letter: char) -> Option<Volume> {
        let name: Vec<u16> = format!("\\\\.\\{letter}:").encode_utf16().chain([0]).collect();
        // SAFETY: NUL로 끝나는 이름을 넘긴다.
        let handle = unsafe { CreateFileW(name.as_ptr(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, std::ptr::null(), OPEN_EXISTING, 0, std::ptr::null_mut()) };
        (handle != INVALID_HANDLE_VALUE).then_some(Volume(handle))
    }

    // NTFS 볼륨 정보: (섹터 크기, 클러스터 크기, 레코드 크기, MFT 시작 클러스터)
    pub fn info(volume: &Volume) -> Option<(usize, u64, usize, i64)> {
        // SAFETY: 출력 버퍼 크기를 함께 넘긴다.
        unsafe {
            let mut data: NTFS_VOLUME_DATA_BUFFER = std::mem::zeroed();
            let mut returned = 0u32;
            let ok = DeviceIoControl(volume.0, FSCTL_GET_NTFS_VOLUME_DATA, std::ptr::null(), 0, (&mut data as *mut NTFS_VOLUME_DATA_BUFFER).cast(), std::mem::size_of::<NTFS_VOLUME_DATA_BUFFER>() as u32, &mut returned, std::ptr::null_mut());
            (ok != 0).then_some((data.BytesPerSector as usize, data.BytesPerCluster as u64, data.BytesPerFileRecordSegment as usize, data.MftStartLcn))
        }
    }

    // 볼륨의 offset 위치에서 buffer 크기만큼 읽는다(섹터 단위로 맞춘 값을 넘긴다).
    pub fn read(volume: &Volume, offset: u64, buffer: &mut [u8]) -> bool {
        // SAFETY: 버퍼 길이를 함께 넘긴다.
        unsafe {
            if SetFilePointerEx(volume.0, offset as i64, std::ptr::null_mut(), FILE_BEGIN) == 0 {
                return false;
            }
            let mut read = 0u32;
            ReadFile(volume.0, buffer.as_mut_ptr(), buffer.len() as u32, &mut read, std::ptr::null_mut()) != 0 && read as usize == buffer.len()
        }
    }

    // 폴더의 MFT 레코드 번호(파일 색인 번호의 아래 48비트)
    pub fn record_number(path: &std::path::Path) -> Option<u64> {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS};
        let file = std::fs::OpenOptions::new().read(true).custom_flags(FILE_FLAG_BACKUP_SEMANTICS).open(path).ok()?;
        use std::os::windows::io::AsRawHandle;
        // SAFETY: 열린 파일 핸들과 0으로 채운 구조체를 넘긴다.
        unsafe {
            let mut info: BY_HANDLE_FILE_INFORMATION = std::mem::zeroed();
            (GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) != 0).then_some((((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64) & 0x0000_ffff_ffff_ffff)
        }
    }
}

// 빠른 색인을 쓸 경로인지 확인한다. 드라이브 전체(C:\)를 연결했을 때만 쓴다.
// 작은 폴더는 MFT 전체를 읽는 것보다 폴더 순회가 빠르다.
pub fn eligible(path: &Path) -> bool {
    let text = crate::file_clipboard::path_text(path);
    let trimmed = text.trim_end_matches(['\\', '/']);
    (trimmed.len() == 2 && trimmed.ends_with(':') && cfg!(windows)) || std::env::var_os("EVERY_DIRECTORY_FORCE_MFT").is_some()
}

// MFT를 읽어 start 아래 항목을 모은다. skip은 제외할 경로(내부 작업 폴더·사용자 제외)를 판단한다.
#[cfg(windows)]
pub fn collect(root: &Root, start: &Path, skip: &dyn Fn(&Path) -> bool, progress: &dyn Fn(usize)) -> Option<(Vec<Entry>, usize)> {
    let text = crate::file_clipboard::path_text(start);
    let letter = text.chars().next().filter(|c| c.is_ascii_alphabetic() && text[1..].starts_with(':'))?;
    volume::flush(letter);
    let volume = volume::open(letter)?;
    let (sector, cluster, record_size, mft_lcn) = volume::info(&volume)?;
    if record_size == 0 || sector == 0 || record_size % sector != 0 {
        return None;
    }
    // 0번 레코드($MFT)의 데이터 실행 목록으로 MFT 전체 위치를 구한다.
    let mut first = vec![0u8; record_size];
    if !volume::read(&volume, mft_lcn as u64 * cluster, &mut first) || !fixup(&mut first, sector) {
        return None;
    }
    let mut mft_runs = vec![];
    let mut at = u16_at(&first, 20)? as usize;
    while let (Some(kind), Some(length)) = (u32_at(&first, at), u32_at(&first, at + 4)) {
        if kind == 0xffff_ffff || length == 0 {
            break;
        }
        if kind == 0x80 && first[at + 8] != 0 {
            let offset = u16_at(&first, at + 32)? as usize;
            mft_runs = runs(first.get(at + offset..at + length as usize)?);
        }
        at += length as usize;
    }
    if mft_runs.is_empty() {
        return None;
    }
    let mut nodes: HashMap<u64, Node> = HashMap::new();
    let mut number = 0u64;
    let chunk_clusters = ((4 * 1024 * 1024) / cluster).max(1);
    for (lcn, length) in mft_runs {
        let mut done = 0u64;
        while done < length {
            let count = chunk_clusters.min(length - done);
            let mut buffer = vec![0u8; (count * cluster) as usize];
            if !volume::read(&volume, (lcn as u64 + done) * cluster, &mut buffer) {
                return None;
            }
            for record in buffer.chunks_mut(record_size) {
                if fixup(record, sector) {
                    parse(record, &mut nodes, number);
                }
                number += 1;
            }
            done += count;
            progress(nodes.len());
        }
    }
    let base = volume::record_number(start)?;
    let mut children: HashMap<u64, Vec<u64>> = HashMap::new();
    for (id, node) in &nodes {
        if *id != node.parent && !node.name.is_empty() && *id >= 16 {
            children.entry(node.parent).or_default().push(*id);
        }
    }
    // 연결 폴더 아래를 깊이 우선으로 훑으며 상대 경로를 만든다.
    let mut entries = vec![];
    let mut skipped = 0;
    let mut stack: Vec<(u64, String)> = vec![(base, String::new())];
    while let Some((folder, prefix)) = stack.pop() {
        for id in children.get(&folder).into_iter().flatten() {
            let node = &nodes[id];
            // 링크(재분석 지점)는 기존 순회와 같이 건너뛴다.
            if node.attributes & 0x400 != 0 || (prefix.is_empty() && folder == 5 && node.name.starts_with('$')) {
                skipped += 1;
                continue;
            }
            let relative = if prefix.is_empty() { node.name.clone() } else { format!("{prefix}/{}", node.name) };
            if skip(&start.join(&relative)) {
                continue;
            }
            let extension = if node.directory { String::new() } else { Path::new(&node.name).extension().map_or(String::new(), |e| e.to_string_lossy().to_lowercase()) };
            entries.push(Entry {
                id: format!("{}:{relative}", root.id),
                root_id: root.id.clone(),
                name: node.name.clone(),
                path: relative.clone(),
                parent: prefix.clone(),
                kind: if node.directory { "directory" } else { "file" }.into(),
                extension,
                size: if node.directory { None } else { Some(node.size.unwrap_or(0)) },
                modified: node.modified,
                // 기존 순회(native_hidden)와 같이 Windows 숨김 속성만 본다.
                hidden: node.attributes & 0x2 != 0,
                created: Some(node.created),
                accessed: Some(node.accessed),
                readonly: node.attributes & 0x1 != 0,
            });
            if node.directory {
                stack.push((*id, relative));
            }
        }
    }
    Some((entries, skipped))
}

#[cfg(not(windows))]
pub fn collect(_root: &Root, _start: &Path, _skip: &dyn Fn(&Path) -> bool, _progress: &dyn Fn(usize)) -> Option<(Vec<Entry>, usize)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_runlists_and_fixups() {
        // 길이 0x18 클러스터를 0x5634 위치에서, 이어서 길이 0x10을 -0x10 만큼 앞에서
        assert_eq!(runs(&[0x21, 0x18, 0x34, 0x56, 0x21, 0x10, 0xf0, 0xff, 0x00]), vec![(0x5634, 0x18), (0x5624, 0x10)]);
        let mut record = vec![0u8; 1024];
        record[..4].copy_from_slice(b"FILE");
        record[4..6].copy_from_slice(&48u16.to_le_bytes());
        record[6..8].copy_from_slice(&3u16.to_le_bytes());
        record[48..50].copy_from_slice(&[7, 7]);
        record[50..52].copy_from_slice(&[1, 2]);
        record[52..54].copy_from_slice(&[3, 4]);
        record[510..512].copy_from_slice(&[7, 7]);
        record[1022..1024].copy_from_slice(&[7, 7]);
        assert!(fixup(&mut record, 512));
        assert_eq!((&record[510..512], &record[1022..1024]), (&[1u8, 2][..], &[3u8, 4][..]));
        assert_eq!(unix_ms(116_444_736_000_000_000), 0);
    }
}

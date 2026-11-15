// macOS Finder 태그(com.apple.metadata:_kMDItemUserTags 확장 속성)를 읽는다.
// 다른 운영체제에는 Finder 태그가 없으므로 빈 목록을 돌려준다.
use std::path::Path;

// 파일의 Finder 태그 이름 목록. 색 번호("\n6")는 뺀다.
#[cfg(target_os = "macos")]
pub fn finder_tags(path: &Path) -> Vec<String> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let Ok(target) = CString::new(path.as_os_str().as_bytes()) else { return vec![] };
    let name = c"com.apple.metadata:_kMDItemUserTags";
    let mut buffer = vec![0u8; 4096];
    // SAFETY: 경로·속성 이름은 NUL로 끝나는 C 문자열이고, 버퍼 길이를 함께 넘긴다.
    let size = unsafe {
        libc::getxattr(target.as_ptr(), name.as_ptr(), buffer.as_mut_ptr().cast(), buffer.len(), 0, 0)
    };
    if size <= 0 {
        return vec![];
    }
    buffer.truncate(size as usize);
    strings(&buffer)
        .into_iter()
        .map(|tag| tag.split('\n').next().unwrap_or_default().to_owned())
        .filter(|tag| !tag.is_empty())
        .collect()
}

#[cfg(not(target_os = "macos"))]
pub fn finder_tags(_path: &Path) -> Vec<String> {
    vec![]
}

// 이진 plist(bplist00)에서 최상위 배열의 문자열만 꺼낸다.
pub fn strings(data: &[u8]) -> Vec<String> {
    let parse = || -> Option<Vec<String>> {
        if data.len() < 40 || &data[..8] != b"bplist00" {
            return None;
        }
        let trailer = &data[data.len() - 32..];
        let offset_size = trailer[6] as usize;
        let ref_size = trailer[7] as usize;
        let count = number(&trailer[8..16]);
        let top = number(&trailer[16..24]);
        let table = number(&trailer[24..32]);
        let offset = |object: usize| -> Option<usize> {
            let at = table.checked_add(object.checked_mul(offset_size)?)?;
            Some(number(data.get(at..at + offset_size)?))
        };
        // 객체 머리에서 길이를 읽는다(15 이상이면 뒤에 정수 객체가 따른다).
        let length = |at: usize| -> Option<(usize, usize)> {
            let low = (data.get(at)? & 0x0f) as usize;
            if low < 15 {
                return Some((low, at + 1));
            }
            let width = 1usize << (data.get(at + 1)? & 0x0f);
            Some((number(data.get(at + 2..at + 2 + width)?), at + 2 + width))
        };
        let root = offset(top)?;
        if data.get(root)? >> 4 != 0xa {
            return None;
        }
        let (items, start) = length(root)?;
        let mut out = vec![];
        for n in 0..items.min(count) {
            let object = number(data.get(start + n * ref_size..start + (n + 1) * ref_size)?);
            let at = offset(object)?;
            let (len, body) = length(at)?;
            match data.get(at)? >> 4 {
                0x5 => out.push(String::from_utf8_lossy(data.get(body..body + len)?).into_owned()),
                0x6 => {
                    let units: Vec<u16> = data
                        .get(body..body + len * 2)?
                        .chunks(2)
                        .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
                        .collect();
                    out.push(String::from_utf16_lossy(&units));
                }
                _ => {}
            }
        }
        Some(out)
    };
    parse().unwrap_or_default()
}

// 빅엔디언 정수를 읽는다.
fn number(bytes: &[u8]) -> usize {
    bytes.iter().fold(0usize, |value, byte| (value << 8) | *byte as usize)
}

// 문자열 배열 하나를 이진 plist로 만든다(시험과 태그 쓰기에 쓴다).
pub fn plist(values: &[&str]) -> Vec<u8> {
    let mut out = b"bplist00".to_vec();
    let mut offsets = vec![out.len()];
    out.push(0xa0 | values.len().min(14) as u8);
    for n in 0..values.len() {
        out.push((n + 1) as u8);
    }
    for value in values {
        offsets.push(out.len());
        let units: Vec<u16> = value.encode_utf16().collect();
        let ascii = value.is_ascii();
        let len = if ascii { value.len() } else { units.len() };
        let marker = if ascii { 0x50 } else { 0x60 };
        if len < 15 {
            out.push(marker | len as u8);
        } else {
            out.extend([marker | 0x0f, 0x10, len as u8]);
        }
        if ascii {
            out.extend(value.as_bytes());
        } else {
            units.iter().for_each(|unit| out.extend(unit.to_be_bytes()));
        }
    }
    let table = out.len();
    out.extend(offsets.iter().map(|offset| *offset as u8));
    let mut trailer = [0u8; 32];
    trailer[6] = 1;
    trailer[7] = 1;
    trailer[15] = offsets.len() as u8;
    trailer[31] = table as u8;
    out.extend(trailer);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_tags_from_binary_plist() {
        assert_eq!(strings(&plist(&["Work\n0", "업무\n6"])), vec!["Work\n0", "업무\n6"]);
        assert!(strings(b"not a plist").is_empty());
    }
}

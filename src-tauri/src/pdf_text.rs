// PDF에서 본문 글자를 뽑는다(본문 검색용). 페이지 내용 스트림의 글자 연산자를 읽고,
// 글꼴의 ToUnicode 표로 글자 코드를 유니코드로 바꾼다. 그림·OCR은 다루지 않는다.
use flate2::read::ZlibDecoder;
use std::{collections::HashMap, io::Read};

// PDF 객체 하나: 사전(글자로 둔다)과 스트림 원본
struct Object {
    dict: String,
    stream: Option<Vec<u8>>,
}

// 바이트를 그대로 한 글자씩 옮긴 문자열(Latin-1). 짧은 낱말 해석에만 쓴다.
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

// 바이트 위치가 그대로 유지되도록 ASCII 밖의 바이트를 '.'로 바꾼 문자열. 객체 위치를 찾을 때 쓴다.
fn ascii(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| if b < 0x80 { b as char } else { '.' }).collect()
}

// 문자열에서 "N 0 R" 참조 번호를 읽는다.
fn reference(text: &str) -> Option<u32> {
    let mut parts = text.split_whitespace();
    let number = parts.next()?.parse().ok()?;
    parts.next()?.parse::<u32>().ok()?;
    (parts.next()? == "R").then_some(number)
}

// 사전에서 키 다음의 값 글자를 꺼낸다(중첩된 << >>·[ ]도 한 값으로 본다).
fn value<'a>(dict: &'a str, key: &str) -> Option<&'a str> {
    let mut search = 0;
    let at = loop {
        let found = dict[search..].find(key)? + search;
        let next = dict[found + key.len()..].chars().next();
        // /Font 와 /FontDescriptor 를 구별한다.
        if next.is_none_or(|c| !c.is_ascii_alphanumeric()) {
            break found + key.len();
        }
        search = found + key.len();
    };
    let rest = dict[at..].trim_start();
    let start = dict.len() - rest.len();
    let end = if rest.starts_with("<<") {
        let mut depth = 0i32;
        let bytes = rest.as_bytes();
        let mut i = 0;
        loop {
            if i + 1 >= bytes.len() {
                break bytes.len();
            }
            if &bytes[i..i + 2] == b"<<" {
                depth += 1;
                i += 2;
            } else if &bytes[i..i + 2] == b">>" {
                depth -= 1;
                i += 2;
                if depth == 0 {
                    break i;
                }
            } else {
                i += 1;
            }
        }
    } else if rest.starts_with('[') {
        rest.find(']').map_or(rest.len(), |i| i + 1)
    } else if let Some(stripped) = rest.strip_prefix('/') {
        1 + stripped.find(|c: char| c.is_whitespace() || "/<>[]()".contains(c)).unwrap_or(stripped.len())
    } else {
        // 숫자·참조(N G R)
        let words: Vec<&str> = rest.split_whitespace().take(3).collect();
        if words.len() == 3 && words[2].starts_with('R') && words[0].parse::<u32>().is_ok() && words[1].parse::<u32>().is_ok() {
            rest.find('R').map_or(rest.len(), |i| i + 1)
        } else {
            rest.find(|c: char| c.is_whitespace() || "/<>[]".contains(c)).unwrap_or(rest.len())
        }
    };
    Some(&dict[start..start + end])
}

// 파일 전체에서 "N G obj ... endobj" 객체와 객체 스트림 안의 객체를 모은다.
fn objects(data: &[u8]) -> HashMap<u32, Object> {
    let mut map = HashMap::new();
    let text = ascii(data);
    let mut search = 0;
    while let Some(found) = text[search..].find(" obj") {
        let at = search + found;
        search = at + 4;
        // 앞의 "번호 세대" 두 숫자를 읽는다.
        let head = &text[at.saturating_sub(24)..at];
        let words: Vec<&str> = head.split_whitespace().rev().take(2).collect();
        if words.len() < 2 {
            continue;
        }
        let (Ok(number), Ok(_)) = (words[1].trim_start_matches(|c: char| !c.is_ascii_digit()).parse::<u32>(), words[0].parse::<u32>()) else { continue };
        let body_start = at + 4;
        let Some(end_rel) = text[body_start..].find("endobj") else { continue };
        let body = &text[body_start..body_start + end_rel];
        let (dict, stream) = match body.find("stream") {
            Some(s) if !body[..s].ends_with("end") => {
                let mut begin = body_start + s + 6;
                if data.get(begin) == Some(&b'\r') {
                    begin += 1;
                }
                if data.get(begin) == Some(&b'\n') {
                    begin += 1;
                }
                let dict = body[..s].to_owned();
                let length = value(&dict, "/Length").and_then(|v| v.trim().parse::<usize>().ok());
                let end = match length {
                    Some(len) if begin + len <= data.len() && text[begin + len..].trim_start().starts_with("endstream") => begin + len,
                    _ => text[begin..].find("endstream").map_or(begin, |e| begin + e),
                };
                (dict, Some(data[begin..end].to_vec()))
            }
            _ => (body.to_owned(), None),
        };
        map.insert(number, Object { dict, stream });
    }
    // 객체 스트림(/Type /ObjStm) 안의 작은 객체를 꺼낸다.
    let mut inner = vec![];
    for object in map.values() {
        if !object.dict.contains("/ObjStm") {
            continue;
        }
        let Some(bytes) = decoded(object) else { continue };
        let first = value(&object.dict, "/First").and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0);
        let count = value(&object.dict, "/N").and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0);
        let text = ascii(&bytes);
        let header: Vec<usize> = text.get(..first.min(text.len())).unwrap_or("").split_whitespace().filter_map(|w| w.parse().ok()).collect();
        for n in 0..count.min(header.len() / 2) {
            let start = first + header[n * 2 + 1];
            let end = if n + 1 < header.len() / 2 { first + header[n * 2 + 3] } else { text.len() };
            if let Some(body) = text.get(start..end.min(text.len())) {
                inner.push((header[n * 2] as u32, body.to_owned()));
            }
        }
    }
    for (number, dict) in inner {
        map.entry(number).or_insert(Object { dict, stream: None });
    }
    map
}

// 압축(FlateDecode)을 푼 스트림 내용. 다른 압축은 다루지 않는다.
fn decoded(object: &Object) -> Option<Vec<u8>> {
    let raw = object.stream.as_ref()?;
    let filter = value(&object.dict, "/Filter").unwrap_or("");
    if filter.is_empty() {
        return Some(raw.clone());
    }
    if !filter.contains("FlateDecode") || filter.contains("DCT") {
        return None;
    }
    let mut out = vec![];
    // 끝부분이 손상돼도 읽은 데까지는 쓴다.
    let _ = ZlibDecoder::new(&raw[..]).take(32 * 1024 * 1024).read_to_end(&mut out);
    (!out.is_empty()).then_some(out)
}

// 참조면 따라가서 사전 글자를, 바로 적힌 사전이면 그대로 돌려준다.
fn resolve<'a>(objects: &'a HashMap<u32, Object>, text: &'a str) -> Option<&'a str> {
    match reference(text) {
        Some(number) => objects.get(&number).map(|o| o.dict.as_str()),
        None => Some(text),
    }
}

// 글자 코드 → 유니코드 표와 코드 길이(1 또는 2바이트)
struct CMap {
    map: HashMap<u32, String>,
    width: usize,
}

// "<hex>" 문자열을 바이트로 바꾼다.
fn hex(text: &str) -> Vec<u8> {
    let digits: Vec<u8> = text.bytes().filter(u8::is_ascii_hexdigit).collect();
    digits.chunks(2).map(|pair| {
        let s = std::str::from_utf8(pair).unwrap_or("0");
        u8::from_str_radix(&format!("{s:0<2}"), 16).unwrap_or(0)
    }).collect()
}

// UTF-16BE 바이트를 글자로 바꾼다.
fn utf16(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes.chunks(2).map(|p| u16::from_be_bytes([p[0], *p.get(1).unwrap_or(&0)])).collect();
    String::from_utf16_lossy(&units)
}

// ToUnicode CMap의 bfchar·bfrange를 읽는다.
fn parse_cmap(text: &str) -> CMap {
    let mut map = HashMap::new();
    let mut width = 1;
    let hexes = |line: &str| -> Vec<String> {
        let mut out = vec![];
        let mut rest = line;
        while let Some(start) = rest.find('<') {
            let Some(end) = rest[start..].find('>') else { break };
            out.push(rest[start + 1..start + end].to_owned());
            rest = &rest[start + end + 1..];
        }
        out
    };
    let number = |h: &str| hex(h).iter().fold(0u32, |v, b| (v << 8) | *b as u32);
    for block in text.split("beginbfchar").skip(1) {
        let block = block.split("endbfchar").next().unwrap_or("");
        let items = hexes(block);
        for pair in items.chunks(2) {
            if pair.len() == 2 {
                width = width.max(hex(&pair[0]).len());
                map.insert(number(&pair[0]), utf16(&hex(&pair[1])));
            }
        }
    }
    for block in text.split("beginbfrange").skip(1) {
        let block = block.split("endbfrange").next().unwrap_or("");
        for line in block.lines() {
            let items = hexes(line);
            if items.len() < 3 {
                continue;
            }
            let (low, high) = (number(&items[0]), number(&items[1]));
            width = width.max(hex(&items[0]).len());
            if high < low || high - low > 65535 {
                continue;
            }
            if line.contains('[') {
                for (n, item) in items[2..].iter().enumerate() {
                    map.insert(low + n as u32, utf16(&hex(item)));
                }
            } else {
                let base = hex(&items[2]);
                let start = base.iter().fold(0u32, |v, b| (v << 8) | *b as u32);
                for code in low..=high {
                    let unicode = start + (code - low);
                    let bytes: Vec<u8> = if base.len() >= 4 { unicode.to_be_bytes().to_vec() } else { (unicode as u16).to_be_bytes().to_vec() };
                    map.insert(code, utf16(&bytes));
                }
            }
        }
    }
    CMap { map, width: width.clamp(1, 2) }
}

// 내용 스트림의 낱말(토큰)
enum Token {
    Text(Vec<u8>),
    Number(f32),
    Name(String),
    Open,
    Close,
    Operator(String),
}

// 내용 스트림을 토큰으로 나눈다.
fn tokens(data: &[u8]) -> Vec<Token> {
    let mut out = vec![];
    let mut i = 0;
    while i < data.len() {
        let c = data[i];
        match c {
            b'(' => {
                let mut depth = 1;
                let mut text = vec![];
                i += 1;
                while i < data.len() && depth > 0 {
                    match data[i] {
                        b'\\' if i + 1 < data.len() => {
                            i += 1;
                            match data[i] {
                                b'n' => text.push(b'\n'),
                                b'r' => text.push(b'\r'),
                                b't' => text.push(b'\t'),
                                b'b' | b'f' => {}
                                d @ b'0'..=b'7' => {
                                    let mut value = (d - b'0') as u32;
                                    for _ in 0..2 {
                                        if i + 1 < data.len() && (b'0'..=b'7').contains(&data[i + 1]) {
                                            i += 1;
                                            value = value * 8 + (data[i] - b'0') as u32;
                                        }
                                    }
                                    text.push(value as u8);
                                }
                                b'\r' | b'\n' => {}
                                other => text.push(other),
                            }
                        }
                        b'(' => {
                            depth += 1;
                            text.push(b'(');
                        }
                        b')' => {
                            depth -= 1;
                            if depth > 0 {
                                text.push(b')');
                            }
                        }
                        other => text.push(other),
                    }
                    i += 1;
                }
                out.push(Token::Text(text));
            }
            b'<' if data.get(i + 1) == Some(&b'<') => i += 2,
            b'>' if data.get(i + 1) == Some(&b'>') => i += 2,
            b'<' => {
                let end = data[i..].iter().position(|&b| b == b'>').map_or(data.len(), |p| i + p);
                out.push(Token::Text(hex(&latin1(&data[i + 1..end]))));
                i = end + 1;
            }
            b'[' => {
                out.push(Token::Open);
                i += 1;
            }
            b']' => {
                out.push(Token::Close);
                i += 1;
            }
            b'/' => {
                let start = i + 1;
                i += 1;
                while i < data.len() && !data[i].is_ascii_whitespace() && !b"/[]()<>{}%".contains(&data[i]) {
                    i += 1;
                }
                out.push(Token::Name(latin1(&data[start..i])));
            }
            b'%' => {
                while i < data.len() && data[i] != b'\n' && data[i] != b'\r' {
                    i += 1;
                }
            }
            _ if c.is_ascii_whitespace() => i += 1,
            _ => {
                let start = i;
                while i < data.len() && !data[i].is_ascii_whitespace() && !b"/[]()<>{}%".contains(&data[i]) {
                    i += 1;
                }
                if i == start {
                    i += 1;
                    continue;
                }
                let word = latin1(&data[start..i]);
                match word.parse::<f32>() {
                    Ok(number) => out.push(Token::Number(number)),
                    Err(_) => out.push(Token::Operator(word)),
                }
            }
        }
    }
    out
}

// 글꼴 표로 글자 바이트를 바꾼다. 표가 없으면 바이트를 Latin-1 글자로 본다.
fn decode_text(bytes: &[u8], cmap: Option<&CMap>, out: &mut String) {
    match cmap {
        Some(cmap) if !cmap.map.is_empty() => {
            for code in bytes.chunks(cmap.width) {
                let key = code.iter().fold(0u32, |v, b| (v << 8) | *b as u32);
                if let Some(text) = cmap.map.get(&key) {
                    out.push_str(text);
                }
            }
        }
        Some(cmap) if cmap.width == 2 => {}
        _ => out.extend(bytes.iter().filter(|b| **b >= 0x20 || **b == b'\n').map(|&b| b as char)),
    }
}

// 페이지(또는 상위 페이지 묶음)에서 /Resources 사전을 찾는다.
fn resources<'a>(objects: &'a HashMap<u32, Object>, page: &'a str) -> Option<&'a str> {
    let mut current = page;
    for _ in 0..16 {
        if let Some(found) = value(current, "/Resources") {
            return resolve(objects, found);
        }
        current = resolve(objects, value(current, "/Parent")?)?;
    }
    None
}

// PDF 파일 바이트에서 본문 글자를 limit 바이트까지 뽑는다.
pub fn extract(data: &[u8], limit: usize) -> String {
    if !data.starts_with(b"%PDF") {
        return String::new();
    }
    let objects = objects(data);
    let mut pages: Vec<(&u32, &Object)> = objects
        .iter()
        .filter(|(_, o)| o.dict.contains("/Type") && value(&o.dict, "/Type").is_some_and(|t| t.trim() == "/Page"))
        .collect();
    pages.sort_by_key(|(n, _)| **n);
    let mut out = String::new();
    let mut cmaps: HashMap<u32, Option<CMap>> = HashMap::new();
    for (_, page) in pages {
        // 이 페이지 글꼴 이름 → 글꼴 객체 번호
        let mut fonts: HashMap<String, u32> = HashMap::new();
        if let Some(font_dict) = resources(&objects, &page.dict).and_then(|r| value(r, "/Font")).and_then(|f| resolve(&objects, f)) {
            let inner = font_dict.trim().trim_start_matches("<<").trim_end_matches(">>");
            let mut rest = inner;
            while let Some(slash) = rest.find('/') {
                let after = &rest[slash + 1..];
                let name_end = after.find(|c: char| c.is_whitespace() || c == '/').unwrap_or(after.len());
                let name = &after[..name_end];
                let tail = &after[name_end..];
                if let Some(number) = reference(tail) {
                    fonts.insert(name.to_owned(), number);
                }
                rest = tail;
            }
        }
        let contents = value(&page.dict, "/Contents").unwrap_or("");
        let refs: Vec<u32> = if contents.trim_start().starts_with('[') {
            let inner = contents.trim().trim_start_matches('[').trim_end_matches(']');
            inner.split('R').filter_map(|part| reference(&format!("{part} R"))).collect()
        } else {
            reference(contents).into_iter().collect()
        };
        for number in refs {
            let Some(stream) = objects.get(&number).and_then(decoded) else { continue };
            let mut font: Option<u32> = None;
            let mut operands: Vec<Token> = vec![];
            for token in tokens(&stream) {
                let Token::Operator(op) = &token else {
                    operands.push(token);
                    continue;
                };
                let cmap = font.and_then(|f| {
                    cmaps
                        .entry(f)
                        .or_insert_with(|| {
                            let dict = &objects.get(&f)?.dict;
                            let unicode = reference(value(dict, "/ToUnicode")?)?;
                            Some(parse_cmap(&ascii(&decoded(objects.get(&unicode)?)?)))
                        })
                        .as_ref()
                });
                match op.as_str() {
                    "Tf" => {
                        font = operands.iter().find_map(|t| if let Token::Name(n) = t { fonts.get(n).copied() } else { None });
                    }
                    "Tj" | "'" | "\"" => {
                        if op != "Tj" {
                            out.push('\n');
                        }
                        if let Some(Token::Text(bytes)) = operands.iter().rev().find(|t| matches!(t, Token::Text(_))) {
                            decode_text(bytes, cmap, &mut out);
                        }
                    }
                    "TJ" => {
                        for item in &operands {
                            match item {
                                Token::Text(bytes) => decode_text(bytes, cmap, &mut out),
                                // 큰 음수 간격은 낱말 사이 띄어쓰기로 본다.
                                Token::Number(n) if *n < -250.0 => out.push(' '),
                                _ => {}
                            }
                        }
                    }
                    "T*" | "Td" | "TD" | "ET" => {
                        if !out.ends_with('\n') {
                            out.push('\n');
                        }
                    }
                    _ => {}
                }
                operands.clear();
                if out.len() >= limit {
                    return out;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::ZlibEncoder, Compression};
    use std::io::Write;

    // 시험용 PDF: 압축한 내용 스트림 + 2바이트 글꼴(ToUnicode로 한글)
    fn sample() -> Vec<u8> {
        let content = b"BT /F1 12 Tf 72 700 Td <00010002> Tj ( report) Tj ET BT /F2 10 Tf [(Hello) -300 (World)] TJ ET";
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(content).unwrap();
        let compressed = encoder.finish().unwrap();
        let cmap = b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n1 begincodespacerange <0000> <FFFF> endcodespacerange\n2 beginbfchar\n<0001> <BCF4>\n<0002> <ACE0>\nendbfchar\nendcmap";
        let mut pdf = b"%PDF-1.7\n".to_vec();
        pdf.extend(b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
        pdf.extend(b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 /Resources << /Font << /F1 5 0 R /F2 7 0 R >> >> >> endobj\n");
        pdf.extend(format!("3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n4 0 obj << /Length {} /Filter /FlateDecode >>\nstream\n", compressed.len()).as_bytes());
        pdf.extend(&compressed);
        pdf.extend(b"\nendstream\nendobj\n");
        pdf.extend(b"5 0 obj << /Type /Font /Subtype /Type0 /ToUnicode 6 0 R >> endobj\n");
        pdf.extend(format!("6 0 obj << /Length {} >>\nstream\n", cmap.len()).as_bytes());
        pdf.extend(cmap);
        pdf.extend(b"\nendstream\nendobj\n7 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF");
        pdf
    }

    #[test]
    fn extracts_unicode_and_plain_text() {
        let text = extract(&sample(), 10_000);
        assert!(text.contains("보고"), "{text:?}");
        assert!(text.contains("Hello World"), "{text:?}");
    }
}

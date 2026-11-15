// 한/영 자판을 잘못 두고 친 검색어를 두벌식 배열 기준으로 바꾼다.
// 예: "qhrhtj" → "보고서", "메ㅡ" → "apm"

const CHOSEONG: &str = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNGSEONG: &str = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONGSEONG: &str = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";
// 두벌식 자판의 영문 키와 자모 (소문자, Shift 자리)
const KEYS: &[(char, char)] = &[
    ('q', 'ㅂ'), ('w', 'ㅈ'), ('e', 'ㄷ'), ('r', 'ㄱ'), ('t', 'ㅅ'), ('y', 'ㅛ'), ('u', 'ㅕ'),
    ('i', 'ㅑ'), ('o', 'ㅐ'), ('p', 'ㅔ'), ('a', 'ㅁ'), ('s', 'ㄴ'), ('d', 'ㅇ'), ('f', 'ㄹ'),
    ('g', 'ㅎ'), ('h', 'ㅗ'), ('j', 'ㅓ'), ('k', 'ㅏ'), ('l', 'ㅣ'), ('z', 'ㅋ'), ('x', 'ㅌ'),
    ('c', 'ㅊ'), ('v', 'ㅍ'), ('b', 'ㅠ'), ('n', 'ㅜ'), ('m', 'ㅡ'),
    ('Q', 'ㅃ'), ('W', 'ㅉ'), ('E', 'ㄸ'), ('R', 'ㄲ'), ('T', 'ㅆ'), ('O', 'ㅒ'), ('P', 'ㅖ'),
];
// 두 자모가 합쳐진 모음·받침
const PAIRS: &[(char, char, char)] = &[
    ('ㅗ', 'ㅏ', 'ㅘ'), ('ㅗ', 'ㅐ', 'ㅙ'), ('ㅗ', 'ㅣ', 'ㅚ'), ('ㅜ', 'ㅓ', 'ㅝ'), ('ㅜ', 'ㅔ', 'ㅞ'),
    ('ㅜ', 'ㅣ', 'ㅟ'), ('ㅡ', 'ㅣ', 'ㅢ'), ('ㄱ', 'ㅅ', 'ㄳ'), ('ㄴ', 'ㅈ', 'ㄵ'), ('ㄴ', 'ㅎ', 'ㄶ'),
    ('ㄹ', 'ㄱ', 'ㄺ'), ('ㄹ', 'ㅁ', 'ㄻ'), ('ㄹ', 'ㅂ', 'ㄼ'), ('ㄹ', 'ㅅ', 'ㄽ'), ('ㄹ', 'ㅌ', 'ㄾ'),
    ('ㄹ', 'ㅍ', 'ㄿ'), ('ㄹ', 'ㅎ', 'ㅀ'), ('ㅂ', 'ㅅ', 'ㅄ'),
];

// 영문 키 하나를 자모로 바꾼다. Shift 자리가 없는 대문자는 소문자와 같다.
fn jamo(key: char) -> Option<char> {
    KEYS.iter()
        .find(|(k, _)| *k == key)
        .or_else(|| KEYS.iter().find(|(k, _)| *k == key.to_ascii_lowercase()))
        .map(|(_, j)| *j)
}

// 두 자모를 합친 모음·받침을 찾는다.
fn join(first: char, second: char) -> Option<char> {
    PAIRS.iter().find(|(a, b, _)| *a == first && *b == second).map(|(_, _, c)| *c)
}

// 합쳐진 자모를 두 자모로 나눈다.
fn split(joined: char) -> Option<(char, char)> {
    PAIRS.iter().find(|(_, _, c)| *c == joined).map(|(a, b, _)| (*a, *b))
}

// 자모 하나를 영문 키로 바꾼다. 합쳐진 자모는 두 키가 된다.
fn keys(jamo: char, out: &mut String) {
    if let Some((first, second)) = split(jamo) {
        keys(first, out);
        keys(second, out);
    } else if let Some((key, _)) = KEYS.iter().find(|(_, j)| *j == jamo) {
        out.push(*key);
    } else {
        out.push(jamo);
    }
}

// 입력 중인 음절을 글자로 내보낸다. 초성·중성이 모두 없으면 낱자로 남긴다.
fn flush(cho: &mut Option<char>, jung: &mut Option<char>, jong: &mut Option<char>, out: &mut String) {
    match (cho.take(), jung.take(), jong.take()) {
        (Some(c), Some(v), last) => {
            let c = CHOSEONG.chars().position(|x| x == c).unwrap() as u32;
            let v = JUNGSEONG.chars().position(|x| x == v).unwrap() as u32;
            let t = last.map_or(0, |t| JONGSEONG.chars().position(|x| x == t).unwrap() as u32);
            out.push(char::from_u32(0xac00 + (c * 21 + v) * 28 + t).unwrap());
        }
        (c, v, t) => out.extend([c, v, t].into_iter().flatten()),
    }
}

// 자모 나열을 한글 입력기처럼 음절로 조합한다.
fn compose(text: &str) -> String {
    let (mut cho, mut jung, mut jong) = (None, None, None);
    let mut out = String::new();
    for c in text.chars() {
        let consonant = CHOSEONG.contains(c) || JONGSEONG.contains(c) && c != ' ';
        let vowel = JUNGSEONG.contains(c);
        if consonant {
            if cho.is_some() && jung.is_some() && jong.is_none() && JONGSEONG.contains(c) {
                jong = Some(c);
            } else if let Some(joined) = jong.and_then(|t| join(t, c)) {
                jong = Some(joined);
            } else {
                flush(&mut cho, &mut jung, &mut jong, &mut out);
                // 겹받침 낱자는 첫소리가 될 수 없으므로 그대로 둔다.
                if CHOSEONG.contains(c) { cho = Some(c) } else { out.push(c) }
            }
        } else if vowel {
            if cho.is_some() && jung.is_none() {
                jung = Some(c);
            } else if let Some(joined) = jung.filter(|_| jong.is_none()).and_then(|v| join(v, c)) {
                jung = Some(joined);
            } else if let Some(last) = jong.take() {
                // 받침이 다음 음절의 첫소리로 넘어간다. 겹받침은 뒤 자음만 넘긴다.
                let (keep, moved) = split(last).map_or((None, last), |(a, b)| (Some(a), b));
                jong = keep;
                flush(&mut cho, &mut jung, &mut jong, &mut out);
                cho = Some(moved);
                jung = Some(c);
            } else {
                flush(&mut cho, &mut jung, &mut jong, &mut out);
                jung = Some(c);
            }
        } else {
            flush(&mut cho, &mut jung, &mut jong, &mut out);
            out.push(c);
        }
    }
    flush(&mut cho, &mut jung, &mut jong, &mut out);
    out
}

// 검색 연산자(ext:, size: 등)가 붙은 낱말은 바꾸지 않는다.
fn each_word(text: &str, convert: impl Fn(&str) -> String) -> String {
    text.split(' ')
        .map(|word| if word.contains(':') { word.to_owned() } else { convert(word) })
        .collect::<Vec<_>>()
        .join(" ")
}

// 영문 자판으로 친 한글을 되살린다. 완성된 음절이 없거나 홀로 남은 모음이 있으면 오타가 아니라고 본다.
pub fn english_to_hangul(text: &str) -> Option<String> {
    if !text.chars().any(|c| c.is_ascii_alphabetic()) || text.chars().any(|c| !c.is_ascii()) {
        return None;
    }
    let converted = each_word(text, |word| compose(&word.chars().map(|c| jamo(c).unwrap_or(c)).collect::<String>()));
    let syllable = converted.chars().any(|c| ('가'..='힣').contains(&c));
    let lone_vowel = converted.chars().any(|c| JUNGSEONG.contains(c));
    (syllable && !lone_vowel).then_some(converted)
}

// 한글 자판으로 친 영문을 되살린다. 바뀐 글자가 두 개 미만이면 쓰지 않는다.
pub fn hangul_to_english(text: &str) -> Option<String> {
    let hangul = |c: char| ('가'..='힣').contains(&c) || ('ㄱ'..='ㅣ').contains(&c);
    if !text.chars().any(hangul) {
        return None;
    }
    let converted = each_word(text, |word| {
        let mut out = String::new();
        for c in word.chars() {
            if ('가'..='힣').contains(&c) {
                let code = c as u32 - 0xac00;
                keys(CHOSEONG.chars().nth((code / 588) as usize).unwrap(), &mut out);
                keys(JUNGSEONG.chars().nth((code % 588 / 28) as usize).unwrap(), &mut out);
                if code % 28 > 0 {
                    keys(JONGSEONG.chars().nth((code % 28) as usize).unwrap(), &mut out);
                }
            } else {
                keys(c, &mut out);
            }
        }
        out
    });
    (converted.chars().filter(|c| c.is_ascii_alphabetic()).count() >= 2 && !converted.chars().any(hangul))
        .then_some(converted)
}

// 결과가 없을 때 다시 찾아볼 반대 자판 검색어를 고른다.
pub fn corrected_query(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 128 {
        return None;
    }
    hangul_to_english(text).or_else(|| english_to_hangul(text)).filter(|converted| converted != text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_both_directions() {
        assert_eq!(english_to_hangul("qhrhtj").as_deref(), Some("보고서"));
        assert_eq!(english_to_hangul("ghldmlfhr").as_deref(), Some("회의록"));
        assert_eq!(english_to_hangul("dkssudgktpdy").as_deref(), Some("안녕하세요"));
        assert_eq!(english_to_hangul("rkqt").as_deref(), Some("값"));
        assert_eq!(english_to_hangul("dlfr").as_deref(), Some("읽"));
        assert_eq!(english_to_hangul("ext:pdf qhrhtj").as_deref(), Some("ext:pdf 보고서"));
        assert_eq!(english_to_hangul("qhrhtj2026").as_deref(), Some("보고서2026"));
        assert_eq!(english_to_hangul("report"), None);
        assert_eq!(english_to_hangul("str"), None);
        assert_eq!(hangul_to_english("메ㅡ").as_deref(), Some("apm"));
        assert_eq!(hangul_to_english("ㅁㅔㅡ").as_deref(), Some("apm"));
        assert_eq!(hangul_to_english("ㄱ데ㅐㄱㅅ").as_deref(), Some("report"));
        assert_eq!(hangul_to_english("값").as_deref(), Some("rkqt"));
        assert_eq!(hangul_to_english("ㅁ"), None);
        assert_eq!(corrected_query("qhrhtj").as_deref(), Some("보고서"));
        assert_eq!(corrected_query("ㄱ데ㅐㄱㅅ").as_deref(), Some("report"));
    }
}

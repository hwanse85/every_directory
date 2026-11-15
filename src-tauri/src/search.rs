use crate::{
    model::{Entry, Root, SearchOptions, SearchResult},
    query::Query,
};
use regex::RegexBuilder;
use std::{
    borrow::Cow,
    cmp::Ordering,
    collections::{BinaryHeap, HashMap, HashSet},
    time::{Duration, Instant},
};
use unicode_normalization::UnicodeNormalization;

// 한글 조합과 영문 대소문자를 검색용으로 통일한다.
pub fn normalize(value: &str) -> String {
    value.nfc().collect::<String>().to_lowercase()
}

// 초성 검색에서 건너뛰는 구분자 중 공백·ASCII 기호 외에 자주 쓰는 전각·한글 문장 부호다.
const EXTRA_SEPARATORS: &str = "·•…、。「」『』【】〔〕（）［］｛｝～〜‐–—‘’“”";

// 초성 검색에서 글자 사이에 있어도 무시하는 공백·구분 기호인지 확인한다.
pub fn is_separator(c: char) -> bool {
    c.is_whitespace() || c.is_ascii_punctuation() || EXTRA_SEPARATORS.contains(c)
}

// 구분 기호가 0개 이상 이어지는 부분과 일치하는 정규식 조각이다.
fn separator_run() -> String {
    let symbols: String = (0u8..128)
        .map(char::from)
        .filter(char::is_ascii_punctuation)
        .chain(EXTRA_SEPARATORS.chars())
        .map(|c| regex::escape(&c.to_string()))
        .collect();
    format!("[\\s{symbols}]*")
}

// 공백·구분 기호를 빼고 한글 음절을 초성으로 바꿔 띄어쓰기·구분자 차이를 무시한다.
pub fn initials(value: &str) -> String {
    let consonants: Vec<char> = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ".chars().collect();
    normalize(value)
        .chars()
        .filter(|c| !is_separator(*c))
        .map(|c| {
            let code = c as u32;
            if (0xac00..=0xd7a3).contains(&code) {
                consonants[((code - 0xac00) / 588) as usize]
            } else {
                c
            }
        })
        .collect()
}

// IME가 합친 자음 겹받침을 검색에 사용하는 개별 초성으로 복원한다.
pub fn split_consonants(value: &str) -> String {
    let leading: Vec<char> = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ".chars().collect();
    let trailing: Vec<char> = "ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"
        .chars()
        .collect();
    value
        .nfc()
        .map(|original| {
            let c = if ('\u{ffa1}'..='\u{ffbe}').contains(&original) {
                original.to_string().nfkc().next().unwrap_or(original)
            } else {
                original
            };
            match c as u32 {
                0x1100..=0x1112 => leading[c as usize - 0x1100],
                0x11a8..=0x11c2 => trailing[c as usize - 0x11a8],
                0x111a => 'ㅀ',
                0x1121 => 'ㅄ',
                _ => c,
            }
        })
        .collect::<String>()
        .chars()
        .map(|c| match c {
            'ㄳ' => "ㄱㅅ".into(),
            'ㄵ' => "ㄴㅈ".into(),
            'ㄶ' => "ㄴㅎ".into(),
            'ㄺ' => "ㄹㄱ".into(),
            'ㄻ' => "ㄹㅁ".into(),
            'ㄼ' => "ㄹㅂ".into(),
            'ㄽ' => "ㄹㅅ".into(),
            'ㄾ' => "ㄹㅌ".into(),
            'ㄿ' => "ㄹㅍ".into(),
            'ㅀ' => "ㄹㅎ".into(),
            'ㅄ' => "ㅂㅅ".into(),
            _ => c.to_string(),
        })
        .collect()
}

// 초성 하나를 그 초성으로 시작하는 음절 범위와 함께 일치시키는 정규식 조각이다.
fn initial_class(index: usize) -> String {
    let consonant = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ".chars().nth(index).unwrap();
    let first = char::from_u32(0xac00 + index as u32 * 588).unwrap();
    let last = char::from_u32(first as u32 + 587).unwrap();
    format!("[{consonant}{first}-{last}]")
}

// 입력 중인 마지막 음절의 받침이 다음 글자의 첫소리일 수 있으면 그 경우의 정규식을 만든다.
// 예: '보곳'(보고서를 치는 중) → '보고' + ㅅ으로 시작하는 음절, '값' → '갑' + ㅅ으로 시작하는 음절
fn composing_alternative(c: char, separators: &str) -> Option<String> {
    let code = c as u32;
    if !(0xac00..=0xd7a3).contains(&code) {
        return None;
    }
    let jong = (code - 0xac00) % 28;
    // 받침 번호 → (남는 받침 번호, 다음 글자 첫소리 번호). 첫소리가 될 수 없는 받침은 없다.
    let (keep, initial) = match jong {
        1 => (0, 0), 2 => (0, 1), 3 => (1, 9), 4 => (0, 2), 5 => (4, 12), 6 => (4, 18),
        7 => (0, 3), 8 => (0, 5), 9 => (8, 0), 10 => (8, 6), 11 => (8, 7), 12 => (8, 9),
        13 => (8, 16), 14 => (8, 17), 15 => (8, 18), 16 => (0, 6), 17 => (0, 7), 18 => (17, 9),
        19 => (0, 9), 20 => (0, 10), 21 => (0, 11), 22 => (0, 12), 23 => (0, 14), 24 => (0, 15),
        25 => (0, 16), 26 => (0, 17), 27 => (0, 18),
        _ => return None,
    };
    let base = char::from_u32(code - jong + keep).unwrap();
    Some(format!("{}{separators}{}", regex::escape(&base.to_string()), initial_class(initial)))
}

// 일반 음절은 그대로 비교하고 입력된 초성만 해당 음절 범위와 함께 검색한다.
// 한글이 들어간 검색어는 글자 사이의 공백·구분 기호(_ - . [ ] 등)를 건너뛰고,
// 입력 중인 마지막 음절의 받침이 다음 글자 첫소리인 경우도 함께 찾는다.
pub fn initial_pattern(value: &str) -> Result<Option<regex::Regex>, String> {
    let value = split_consonants(value);
    let consonants = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
    let has_initial = value.chars().any(|c| consonants.contains(c));
    let wildcard = value.contains(['*', '?']);
    let korean = has_initial || value.chars().any(|c| ('가'..='힣').contains(&c));
    if !korean && !wildcard {
        return Ok(None);
    }
    let separators = if korean { separator_run() } else { String::new() };
    let letters: Vec<char> = value
        .chars()
        .filter(|c| !korean || !c.is_whitespace())
        .collect();
    let last_letter = letters.iter().rposition(|c| !matches!(c, '*' | '?'));
    let mut parts = vec![];
    for (position, &c) in letters.iter().enumerate() {
        let part = if let Some(index) = consonants.chars().position(|initial| initial == c) {
            initial_class(index)
        } else if c == '*' {
            ".*".into()
        } else if c == '?' {
            ".".into()
        } else if let Some(alternative) = (korean && Some(position) == last_letter)
            .then(|| composing_alternative(c, &separators))
            .flatten()
        {
            format!("(?:{}|{alternative})", regex::escape(&c.to_string()))
        } else {
            regex::escape(&c.to_string())
        };
        parts.push(part);
    }
    let body = parts.join(&separators);
    let pattern = if wildcard {
        format!("(?s)^{body}$")
    } else {
        body
    };
    RegexBuilder::new(&pattern)
        .case_insensitive(true)
        .size_limit(4_000_000)
        .build()
        .map(Some)
        .map_err(|error| error.to_string())
}

// 문자열에서 중복 없는 세 글자 검색 키를 만든다.
fn grams(value: &str) -> HashSet<String> {
    value
        .chars()
        .collect::<Vec<_>>()
        .windows(3)
        .map(|w| w.iter().collect())
        .collect()
}

// 두 글자 검색도 후보를 좁히고, 긴 초성 검색은 더 선택적인 세 글자 키를 쓴다.
fn initial_grams(value: &str) -> HashSet<String> {
    let chars: Vec<char> = value.chars().collect();
    [2, 3]
        .into_iter()
        .flat_map(|width| {
            chars
                .windows(width)
                .filter(|part| part.iter().any(|c| ('ㄱ'..='ㅎ').contains(c)))
                .map(|part| part.iter().collect::<String>())
        })
        .collect()
}

// 파일 확장자와 폴더 여부로 분류를 결정한다.
fn category(entry: &Entry) -> &str {
    if entry.kind == "directory" {
        return "folder";
    }
    let ext = entry.extension.as_str();
    for (group, extensions) in [
        (
            "document",
            "pdf doc docx hwp hwpx txt md xlsx xls ppt pptx csv",
        ),
        ("image", "png jpg jpeg gif svg webp avif heic fig psd ai"),
        (
            "code",
            "js jsx ts tsx py json html css scss go rs java yml yaml sh",
        ),
        ("audio", "mp3 wav flac m4a ogg mp4 mov webm"),
        ("archive", "zip 7z rar tar gz"),
    ] {
        if extensions.split_whitespace().any(|e| e == ext) {
            return group;
        }
    }
    "all"
}

// 인접 글자 뒤바뀜을 포함한 편집 거리를 계산한다.
fn distance(a: &str, b: &str, maximum: usize) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.len().abs_diff(b.len()) > maximum {
        return maximum + 1;
    }
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut before = previous.clone();
    for i in 1..=a.len() {
        let mut current = vec![i; b.len() + 1];
        for j in 1..=b.len() {
            current[j] = (current[j - 1] + 1)
                .min(previous[j] + 1)
                .min(previous[j - 1] + usize::from(a[i - 1] != b[j - 1]));
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                current[j] = current[j].min(before[j - 2] + 1);
            }
        }
        if *current.iter().min().unwrap_or(&0) > maximum {
            return maximum + 1;
        }
        before = previous;
        previous = current;
    }
    previous[b.len()]
}

// 정확한 포함 일치를 우선하고 단어별 오타를 제한한다.
pub(crate) fn fuzzy(word: &str, value: &str) -> Option<usize> {
    if value.contains(word) {
        return Some(0);
    }
    let count = word.chars().count();
    if !(3..=64).contains(&count) {
        return None;
    }
    let maximum = if count >= 6 { 2 } else { 1 };
    let best = value
        .split(|c: char| c.is_whitespace() || ". _/\\()[]{}-".contains(c))
        .map(|part| distance(word, part, maximum))
        .min()
        .unwrap_or(maximum + 1);
    (best <= maximum).then_some(best)
}

// 메모리 인덱스와 검색 키를 함께 유지한다.
#[derive(Default)]
pub struct Index {
    pub entries: Vec<Entry>,
    names: Vec<String>,
    paths: Vec<String>,
    grams: HashMap<String, Vec<u32>>,
    initial_grams: HashMap<String, Vec<u32>>,
    root_labels: HashMap<String, (String, String)>,
    hidden_dirs: HashSet<String>,
    visibility:Vec<u8>,
}

// Numeric filename segments sort naturally without allocating UTF-16 on each comparison.
fn logical_compare(first: &str, second: &str) -> Ordering {
    let (a,b)=(first.as_bytes(),second.as_bytes());let(mut i,mut j)=(0,0);
    while i<a.len() && j<b.len() {
        if a[i].is_ascii_digit() && b[j].is_ascii_digit() {
            let (start_i,start_j)=(i,j);
            while i<a.len() && a[i].is_ascii_digit(){i+=1;}
            while j<b.len() && b[j].is_ascii_digit(){j+=1;}
            let (mut x,mut y)=(start_i,start_j);
            while x<i && a[x]==b'0'{x+=1;}while y<j && b[y]==b'0'{y+=1;}
            let order=(i-x).cmp(&(j-y)).then_with(||a[x..i].cmp(&b[y..j])).then_with(||(i-start_i).cmp(&(j-start_j)));
            if order!=Ordering::Equal{return order;}
        }else{
            let order=a[i].cmp(&b[j]);if order!=Ordering::Equal{return order;}i+=1;j+=1;
        }
    }
    a.len().cmp(&b.len())
}

impl Index {
    fn visibility(entry:&Entry)->u8 {
        u8::from(entry.hidden||crate::visibility::hidden_name(&entry.path))
            | (u8::from(crate::visibility::temporary(&entry.name))<<1)
            | (u8::from(crate::visibility::recycle(&entry.path))<<2)
    }
    fn root_label<'a>(&'a self, entry:&'a Entry, absolute:bool)->&'a str {
        self.root_labels.get(&entry.root_id).map(|value|if absolute{value.1.as_str()}else{value.0.as_str()}).unwrap_or(&entry.root_id)
    }
    pub fn set_roots(&mut self, roots: impl IntoIterator<Item=Root>) {
        self.root_labels=roots.into_iter().map(|root|(root.id,(normalize(&root.name),normalize(&root.absolute_path).replace('\\',"/")))).collect();
    }

    fn compare(&self, first:usize, second:usize, key:&str, descending:bool) -> Ordering {
        let(a,b)=(&self.entries[first],&self.entries[second]);
        let folders=(b.kind=="directory").cmp(&(a.kind=="directory"));
        if folders!=Ordering::Equal{return folders;}
        let parent=|index:usize|self.paths[index].rsplit_once('/').map(|(parent,_)|parent).unwrap_or("");
        let order=match key {
            "name"=>logical_compare(&self.names[first],&self.names[second]),
            "size"=>a.size.cmp(&b.size),
            "modified"=>a.modified.cmp(&b.modified),
            "created"=>a.created.cmp(&b.created),
            "accessed"=>a.accessed.cmp(&b.accessed),
            "attributes"=>(a.readonly,a.hidden).cmp(&(b.readonly,b.hidden)),
            "extension"|"type"=>logical_compare(&a.extension,&b.extension),
            "root"=>logical_compare(self.root_label(a,false),self.root_label(b,false)),
            "location"=>logical_compare(self.root_label(a,false),self.root_label(b,false)).then_with(||logical_compare(parent(first),parent(second))),
            "fullPath"=>logical_compare(self.root_label(a,true),self.root_label(b,true)).then_with(||logical_compare(&self.paths[first],&self.paths[second])),
            _=>Ordering::Equal,
        };
        (if descending{order.reverse()}else{order}).then_with(||a.id.cmp(&b.id))
    }
    // 완료된 스냅샷으로 검색 자료를 한 번에 교체한다.
    pub fn replace(&mut self, mut entries: Vec<Entry>) {
        // 긴 경로를 비교할 때마다 다시 정규화하지 않고 항목당 한 번만 계산한다.
        entries.sort_by_cached_key(|entry| (entry.root_id.clone(), normalize(&entry.path)));
        self.names = entries.iter().map(|e| normalize(&e.name)).collect();
        self.paths = entries.iter().map(|e| normalize(&e.path)).collect();
        self.grams.clear();
        self.initial_grams.clear();
        for (i, name) in self.names.iter().enumerate() {
            for gram in grams(name) {
                self.grams.entry(gram).or_default().push(i as u32);
            }
        }
        for (i, path) in self.paths.iter().enumerate() {
            for gram in initial_grams(&initials(path)) {
                self.initial_grams.entry(gram).or_default().push(i as u32);
            }
        }
        self.visibility=entries.iter().map(Self::visibility).collect();
        self.hidden_dirs=entries.iter().filter(|e|e.hidden&&e.kind=="directory").map(|e|e.id.clone()).collect();
        self.entries = entries;
    }

    // Keep unchanged normalized keys and postings; repair only removed/moved slots and new entries.
    pub fn update(&mut self, removed: &[String], entries: Vec<Entry>) {
        let ids: HashSet<&str> = removed
            .iter()
            .map(String::as_str)
            .chain(entries.iter().map(|entry| entry.id.as_str()))
            .collect();
        let positions: Vec<usize> = if ids.is_empty() {
            vec![]
        } else {
            self.entries
                .iter()
                .enumerate()
                .filter_map(|(i, e)| ids.contains(e.id.as_str()).then_some(i))
                .collect()
        };
        let mut moved_from = HashMap::new();
        let mut remap: HashMap<u32, Option<u32>> = HashMap::new();
        let mut changed_names = HashSet::new();
        let mut changed_initials = HashSet::new();
        for position in positions.into_iter().rev() {
            let last = self.entries.len() - 1;
            for slot in [position, last] {
                changed_names.extend(grams(&self.names[slot]));
                changed_initials.extend(initial_grams(&initials(&self.paths[slot])));
            }
            remap.insert(position as u32, None);
            if position != last {
                let original = moved_from.remove(&last).unwrap_or(last as u32);
                moved_from.insert(position, original);
                remap.insert(original, Some(position as u32));
            }
            self.entries.swap_remove(position);
            self.visibility.swap_remove(position);
            self.names.swap_remove(position);
            self.paths.swap_remove(position);
        }
        fn repair(
            index: &mut HashMap<String, Vec<u32>>,
            keys: HashSet<String>,
            remap: &HashMap<u32, Option<u32>>,
        ) {
            for key in keys {
                if let Some(list) = index.get_mut(&key) {
                    list.retain_mut(|position| match remap.get(position) {
                        Some(Some(next)) => {
                            *position = *next;
                            true
                        }
                        Some(None) => false,
                        None => true,
                    });
                    if list.is_empty() {
                        index.remove(&key);
                    }
                }
            }
        }
        repair(&mut self.grams, changed_names, &remap);
        repair(&mut self.initial_grams, changed_initials, &remap);
        for entry in entries {
            let i = self.entries.len() as u32;
            let name = normalize(&entry.name);
            let path = normalize(&entry.path);
            for gram in grams(&name) {
                self.grams.entry(gram).or_default().push(i);
            }
            for gram in initial_grams(&initials(&path)) {
                self.initial_grams.entry(gram).or_default().push(i);
            }
            self.names.push(name);
            self.paths.push(path);
            self.visibility.push(Self::visibility(&entry));
            self.entries.push(entry);
        }
        self.hidden_dirs=self.entries.iter().filter(|e|e.hidden&&e.kind=="directory").map(|e|e.id.clone()).collect();
    }

    // 항목의 상위 폴더 중 숨김 폴더가 있는지 확인한다.
    fn under_hidden_dir(&self, entry: &Entry) -> bool {
        if self.hidden_dirs.is_empty() {
            return false;
        }
        let mut key = format!("{}:", entry.root_id);
        let base = key.len();
        entry
            .parent
            .match_indices('/')
            .map(|(i, _)| &entry.parent[..i])
            .chain(std::iter::once(entry.parent.as_str()))
            .any(|parent| {
                key.truncate(base);
                key.push_str(parent);
                self.hidden_dirs.contains(&key)
            })
    }

    // AND는 가장 작은 필수 후보, OR는 각 분기의 합집합을 사용한다.
    // 제외 조건이나 인덱스로 제한할 수 없는 분기는 전체 검사로 되돌린다.
    fn candidates<'a>(&'a self, query: &Query, full_path: bool) -> Option<Cow<'a, [u32]>> {
        match query {
            Query::And(items) => items
                .iter()
                .filter_map(|item| self.candidates(item, full_path))
                .min_by_key(|items| items.len()),
            Query::Or(items) => {
                let lists: Option<Vec<_>> = items
                    .iter()
                    .map(|item| self.candidates(item, full_path))
                    .collect();
                let mut combined: Vec<_> = lists?
                    .iter()
                    .flat_map(|items| items.iter().copied())
                    .collect();
                combined.sort_unstable();
                combined.dedup();
                Some(Cow::Owned(combined))
            }
            Query::Text {
                text, mode, path, ..
            } => {
                let mut best: Option<&[u32]> = None;
                for literal in text.split(['*', '?']) {
                    let initial_text = split_consonants(literal);
                    let (keys, index) = if mode == "initials"
                        && initial_text
                            .chars()
                            .any(|c| ('ㄱ'..='ㅎ').contains(&c) || ('가'..='힣').contains(&c))
                    {
                        (initial_grams(&initials(&initial_text)), &self.initial_grams)
                    } else if !full_path
                        && !path
                        && ["normal", "wildcard", "initials"].contains(&mode.as_str())
                    {
                        (grams(&normalize(literal)), &self.grams)
                    } else {
                        continue;
                    };
                    for key in keys {
                        let Some(list) = index.get(&key) else {
                            return Some(Cow::Borrowed(&[]));
                        };
                        if best.is_none_or(|previous| list.len() < previous.len()) {
                            best = Some(list);
                        }
                    }
                }
                best.map(Cow::Borrowed)
            }
            _ => None,
        }
    }

    // 다섯 검색 방식과 필터를 적용하고 시간 초과 여부를 명시한다.
    pub fn search(&self, options: &SearchOptions) -> Result<SearchResult, String> {
        self.search_inner(options, None, &|| false, Instant::now() + Duration::from_millis(650))
    }

    // 빠른 검색은 전체 후보에서 상위 항목을 고르고 이전 요청을 중단한다.
    pub fn quick_search(
        &self,
        options: &SearchOptions,
        boosts: &HashMap<String, usize>,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<SearchResult, String> {
        let start = Instant::now();
        let deadline = start + Duration::from_millis(250);
        // 경로 검색은 영문·숫자에 쓸 색인 키가 없어 전체를 훑는다. 큰 색인에서 시간 제한에 걸려
        // 파일명 일치까지 놓치지 않도록 색인으로 파일명 일치를 먼저 찾고, 남은 시간에 경로 일치를 더한다.
        // 파일명 색인으로 후보를 좁힐 수 없는 검색(정규식·퍼지·한두 글자)은 두 단계 모두 전체를 훑어
        // 경로 단계가 시간을 받지 못하므로, 경로 검색 한 번으로 찾는다(경로에는 파일명도 들어 있다).
        if !options.full_path || !self.names_indexed(options) {
            return self.search_inner(options, Some(boosts), cancelled, deadline);
        }
        let names = self.search_inner(
            &SearchOptions { full_path: false, ..options.clone() },
            Some(boosts),
            cancelled,
            deadline,
        )?;
        let paths = self.search_inner(options, Some(boosts), cancelled, deadline)?;
        let limit = options.limit.unwrap_or(500).clamp(1, 1000);
        let mut entries = names.entries;
        for entry in paths.entries {
            if entries.len() >= limit {
                break;
            }
            if !entries.iter().any(|item| item.id == entry.id) {
                entries.push(entry);
            }
        }
        Ok(SearchResult {
            entries,
            total: names.total.max(paths.total),
            elapsed: start.elapsed().as_secs_f64() * 1000.0,
            partial: names.partial || paths.partial,
            scanned: names.scanned + paths.scanned,
        })
    }

    // 파일명 검색을 세 글자 색인으로 좁힐 수 있는지 확인한다.
    fn names_indexed(&self, options: &SearchOptions) -> bool {
        if options.mode == "regex" {
            return false;
        }
        let sensitive = options.case_sensitive && options.mode != "initials";
        let query: String = options.query.nfc().collect();
        Query::parse(&query, &options.mode, sensitive)
            .ok()
            .is_some_and(|query| self.candidates(&query, false).is_some())
    }

    // 공통 검색 조건을 적용하되 빠른 검색의 메모리와 응답 시간을 제한한다.
    fn search_inner(
        &self,
        options: &SearchOptions,
        boosts: Option<&HashMap<String, usize>>,
        cancelled: &dyn Fn() -> bool,
        deadline: Instant,
    ) -> Result<SearchResult, String> {
        let start = Instant::now();
        if options.query.chars().count() > 512 {
            return Err("검색어는 512자까지 입력해 주세요.".into());
        }
        if !["normal", "wildcard", "regex", "fuzzy", "initials"].contains(&options.mode.as_str()) {
            return Err("지원하지 않는 검색 방식입니다.".into());
        }
        let sensitive = options.case_sensitive && options.mode != "initials";
        let query: String = options.query.nfc().collect();
        let expression = if options.mode == "regex" {
            None
        } else {
            Some(Query::parse(&query, &options.mode, sensitive)?)
        };
        let regex = if options.mode == "regex" {
            Some(
                RegexBuilder::new(&query)
                    .case_insensitive(!sensitive)
                    .size_limit(4_000_000)
                    .build()
                    .map_err(|e| {
                        format!("정규식 오류: {e}. 전후방 탐색과 역참조는 지원하지 않습니다.")
                    })?,
            )
        } else {
            None
        };
        let planned = expression
            .as_ref()
            .and_then(|query| self.candidates(query, options.full_path));
        let candidates = planned.as_deref();
        let count = candidates.map_or(self.entries.len(), <[u32]>::len);
        let limit = options.limit.unwrap_or(500).clamp(1, 1000);
        let offset=if boosts.is_some(){0}else{options.offset.unwrap_or(0).min(self.entries.len())};
        let explicit_sort=boosts.is_none() && options.sort_by.is_some();
        if options.sort_by.as_deref().is_some_and(|key| !["name","location","type","extension","size","modified","created","accessed","attributes","root","fullPath"].contains(&key)) {
            return Err("지원하지 않는 정렬 항목입니다.".into());
        }
        let mut matches = vec![];
        let mut ranked = BinaryHeap::new();
        let name_query = normalize(options.query.trim());
        let mut total = 0;
        let mut partial = false;
        let mut scanned = 0;
        for n in 0..count {
            if n % 128 == 0 {
                if cancelled() {
                    return Err("검색 요청이 취소되었습니다.".into());
                }
                if Instant::now() > deadline {
                    partial = true;
                    break;
                }
            }
            let i = candidates.map_or(n, |v| v[n] as usize);
            let entry = &self.entries[i];
            scanned += 1;
            if (!options.root_id.is_empty() && entry.root_id != options.root_id)
                || (options.category != "all" && category(entry) != options.category)
            {
                continue;
            }
            let flags=self.visibility[i];
            if flags&4!=0 {if !options.show_recycle_bin {continue;}}
            else if flags&2!=0 {if !options.show_temporary {continue;}}
            else if !options.show_hidden && flags&1!=0 {continue;}
            let original: String;
            let value = if sensitive || options.mode == "regex" {
                original = if options.full_path {
                    entry.path.nfc().collect()
                } else {
                    entry.name.nfc().collect()
                };
                &original
            } else if options.full_path {
                &self.paths[i]
            } else {
                &self.names[i]
            };
            let original_path: String;
            let path_value = if sensitive {
                original_path = entry.path.nfc().collect();
                &original_path
            } else {
                &self.paths[i]
            };
            let score = if let Some(regex) = &regex {
                regex.is_match(value).then_some(0)
            } else {
                expression
                    .as_ref()
                    .unwrap()
                    .matches(entry, value, path_value)
            };
            // 숨김 폴더 아래인지는 상위 경로마다 키를 만들어야 해서 일치한 항목에만 확인한다.
            let score = score.filter(|_| options.show_hidden || flags&6!=0 || !self.under_hidden_dir(entry));
            if let Some(score) = score {
                total += 1;
                if let Some(boosts) = boosts {
                    let name = &self.names[i];
                    let quality = if name == &name_query {
                        0
                    } else if name.starts_with(&name_query) {
                        1
                    } else if name.contains(&name_query) {
                        2
                    } else {
                        3
                    };
                    ranked.push((quality, *boosts.get(&entry.id).unwrap_or(&10000), score, i));
                    if ranked.len() > limit {
                        ranked.pop();
                    }
                } else if explicit_sort || options.mode == "fuzzy" || matches.len() < offset.saturating_add(limit) {
                    matches.push((score, i));
                }
            }
        }
        if boosts.is_some() {
            matches = ranked
                .into_sorted_vec()
                .into_iter()
                .map(|(_, _, score, i)| (score, i))
                .collect();
        } else if explicit_sort || options.mode == "fuzzy" {
            let compare=|a:&(usize,usize),b:&(usize,usize)| {
                if let Some(key)=options.sort_by.as_deref(){self.compare(a.1,b.1,key,options.descending)}else{a.cmp(b)}
            };
            let end=offset.saturating_add(limit).min(matches.len());
            if end<matches.len(){matches.select_nth_unstable_by(end,compare);matches.truncate(end);}
            if offset<matches.len(){
                if offset>0{matches.select_nth_unstable_by(offset,compare);}
                matches[offset..].sort_unstable_by(compare);
            }
        }
        Ok(SearchResult {
            entries: matches
                .into_iter()
                .skip(offset)
                .take(limit)
                .map(|(_, i)| self.entries[i].clone())
                .collect(),
            total,
            elapsed: start.elapsed().as_secs_f64() * 1000.0,
            partial,
            scanned,
        })
    }
}

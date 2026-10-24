use crate::{
    model::{Entry, SearchOptions, SearchResult},
    query::Query,
};
use regex::RegexBuilder;
use std::{
    collections::{BinaryHeap, HashMap, HashSet},
    time::Instant,
};
use unicode_normalization::UnicodeNormalization;

// 한글 조합과 영문 대소문자를 검색용으로 통일한다.
pub fn normalize(value: &str) -> String {
    value.nfc().collect::<String>().to_lowercase()
}

// 공백을 제외하고 한글 음절을 초성으로 바꿔 띄어쓰기 차이를 무시한다.
pub fn initials(value: &str) -> String {
    let consonants: Vec<char> = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ".chars().collect();
    normalize(value)
        .chars()
        .filter(|c| !c.is_whitespace())
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
    value
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

// 일반 음절은 그대로 비교하고 입력된 초성만 해당 음절 범위와 함께 검색한다.
pub fn initial_pattern(value: &str) -> Result<Option<regex::Regex>, String> {
    let value = split_consonants(value);
    let consonants = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
    let has_initial = value.chars().any(|c| consonants.contains(c));
    let wildcard = value.contains(['*', '?']);
    let ignore_spaces = has_initial || value.chars().any(|c| ('가'..='힣').contains(&c));
    if !ignore_spaces && !wildcard {
        return Ok(None);
    }
    let mut parts = vec![];
    for c in value
        .chars()
        .filter(|c| !ignore_spaces || !c.is_whitespace())
    {
        let part = if let Some(index) = consonants.chars().position(|initial| initial == c) {
            let first = char::from_u32(0xac00 + index as u32 * 588).unwrap();
            let last = char::from_u32(first as u32 + 587).unwrap();
            format!("[{c}{first}-{last}]")
        } else if c == '*' {
            ".*".into()
        } else if c == '?' {
            ".".into()
        } else {
            regex::escape(&c.to_string())
        };
        parts.push(part);
    }
    let body = parts.join(if ignore_spaces { "\\s*" } else { "" });
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
    grams: HashMap<String, Vec<usize>>,
}

impl Index {
    // 완료된 스냅샷으로 검색 자료를 한 번에 교체한다.
    pub fn replace(&mut self, mut entries: Vec<Entry>) {
        // 긴 경로를 비교할 때마다 다시 정규화하지 않고 항목당 한 번만 계산한다.
        entries.sort_by_cached_key(|entry| (entry.root_id.clone(), normalize(&entry.path)));
        self.names = entries.iter().map(|e| normalize(&e.name)).collect();
        self.paths = entries.iter().map(|e| normalize(&e.path)).collect();
        self.grams.clear();
        for (i, name) in self.names.iter().enumerate() {
            for gram in grams(name) {
                self.grams.entry(gram).or_default().push(i);
            }
        }
        self.entries = entries;
    }

    // 다섯 검색 방식과 필터를 적용하고 시간 초과 여부를 명시한다.
    pub fn search(&self, options: &SearchOptions) -> Result<SearchResult, String> {
        self.search_inner(options, None, &|| false)
    }

    // 빠른 검색은 전체 후보에서 상위 항목을 고르고 이전 요청을 중단한다.
    pub fn quick_search(
        &self,
        options: &SearchOptions,
        boosts: &HashMap<String, usize>,
        cancelled: &dyn Fn() -> bool,
    ) -> Result<SearchResult, String> {
        self.search_inner(options, Some(boosts), cancelled)
    }

    // 공통 검색 조건을 적용하되 빠른 검색의 메모리와 응답 시간을 제한한다.
    fn search_inner(
        &self,
        options: &SearchOptions,
        boosts: Option<&HashMap<String, usize>>,
        cancelled: &dyn Fn() -> bool,
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
        let literals = expression.as_ref().map(Query::literals).unwrap_or_default();
        let mut candidates: Option<&Vec<usize>> = None;
        if !options.full_path && ["normal", "wildcard"].contains(&options.mode.as_str()) {
            for word in &literals {
                for literal in word.split(['*', '?']) {
                    for key in grams(&normalize(literal)) {
                        match self.grams.get(&key) {
                            None => {
                                return Ok(SearchResult {
                                    entries: vec![],
                                    total: 0,
                                    elapsed: start.elapsed().as_secs_f64() * 1000.0,
                                    partial: false,
                                    scanned: 0,
                                })
                            }
                            Some(list)
                                if candidates
                                    .is_none_or(|previous| list.len() < previous.len()) =>
                            {
                                candidates = Some(list)
                            }
                            _ => (),
                        }
                    }
                }
            }
        }
        let count = candidates.map_or(self.entries.len(), Vec::len);
        let limit = options.limit.unwrap_or(500).clamp(1, 1000);
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
                if start.elapsed().as_millis() > if boosts.is_some() { 250 } else { 650 } {
                    partial = true;
                    break;
                }
            }
            let i = candidates.map_or(n, |v| v[n]);
            let entry = &self.entries[i];
            scanned += 1;
            if (!options.root_id.is_empty() && entry.root_id != options.root_id)
                || (options.category != "all" && category(entry) != options.category)
            {
                continue;
            }
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
                } else if options.mode == "fuzzy" || matches.len() < limit {
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
        } else if options.mode == "fuzzy" {
            matches.sort_unstable();
        }
        Ok(SearchResult {
            entries: matches
                .into_iter()
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

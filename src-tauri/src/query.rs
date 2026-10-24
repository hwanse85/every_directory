use crate::{
    model::Entry,
    search::{fuzzy, normalize},
};
use chrono::{Local, NaiveDate, TimeZone};
use regex::{Regex, RegexBuilder};

// 검색식을 AND, OR, 제외 조건과 메타데이터 조건으로 표현한다.
pub enum Query {
    And(Vec<Query>),
    Or(Vec<Query>),
    Not(Box<Query>),
    Text {
        text: String,
        pattern: Option<Regex>,
        path: bool,
        mode: String,
    },
    Extension(Vec<String>),
    Kind(&'static str),
    Number {
        field: &'static str,
        low: u64,
        high: u64,
    },
}

// 따옴표와 연산자를 구별한 검색 토큰이다.
#[derive(Debug, PartialEq)]
enum Token {
    Word(String),
    Or,
    Not,
    Open,
    Close,
}

// 따옴표 안의 공백과 연산자는 파일명 그대로 보존한다.
fn tokenize(input: &str) -> Result<Vec<Token>, String> {
    let mut tokens = vec![];
    let mut word = String::new();
    let mut quoted = false;
    for c in input.chars() {
        if c == '"' {
            quoted = !quoted;
            continue;
        }
        if quoted {
            word.push(c);
            continue;
        }
        let comparison = matches!(c, '<' | '>')
            && ["size:", "dm:", "date-modified:"].contains(&word.to_lowercase().as_str());
        if comparison {
            word.push(c);
            continue;
        }
        if c.is_whitespace() || matches!(c, '|' | '<' | '>') || (c == '!' && word.is_empty()) {
            if !word.is_empty() {
                tokens.push(Token::Word(std::mem::take(&mut word)));
            }
            match c {
                '|' => tokens.push(Token::Or),
                '!' => tokens.push(Token::Not),
                '<' => tokens.push(Token::Open),
                '>' => tokens.push(Token::Close),
                _ => (),
            }
        } else {
            word.push(c);
        }
    }
    if quoted {
        return Err("검색어의 따옴표를 닫아 주세요.".into());
    }
    if !word.is_empty() {
        tokens.push(Token::Word(word));
    }
    Ok(tokens)
}

// 검색 토큰의 우선순위와 중첩 깊이를 관리한다.
struct Parser {
    tokens: Vec<Token>,
    cursor: usize,
    mode: String,
    sensitive: bool,
}
impl Parser {
    // Everything 기본 순서에 맞춰 OR를 AND보다 먼저 묶는다.
    fn and(&mut self, depth: usize) -> Result<Query, String> {
        if depth > 32 {
            return Err("검색 그룹은 32단계까지 사용할 수 있습니다.".into());
        }
        let mut items = vec![];
        while self.cursor < self.tokens.len() && self.tokens[self.cursor] != Token::Close {
            let mut alternatives = vec![self.atom(depth + 1)?];
            while self.tokens.get(self.cursor) == Some(&Token::Or) {
                self.cursor += 1;
                alternatives.push(self.atom(depth + 1)?);
            }
            items.push(if alternatives.len() == 1 {
                alternatives.remove(0)
            } else {
                Query::Or(alternatives)
            });
        }
        Ok(Query::And(items))
    }
    // 단일 조건 또는 제외·그룹 조건을 읽는다.
    fn atom(&mut self, depth: usize) -> Result<Query, String> {
        if depth > 32 {
            return Err("검색 그룹이 너무 깊습니다.".into());
        }
        let token = self
            .tokens
            .get(self.cursor)
            .ok_or("연산자 다음에 검색 조건을 입력해 주세요.")?;
        self.cursor += 1;
        match token {
            Token::Not => Ok(Query::Not(Box::new(self.atom(depth + 1)?))),
            Token::Open => {
                if self.tokens.get(self.cursor) == Some(&Token::Close) {
                    return Err("빈 검색 그룹은 사용할 수 없습니다.".into());
                }
                let query = self.and(depth + 1)?;
                if self.tokens.get(self.cursor) != Some(&Token::Close) {
                    return Err("검색 그룹의 >를 닫아 주세요.".into());
                }
                self.cursor += 1;
                Ok(query)
            }
            Token::Word(word) => term(word, &self.mode, self.sensitive),
            _ => Err("검색 연산자 위치를 확인해 주세요.".into()),
        }
    }
}

// 크기 단위를 바이트로 바꾸고 잘못된 조건을 거절한다.
fn bytes(input: &str) -> Result<u64, String> {
    let value = input.to_lowercase();
    let at = value
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(value.len());
    let number: f64 = value[..at]
        .parse()
        .map_err(|_| "크기를 size:>10mb 형식으로 입력해 주세요.")?;
    let unit = match &value[at..] {
        "" | "b" => 1.0,
        "k" | "kb" | "kib" => 1024.0,
        "m" | "mb" | "mib" => 1024_f64.powi(2),
        "g" | "gb" | "gib" => 1024_f64.powi(3),
        "t" | "tb" | "tib" => 1024_f64.powi(4),
        _ => return Err("크기 단위는 B, KB, MB, GB, TB를 지원합니다.".into()),
    };
    if !number.is_finite() || number < 0.0 || number * unit >= u64::MAX as f64 {
        return Err("크기가 허용 범위를 벗어났습니다.".into());
    }
    Ok((number * unit) as u64)
}

// 현지 날짜의 시작과 다음 날 시작을 밀리초로 계산한다.
fn date(input: &str) -> Result<(u64, u64), String> {
    let today = Local::now().date_naive();
    let day = match input.to_lowercase().as_str() {
        "today" => today,
        "yesterday" => today.pred_opt().ok_or("날짜 범위 오류")?,
        _ => NaiveDate::parse_from_str(input, "%Y-%m-%d")
            .map_err(|_| "수정일은 dm:2026-10-23 또는 dm:today 형식으로 입력해 주세요.")?,
    };
    let next = day.succ_opt().ok_or("날짜 범위 오류")?;
    let start = Local
        .from_local_datetime(&day.and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .ok_or("현지 날짜를 해석할 수 없습니다.")?
        .timestamp_millis();
    let end = Local
        .from_local_datetime(&next.and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .ok_or("현지 날짜를 해석할 수 없습니다.")?
        .timestamp_millis();
    if start < 0 {
        return Err("1970년 이후 날짜를 입력해 주세요.".into());
    }
    Ok((start as u64, end as u64 - 1))
}

// 비교 연산자 또는 양 끝을 포함하는 범위를 메타데이터 조건으로 만든다.
fn number(field: &'static str, input: &str) -> Result<Query, String> {
    // 속성 종류에 따라 값의 최소·최대 범위를 읽는다.
    let parse = |value: &str| -> Result<(u64, u64), String> {
        if field == "size" {
            let value = bytes(value)?;
            Ok((value, value))
        } else {
            date(value)
        }
    };
    let (low, high) = if let Some((from, to)) = input.split_once("..") {
        (parse(from)?.0, parse(to)?.1)
    } else {
        let (operator, value) = [">=", "<=", ">", "<", "="]
            .iter()
            .find_map(|op| input.strip_prefix(op).map(|value| (*op, value)))
            .unwrap_or(("=", input));
        let (start, end) = parse(value)?;
        match operator {
            ">=" => (start, u64::MAX),
            ">" => (end.checked_add(1).ok_or("비교 범위 오류")?, u64::MAX),
            "<=" => (0, end),
            "<" => (0, start.checked_sub(1).ok_or("비교 범위 오류")?),
            _ => (start, end),
        }
    };
    if low > high {
        return Err("범위의 시작은 끝보다 작아야 합니다.".into());
    }
    Ok(Query::Number { field, low, high })
}

// 파일명·확장자·종류·경로·크기·수정일 조건을 미리 컴파일한다.
fn term(word: &str, mode: &str, sensitive: bool) -> Result<Query, String> {
    let lower = word.to_lowercase();
    if lower.starts_with("ext:") {
        let values: Vec<String> = word[4..]
            .split([',', ';'])
            .map(|s| normalize(s.trim_start_matches('.')))
            .filter(|s| !s.is_empty())
            .collect();
        if values.is_empty() {
            return Err("ext:pdf 처럼 확장자를 입력해 주세요.".into());
        }
        return Ok(Query::Extension(values));
    }
    for (prefix, field) in [
        ("size:", "size"),
        ("dm:", "modified"),
        ("date-modified:", "modified"),
    ] {
        if lower.starts_with(prefix) {
            return number(field, &word[prefix.len()..]);
        }
    }
    for (prefix, kind) in [("file:", "file"), ("folder:", "directory")] {
        if lower.starts_with(prefix) {
            let rest = &word[prefix.len()..];
            return if rest.is_empty() {
                Ok(Query::Kind(kind))
            } else {
                Ok(Query::And(vec![
                    Query::Kind(kind),
                    term(rest, mode, sensitive)?,
                ]))
            };
        }
    }
    let path = lower.starts_with("path:") || word.contains(['/', '\\']);
    let word = if lower.starts_with("path:") {
        &word[5..]
    } else {
        word
    };
    if word.is_empty() {
        return Err("path: 다음에 경로를 입력해 주세요.".into());
    }
    let text = if sensitive {
        word.to_owned()
    } else {
        normalize(word)
    }
    .replace('\\', "/");
    let pattern = if mode == "initials" {
        crate::search::initial_pattern(&text)?
    } else if mode == "wildcard" || (mode == "normal" && text.contains(['*', '?'])) {
        let pattern: String = text
            .chars()
            .map(|c| match c {
                '*' => ".*".into(),
                '?' => ".".into(),
                _ => regex::escape(&c.to_string()),
            })
            .collect();
        Some(
            RegexBuilder::new(&format!("(?s)^{pattern}$"))
                .case_insensitive(!sensitive)
                .size_limit(4_000_000)
                .build()
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };
    Ok(Query::Text {
        text,
        pattern,
        path,
        mode: mode.into(),
    })
}

impl Query {
    // 정규식 이외의 검색 입력을 검증하고 조건식으로 바꾼다.
    pub fn parse(input: &str, mode: &str, sensitive: bool) -> Result<Self, String> {
        let mut parser = Parser {
            tokens: tokenize(input)?,
            cursor: 0,
            mode: mode.into(),
            sensitive,
        };
        let query = parser.and(0)?;
        if parser.cursor != parser.tokens.len() {
            return Err("검색 그룹의 < > 개수를 확인해 주세요.".into());
        }
        Ok(query)
    }
    // 모든 결과에 반드시 필요한 파일명 조건만 후보 축소에 사용한다.
    pub fn literals(&self) -> Vec<&str> {
        match self {
            Query::And(items) => items.iter().flat_map(Query::literals).collect(),
            Query::Text {
                text,
                path: false,
                mode,
                ..
            } if ["normal", "wildcard"].contains(&mode.as_str()) => {
                text.split(['*', '?']).filter(|s| !s.is_empty()).collect()
            }
            _ => vec![],
        }
    }
    // 현재 파일에 조건식을 적용하고 퍼지 일치 점수를 반환한다.
    pub fn matches(&self, entry: &Entry, value: &str, path_value: &str) -> Option<usize> {
        match self {
            Query::And(items) => items.iter().try_fold(0, |sum, q| {
                q.matches(entry, value, path_value).map(|s| sum + s)
            }),
            Query::Or(items) => items
                .iter()
                .filter_map(|q| q.matches(entry, value, path_value))
                .min(),
            Query::Not(query) => query
                .matches(entry, value, path_value)
                .is_none()
                .then_some(0),
            Query::Extension(exts) => {
                (entry.kind == "file" && exts.contains(&entry.extension)).then_some(0)
            }
            Query::Kind(kind) => (entry.kind == *kind).then_some(0),
            Query::Number { field, low, high } => {
                let number = if *field == "size" {
                    if entry.kind != "file" {
                        return None;
                    }
                    entry.size?
                } else {
                    entry.modified
                };
                (*low <= number && number <= *high).then_some(0)
            }
            Query::Text {
                text,
                pattern,
                path,
                mode,
            } => {
                let value = if *path { path_value } else { value };
                if let Some(pattern) = pattern {
                    return pattern.is_match(value).then_some(0);
                }
                match mode.as_str() {
                    "fuzzy" => fuzzy(text, value),
                    _ => value.contains(text).then_some(0),
                }
            }
        }
    }
}

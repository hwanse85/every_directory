use serde::{Deserialize, Serialize};

// 화면과 Rust에서 공유하는 파일 메타데이터다.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub root_id: String,
    pub name: String,
    pub path: String,
    pub parent: String,
    pub kind: String,
    pub extension: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    pub modified: u64,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hidden: bool,
}

// 사용자가 연결한 폴더와 마지막 인덱싱 상태다.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Root {
    pub id: String,
    pub name: String,
    pub absolute_path: String,
    pub count: usize,
    pub last_indexed: u64,
    pub skipped: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub watch_error: Option<String>,
}

// 등록된 폴더 안의 상대 경로만 파일 작업에 사용한다.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub root_id: String,
    pub path: String,
}

// 기존 화면과 호환되는 검색 조건이다.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub query: String,
    #[serde(default = "normal")]
    pub mode: String,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default = "all")]
    pub category: String,
    #[serde(default)]
    pub root_id: String,
    #[serde(default)]
    pub full_path: bool,
    pub limit: Option<usize>,
}

// 지정하지 않은 검색 방식의 기본값을 반환한다.
fn normal() -> String {
    "initials".into()
}
// 지정하지 않은 분류의 기본값을 반환한다.
fn all() -> String {
    "all".into()
}

// 검색 결과와 실제 엔진 처리 시간을 전달한다.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub entries: Vec<Entry>,
    pub total: usize,
    pub elapsed: f64,
    pub partial: bool,
    pub scanned: usize,
}

// 일괄 이름 변경에서 적용할 치환과 번호 규칙이다.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameRule {
    pub find: String,
    pub replace: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub preserve_extension: bool,
    pub prefix: String,
    pub suffix: String,
    pub number: bool,
    pub start: usize,
    pub padding: usize,
}

// 원본을 보존하는 이미지 변환 조건이다.
#[derive(Clone, Deserialize)]
pub struct ImageOptions {
    pub width: u32,
    pub height: u32,
    pub fit: String,
    pub format: String,
    pub enlarge: bool,
}

// 파일 작업 요청을 하나의 명확한 자료형으로 전달한다.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub action: String,
    #[serde(default)]
    pub entries: Vec<Location>,
    pub destination: Option<Location>,
    pub name: Option<String>,
    pub rule: Option<RenameRule>,
    pub trash_id: Option<String>,
    pub image: Option<ImageOptions>,
}

// 앱 휴지통에 보관된 원본 위치와 삭제 시각이다.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,
    pub root_id: String,
    pub path: String,
    pub name: String,
    pub deleted_at: u64,
}

// 앱 안에서 잘라낸 항목과 운영체제 클립보드가 같은지 확인하는 정보다.
#[derive(Deserialize)]
pub struct FileClipboard {
    pub entries: Vec<Location>,
    pub cut: bool,
}

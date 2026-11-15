// 초성 + 일반 검색에서 초성·숫자·영문·특수문자를 섞은 검색어가 기대한 파일을 찾는지 확인한다.
use every_directory_lib::{
    model::{Entry, SearchOptions},
    search::Index,
};
use serde_json::json;
use std::collections::HashMap;

const NAMES: &[&str] = &[
    "보고서_v2.txt",
    "보고서-2026-03.pdf",
    "[초안] 설계 검토.docx",
    "회의록(2026.03).hwp",
    "IMG_0042 사진.jpg",
    "프로젝트A_계획서 v1.2.xlsx",
    "C++ 코딩 규칙.md",
    "제안서#3 최종.pptx",
    "가나다 abc 123.txt",
    "업무_보고서.txt",
    "설계-검토_rev.B.pdf",
    "도면 No.12-A.dwg",
    "1차_회의록.txt",
    "Ver2_보고서.txt",
    "보고서 (1).txt",
    "테스트~백업.txt",
    "급여_명세서_2026년.xlsx",
    "a&b 계약서.pdf",
    "50%할인.txt",
    "비용$정산.xlsx",
    "결과+분석.txt",
    "질의@응답.txt",
    "주간'보고.txt",
    "이름=값.txt",
    "갑시다.txt",
];

// 파일 이름 하나를 색인 항목으로 만든다.
fn entry(name: &str) -> Entry {
    let extension = name.rsplit_once('.').map(|(_, ext)| ext.to_lowercase()).unwrap_or_default();
    Entry {
        id: format!("root:문서/{name}"),
        root_id: "root".into(),
        path: format!("문서/{name}"),
        parent: "문서".into(),
        name: name.into(),
        kind: "file".into(),
        extension,
        size: Some(1),
        modified: 1,
        hidden: false,
        created: None,
        accessed: None,
        readonly: false,
    }
}

// 검색어마다 반드시 찾아야 하는 파일 이름이다.
const CASES: &[(&str, &str)] = &[
    ("ㅂㄱㅅ_v2", "보고서_v2.txt"),
    ("ㅂㄱㅅ_V2", "보고서_v2.txt"),
    ("보고ㅅ_v2", "보고서_v2.txt"),
    ("ㅂ고서_v2", "보고서_v2.txt"),
    ("ㅂㄱㅅ-2026", "보고서-2026-03.pdf"),
    ("ㅂㄱㅅ-2026-03", "보고서-2026-03.pdf"),
    ("[ㅊㅇ]", "[초안] 설계 검토.docx"),
    ("[ㅊㅇ] ㅅㄱ", "[초안] 설계 검토.docx"),
    ("[ㅊㅇ]ㅅㄱ", "[초안] 설계 검토.docx"),
    ("ㅎㅇㄹ(2026", "회의록(2026.03).hwp"),
    ("ㅎㅇㄹ(2026.03)", "회의록(2026.03).hwp"),
    ("회의록(2026", "회의록(2026.03).hwp"),
    ("img_0042 ㅅㅈ", "IMG_0042 사진.jpg"),
    ("img_0042ㅅㅈ", "IMG_0042 사진.jpg"),
    ("IMG_0042ㅅㅈ", "IMG_0042 사진.jpg"),
    ("ㅍㄹㅈㅌa_ㄱㅎㅅ", "프로젝트A_계획서 v1.2.xlsx"),
    ("ㅍㄹㅈㅌA", "프로젝트A_계획서 v1.2.xlsx"),
    ("ㄱㅎㅅ v1.2", "프로젝트A_계획서 v1.2.xlsx"),
    ("ㄱㅎㅅv1.2", "프로젝트A_계획서 v1.2.xlsx"),
    ("c++ ㅋㄷ", "C++ 코딩 규칙.md"),
    ("c++ㅋㄷ", "C++ 코딩 규칙.md"),
    ("ㅈㅇㅅ#3", "제안서#3 최종.pptx"),
    ("ㅈㅇㅅ#3 ㅊㅈ", "제안서#3 최종.pptx"),
    ("ㄱㄴㄷ abc 123", "가나다 abc 123.txt"),
    ("ㄱㄴㄷabc123", "가나다 abc 123.txt"),
    ("ㅇㅁ_ㅂㄱㅅ", "업무_보고서.txt"),
    ("ㅅㄱ-ㄱㅌ_rev.b", "설계-검토_rev.B.pdf"),
    ("ㄷㅁ no.12-a", "도면 No.12-A.dwg"),
    ("ㄷㅁno.12-a", "도면 No.12-A.dwg"),
    ("1ㅊ_ㅎㅇㄹ", "1차_회의록.txt"),
    ("1ㅊ", "1차_회의록.txt"),
    ("ver2_ㅂㄱㅅ", "Ver2_보고서.txt"),
    ("ㅂㄱㅅ(1)", "보고서 (1).txt"),
    ("ㅂㄱㅅ (1)", "보고서 (1).txt"),
    ("ㅌㅅㅌ~ㅂㅇ", "테스트~백업.txt"),
    ("ㄱㅇ_ㅁㅅㅅ_2026ㄴ", "급여_명세서_2026년.xlsx"),
    ("2026ㄴ", "급여_명세서_2026년.xlsx"),
    ("a&b ㄱㅇㅅ", "a&b 계약서.pdf"),
    ("a&bㄱㅇㅅ", "a&b 계약서.pdf"),
    ("50%ㅎㅇ", "50%할인.txt"),
    ("ㅂㅇ$ㅈㅅ", "비용$정산.xlsx"),
    ("ㄱㄱ+ㅂㅅ", "결과+분석.txt"),
    ("ㅈㅇ@ㅇㄷ", "질의@응답.txt"),
    ("ㅈㄱ'ㅂㄱ", "주간'보고.txt"),
    ("ㅇㄹ=ㄱ", "이름=값.txt"),
    ("ㅇㄹ=ㄱ.txt", "이름=값.txt"),
    ("ㅂㄱㅅ.txt", "업무_보고서.txt"),
    ("ㅂㄱ", "주간'보고.txt"),
    // 파일 이름의 구분자(_ - . [ ] ( ) 등)를 빼고 입력해도 찾는다.
    ("ㅂㄱㅅv2", "보고서_v2.txt"),
    ("ㅂㄱㅅ2026", "보고서-2026-03.pdf"),
    ("ㅂㄱㅅ202603", "보고서-2026-03.pdf"),
    ("ㅎㅇㄹ2026", "회의록(2026.03).hwp"),
    ("회의록2026", "회의록(2026.03).hwp"),
    ("ㅇㅁㅂㄱㅅ", "업무_보고서.txt"),
    ("ㅊㅇㅅㄱ", "[초안] 설계 검토.docx"),
    ("ㄱㅎㅅv12", "프로젝트A_계획서 v1.2.xlsx"),
    ("1ㅊㅎㅇㄹ", "1차_회의록.txt"),
    ("ㄱㅇㅁㅅㅅ2026", "급여_명세서_2026년.xlsx"),
    ("ㅅㄱㄱㅌrevb", "설계-검토_rev.B.pdf"),
    ("ㅂㅇㅈㅅ", "비용$정산.xlsx"),
    // 한글 입력기가 마지막 음절을 조합하는 중(받침이 다음 글자 첫소리)에도 결과가 끊기지 않는다.
    ("보곳", "보고서_v2.txt"),
    ("횡", "회의록(2026.03).hwp"),
    ("회읠", "회의록(2026.03).hwp"),
    ("ㄱㅇ_명셋", "급여_명세서_2026년.xlsx"),
    ("업뭅", "업무_보고서.txt"),
    ("겱", "결과+분석.txt"),
    ("제안ㅅ", "제안서#3 최종.pptx"),
    ("값", "갑시다.txt"),
];

// 구분자를 무시해도 다른 파일까지 엉뚱하게 찾지 않는다.
const EXCLUDED: &[(&str, &str)] = &[
    ("ㅂㄱㅅv2", "보고서-2026-03.pdf"),
    ("ㅎㅇㄹ2026", "1차_회의록.txt"),
    ("보곳", "결과+분석.txt"),
    ("[ㅊㅇ]", "설계-검토_rev.B.pdf"),
];

// 검색 한 번의 결과 파일 이름 목록을 구한다.
fn names(index: &Index, query: &str, full_path: bool, quick: bool) -> Result<Vec<String>, String> {
    let options: SearchOptions = serde_json::from_value(
        json!({"query": query, "mode": "initials", "fullPath": full_path, "limit": 1000}),
    )
    .unwrap();
    let result = if quick {
        index.quick_search(&options, &HashMap::new(), &|| false)
    } else {
        index.search(&options)
    }?;
    Ok(result.entries.into_iter().map(|entry| entry.name).collect())
}

#[test]
fn mixed_initial_queries_find_expected_files() {
    let mut index = Index::default();
    index.replace(NAMES.iter().map(|name| entry(name)).collect());
    let mut failures = vec![];
    for (query, expected) in CASES {
        for full_path in [false, true] {
            for quick in [false, true] {
                match names(&index, query, full_path, quick) {
                    Ok(found) if found.iter().any(|name| name == expected) => {}
                    Ok(found) => failures.push(format!("{query:?} 경로={full_path} 빠른={quick} → {found:?}")),
                    Err(error) => failures.push(format!("{query:?} 경로={full_path} 빠른={quick} → 오류 {error}")),
                }
            }
        }
    }
    for (query, unexpected) in EXCLUDED {
        let found = names(&index, query, false, false).unwrap();
        if found.iter().any(|name| name == unexpected) {
            failures.push(format!("{query:?}가 {unexpected:?}까지 찾음"));
        }
    }
    assert!(failures.is_empty(), "찾지 못한 검색 {}건:\n{}", failures.len(), failures.join("\n"));
}


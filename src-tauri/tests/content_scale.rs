// 본문 검색 규모 검증: 문서 1만 개의 본문 추출 시간, 본문 검색 시간, 저장 크기를 잰다(명시 실행).
use every_directory_lib::{content, model::{Entry, SearchOptions}, search::Index};
use std::{collections::HashMap, io::Write, time::Instant};

// 문단 여러 개가 든 docx를 만든다.
fn docx(path: &std::path::Path, text: &str) {
    let mut writer = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    writer.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
    let body: String = text.split(". ").map(|p| format!("<w:p><w:r><w:t>{p}</w:t></w:r></w:p>")).collect();
    writer.write_all(format!("<w:document><w:body>{body}</w:body></w:document>").as_bytes()).unwrap();
    // 실제 문서처럼 그림 같은 압축되지 않는 부분을 함께 넣는다.
    writer.start_file("word/media/image1.png", zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored)).unwrap();
    writer.write_all(&(0..20_000u32).map(|n| (n.wrapping_mul(2654435761) >> 13) as u8).collect::<Vec<_>>()).unwrap();
    writer.finish().unwrap();
}

#[test]
#[ignore = "explicit content-search scale verification"]
fn ten_thousand_documents() {
    let dir = tempfile::tempdir().unwrap();
    let words = ["계약", "해지", "정산", "보고", "검토", "일정", "예산", "설계", "품질", "안전", "회의", "결과"];
    let mut entries = vec![];
    for n in 0..10_000usize {
        let text: String = (0..300).map(|k| words[(n * 7 + k * 13) % words.len()]).collect::<Vec<_>>().join(" ")
            + if n % 997 == 0 { ". 특약 고유문구 확인" } else { "" };
        let name = format!("문서{n:05}.docx");
        docx(&dir.path().join(&name), &text);
        let size = std::fs::metadata(dir.path().join(&name)).unwrap().len();
        entries.push(Entry { id: format!("r:{name}"), root_id: "r".into(), name: name.clone(), path: name, parent: String::new(), kind: "file".into(), extension: "docx".into(), size: Some(size), modified: 1, hidden: false, created: None, accessed: None, readonly: false });
    }
    let source: u64 = entries.iter().map(|e| e.size.unwrap()).sum();
    let started = Instant::now();
    let mut texts = HashMap::new();
    for entry in &entries {
        texts.insert(entry.id.clone(), content::extract(&dir.path().join(&entry.path), "docx").unwrap());
    }
    let extract_seconds = started.elapsed().as_secs_f64();
    let text_bytes: usize = texts.values().map(String::len).sum();
    // 저장 형식과 같게 압축한 크기
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    serde_json::to_writer(&mut encoder, &texts).unwrap();
    let disk = encoder.finish().unwrap().len();
    let mut index = Index::default();
    index.replace(entries);
    index.set_content(texts);
    let options: SearchOptions = serde_json::from_value(serde_json::json!({"query": "content:\"고유문구\"", "mode": "initials", "limit": 100})).unwrap();
    let started = Instant::now();
    let result = index.search(&options).unwrap();
    let search_ms = started.elapsed().as_secs_f64() * 1000.0;
    println!("문서 10000개: 추출 {extract_seconds:.1}초, 본문 {:.1}MB, 저장 {:.1}MB, 원본 {:.1}MB(저장/원본 {:.1}%), 본문 검색 {search_ms:.1}ms, 결과 {}건",
        text_bytes as f64 / 1e6, disk as f64 / 1e6, source as f64 / 1e6, disk as f64 * 100.0 / source as f64, result.total);
    assert_eq!(result.total, 11);
    assert!(extract_seconds < 600.0);
    assert!(search_ms < 1000.0);
}

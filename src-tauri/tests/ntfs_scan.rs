// Windows NTFS 빠른 색인(MFT 읽기)이 폴더 순회와 같은 항목·크기를 모으는지 확인한다.
// 관리자 권한이 없으면 빠른 색인을 쓸 수 없으므로 건너뛴다(GitHub Actions Windows 실행기는 관리자다).
#[cfg(windows)]
#[test]
fn mft_scan_matches_directory_walk() {
    use every_directory_lib::{model::Root, ntfs};
    use std::collections::BTreeMap;
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path();
    std::fs::create_dir_all(base.join("문서/하위 폴더")).unwrap();
    std::fs::write(base.join("문서/보고서.txt"), vec![b'x'; 1234]).unwrap();
    std::fs::write(base.join("문서/하위 폴더/큰 파일.bin"), vec![0u8; 300_000]).unwrap();
    std::fs::write(base.join("빈 파일.txt"), b"").unwrap();
    let root = Root { id: "r".into(), name: "시험".into(), absolute_path: base.to_string_lossy().into(), ..Default::default() };
    let Some((entries, _)) = ntfs::collect(&root, base, &|_| false, &|_| {}) else {
        println!("관리자 권한이 없거나 NTFS가 아니어서 MFT 빠른 색인 검사를 건너뜁니다.");
        return;
    };
    let fast: BTreeMap<String, Option<u64>> = entries.iter().map(|e| (e.path.clone(), e.size)).collect();
    let mut walked = BTreeMap::new();
    for item in walkdir::WalkDir::new(base).min_depth(1) {
        let item = item.unwrap();
        let relative = item.path().strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
        walked.insert(relative, item.file_type().is_file().then(|| item.metadata().unwrap().len()));
    }
    assert_eq!(fast, walked);
    let report = entries.iter().find(|e| e.name == "보고서.txt").unwrap();
    assert_eq!((report.parent.as_str(), report.extension.as_str(), report.kind.as_str()), ("문서", "txt", "file"));
    assert!(report.modified > 1_600_000_000_000, "수정 시각 {}", report.modified);
}

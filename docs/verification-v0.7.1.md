# v0.7.1 초성 검색의 공백 무시

검증일: 2026-10-23. 초성 검색에서 파일명과 검색어의 공백 위치가 달라도 일치하도록 수정했다. 데스크톱 Rust 엔진과 웹 호환 TypeScript 엔진에 동일하게 반영했다.

`데이터분석 발굴.pdf`에 대해 다음 입력을 모두 지원한다.

- `ㄷㅇㅌㅂㅅ ㅂㄱ`
- `ㄷㅇㅌㅂㅅㅂㄱ`
- `ㄷㅇ ㅌㅂㅅㅂ ㄱ`
- `"ㄷㅇㅌㅂㅅ ㅂㄱ"`

공백을 제거한 초성 키를 인덱스 구성 시 미리 만들며, 검색어의 초성 변환도 검색 조건을 만들 때 한 번만 수행한다. 일반 검색·정규식의 공백 처리는 유지한다. 초성 검색에서 공백으로 나눈 조건은 기존처럼 AND로 적용한다. 확장자·연결 폴더·파일 분류 필터와 데스크톱의 OR·제외·경로 조건도 유지한다. 파일명을 실제로 변경하지 않는다. 기존 저장 인덱스는 앱 시작 시 새 검색 키를 구성하므로 다시 폴더를 스캔할 필요가 없다.

## 검증

| 구분 | 결과 |
|---|---|
| Rust 단위·통합 테스트 | 22개 통과, 기존 수동 성능 벤치마크 1개 제외 |
| TypeScript·기존 서버 테스트 | 26개 통과 |
| 실제 Mac Tauri WebView | 37개 통과, 비동기 오류 없음 |
| 프런트엔드 | TypeScript 검사·프로덕션 빌드 성공 |
| Mac 배포 | Apple Silicon 앱·DMG·ZIP 빌드, 임시 서명·DMG·ZIP 무결성 확인 |
| Windows 배포 | x64 MSVC 앱·NSIS 설치 EXE 교차 빌드 성공. 실제 Windows 실행은 미검증 |

검색 회귀 테스트에는 위 두 입력 예시, 잘못 나눈 공백, 탭·전각 공백, NFC/NFD 한글 파일명, 공백 있는 상위 경로, 필터와 일반 검색·정규식이 포함된다. 실제 WebView 검증은 검증 폴더 안에 `데이터분석 발굴.pdf`를 생성한 뒤 검색 방식을 **한글 초성**으로 선택하여 첫 세 입력의 검색 결과와 선택 파일을 확인했다.

- [실제 WebView 결과 JSON](../output/playwright/tauri-v071/smoke-data/smoke-report.json)
- [Rust 로그](../output/playwright/tauri-v071/rust-tests.log)
- [기존 서버·TypeScript 로그](../output/playwright/tauri-v071/node-tests.log)
- [화면 빌드 로그](../output/playwright/tauri-v071/ui-build.log)

자동 검증 인덱스와 WebView 저장소는 사용자 데이터와 분리했다. 실제 앱 내부 자동 검증을 완료한 뒤, 2026-10-24에 Mac 잠금을 해제하고 배포용 v0.7.1 앱에서 수동 입력으로 추가 확인했다. 수동 확인에는 별도 검증 인덱스를 사용했으며 검증 후 기존 사용자 인덱스로 앱을 다시 실행했다.

세 입력 모두 `데이터분석 발굴.pdf` 한 개를 찾았고 오른쪽 활성 탐색창에서도 같은 파일이 선택됐다. 검증 데이터 13개 항목에서 화면에 표시된 전체 응답 시간은 65~80ms였다. 이 수치는 모든 파일 규모에 대한 성능 보장이 아니다.

- [공백 있는 초성 검색 화면](../output/playwright/tauri-v071/initials-spaced.png)
- [공백 없는 초성 검색 화면](../output/playwright/tauri-v071/initials-joined.png)
- [다른 위치에 공백을 넣은 검색 화면](../output/playwright/tauri-v071/initials-alternate-spaces.png)
- [수동 검증 접근성 기록](../output/playwright/tauri-v071/manual-initials-ax.txt)

## 설치 파일

- [Mac Apple Silicon DMG](../releases/v0.7.1/EveryDirectory_0.7.1_mac_arm64.dmg)
- [Mac Apple Silicon ZIP](../releases/v0.7.1/EveryDirectory_0.7.1_mac_arm64.zip)
- [Windows x64 설치 EXE](../releases/v0.7.1/EveryDirectory_0.7.1_windows_x64_setup.exe)
- [크기·SHA-256 명세](../releases/v0.7.1/artifacts.json)

Mac Intel 빌드는 포함하지 않는다. Mac은 로컬 임시 서명이며 Apple 공증은 하지 않았다. Windows는 코드 서명 없이 빌드했다. WebView2 추가 다운로드는 Windows 설치 EXE 용량에 포함하지 않는다. 자세한 기능 범위는 [v0.7 기준표](features-v0.7.md)를 따른다.

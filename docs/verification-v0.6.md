# v0.6 검증 기록

검증일: 2026-10-23, macOS 27.0.1 arm64. OCR은 데스크톱에서 제외했다.

- TypeScript / Vite 프로덕션 빌드 통과.
- Rust: 단위 1개 + 파일 엔진 통합 15개 통과, 별도 성능 테스트 1개는 일반 실행에서 제외.
- 기존 Node 경로: 25개 통과. CSV의 한글·경로·따옴표·수식 처리 검증 포함.
- 실제 Tauri WKWebView: 파일이 연결된 상태 19개 + 빈 인덱스 상태 3개 통과, 화면 오류 0개.

## PDF 실행

검색 결과와 탐색창 각각의 PDF 더블클릭 이벤트를 실제 WKWebView에 전달했다. 두 번 모두 Rust 파일 검증과 `/usr/bin/open`의 정상 종료, 실행 완료 알림을 확인했다. OS 미리보기 앱에서 테스트 PDF의 제목·경로·3개 페이지가 표시된 것을 macOS 접근성 트리와 원본 스크린샷으로 별도 확인했다. 기본 앱 명령의 성공은 해당 문서의 모든 페이지 렌더링까지 보장하는 의미가 아니다.

최종 릴리스 앱에서도 마우스 좌표로 검색 결과와 탐색창의 PDF를 각각 더블클릭했다. 검색 결과에서 열린 원본 PDF를 미리보기 앱에서 닫은 뒤, 탐색창에서 다시 열어 제목·경로·3페이지 표시와 앱의 실행 완료 알림을 확인했다. 자동 이벤트 테스트와 별개로 실제 사용자 입력 경로도 확인했다.

사용자의 재진행 요청 후 v0.6.0 릴리스 앱을 다시 실행해 두 위치의 더블클릭을 재확인했다. 오른쪽 탐색창에서 PDF를 연 뒤 문서 창을 닫고, 왼쪽 검색 결과에서 다시 열어 같은 절대 경로와 `Page 1 of 3` 표시를 확인했다. 화면 캡처 단계에서 미리보기 창이 한 차례 감지되지 않았으나, 접근성 창의 Raise 동작 후 캡처까지 완료했다. 재개 검증 화면은 `output/playwright/tauri-v06/05-retry-pdf.png`, `06-retry-app.png`에 보관했다. 이 검증에서는 소스 코드를 추가 변경하지 않았다.

오른쪽 탐색창이 미리보기를 호출하던 연결을 기본 앱 실행으로 수정했다. 검색/탐색창의 Space와 별도 미리보기는 유지한다. OS 명령 생성만 성공하고 연결 실행이 실패하는 경우를 구별하도록 종료 상태와 stderr를 확인한다. Windows는 Explorer 프로세스 전달에서 ShellExecuteW 파일 연결 실행으로 변경했으며 COM 초기화를 적용했다. Windows 실기기 PDF 연결 실행은 아직 확인하지 않았다.

## 추가 통합 확인

- 두 탐색창·첫 번째 활성 상태와 클릭에 따른 위치/선택 연결.
- TXT·이미지·PDF 미리보기, PDF 워커와 파일 범위 응답.
- OR·제외·확장자·크기·현지 수정일을 결합한 검색.
- 현재 폴더 필터, 크기 정렬, 폴더 트리 펼치기, 우클릭 메뉴.
- 검색 조건 저장·복원, 탭·창 작업 공간 저장.
- 드롭 후 복사 선택, 실제 대상 파일 생성과 탐색창 목록 갱신.
- 독립 탭 추가, 탐색창 1·3·4·2개 전환.
- 빈 인덱스에서 가짜 샘플 파일을 표시하지 않고 폴더 연결 안내.

검증 빌드는 sessionStorage를 사용해 사용자의 저장된 탭·북마크와 분리한다. 자동 실행 기록과 검증 명령, WebView 백그라운드 제한 해제는 `smoke-test` 기능에서만 사용한다. 배포 빌드의 localStorage 설정과 구분된다. 이번 수정 과정의 이전 실패 기록은 보존했으며 아래 최종 보고서를 통과 근거로 사용한다.

원본 보고서:
- `output/playwright/tauri-v06/isolated-final/smoke-report.json`
- `output/playwright/tauri-v06/isolated-final/native-opens.json`
- `output/playwright/tauri-v06/isolated-empty/smoke-report.json`
- `output/playwright/tauri-v06/01-native-pdf.png`
- `output/playwright/tauri-v06/02-native-app.png`
- `output/playwright/tauri-v06/03-tree-filter.png`
- `output/playwright/tauri-v06/04-context-menu.png`

[실제 앱 화면 모음](../output/playwright/tauri-v06/index.html)에서 원본 캡처를 확인할 수 있다.

기능 전체 범위와 미구현 항목은 [기능 기준표](features-v0.6.md)를 참고한다. 모든 Everything·Q-Dir 기능과 Windows 실기기 검증을 완료한 것으로 표시하지 않는다.

## 검색 성능 재확인

20만 개 메타데이터의 Rust 릴리스 검색에서 일반 4.17ms, 와일드카드 0.60ms, 정규식 75.64ms, 초성 48.56ms, 퍼지 157.80ms를 측정했다. 모두 부분 결과 없이 끝났다. 디스크 최초 스캔·앱 시작·입력 대기·IPC를 포함하지 않은 검색 엔진 시간이다. 최종 단계에서 긴 경로 정규화 키를 항목당 한 번 계산하도록 바꿨으며 기능 테스트를 다시 통과했다.

실사용 인덱스 약 117만 개(저장 JSON 약 533MB)를 불러오는 과정에서 정렬 비교마다 긴 경로 키를 다시 만드는 병목을 확인하고, `sort_by_cached_key`로 항목당 한 번 계산하도록 수정했다. 수정 후 최종 앱을 다시 열었을 때 도구 호출 약 9.3초 안에 인덱스와 화면이 준비됐다. 이 값에는 화면 관찰 도구 시간이 포함되어 있으며 최초 스캔 성능이 아니다. 해당 인덱스에서 `개발 계획 ext:pdf` 검색은 엔진 43.7ms / 전체 113ms로 표시됐다. 다른 검색어·디스크·인덱스 규모에 대한 일괄 보장은 아니다.

macOS arm64 배포: 앱 약 5.9MiB, DMG 약 3.5MiB, ZIP 약 3.0MiB. 인덱스 데이터는 별도다. 로컬 임시 서명과 무결성 검사를 적용했으며 Developer ID 서명·공증은 별도다. 정확한 크기와 해시는 `output/playwright/tauri-v06/build-artifacts.json`에 기록한다.

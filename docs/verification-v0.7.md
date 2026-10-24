# v0.7 검증 및 배포 기록

검증일: 2026-10-23. 환경: macOS Apple Silicon, React + Tauri 2 + Rust. 실제 파일은 프로젝트 안의 별도 검증 폴더를 사용했으며, 자동 검증의 인덱스·WebView 데이터는 사용자 데이터와 분리했다. OCR은 데스크톱 빌드에 포함하지 않는다.

## 검증 결과

| 구분 | 결과 | 범위 |
|---|---|---|
| Rust | 21개 통과, 성능 벤치마크 1개 제외 | 단위 1개, 기존 엔진 통합 15개, 신규 파일·분석 통합 5개 |
| 기존 Node 테스트 | 25개 통과 | 웹 호환 서버의 검색·파일 기능 회귀 검증. 데스크톱에 Node/OCR을 포함한다는 뜻은 아님 |
| 실제 Tauri WebView | 34개 통과 | 검색·활성 창·미리보기·기본 앱 실행·탭·창 개수·메뉴·실제 파일 생성/복제·분석·트레이 |
| 빈 인덱스 WebView | 3개 통과 | 샘플 파일 없는 시작, 두 탐색창, 폴더 연결 안내 |
| Mac 배포 파일 | 통과 | 릴리스 앱 빌드, 로컬 임시 서명 무결성, DMG 체크섬, ZIP 압축 무결성 |
| Windows 배포 파일 | 빌드·형식 확인 통과 | x64 MSVC 앱과 NSIS 설치 EXE. Windows에서 설치·실행은 검증하지 못함 |

최종 화면 자동 검증은 [JSON 결과](../output/playwright/tauri-v07/smoke-data-final-2/smoke-report.json)에 기록했다. 34개 모두 통과했고 비동기 오류는 없다. 빈 화면은 [별도 JSON 결과](../output/playwright/tauri-v07/empty-data/smoke-report.json)에 기록했다.

검색의 한 번 클릭은 활성 탐색창의 위치·파일 선택에 반영된다. 검색 목록과 탐색창의 PDF 더블클릭 모두 Rust가 OS의 기본 앱 실행 명령을 완료했으며, 수동 검증에서 macOS 미리보기 앱에 실제 3페이지 PDF가 열린 것을 확인했다. 파일을 읽는 미리보기는 실제 네이티브 파일 프로토콜을 사용했다.

새 파일 생성·복제는 실제 디스크에 반영되는 것을 확인했다. 같은 이름으로 다시 복사하면 대화상자 안에 오류가 표시되고 기존 파일이 한 개로 유지되는 회귀 검증을 추가했다. 수동 F5 복사에서도 같은 오류 표시를 확인했다. 폴더 용량·중복·비교 결과는 Rust에서 실제 파일을 읽은 결과다. 분석 한도·미확인 상태와 내용이 다른 파일 구분은 Rust 통합 테스트에 포함한다.

트레이는 네이티브 아이콘 등록, 기본 백그라운드 설정, 창을 숨긴 뒤 프로세스/IPC 유지, 다시 표시를 검증했다. 릴리스 앱의 두 번째 실행이 기존 창과 검색창을 복원하는 것도 확인했다. 전역 단축키 등록 오류가 없는 것은 확인했지만, 컴퓨터 조작 도구를 통한 OS 전역 키 입력과 macOS 메뉴 막대 트레이 메뉴 클릭은 직접 검증하지 못했다.

## 배포 파일

| 대상 | 파일 | 크기 |
|---|---|---|
| macOS Apple Silicon | [DMG](../releases/v0.7.0/EveryDirectory_0.7.0_mac_arm64.dmg) | 3.61 MiB |
| macOS Apple Silicon | [ZIP](../releases/v0.7.0/EveryDirectory_0.7.0_mac_arm64.zip) | 3.09 MiB |
| Windows x64 | [설치 EXE](../releases/v0.7.0/EveryDirectory_0.7.0_windows_x64_setup.exe) | 2.53 MiB |

정확한 바이트와 해시는 [배포 명세](../releases/v0.7.0/artifacts.json), [SHA256SUMS](../releases/v0.7.0/SHA256SUMS.txt)에 있다. 설치 방법은 [사용 안내](../releases/v0.7.0/사용%20안내.md)를 참고한다.

Mac은 Apple 공증 없이 로컬 임시 서명했다. Windows는 서명되지 않았으며 실제 Windows 설치·트레이·기본 앱 연결은 추가 확인이 필요하다. Windows에 WebView2가 없으면 런타임 설치가 필요하며 이 다운로드 크기는 설치 EXE 크기에 포함하지 않는다. Mac Intel 빌드는 포함하지 않는다.

## 실제 화면

[스크린샷 11장](../output/playwright/tauri-v07/screenshots.md)과 [HTML 갤러리](../output/playwright/tauri-v07/gallery.html)에 라이트/다크, 아이콘·단축키 메뉴, 파일 도구, 분석, PDF 기본 앱 실행, 복사 충돌 안내를 모았다. 모두 실제 Mac 앱 화면이며 디자인 목업이 아니다.

## 재현 명령

```sh
npm run build
npm run test:rust
npm test
npm run desktop:build -- --bundles app
npm run desktop:package:mac
npm run desktop:build:windows
```

WebView 검증은 `smoke-test` 기능으로 디버그 앱을 빌드하고 `EVERY_DIRECTORY_DATA`와 `EVERY_DIRECTORY_SMOKE_ROOT`를 별도 검증 경로로 지정한다. 배포 빌드에는 검증 스크립트와 검증용 IPC를 포함하지 않는다. Windows 교차 빌드는 Rust MSVC 대상, cargo-xwin, LLVM/LLD, NSIS가 필요하다.

Finder·Windows 탐색기·Everything·Q-Dir의 모든 기능을 구현한 상태는 아니다. 구현 범위와 OS 외부 파일 클립보드·범용 실행 취소 등 남은 항목은 [기능 기준표](features-v0.7.md)에 명시했다.

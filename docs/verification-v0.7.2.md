# v0.7.2 검색 속성 선택과 호버 하위 메뉴

검증일: 2026-10-24. React 화면에서 검색 결과의 표시 열을 선택하고, 파일 우클릭 메뉴를 포인터 이동으로 펼치도록 변경했다. Rust 검색·파일 엔진의 동작과 OCR 제외 범위는 유지한다.

## 변경 사항

- **표시 항목**에서 이름·위치·유형·확장자·크기·수정일·연결 폴더·전체 경로를 선택한다. 이름은 필수이며 기본 구성은 이름·위치·크기·수정일이다.
- 설정은 자동 저장하고 기본값 복원과 Esc 초점 복귀를 지원한다. 열 제목으로 오름차순·내림차순 정렬을 전환한다. 정렬한 열을 감추면 검색 엔진의 기본 결과 순서로 돌아간다.
- 열이 많으면 가로 스크롤로 모두 확인한다. 머리글과 행의 스크롤을 맞추며 기존 가상 스크롤·검색 결과 클릭·더블클릭·우클릭 동작을 유지한다.
- 수정일은 날짜와 시각, 파일 크기는 읽기 쉬운 단위로 표시한다. 폴더 용량과 수집하지 못한 값은 대시로 표시한다. 파일 시스템의 생성일·접근일·권한은 현재 인덱스에 없어 추가하지 않았다.
- 주 메뉴를 유지한 채 하위 메뉴를 옆에 펼친다. 마우스를 올리면 지연 없이 열리고, 다른 그룹으로 이동하면 전환한다. 메뉴 사이를 이동할 때 유지하고 화면 경계에서는 왼쪽으로 펼치거나 위로 조정한다.
- 클릭·터치 선택도 지원하고 →/←로 하위 메뉴 진입·복귀, ↑/↓·Home·End로 이동, Enter로 실행한다. Esc는 하위 메뉴부터 닫고 Tab과 메뉴 밖 클릭은 전체 메뉴를 닫는다. 기존 아이콘·단축키·비활성 조건을 유지한다.

## 검증 결과

| 구분 | 결과 |
|---|---|
| TypeScript·기존 서버 테스트 | 29개 통과 |
| 프런트엔드 | TypeScript 검사·프로덕션 빌드 성공 |
| 실제 Mac Tauri WKWebView | 49개 통과, 비동기 오류 없음 |
| Mac 배포 | Apple Silicon 앱·DMG·ZIP 생성, 로컬 임시 서명 적용 |
| Windows 배포 | x64 MSVC 앱·NSIS 설치 EXE 교차 빌드 성공. 실제 Windows 설치·실행은 미검증 |

표시 설정의 필수 열·잘못된 저장값·중복값과 Mac/Windows 경로 처리, 폴더·미수집 속성 처리를 단위 테스트했다. 실제 WebView에서는 8개 열 선택과 저장, 가로 스크롤의 머리글 정렬, 크기 정렬, 기본값·초점 복원을 검증했다. 하위 메뉴는 **클릭 이벤트 없이 포인터 진입 이벤트만**으로 열고 전환했으며, 메뉴 경계 이동·화면 경계 보정·키보드 진입과 복귀를 확인했다. 기존 PDF·이미지·텍스트 미리보기, PDF 기본 앱 실행, 탭·창·파일 도구·초성 검색·트레이 검증도 포함했다.

최종 자동 검증은 별도 파일 인덱스와 sessionStorage 설정으로 실행했다. 날짜 필터 검증을 위해 검증 파일의 수정일을 실행 당일로 맞췄다. 초기 검증의 날짜·저장소·비동기 대기 조건을 보완했으며, 통과 근거는 아래 최종 결과만 사용한다. 테스트 29개 중 OCR 관련 검증은 남아 있는 구형 Node 서버에 해당하며 Tauri 배포판에 OCR을 추가하지 않는다.

- [최종 WebView 결과 JSON](../output/playwright/tauri-v072/verified-data/smoke-report.json)
- [TypeScript·기존 서버 테스트 로그](../output/playwright/tauri-v072/node-tests.log)
- [프런트엔드 빌드 로그](../output/playwright/tauri-v072/ui-build.log)
- [Mac 빌드 로그](../output/playwright/tauri-v072/mac-build.log)
- [Windows 빌드 로그](../output/playwright/tauri-v072/windows-build.log)

검증용 프런트엔드를 별도 경로에 빌드하려면 다음을 사용한다. 배포 프런트엔드와 검증 자산을 동시에 덮어쓰지 않는다.

```sh
VITE_ED_VERIFICATION=1 npx vite build --outDir output/playwright/tauri-v072/dist-smoke
npm run desktop:build -- --debug --features smoke-test --bundles app --config '{"build":{"frontendDist":"../output/playwright/tauri-v072/dist-smoke","beforeBuildCommand":""}}'
```

실행 시 `EVERY_DIRECTORY_DATA`와 `EVERY_DIRECTORY_SMOKE_ROOT`에 새 검증 경로를 지정한다. 검증 파일 구성은 README의 검증 절을 따른다. 배포 빌드는 `smoke-test` 기능과 검증용 sessionStorage를 포함하지 않는다.

## 실제 앱 화면

아래 화면은 검증용 실제 로컬 파일을 연결한 Mac Tauri 앱에서 촬영했다. 메뉴 화면은 직접 우클릭해 펼친 상태이며, 클릭 없는 호버 동작의 자동 검증은 위 JSON에 기록했다.

- [파일 속성 선택 창](../output/playwright/tauri-v072/01-search-column-picker.png)
- [여러 속성을 함께 표시한 검색 결과](../output/playwright/tauri-v072/02-search-attributes.png)
- [주 메뉴 옆 하위 메뉴](../output/playwright/tauri-v072/03-context-submenu.png)
- [수동 확인 접근성 기록](../output/playwright/tauri-v072/manual-ui-ax.txt)

## 설치 파일

- [Mac Apple Silicon DMG](../releases/v0.7.2/EveryDirectory_0.7.2_mac_arm64.dmg) — 3.616 MiB
- [Mac Apple Silicon ZIP](../releases/v0.7.2/EveryDirectory_0.7.2_mac_arm64.zip) — 3.090 MiB
- [Windows x64 설치 EXE](../releases/v0.7.2/EveryDirectory_0.7.2_windows_x64_setup.exe) — 2.532 MiB
- [크기·SHA-256 명세](../releases/v0.7.2/artifacts.json)

Mac Intel 빌드와 Apple 공증, Windows 코드 서명은 포함하지 않는다. Windows WebView2가 없으면 설치 중 런타임을 다운로드하며 그 용량은 위 EXE에 포함하지 않는다.

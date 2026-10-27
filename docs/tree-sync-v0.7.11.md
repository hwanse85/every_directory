# 0.7.11 탐색 트리 동기화

기존 트리는 펼침 상태만 관리해 주소 이동이나 탭 전환으로 현재 폴더가 달라져도 상위 가지가 접힌 채로 남았습니다. 활성 탭의 현재 경로가 바뀔 때 해당 폴더까지 자동으로 펼치고, 선택 표시와 스크롤 위치를 맞추도록 수정했습니다. 키보드 초점을 강제로 옮기지는 않습니다.

- 탐색창마다 트리 표시 여부를 저장하고, 각 탭의 펼침 상태를 독립적으로 복원합니다.
- 주소 입력, 검색 결과 연결, 뒤로·앞으로, 탭 전환과 재실행에 같은 동기화를 적용합니다.
- 목록의 숨김 폴더 설정을 트리에도 적용하며, 현재 경로를 표시하는 데 필요한 상위 폴더는 유지합니다.
- 비어 있던 폴더에 하위 폴더가 생긴 경우에도 인덱스 변경 후 트리를 갱신합니다.
- 방향키·Home/End로 트리를 탐색하고 Enter로 이동합니다. Ctrl+클릭·가운데 클릭은 새 탭으로 엽니다.
- 트리의 폴더를 파일 드롭 대상으로 인식하며, 폴더 읽기에 실패하면 오류와 재시도 버튼을 표시합니다.

TypeScript/서버 테스트 50개, 실제 Windows 11 Tauri/WebView2 E2E 13개 모음의 187개 검사를 통과했습니다. 트리 검사는 16개이며 주소·기록·창·탭·재실행 동기화, 숨김 설정, 하위 폴더 생성 후 갱신과 드롭 대상 경로를 포함합니다. 읽기 실패의 재시도 UI는 이번 네이티브 자동 검사에 포함하지 않았습니다. 기존 Windows 10 IME 실기 검증 범위는 [0.7.10 기록](columns-ime-startup-v0.7.10.md)과 같습니다.

[프로그램 소개 페이지](introduction/index.html)는 빠른 검색 단축키와 한글 초성 검색을 짧게 소개합니다. 화면은 개인정보가 없는 예시 데이터와 실제 React UI를 사용하는 격리 브라우저 미리보기에서 촬영했습니다. Windows 캡처 도구의 모니터 캡처 오류 때문에 네이티브 창 촬영을 대체했으며, 예시 데이터 연결에 공식 Tauri IPC mock을 사용합니다. 이는 위 네이티브 E2E 결과와 별개입니다.

## English summary

The folder tree now reveals the current tab's ancestors, marks its location, and scrolls it into view without stealing keyboard focus. Expansion is saved per tab, while tree visibility is saved per pane. Address/history navigation, tab changes, hidden-folder settings, and newly created subfolders stay synchronized. Keyboard navigation, opening tree locations in new tabs, and folder drop targets are also supported.

Validation passed: 50 TypeScript/server tests and 187 checks across 13 actual Windows 11/WebView2 E2E suites, including 16 tree checks. The read-error retry UI was not part of the native automated checks. Introduction-page screenshots use the actual React UI in an isolated browser presentation fixture with official Tauri IPC mocks and synthetic files; they are separate from the native E2E evidence.

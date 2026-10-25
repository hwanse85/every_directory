# 0.7.9 작업 공간 확대

검색과 탐색에 필요한 실제 파일 목록을 더 넓게 보여주도록 화면을 정리했습니다.

- 큰 작업 공간 제목, 홍보 문구, 연결 폴더 수, 중복 검색·탐색 제목과 하단 상태 표시를 제거했습니다.
- 파일 도구·레이아웃·탐색창 개수·폴더 연결을 높이 40px의 상단 도구 모음으로 옮겼습니다. 검색·명령·테마·도움말·설정 버튼도 유지합니다.
- 사이드바를 접고 펼칠 수 있으며, 설정을 저장합니다. 접으면 작업 폭이 176px 넓어집니다.
- 검색 조건·파일 분류·탐색창 도구 모음의 여백을 줄였습니다. 창이 작아지면 버튼 설명을 아이콘과 툴팁으로 표시하고, 검색 조건은 검색창 폭에 맞게 배치합니다.
- 앱 정보·버전·라이선스는 설정에서 확인합니다. 파일 목록 밀도 설정은 유지합니다.

## Windows 검증

실제 Tauri/WebView2에서 11개 E2E 모음의 142개 검사를 모두 통과했습니다. 건너뛴 검사는 없습니다. 이 중 화면 배치 검사는 16개로, 버튼 위치·레이아웃 메뉴·사이드바 설정 유지·탐색창 개수 변경·검색 단축키와 작은 창 크기를 확인합니다. 기존 검색·초성 입력·탭·복사·이동·클립보드·드래그 앤 드롭 등 회귀 검사도 포함합니다. 별도 단위 테스트 44개와 라이선스 목록 608개 확인도 통과했습니다.

| 클라이언트 크기 | 상단 도구 모음 | 작업창 시작 위치 | 작업창 높이 | 화면 높이 대비 |
| --- | --- | --- | --- | --- |
| 1440×960 | 40px | 46px | 908px | 94.6% |
| 900×640 | 40px | 46px | 588px | 91.9% |

수치는 Windows 창 테두리를 제외한 앱 내부 영역 기준입니다. 작은 창에서도 상단 도구가 화면 안에 표시되는지 검사했습니다. 테스트는 생성한 임시 파일과 별도 앱 데이터로 진행했습니다.

Windows x64 NSIS 설치본은 `npm run desktop:build:windows`로 생성합니다. 이전 앱은 트레이 메뉴에서 완전히 종료한 뒤 새 설치본을 실행합니다. WebView2 런타임이 필요합니다.

## English summary

Version 0.7.9 removes the large workspace heading, promotional labels, duplicate panel headings, and redundant status bars. Essential actions now share a 40px toolbar. The sidebar can be collapsed, adding 176px of working width, and its state persists. Search controls and explorer toolbars use less padding; list-density preferences remain available. App version and license information remain in Settings.

All 142 checks across 11 actual Tauri/WebView2 E2E suites passed without skips, including 16 layout checks and the existing file-operation regressions. Unit tests (44) and the third-party license inventory (608) also passed. The working area begins 46px below the top and occupies 94.6% of a 1440×960 client area or 91.9% at 900×640. Tests used generated fixtures and isolated app data.

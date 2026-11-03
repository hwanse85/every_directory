# macOS E2E 확대와 결함 수정

## 고친 결함

### 1. 설정이 바뀌면 검색 결과 선택이 풀림
- **증상:** 데스크톱 앱에서 "검색 결과 선택 시 탐색창 따라가기"를 켜고 검색 결과를 누르면, 약 1초 뒤 선택이 풀렸습니다. 글자 크기 같은 검색과 무관한 설정을 바꿔도 같은 일이 생겼습니다.
- **원인:**
  - 검색 조건 키에 설정 객체 전체가 들어 있었습니다.
  - 백엔드 응답에 붙은 `preferencesWarning`이 처음 불러온 설정에는 있고, 변경 알림에는 없었습니다. 그래서 값이 같아도 조건이 바뀐 것으로 보고 검색을 다시 돌리며 선택을 지웠습니다.
- **수정:**
  - `normalizePreferences`는 알려진 설정 항목만 남깁니다.
  - 메인 검색은 결과에 영향을 주는 설정(숨김·임시·휴지통 표시, 한 번에 불러올 개수)이 바뀔 때만 다시 검색합니다.
  - 빠른 검색 창도 같은 이유로 고른 줄이 처음으로 돌아가던 것을 고쳤습니다. 경로 검색, 숨김·임시·휴지통 표시 설정이 바뀔 때만 다시 검색합니다.
  - 빠른 검색은 클립보드 키워드 일치 여부(`clipboardTrigger`)를 쓰면서도 의존성에서 빠져 있었습니다. 지금까지는 설정 객체 전체가 의존성이라 드러나지 않았습니다. 이번에 의존성에 넣었고, quick 스위트(25개)로 확인했습니다.
- **검증:** ux 스위트에 두 항목을 추가했습니다.
  - "따라가기 켜짐: 위치를 옮긴 뒤에도 검색 결과 선택 유지"
  - "검색과 무관한 설정을 바꿔도 검색 결과 선택 유지"
  - 단위 테스트: 설정 정규화가 모르는 항목을 버리는지 확인합니다.

### 2. macOS Finder에서 숨긴 파일을 숨김으로 보지 않음
- **증상:** Finder에서 숨긴 파일(`chflags hidden`, UF_HIDDEN 플래그)이 "숨김 파일 표시"를 꺼도 보였습니다. 이름이 `.`으로 시작하는 파일만 숨김으로 처리했습니다.
- **수정:** `store::native_hidden`으로 판단 코드를 한곳에 모았습니다. Windows는 숨김 속성, macOS는 점 이름과 UF_HIDDEN 플래그를 봅니다.
- **검증:** Rust 단위 테스트를 추가했고, history 스위트의 "숨김 속성과 휴지통 표시 설정 반영" 항목이 macOS에서 통과합니다.

### 3. macOS 붙여넣기 보드·드롭 경로의 한글이 분리형(NFD)으로 들어옴
- **증상:** Finder나 앱에서 복사한 파일 경로를 macOS가 자모 분리형으로 돌려줍니다(예: "업무 보고서.txt"가 59자 대신 65자). 그래서 클립보드 이력에서 "보고서"로 찾아도 걸리지 않고, 이름 비교도 어긋났습니다. Finder에서 끌어다 놓은 파일도 분리형 이름으로 만들어질 수 있었습니다.
- **수정:**
  - macOS 클립보드 파일 읽기(`file_clipboard::read_files`)와 외부 파일 가져오기(`import_files`)에서 경로를 조합형(NFC)으로 바꿉니다.
  - APFS는 두 형태를 같은 파일로 찾으므로 원본을 찾는 데는 문제가 없습니다.
- **검증:** Rust 단위 테스트를 추가했고, history 스위트의 "운영체제 파일 클립보드 경로 저장" 항목이 macOS에서 통과합니다.

## E2E 범위 확대

| | 이전 | 이후 |
|---|---|---|
| macOS 스위트 | 6개(ux·quick·empty·desktop·audit·portable) | 17개(+ search·explorer·history·layout·columns·tree·actions·grid·clipboard·drag·transfer) |
| Windows 전용으로 남은 스위트 | | shell-new(Windows 새로 만들기 메뉴), history-monitor(Windows 클립보드 감시), windows(Windows 셸 UI) |

macOS에서 돌게 하려고 바꾼 것:
- **주입 조건:** 공용 스위트의 E2E 스크립트 주입 조건을 `#[cfg(all(windows, feature = "smoke-test"))]`에서 `#[cfg(feature = "smoke-test")]`로 넓혔습니다.
- **경로 구분자:** 테스트 코드가 행 경로를 `\` 구분자로 비교하던 것을 두 구분자 모두 받도록 바꿨습니다(actions·transfer·drag·clipboard·explorer).
- **창 크기:** layout의 900×640 작은 창 대기는 macOS 제목 표시줄 높이만큼 내용 높이가 작아지는 것을 허용합니다.
- **Insert 키:** macOS 키보드에는 Insert 키가 없어, clipboard의 Shift+Insert 붙여넣기 단계는 Windows에서만 검사합니다.
- **history 스위트:**
  - 숨김 파일을 만들 때 macOS에서는 `chflags hidden`을 씁니다.
  - 테스트 이미지 기록은 플랫폼 공용으로 바꿨습니다.
  - 기록 금지 표시 검사는 macOS에서 `org.nspasteboard.ConcealedType`을 씁니다.

## 검증 결과

- macOS 전체 E2E: 17개 스위트 354개 항목 통과(`npm run test:e2e`).
- 단위 테스트 72개, Rust 테스트 68개 통과. Windows 대상 `cargo xwin check --features smoke-test` 통과.
- Windows 실제 실행(20개 스위트)은 푸시 뒤 CI에서 확인합니다. 테스트 코드의 경로 비교는 `\`와 `/`를 모두 받으므로 Windows 동작은 그대로입니다.

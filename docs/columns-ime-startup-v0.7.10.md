# 0.7.10 칼럼 조절·IME·시작 대기 개선

## 칼럼과 목록 조작

검색 결과와 각 탐색창의 목록 보기에서 모든 헤더에 항상 보이는 경계선과 조절 핸들을 제공합니다.

- 경계선을 좌우로 드래그해 너비를 바꿉니다. 드래그는 정렬이나 파일 이동을 실행하지 않습니다. 진행 중 Esc를 누르면 이전 너비로 돌아갑니다.
- 경계선 더블클릭 또는 Enter는 해당 칼럼의 내용에 너비를 맞춥니다. 긴 목록에서는 처음 1,000개 항목을 측정합니다.
- 경계선에 키보드 초점을 두고 ←/→로 10px, Shift+←/→로 40px씩 조절합니다. 칼럼별 최소 너비와 최대 2,000px 제한을 적용합니다.
- 헤더 우클릭 또는 오른쪽 칼럼 설정 버튼에서 전체 내용 맞춤·기본 너비 복원을 실행합니다.
- 검색 결과와 탐색창별 너비를 각각 저장합니다. 폴더·탭 이동과 앱 재실행 후에도 유지합니다.
- 좁은 탐색창에서 유형·크기·수정일을 자동으로 숨기던 기존 규칙을 해제했습니다. 지정한 너비를 유지하고 가로 스크롤로 접근하며, 헤더와 파일 행이 함께 움직입니다. 격자 보기는 유지합니다.
- 두 목록 모두 정렬 방향을 표시하고, 잘린 속성은 툴팁으로 확인할 수 있습니다.

## 한글 초성 중복 입력

이전 코드는 조합 중 겹자음이 생기면 입력창을 강제로 blur하고 다음 프레임에 다시 focus한 뒤 문자열을 고쳤습니다. 이는 IME가 소유한 조합 범위와 앱의 값 수정을 겹치게 만드는 경로입니다. Windows 10에서 보고된 `ㅂㄱㅅ → ㅂㄱㄱㅅ`의 원인 후보로 이 경로를 제거했습니다. Windows 10 실기에서 이벤트 기록을 수집한 것은 아닙니다.

새 공통 입력 처리는 메인 검색·독립 빠른 검색·현재 폴더 필터에 적용됩니다. 조합 중에는 원문과 초점을 유지하며, 조합 종료 주변의 최종 input 이벤트가 처리된 다음 프레임에 한 번만 정규화합니다. 입력 도중에는 별도 시각 표시로 `ㅂㄳ`를 `ㅂㄱㅅ`로 보여주므로, 이를 위해 활성 조합 문자열을 덮어쓰지 않습니다. 커서 위치를 변환하고 일반 한글 음절·된소리·의도적으로 반복한 자음은 보존합니다.

조합 중 DOM 업데이트와 composition/input 이벤트의 관계는 [W3C UI Events](https://www.w3.org/TR/uievents/#events-composition-input-events), 구현별 종료 순서 차이는 [W3C UI Events Algorithms](https://www.w3.org/TR/uievents/event-algo.html#end-composition)를 참고했습니다.

## 시작 지연 분석

기존 앱은 창 생성 setup 과정에서 저장 인덱스 JSON 읽기, 변경 기록 복원, 검색 키 재구성, 폴더 감시 등록을 동기적으로 실행했습니다. 항목이 많으면 이 작업이 초기 화면 표시를 막습니다. Tauri 앱이 반드시 이 방식으로 기다려야 하는 것은 아닙니다.

이 작업을 전용 백그라운드 스레드로 옮겼습니다. 화면과 설정은 먼저 표시하며, 검색 영역에 인덱스 로딩 상태를 알립니다. 검색·파일 작업과 저장된 탐색창 복원은 데이터가 준비될 때까지 기다려 빈 인덱스를 실제 상태로 잘못 저장하지 않도록 했습니다. 인덱스 읽기에 실패하면 오류를 전달하고 기존 파일은 보존합니다. 트레이 시작 시 인덱스가 비었거나 손상됐으면 메인 창을 표시합니다.

생성한 10만 항목의 저장 인덱스를 사용한 Windows 11 **디버그 엔진 벤치마크**:

| 방식 | 엔진 준비 호출에서 차단된 시간 | 인덱스 사용 가능까지 |
| --- | --- | --- |
| 기존 동기 방식 | 3,730ms | 3,730ms |
| 백그라운드 방식 | 1ms 미만 | 3,736ms |

측정은 동일한 복원 알고리즘의 실행 위치를 비교한 것입니다. 실제 앱 전체 실행 시간이나 Windows 10의 실측값이 아니며, WebView2 초기화 시간도 포함하지 않습니다. 인덱스를 복원하는 총 CPU 작업과 처음 폴더를 연결할 때의 파일 스캔은 여전히 필요합니다. 이번 수정은 그 작업 때문에 창 표시까지 함께 지연되는 문제를 해결합니다.

## 검증과 배포

- TypeScript/서버 단위 테스트 47개 통과.
- Rust 일반 테스트 54개 통과. 대용량 비교 테스트는 C: 임시 저장 공간 부족으로 실패한 뒤 충분한 공간의 격리 임시 폴더에서 재실행해 통과했습니다. 위 10만 항목 벤치마크는 별도로 실행했습니다.
- 실제 Windows 11 Tauri/WebView2 E2E 12개 모음, 171개 검사 통과. 건너뛴 모음 없음. 칼럼 검사는 26개이며 기존 복사·이동·클립보드·드래그·탭·검색 등도 포함합니다.
- IME 검사는 최종 input이 조합 종료 전·후에 도착하는 순서, 초점 유지, 중간 위치 편집과 커서 복원, 연속 조합, 된소리·완성형·반복 자음 보존을 재현했습니다. Windows 10의 실제 키보드/IME 조합에 대한 재검증은 별도입니다.
- 생성한 파일과 별도 앱 데이터로 실제 마우스 드래그를 확인했습니다. 기존 설치 앱의 데이터는 검증에 사용하지 않았습니다.
- 의존성·라이선스 608개와 앱 버전이 일치합니다. 배포 파일은 Windows x64 NSIS 설치본이며 WebView2 런타임이 필요합니다.

이전 앱은 트레이에서 완전히 종료한 뒤 새 설치본을 실행합니다.

## English summary

Version 0.7.10 adds visible, draggable column boundaries to search and explorer lists. It includes double-click auto-fit, keyboard resizing, drag cancellation, independent saved widths, and a header menu for fit-all/reset. Narrow panes retain every attribute through synchronized horizontal scrolling rather than hiding columns.

Korean search fields no longer blur/refocus or rewrite native IME text during composition. A visual mirror displays separated consonants while preserving the native composition range. Normalization runs after the final composition event batch, with caret preservation. Tests cover both final-input event orders, repeated input, tense consonants, and ordinary Korean syllables. Actual Windows 10 IME verification remains separate from these Windows 11 tests.

Saved-index restoration now runs on a background thread rather than blocking window setup. Data-dependent actions wait for readiness; loading failures preserve existing data. A synthetic 100,000-entry debug-engine benchmark measured 3,730ms of synchronous setup versus less than 1ms to return from asynchronous setup, with index readiness still taking 3,736ms. These are engine measurements, not full application launch times.

Validation passed: 47 TypeScript/server tests, 54 regular Rust tests, an explicit startup benchmark, 171 checks across 12 actual Windows 11/WebView2 E2E suites without skips, manual mouse drags, and the 608-entry license inventory.

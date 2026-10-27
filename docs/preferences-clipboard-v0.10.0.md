# 사용자 설정과 클립보드 — 0.10.0

## 검색에 표시할 파일

기본값은 숨김 파일, 임시·잠금 파일, 휴지통 항목을 표시하지 않는 것이다. 설정에서 각각 다시 표시할 수 있으며, 원본 파일을 삭제하거나 인덱스에서 제거하지 않는다.

| 분류 | 기본 처리 | 판단 기준 |
|---|---|---|
| 숨김 파일·폴더 | 검색·탐색 목록에서 제외 | Windows 숨김 속성, 점으로 시작하는 이름, 인덱스의 숨김 상위 폴더 |
| 임시·잠금 파일 | 제외 | Office `~$`, `.~lock.`, `.#`, `.tmp`, `.temp`, `.swp`, `.swo` |
| 휴지통 | 제외 | `$Recycle.Bin`, `Recycler`, `.Trash`, `.Trashes` 등의 경로 구성 요소 |
| 일반 `$` 파일 | 표시 | `$budget.txt`처럼 `$`로 시작한다는 사실만으로 숨김·임시 파일로 판단하지 않음 |

‘임시 파일 표시’와 ‘휴지통 항목 표시’는 해당 분류의 숨김 여부와 관계없이 각각 적용한다. 검색 결과의 개수·정렬·페이지 처리는 이 정책을 적용한 뒤 계산한다. 숨김 표시 단축키도 설정과 연결해 저장한다. 권한 문제나 기존 인덱스 제외 규칙으로 수집하지 못한 파일까지 표시하는 옵션은 아니다. 현재 경로의 트리 상위 항목은 위치를 잃지 않도록 표시할 수 있다.

## 저장되는 사용자 설정

설정 화면에서 변경 후 **사용자 설정 저장**을 누른다. 검색 표시 정책, 매칭 강조, 빠른 검색의 경로 검색, 입력 대기 시간, 페이지당 결과 수, 파일 목록 글자 크기, 활성 탐색창 색, 새 창의 기본 보기, 클립보드 옵션을 추가했다.

사용자 설정은 앱 데이터의 `preferences.json`, 자동 시작·전역 단축키 등은 `desktop.json`, 기존 탭·칼럼·트리 너비·테마·레이아웃은 WebView 저장소에서 복원한다. 변경한 사용자 설정은 메인 창과 빠른 검색창에 동기화한다. 잘못된 범위는 저장하지 않으며, 손상된 사용자 설정은 알림과 함께 기본값으로 열고 기존 파일은 새 설정을 저장하기 전까지 보존한다.

## 초성 검색 강조와 활성 창

- 메인 검색·빠른 검색·현재 폴더 필터의 일치 부분을 강조한다. `ㅂㄱㅅ → 보고서`, `보고ㅅ → 보고서`, 된소리와 띄어쓰기를 지원한다.
- 이름 외에 화면에 표시된 경로·확장자 등의 일치 부분도 강조한다. `path:ㄱㄹㅂㄱㅅ`가 파일명 대신 ‘경로 보고서’ 폴더에서 일치해도 경로 칼럼을 강조한다. 이 변경은 모든 Windows 속성의 내용 검색 기능을 새로 추가하는 것은 아니다.
- 강조 패턴을 캐시하고 안전한 RE2 검색을 사용한다. 퍼지 검색에서 오타가 있는 단어 전체의 편집 거리까지 시각화하는 기능은 포함하지 않는다.
- 활성 탐색창에는 3px 테두리와 상단 강조선을 추가했다. 파랑·보라·주황·초록 중 선택할 수 있다.

## 도구와 클립보드 이력

상위 **파일 도구** 메뉴는 **도구**로 변경했다. 내부에 **파일 도구 / 클립보드** 탭을 제공하며, 기존 파일 작업 기능은 파일 도구 탭에 유지한다. 탭은 좌우 화살표로 전환할 수 있다.

클립보드는 Windows에서 앱이 실행 중일 때 자동 기록한다. 창을 닫아도 트레이 실행을 유지하면 계속 기록하며, 앱을 완전히 종료한 동안의 변경은 수집할 수 없다.

| 항목 | 동작 |
|---|---|
| 텍스트 | 일반 텍스트 원문 저장, 전체 본문 검색·미리보기·TXT 사본 저장 |
| 파일·폴더 | 최대 200개 원본 경로 보관, 파일 클립보드 복원·경로 텍스트 복사·다른 폴더에 사본 저장 |
| 이미지·화면 캡처 | PNG 내용 저장, 미리보기·이미지 클립보드 복원·PNG 사본 저장 |
| 기간 | **기본 10일**, 1~60일을 슬라이더로 1일씩 조절 |
| 정렬 | 최신 복사 순, 동일 내용은 중복 병합 |
| 편의 기능 | 종류 필터, 본문 검색, 즐겨찾기, 기록 일시정지, 개별·전체 삭제 |
| 키보드 | ↑↓ 선택, Enter 복사, 목록 항목에서 Delete 삭제, Ctrl+F 이력 검색 |

파일 이력은 파일 전체를 백업하는 기능이 아니다. 원본이 이동·삭제되면 파일 복원이나 사본 저장이 실패할 수 있으며, 저장된 경로는 텍스트로 복사할 수 있다. 파일 사본 저장에는 Windows Shell 파일 작업을 사용하고, 같은 이름이 있으면 번호 이름을 선택해 덮어쓰지 않는다. 텍스트·이미지 사본도 기존 파일을 덮어쓰지 않는다.

### 빠른 검색

**Ctrl+Shift+Space → `clip` → Enter**로 최신 클립보드 목록을 연다. 키워드는 설정에서 변경할 수 있다. 키워드를 입력하면 일반 파일 검색 결과와 함께 **클립보드 보기** 항목이 맨 위에 나타난다. Esc로 파일 검색에 돌아간다. 목록에서 미리보기·복사·저장을 사용할 수 있다.

### 저장·제외 정책

Windows에서는 이력 목록과 내용 모두 현재 사용자 계정의 [DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)로 암호화해 PC 내부에 저장한다. 서버나 클라우드로 전송하지 않는다. 이력 내용은 최대 200 MB / 2,000개이며, 항목별 최대 크기는 기본 16 MB에서 1~64 MB로 조절한다. 이미지는 최대 1,677만 픽셀까지 처리한다. PNG는 JSON 숫자 배열로 디스크에 저장하지 않고 원본 바이트로 암호화한다.

보관 기간을 넘기면 즐겨찾기도 삭제한다. 앱 시작·목록 조회·백그라운드 정리에서 기간을 적용한다. 원본 클립보드 변경은 Windows API로 약 200ms 간격으로 확인하며, 다른 앱의 짧은 잠금은 재시도한다. 매우 빠르게 덮어써진 중간 내용, 앱 전용 서식·가상 파일·지연 제공 형식까지 무손실 보관하는 것은 아니다.

Windows의 `ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory=0` 표시를 존중한다. 기본 제외 앱은 `1password.exe`, `bitwarden.exe`, `keepass.exe`, `keepassxc.exe`이며 실행 파일 이름으로 수정할 수 있다. 제외 앱 식별은 운영체제에서 클립보드 소유 프로세스를 확인할 수 있을 때 적용된다. 모든 앱의 비밀번호를 자동 판별한다는 의미는 아니다.

이력 검색·즐겨찾기·유형별 기록·일시정지는 [Alfred의 클립보드 사용 흐름](https://www.alfredapp.com/help/features/clipboard/)을 참고했다. 자동 텍스트 확장이나 전체 Alfred 워크플로 엔진을 구현한 것은 아니다. 기록 제외 형식은 [Microsoft의 Clipboard Formats](https://learn.microsoft.com/en-us/windows/win32/dataxchg/clipboard-formats)를 따른다.

## Windows 배포

- 설치형: `EveryDirectory-0.10.0-windows-x64-setup.exe`
- 압축 단독 실행형: `EveryDirectory-0.10.0-windows-x64-portable.zip`

ZIP을 풀고 `EveryDirectory.exe`를 실행한다. 함께 제공하는 `portable.flag`가 있으면 실행 파일 옆 `portable-data`에 설정·인덱스·클립보드·WebView 데이터를 저장한다. 처음에는 자동 시작을 등록하지 않고 기존 설치형의 인덱스를 가져오지 않는다. 쓰기 가능한 폴더에서 실행해야 한다. 다른 PC·Windows 계정에서는 DPAPI 이력을 복호화하지 못할 수 있으므로 이력 이동용 형식으로 사용하지 않는다.

설치형과 압축형 모두 Microsoft Edge WebView2 Runtime이 필요하다. 기존 앱은 트레이에서도 완전히 종료한 뒤 새 버전을 실행한다. 실제 검증 OS는 Windows 11이며, Windows 10 물리 장비 전체 조합은 검증하지 않았다. 최종 검증 개수와 파일 해시는 배포 폴더의 `verification.json`, `SHA256SUMS.txt`에 기록한다.

## 검증 기록

Windows 11의 실제 Tauri/WebView2 E2E **19개 묶음·309개 항목**을 통과했고 건너뛴 묶음은 없다. 사용자 클립보드를 보존·복원하는 보호 절차 안에서 텍스트·파일·이미지 자동 수집, 제외 앱·보호 형식·기록 중지, 중복 병합, 본문 검색, 복사·사본 저장, 프로그램 재시작, 빠른 검색 키워드·Enter·Esc와 화면 영역을 검증했다. 포터블 테스트는 `EVERY_DIRECTORY_DATA` 우회 없이 `portable.flag`로 저장 위치를 선택하고, 프로세스를 재시작해 설정 파일·WebView 프로필이 실행 파일 옆에 만들어지는 것을 확인했다.

TypeScript/웹 서비스 **68개**, Rust 기본 **66개**와 별도 실행한 **100만 항목 초성 검색 1개**가 통과했다. 나머지 선택 성능·볼륨 검증 4개와 별도 대용량 분석 1개는 이 변경에서 재실행하지 않았다. Windows 10 실기기와 모든 서드파티 형식의 무손실 복원을 검증한 것은 아니다.

## English summary

Version 0.10.0 adds persistent search/display preferences, default exclusion of hidden/temporary/recycle-bin items, Korean initials highlighting across displayed names and paths, a stronger active-pane outline, and separate File tools / Clipboard tabs.

On Windows, clipboard history records text, file references and PNG images while the app is running. Retention defaults to 10 days and can be set from 1 to 60 days in daily increments. Enter the configurable keyword `clip` in Quick Search and press Enter to open history. Search full text, preview, restore to the system clipboard, save copies, favorite, pause or delete entries. Favorites follow the same retention limit. Windows DPAPI protects local metadata and payloads; Windows history-exclusion markers and configured source-app exclusions are respected.

File entries retain references rather than backups. Rich application formats and virtual files are not fully preserved. The ZIP build uses adjacent portable storage when `portable.flag` is present. WebView2 is required; Windows 10 physical devices and every third-party clipboard format have not been tested.

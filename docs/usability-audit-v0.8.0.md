# 기능·사용성 점검 — v0.8.0

검토일: 2026-10-26. 대상: React 화면, Windows Tauri/Rust 엔진, 웹 호환 검색 엔진.

**일상적인 검색·다중 창 파일 작업의 결함을 수정했다. Everything·Q-Dir의 모든 기능과 동등한 상태는 아니다.** 아래 ‘부분’과 ‘미구현’은 남은 개발 범위다. 제품 전체의 모든 조합을 테스트했다는 의미도 아니다.

## 이번에 고친 문제

| 문제와 영향 | 변경 |
|---|---|
| 검색 결과가 1,000개에서 끊겨 뒤쪽 파일 선택 불가 | ‘더 보기’로 1,000개씩 추가. 가상 목록과 중복 제거 유지. 조건 변경은 첫 페이지로 복귀 |
| 불러온 일부 결과만 정렬하여 가장 큰 파일 누락 가능 | 검색된 전체 항목 정렬 후 페이지 반환. 이름의 숫자를 자연스럽게 비교. 같은 값은 ID로 순서 유지 |
| 페이지 사이 파일 변경으로 결과가 섞일 수 있음 | 인덱스 버전이 달라지면 첫 페이지부터 다시 조회 |
| 검색 목록에서 여러 파일 작업이 어려움 | Ctrl·Shift·Ctrl+A, 범위·추가·반전 선택과 그룹 복사/잘라내기/삭제/압축/내보내기 |
| 검색 단축키가 뒤쪽 탐색창에 전달될 수 있음 | 단축키 범위 분리. IME 조합 및 입력 필드 보호. Ctrl+Insert·Shift+Insert 추가 |
| 검색 그룹 전송 대상이 활성 창에 따라 혼동됨 | 현재 경로를 표시하는 대화상자에서 모든 탐색창 선택. Ctrl·Shift 추가 선택 시 자동 위치 이동 억제 |
| 닫은 탭 복구·탭 정리 부족 | 최근 20개 복구, Ctrl+Shift+T, 복제·이름 변경·고정·다른 탭/오른쪽 탭 닫기, 가운데 클릭 닫기 |
| 탭 순서 변경 불가 | Windows 네이티브 파일 드롭과 공존하는 포인터 드래그 정렬. 삽입 경계 표시 |
| 중요한 작업 위치 변경·탭 닫힘 | 고정 탭 닫기 차단. 다른 폴더 이동은 색상 미지정 새 탭 사용 |
| 재실행 후 정렬 손실 | 검색·탐색창별 정렬 저장. 검색 즐겨찾기에 칼럼·정렬 포함 |
| 손상된 설정으로 시작 화면 오류 가능 | 기록·선택 탭·보기·색·이름·고정 값을 검증하고 기본 상태로 복구 |
| 목록 공유가 CSV에 한정됨 | CSV·TXT·TSV·인쇄용 HTML. HTML 이스케이프, CSV/TSV 수식 방어, 원자적 저장과 기존 파일 보호 |
| 키보드 접근·파일 구분 부족 | 이름 타이핑/초성 이동, F1 도움말·F3 검색·F11 전체 화면, Ctrl++ 칼럼 맞춤. 종류별 색상 설정 |

새 탭·복제 탭은 색과 고정을 상속하지 않는다. 닫은 탭은 원래 색·이름·기록과 ID를 복구하되 고정은 해제한다. ID 보존으로 탭별 트리 상태도 다시 사용할 수 있다.

## Everything과 비교

기준: [공식 기능](https://www.voidtools.com/support/everything/), [검색](https://www.voidtools.com/support/everything/searching/), [단축키](https://www.voidtools.com/support/everything/keyboard_shortcuts/). 공식 문서에는 1.5 전용 기능도 있으므로 전체 버전과 호환된다고 표현하지 않는다.

| 기능군 | 상태 | 차이·후속 작업 |
|---|---|---|
| 파일명 검색·실시간 갱신·오프라인 | 구현 | 연결 폴더 스캔·감시 기반. 시스템 전체 NTFS 인덱싱과 다름 |
| 초성·일반·와일드카드·정규식·퍼지 | 구현 | Rust regex. PCRE 전후방 탐색·역참조 미지원 |
| AND·OR·제외·그룹·파일/폴더·확장자·크기·수정일 | 부분 | 핵심 구문 구현. 전체 함수·매크로·수정자·속성 검색 미지원 |
| 경로·드라이브 검색 | 부분 | 폴더 범위·연결 폴더 내부 경로 검색. 드라이브 문자·절대 경로 구문 추가 필요 |
| 결과 정렬·칼럼·다중 선택·파일 작업 | 구현·보강 | 인덱스 변경 감지. Ctrl+A는 불러온 결과 대상 |
| 기록·북마크·전역 호출·트레이 | 구현 | 매크로·전체 기록 편집·검색 세션/창 복원은 차이 있음 |
| 대규모 성능·시작 | 부분 | 백그라운드 복구·증분 갱신·초성 후보 인덱스. 수백만 파일의 동등 성능 보장 아님 |
| NTFS MFT·USN·서비스 | 미구현 | 현재 폴더 순회·감시. 볼륨별 저널 재개·권한 경계 설계 필요 |
| 파일 내용·IFilter | 미구현 | 미리보기·OCR은 내용 검색의 대체 기능 아님 |
| 파일 목록 가져오기·오프라인 목록 | 미구현 | 현재 내보내기는 화면 목록 공유용 |
| SDK·외부 CLI 검색·ETP/HTTP·플러그인 | 미구현 | 별도 인터페이스·접근 제어·프로토콜 필요 |
| 언어·세부 옵션·고급 속성 | 부분 | 한국어 중심. 전체 언어·속성·설정 동등성 없음 |

시간 초과 검색은 여전히 **부분 결과**다. 이때 정렬도 확인된 결과 범위다. ‘더 보기’는 시간 초과 지점에서 스캔을 재개하지 않는다. 취소 가능한 검색 세션·계속 검색·대용량 정렬은 추가 개발 대상으로 남긴다.

## Q-Dir과 비교

기준: [공식 Q-Dir 도움말](https://www.softwareok.com/?seite=Freeware/Q-Dir/Help+file).

| 기능군 | 상태 | 차이·후속 작업 |
|---|---|---|
| 1~4 창·탭·레이아웃·폴더 조합 | 구현·보강 | 고정·이름·복구·순서 변경 추가. 배치·작업 공간 저장 |
| 주소·기록·폴더 트리 | 구현 | 편집·뒤로/앞으로/상위·위치 자동 펼침. 공용 단일 트리는 별도 |
| 클립보드·전송·드래그 | 구현 | Windows CF_HDROP·Shell 복사·같은 볼륨 이동·번호 사본. OS별 동등성 별도 검증 |
| 삭제·복구·실행 취소 | 부분 | 앱 휴지통·복구. Windows 휴지통·일반 Ctrl+Z 미구현 |
| 보기·미리보기·필터·칼럼 | 부분 | 목록/격자·텍스트/이미지/PDF/미디어·너비 조절. 타일·여러 아이콘 크기·전체 Shell 속성은 차이 |
| 색·강조 규칙 | 부분 | 종류별 기본 색상. 사용자 패턴·색 규칙 편집 미구현 |
| 폴더 크기·비교·중복 | 부분 | 별도 분석 도구·취소·한도 표시. 재귀 폴더 크기 칼럼 미구현 |
| 압축·가상/네트워크 위치 | 부분 | ZIP·연결 가능한 파일시스템 폴더. 압축 내부 탐색·FTP·CAB·Shell 가상 폴더 미구현 |
| 내보내기·인쇄 | 부분 | CSV/TXT/TSV/HTML, 브라우저에서 HTML 인쇄. XLS·직접 인쇄·전체 검색 내보내기 미구현 |
| 우클릭·연결 프로그램 | 부분 | 앱 메뉴·기본 앱 실행. 타사 Shell 확장·내부 연결 규칙 미구현 |
| 휴대용 설정·언어·확대경·프로필 | 부분/미구현 | 테마·밀도·화면 저장. 휴대용 프로필·설정 이식·다국어 UI·확대경 미구현 |

## 다음 개발 순서와 완료 기준

1. **대규모 검색·경로**: 절대/UNC/드라이브 구문, 계속 검색, 전체 내보내기. 100만 항목에서 누락·중복·변경 중 조회·취소를 검증하고 응답 시간·메모리를 측정한다.
2. **Windows 통합**: OS 휴지통·실행 취소·Shell 메뉴·네트워크/가상 폴더. 충돌·권한·중간 취소·부분 완료·볼륨 이동을 실제 Windows 10/11에서 확인한다.
3. **보기·프로필**: 사용자 색 규칙, 폴더 크기 칼럼, 보기 크기, 설정 이식, 직접 인쇄. 창·탭·재시작에 걸친 독립 상태를 검증한다.
4. **인덱스·내용 엔진**: USN/MFT·서비스·내용 검색/IFilter. 권한 분리, 감시 누락·저널 소실·외장 장치 재연결·파일 잠금 처리가 필요하다.
5. **외부 연동**: SDK·CLI·서버·플러그인. 통합 테스트·접근 제어를 갖춘 뒤 제공한다.

## 검증

- TypeScript/웹 호환 경로: `npm test` — 59개 통과.
- 실제 Windows Tauri/WebView2: `npm run test:e2e` — **14개 묶음, 213개 검증 통과, 건너뜀 0**. 검색·페이지·칼럼·트리·미리보기·파일 작업·빠른 검색·격자·클립보드·드래그·전송·첫 실행·Windows UI 포함. 대용량 페이지 fixture는 1,205개 파일이다.
- Rust: 기본 검증 56개와 별도 검증 3개, 총 59개 통과. 별도 검증은 4GiB 초과 분석, 실제 C↔D 볼륨 이동, 100만 합성 항목 초성 검색이다. 선택 실행인 시작·20만 항목 검색·전송 벤치마크 3개는 이번에 재실행하지 않았다. 배포 파일 검사는 배포 폴더의 `verification.json`에 기록한다.
- 100만 합성 항목에서 `ㅂㄱㅅ`, `ㅆㄹㅁㅇㄷ` 등 11개 검색어를 일반/빠른 검색 엔진 양쪽에서 확인했다. 결과 누락·시간 초과 없이 후보 1~2개로 좁혔으며 해당 엔진 요청은 0.45~1.16ms였다. 디버그 엔진의 제한된 합성 사례로, 전체 디스크 인덱싱·UI 표시·일반적인 모든 검색의 성능 수치가 아니다.
- 격리된 임시 파일로 검증했다. 클립보드는 원래 내용을 백업·복원한다. 백업 불가로 건너뛰면 완료로 취급하지 않는다. 원본 보고서는 로컬 `test-results/e2e/summary.json`.
- 이번 장비는 **Windows 11**이다. Windows 10 실제 IME 키 입력·드라이버·네트워크·타사 Shell 확장은 별도 검증이 필요하다. 프로그램으로 만든 composition 이벤트가 실제 IME 전체를 증명하지 않는다.

## English

Version 0.8.0 adds incremental result loading, sorting before pagination, search multi-selection and file actions, isolated keyboard scopes, and tab reordering/renaming/pinning/duplication/recovery. Sort settings persist. Lists can be exported as CSV, TXT, TSV or printable HTML. The native Windows regression run passed 213 checks in 14 suites without skips; 59 TypeScript tests passed.

This is **not full Everything/Q-Dir parity**. MFT/USN, content/IFilter search, SDK/server protocols, general undo, native recycle-bin integration, Shell extensions/virtual folders, custom color rules, full metadata columns, portable profiles, XLS and advanced search functions remain incomplete. Timed-out searches remain partial; loading more does not resume the scan. Selection/export apply to loaded entries.

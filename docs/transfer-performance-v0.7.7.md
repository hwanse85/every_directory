# 탐색창 복사·이동 성능 개선 — 0.7.7

2026-10-24, Windows x64 / MSVC release / 로컬 임시 폴더 / WebView2.

## 원인

파일 한 개를 옮겨도 `Engine::refresh`가 모든 연결 폴더의 스냅샷을 복제하고, 전체 `index.json`을 동기 저장한 뒤 검색 인덱스와 검색 키를 다시 만들었다. JSON 조각을 버퍼 없이 파일에 쓰는 것도 Windows에서 작은 쓰기 호출을 크게 늘렸다. 뒤늦게 도착한 파일 감시 이벤트가 같은 처리를 반복하면서 다음 파일 작업도 공용 작업 잠금에서 기다렸다.

## 변경

- 변경 경로의 추가·수정·삭제만 검색 인덱스에 반영한다. 기존 정규화 문자열과 검색 후보 키를 재사용하고 삭제로 위치가 바뀐 항목의 후보 번호만 보정한다.
- 작업 완료 전 변경 기록을 `index-journal.jsonl`에 기록하고 동기화한다. 시작할 때 전체 스냅샷에 기록을 재생하므로 전체 파일을 매번 저장하지 않고도 완료한 변경을 복원한다.
- 기록이 4 MiB 이상이고 변경이 2초 이상 없으면 백그라운드에서 스냅샷으로 합친다. 스냅샷 쓰기는 검색·파일 작업 잠금 밖에서 수행하며 그동안 들어온 변경 기록을 보존한다. 전체 재검색이나 폴더 연결 해제는 세대 번호로 이전 저장 작업을 무효화한다.
- 전체 JSON 저장에 256 KiB 버퍼를 적용하고 파일 동기화·임시 파일 교체를 유지한다. 중복 감시 이벤트는 메타데이터에 변화가 없으면 저장과 인덱스 갱신을 생략한다.
- Windows 파일 복사는 `CopyFileW`의 기존 대상 덮어쓰기 금지 옵션을 사용한다. 복사 충돌은 기존대로 `(1)`, `(2)` 사본을 만들며 이동 충돌과 경로 검증도 유지한다.
- 창 사이 전송 완료 메시지에 실제 소요 시간을 표시한다. 작업 응답에는 대기·파일 처리·인덱스 처리 시간(`timings.queueMs/fileMs/indexMs`)을 포함한다.

## 측정 방법

`src-tauri/tests/transfer_performance.rs`는 실제 작은 파일의 복사와 같은 볼륨 이동을 실행한다. 연결 드라이브의 대량 항목은 메모리의 합성 항목으로 구성한다. 디스크 전송 대역폭이 아닌 전체 인덱스 때문에 생기는 고정 지연을 비교하는 테스트이며 대용량 파일·NAS·다른 디스크 간 전송 속도를 보장하는 수치는 아니다.

```sh
cargo test --release --manifest-path src-tauri/Cargo.toml --test transfer_performance -- --ignored --nocapture
```

기본 20만 항목이며 `ED_TRANSFER_BENCH_ENTRIES=1000000`으로 100만 항목을 측정한다. 원본 바이트, 관계없는 인덱스 항목 보존, 전송 후 목록을 검사한다. 측정값은 아래 검증 결과와 함께 기록한다.

| 관계없는 인덱스 항목 | 작업 | 수정 전 | 0.7.7 |
| ---: | --- | ---: | ---: |
| 200,000 | 작은 파일 복사 | 30,836.23 ms | 44.91 ms |
| 200,000 | 같은 볼륨 이동 | 56,020.18 ms | 25.76 ms |
| 1,000,000 | 작은 파일 복사 | 미측정 | 241.22 ms |
| 1,000,000 | 같은 볼륨 이동 | 미측정 | 175.04 ms |

각 조건의 단일 실행 관측값이다. 이동은 앞선 복사에 이어 실행하므로 파일 감시 작업 대기도 포함한다. 100만 항목 이동의 175.04 ms 중 대기는 71.54 ms, 파일 처리는 7.46 ms, 인덱스 처리는 96.02 ms였다. 전송 뒤 루트 목록 조회는 20만 항목에서 4.23 ms, 100만 항목에서 15.81 ms였다.

작은 실제 파일을 사용한 두 탐색창 E2E에서는 확인 버튼을 누른 뒤 복사 완료 52.2 ms, 이동 완료 45.2 ms를 관측했다. 이 E2E는 작은 실제 폴더를 사용하며 대규모 합성 인덱스 벤치마크와는 별개의 검사다.

## 검증

- Rust 자동 테스트: 46개 통과, 대규모 벤치마크 3개는 기본 실행에서 제외한다.
- TypeScript/서버 자동 테스트: 44개 통과.
- 실제 Tauri/WebView2 E2E: 10개 묶음, 126개 항목 통과. 새 전송 묶음은 첫 창에서 두 번째 창으로 복사·이동, 원본 보존·제거, 번호 사본, 폴더 하위 항목, 검색 반영과 완료 시간을 검사한다.
- 영속성: 전체 스냅샷을 다시 쓰지 않은 채 재시작 복원, 미완성 로그 꼬리 복구, 이전 세대 로그 무시, 예전 인덱스 읽기, 백그라운드 저장과 동시 변경 보존, 연결 해제 후 이전 저장 작업 무효화를 검사한다.
- 증분 검색 인덱스는 반복 삭제·교체·추가 후 전체 재생성 결과와 일반·초성·와일드카드·정규식·퍼지·빠른 검색 결과를 비교한다.

기존 0.7.6 인덱스는 바로 읽는다. 0.7.7 사용 후 구버전으로 내려가면 구버전은 변경 기록을 읽지 않으므로 연결 폴더를 다시 검색해야 한다. 실제 파일은 이 저장 형식 변경의 영향을 받지 않는다.

## English summary

Each transfer previously cloned and synchronously saved the entire file index, rebuilt every search key, and could repeat this work for duplicate filesystem notifications. Version 0.7.7 updates changed entries and search postings, commits a small durable journal, and compacts it into a buffered checkpoint after idle time. Concurrent mutations remain in the journal; generations prevent an older checkpoint from restoring a disconnected root. Windows copies use the native fail-if-exists API. Numbered copies and overwrite protection remain in place.

The release benchmark transfers a real small file alongside synthetic unrelated index entries; it measures index overhead rather than large-file throughput. Validation includes 46 Rust tests, 44 TypeScript/server tests, 126 checks in the actual Tauri/WebView2 app, journal restart/crash recovery, and incremental-search equivalence. Downgrading to a version without journal support requires rescanning connected folders.

In single local runs with 200,000 unrelated entries, copy time fell from 30,836.23 ms to 44.91 ms and move time from 56,020.18 ms to 25.76 ms. At 1,000,000 entries, the updated code took 241.22 ms for copy and 175.04 ms for move. These timings include index updates and any filesystem-watcher queue wait; they are not throughput promises for large files or network drives.

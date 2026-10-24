# Windows 기본 파일 작업 엔진 — 0.7.8

2026-10-25, Windows x64 / WebView2 / MSVC.

## 기본 원칙과 적용 범위

Windows의 파일·폴더 전송은 운영체제의 파일 작업 엔진에 맡긴다. 앱은 연결 폴더 범위 확인, 번호 사본 이름 예약, 완료 후 검색·목록 갱신을 담당한다. 0.7.7에서 제거한 전체 인덱스 재생성·동기 저장 지연은 다시 도입하지 않는다.

- 파일·폴더 복사: Windows Shell `IFileOperation::CopyItem`에 선택 항목을 한 배치로 등록해 `PerformOperations`로 실행한다. Ctrl+C/V, 탐색창 사이 복사와 드래그, 외부 파일 붙여넣기에 같은 경로를 사용한다. Windows가 재귀 복사, 파일 속성·추가 데이터 스트림과 전송 진행·취소 창을 처리한다.
- 같은 볼륨의 이동: `MoveFileExW`를 교체 플래그 없이 한 번 호출한다. 폴더 내용 전체를 읽거나 복사하지 않고 위치를 변경한다.
- 다른 볼륨의 이동: `ERROR_NOT_SAME_DEVICE`인 경우 Windows Shell `MoveItem` 배치로 실행한다. 기존의 앱 재귀 복사 후 앱 휴지통 이동 절차를 제거했다. 공유 위반 등 다른 이동 오류는 불필요한 복사를 시도하지 않고 알린다.
- 이름 중복: 복사는 기존 `(1)`, `(2)` 이름을 유지한다. 완성한 사본을 대상 볼륨의 임시 폴더에서 배타적 이름 변경으로 확정한다. 원본은 복사 취소·실패 시에도 보존한다. 이동의 기존 이름 충돌은 사전 거부하며 자동 덮어쓰기·Yes-to-all을 켜지 않는다.
- 취소·오류: Windows의 실제 중단 상태를 확인해 성공으로 표시하지 않는다. 다른 볼륨 이동이 일부 완료된 경우 원본과 대상에 남은 파일을 보존하고 양쪽 경로를 다시 색인한다. 이동 결과를 숨겨진 임시 폴더와 함께 지우지 않는다.
- 내부 사본 저장 등 단일 파일 작업은 기존 Windows `CopyFileW`를 사용한다. macOS·기타 플랫폼은 기존 구현을 유지한다.

`IFileOperation`은 STA 스레드에서 실행해야 하므로 전용 스레드 안에서 COM을 초기화하고, 모든 COM 객체를 해제한 뒤 종료한다. 앱의 화면 스레드는 차단하지 않는다. Win32 내부 경로의 `\\?\` / `\\?\UNC\` 접두사는 Shell 파싱 시 일반 드라이브·UNC 표기로 바꾸고 UTF-16 문자는 보존한다. 긴 한글 경로도 같은 Shell 엔진으로 복사한다. 심볼릭 링크·정션이 선택한 트리 밖으로 이어지는 경우는 기존 경계 검사에서 차단한다.

Microsoft 원문: [IFileOperation](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ifileoperation), [작업 플래그와 중단 처리](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-setoperationflags), [MoveFileExW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw).

## 검증 방법

Windows 전용 자동 테스트는 다음을 확인한다.

- 한 배치에서 실제 한글 폴더·빈 폴더·여러 파일 복사, 파일 내용·수정 시각·NTFS 추가 데이터 스트림 보존.
- Shell 폴더 이동, 기존 대상 충돌 시 원본과 기존 파일 보존, 잠긴 원본의 실패 처리.
- 260자를 넘는 한글 경로의 실제 복사와 정션의 범위 이탈 차단.
- 별도 C:·D: 볼륨 사이에서 파일·폴더 실제 이동, 원본 제거·내용 보존·빈 폴더·양쪽 목록 갱신과 앱 휴지통 사본 미생성. 반대 방향 반복 복사의 번호 이름도 검사한다. 테스트 마지막에 교체 없는 `MoveFileExW`가 오류 17을 반환하는지 확인해 같은 볼륨 테스트로 잘못 통과하지 않도록 한다.

```powershell
# 전체 Rust 검사. 별도 볼륨 테스트와 대규모 벤치마크는 기본 실행에서 제외한다.
npm run test:rust -- --tests

# 별도 쓰기 가능한 실제 볼륨이 있을 때만 명시적으로 실행한다.
$env:ED_CROSS_VOLUME_DIRECTORY = 'D:\'
cargo test --manifest-path src-tauri/Cargo.toml --test native_transfer_volumes -- --ignored --nocapture

# 실제 Tauri/WebView2의 단축키·클립보드·드래그·두 탐색창 전송 회귀 검사.
npm run test:e2e
npm run desktop:build:windows
```

실제 두 볼륨 테스트는 임시 폴더에 8 MiB 파일과 하위 폴더를 만들어 실행했으며 최종 실행에서 0.39초에 통과했다. 이 시간은 준비와 여러 검사를 포함한 한 번의 관측값으로, 디스크·네트워크 전송 속도를 보장하는 수치가 아니다. Windows 진행 창의 물리적 취소 버튼 입력은 DOM E2E 자동화 범위에 포함하지 않는다.

최종 로컬 Rust 검사 52개와 별도 실제 두 볼륨 검사 1개, TypeScript/서버 검사 44개가 통과했다. 로컬 MSVC 디버그 심볼 생성의 내부 오류를 피하기 위해 전체 Rust 검사에는 `--config profile.test.package.every-directory.debug=0`을 적용했다. 이 설정은 검사 대상 앱 패키지의 심볼 생성만 끄며 검사 로직과 배포용 최적화 구성은 바꾸지 않는다. E2E 검증 빌드·실행과 다른 Rust 빌드는 실행 파일 교체를 피하기 위해 순서대로 수행한다.

## English summary

On Windows, file/folder copies and cross-volume moves now use the Shell `IFileOperation` engine, batching selections into one operation with native progress/cancellation. Same-volume moves use one exclusive `MoveFileExW` rename. Cross-volume moves no longer create an extra source copy in the application's trash. Numbered copies, overwrite protection, and incremental index updates remain in place. Partial cross-volume moves keep files visible on either side and refresh both indexes after cancellation or failure.

Native tests cover Unicode trees, empty folders, modification times, NTFS alternate streams, existing-target and locked-source failures, extended paths, and junction boundaries. An opt-in test was executed across actual C: and D: volumes, checking contents, source removal, both indexes, numbered copies in the reverse direction, and the absence of an app-trash duplicate. Native progress-dialog button input is outside the DOM E2E automation scope.

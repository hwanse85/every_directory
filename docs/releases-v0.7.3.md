# v0.7.3 배포 안내

빠른 검색창, 파일·폴더 즐겨찾기, 최근 검색·사용 기록과 운영체제 파일 클립보드를 포함한 배포본이다. 자세한 조작은 [빠른 검색 사용 안내](quick-search.md)를 따른다.

## 배포 대상

| 운영체제 | 파일 | 설치 방법 |
|---|---|---|
| macOS 11 이상, Apple Silicon | `EveryDirectory_0.7.3_mac_arm64.dmg` | 열어서 앱을 Applications로 이동 |
| macOS 11 이상, Apple Silicon | `EveryDirectory_0.7.3_mac_arm64.zip` | 압축을 풀어 앱을 Applications로 이동 |
| Windows 10·11, 64비트 x64 | `EveryDirectory_0.7.3_windows_x64_setup.exe` | 설치 프로그램을 실행 |
| Windows 10·11, 64비트 x64, WebView2 설치됨 | `EveryDirectory_0.7.3_windows_x64_lite_setup.exe` | 경량 설치 프로그램을 실행 |

Windows 10과 11은 같은 설치 파일을 사용한다. 사용자별 설치 방식이며 Node.js, Python, Rust는 사용자 PC에 필요하지 않다. Windows 32비트, Windows ARM 네이티브와 Intel Mac 빌드는 포함하지 않는다.

## 폐쇄망 Windows 설치

설치 EXE에는 Microsoft WebView2 Evergreen의 **x64 오프라인 설치 프로그램**을 포함한다. WebView2가 없는 PC에서는 이 파일을 이용해 설치하므로 인터넷에서 런타임을 내려받을 필요가 없다. 이미 설치된 런타임은 시스템의 것을 사용한다. 회사 정책으로 런타임 설치가 제한되거나 오래된 런타임을 관리하는 경우 전산 담당자가 배포 폴더의 `windows-dependencies/MicrosoftEdgeWebView2RuntimeInstallerX64.exe`로 설치·갱신할 수 있다. 이 별도 파일은 설치 EXE에 들어 있는 것과 동일한 Microsoft 원본이다.

Tauri의 [오프라인 설치 방식](https://v2.tauri.app/distribute/windows-installer/#offline-installer)과 Microsoft의 [Windows 10·11 지원 범위](https://learn.microsoft.com/en-us/microsoft-edge/webview2/#supported-windows-versions)를 기준으로 구성했다. 특정 Windows 빌드·보안 정책에서의 실행 성공은 대상 PC 실기 검증으로 확인해야 한다.

## 경량 설치본과 용량

| 구성 | 실측 크기 | 사용 조건 |
|---|---:|---|
| Windows 통합 설치본 | 210.106 MiB | WebView2 오프라인 설치본 포함 |
| Windows 경량 설치본 | 2.567 MiB | WebView2 Evergreen 사전 설치 필요 |
| 별도 WebView2 설치본 | 204.872 MiB | 전산팀이 필요한 PC에 먼저 설치 |

경량 설치본은 통합 설치본보다 98.78% 작다. 두 설치본에서 추출한 앱 실행 파일의 SHA-256이 같아 앱 기능을 제거하지 않았음을 확인했다. 통합 설치본은 이미 LZMA로 압축되어 있으며 대부분을 Microsoft 런타임이 차지한다.

회사에서는 전산팀이 WebView2를 공통 설치·관리하고 직원에게 경량 설치본을 배포하면 앱 업데이트마다 런타임을 다시 전달할 필요가 없다. Evergreen 런타임은 [여러 WebView2 앱이 공유하는 구성요소](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#the-evergreen-runtime-distribution-mode)다. 경량 설치본은 인터넷 다운로드를 시도하지 않는다. 런타임이 없으면 앱 파일을 복사하기 전에 준비 방법을 안내하고 종료한다. 무인 설치에서는 메시지 창 없이 종료 코드 2를 반환하도록 구성했다.

경량 설치본 재생성 명령은 다음과 같다. 기본 설치 파일 이름은 통합본과 같으므로 배포 시 `_lite_setup.exe`로 구분해 보관한다.

```sh
npm run desktop:build:windows -- --config src-tauri/tauri.windows-lite.conf.json
```

경량 설치본의 패키징·무결성·앱 바이너리 동일성과 필수 구성요소 검사 코드의 컴파일을 확인했다. Windows PC에서 런타임 설치 유무에 따른 실제 설치 흐름은 별도 실기 검증 항목이다.

## 실행

앱에서 검색할 폴더를 연결한 뒤 인덱싱이 끝나면 빠른 검색을 사용한다.

- macOS: `Command+Shift+Space`
- Windows: `Ctrl+Shift+Space`
- `↑` / `↓`로 선택, `Enter`로 열기, `Tab`으로 작업 선택, `Esc`로 닫기
- 파일 자체 복사 후 Finder·탐색기에서 `Command+V` / `Ctrl+V`로 붙여넣기

## 서명과 검증 범위

Mac은 로컬 임시 서명(ad-hoc)을 적용하며 Apple Developer ID 서명·공증은 포함하지 않는다. Windows는 회사 배포 인증서로 서명하지 않은 설치 파일이다. 조직의 배포 정책에 맞는 인증서 적용은 별도다.

빌드·압축 무결성·실행 파일 아키텍처·런타임 포함 여부와 SHA-256을 검사하고 결과를 배포 폴더의 `verification.json`에 기록한다. 실제 Windows 10·11에서 설치, 전역 단축키, 한글 입력, 탐색기 파일 붙여넣기를 실행한 결과와 교차 빌드 결과는 구분한다. 실기 검증 없이 모든 Windows 환경에서 오류가 없다고 보장하지 않는다.

배포 파일은 [v0.7.3 폴더](../releases/v0.7.3/)에 보관한다. 파일별 크기와 SHA-256은 `artifacts.json`, 전송 후 무결성 확인에는 `SHA256SUMS.txt`를 사용한다.

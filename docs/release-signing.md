# 배포 서명·공증·업데이트 준비

Every Directory의 CI(`.github/workflows/desktop.yml`)는 **서명 인증서 비밀값이 등록돼 있을 때만** 서명하고, 없으면 지금처럼 서명 없이 빌드합니다. 인증서를 사고 보관할지는 저장소 관리자가 정합니다. 이 문서는 그 결정 뒤에 필요한 설정을 정리합니다.

## 1. macOS — Developer ID 서명과 공증

Apple Developer Program(연 99달러)에 가입해 **Developer ID Application** 인증서를 만든 뒤, GitHub 저장소 *Settings › Secrets and variables › Actions*에 아래 비밀값을 등록합니다.

| 비밀값 | 내용 |
|---|---|
| `APPLE_CERTIFICATE` | 인증서와 개인 키를 내보낸 `.p12` 파일을 base64로 바꾼 글자(`base64 -i cert.p12`) |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12`를 내보낼 때 정한 암호 |
| `APPLE_SIGNING_IDENTITY` | 예: `Developer ID Application: 이름 (TEAMID)` |
| `APPLE_ID` | 공증에 쓸 Apple ID 이메일(공증을 하려면 셋 모두 등록) |
| `APPLE_PASSWORD` | Apple ID의 **앱 전용 암호**(appleid.apple.com에서 만듦) |
| `APPLE_TEAM_ID` | 개발자 팀 ID(10자리) |

등록하면 Tauri가 빌드할 때 서명하고, `APPLE_ID`까지 있으면 공증(notarization)과 스테이플까지 합니다. Gatekeeper 경고가 사라집니다.

## 2. Windows — 코드 서명

코드 서명 인증서(OV 또는 EV)를 `.pfx`로 받은 뒤 아래 비밀값을 등록합니다.

| 비밀값 | 내용 |
|---|---|
| `WINDOWS_CERTIFICATE` | `.pfx` 파일을 base64로 바꾼 글자(PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))`) |
| `WINDOWS_CERTIFICATE_PASSWORD` | `.pfx` 암호 |

등록하면 CI가 `scripts/sign-windows.mjs`를 Tauri의 `signCommand`로 지정해, 실행 파일과 설치 파일을 `signtool`(SHA-256, 타임스탬프 포함)로 서명합니다. 스크립트는 셸을 거치지 않고 인자 배열로 `signtool`을 실행합니다.

- EV 인증서나 클라우드 서명(Azure Trusted Signing 등)은 하드웨어 토큰·서비스 인증이 필요해 이 스크립트를 그 서비스의 명령으로 바꿔야 합니다.
- SmartScreen 평판은 서명한 뒤에도 내려받은 횟수가 쌓여야 경고가 사라집니다(EV는 바로 신뢰).

## 3. 업데이트 확인

- 앱은 **GitHub 릴리스 API**(`/repos/hwanse85/every_directory/releases/latest`)로 새 버전이 있는지 확인합니다. 설정의 *시작할 때 새 버전 확인*(기본 꺼짐)을 켜면 하루 한 번, 정보 화면의 *업데이트 확인*을 누르면 바로 확인합니다.
- 요청에는 이 PC의 정보가 들어가지 않습니다(운영체제의 `curl`로 공개 API만 읽음).
- 새 버전이 있으면 릴리스 페이지를 열어 직접 내려받습니다. **자동 설치는 하지 않습니다.**

### 자동 설치로 넓히려면

Tauri 업데이터(`tauri-plugin-updater`)는 업데이트 파일마다 **업데이터 전용 서명 키**로 만든 서명을 요구합니다.

1. `npx tauri signer generate -w ~/.tauri/every-directory.key`로 키 쌍을 만들고, 공개 키는 `tauri.conf.json`의 `plugins.updater.pubkey`에, 개인 키와 암호는 비밀값 `TAURI_SIGNING_PRIVATE_KEY`·`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`에 둡니다.
2. 빌드에 `bundle.createUpdaterArtifacts: true`를 켜고, 릴리스에 `latest.json`(버전·파일 주소·서명)을 함께 올립니다.
3. 업데이터 플러그인을 넣으면 HTTP·서명 검증 라이브러리가 함께 들어오므로 `THIRD_PARTY_NOTICES.txt`와 `src/third-party-licenses.json`을 갱신해야 합니다.

개인 키를 잃어버리면 기존 설치본에 업데이트를 보낼 수 없으므로 키 보관 방법을 먼저 정한 뒤 진행합니다.

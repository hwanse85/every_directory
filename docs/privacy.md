# 공개 저장소와 배포본의 개인정보 보호

[한국어 README](../README.md) · [English README](../README.en.md)

## 저장소 정책

- 소스·문서와 공개용 테스트 자료만 Git에 보관한다. 설치 파일, 실행 파일, 디버그 심볼, 개인 인덱스/DB, 환경 파일과 로컬 검증 결과는 올리지 않는다.
- 커밋 작성자와 커미터 이메일은 GitHub의 noreply 주소를 사용한다. 오픈소스 저작권·라이선스에 포함된 저자 연락처는 해당 고지로 보존한다.
- 개인 경로가 포함됐던 과거 v0.7.4 배포 패키지는 소스 이력에서 제거했다. 과거 버전 문서는 당시 기능을 설명하는 기록이며 현재 다운로드 목록이 아니다.
- 새 배포물은 개인정보 검사를 통과한 빌드만 사용한다. GitHub Actions의 결과물도 게시 전 검사한다.

## 빌드 경로 제거

`scripts/build-environment.mjs`는 개발자 홈, 임시 폴더, Cargo/Rustup 및 프로젝트 경로를 일반적인 `/build/...` 경로로 치환하도록 rustc 인자를 구성한다. Windows의 구분자와 확장 경로 형식, 공백이 포함된 경로도 처리한다. 일반 데스크톱·Windows 패키지 빌드 스크립트에서 공통으로 사용한다.

Rust의 경로 치환은 모든 외부 도구의 출력까지 보장하지 않는다. 따라서 빌드 플래그와 별도로 실제 압축 전 실행 파일을 검사한다. `.pdb`, `.rlib`, 캐시 등 중간 산출물은 배포하지 않는다. macOS 패키징도 실행 파일 검사를 통과해야 진행한다.

```sh
npm run privacy:check
npm run privacy:check -- --history
npm run privacy:check -- --binary src-tauri/target/release/every-directory.exe
npm run privacy:check -- --binary "src-tauri/target/release/bundle/macos/Every Directory.app/Contents/MacOS/every-directory"
```

검사 오류는 위치와 분류만 출력하며 일치한 개인정보·토큰 원문은 출력하지 않는다. 소스 검사에는 의도된 테스트 계정명과 공용 CI 계정의 예외가 있고, 실제 사용자 이름은 예외에 추가하지 않는다. 토큰·이메일·경로 패턴 검사는 모든 민감정보를 찾아낸다는 보장이 아니므로 새 자료·바이너리를 공개할 때 함께 검토해야 한다.

## 이력 정리 후 협업

정리 전 복제본의 브랜치를 다시 push하면 제거된 이력이 돌아올 수 있다. 기존 작업이 있다면 필요한 소스 변경만 검토해 옮기고, 정리된 저장소를 새로 clone한다. 관련 브랜치와 커밋의 해시는 변경된다.

GitHub가 관리하는 과거 PR 참조·캐시와 외부 사용자의 clone/fork는 브랜치 강제 갱신만으로 지워지지 않을 수 있다. 삭제된 데이터에 대한 참조가 남으면 GitHub Support에서 별도 처리가 필요하다. 이 저장소의 정상 브랜치 검사 통과와 GitHub 서버의 과거 데이터 완전 삭제는 구분해야 한다.

참고: [GitHub 민감정보 이력 제거](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository), [Rust 경로 치환과 한계](https://doc.rust-lang.org/rustc/remap-source-paths.html).

## English

Source history must not contain compiled distributions, debug symbols, local indexes/databases, environment files, or personal verification output. Commit authors and committers use GitHub noreply addresses. Third-party copyright notices and their credited contact information are retained.

The build wrappers remap developer paths to generic build roots. Because compiler remapping does not cover every linker or external tool, inspect the actual unpacked executable before packaging or uploading it. The commands above check tracked source, reachable history, and executables; diagnostics never print the matching private value. Pattern scanning is a safeguard, not a complete forensic guarantee.

After a history cleanup, use a fresh clone and do not push old branches. GitHub-managed pull-request references and cached commits, as well as external clones/forks, can survive a force push. Those require separate cleanup; GitHub Support controls its server-side references and caches.

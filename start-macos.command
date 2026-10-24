#!/bin/zsh
# 빌드된 앱을 열고 없으면 데스크톱 개발 모드로 실행한다.
cd -- "${0:A:h}" || exit 1
app_path="$PWD/src-tauri/target/release/bundle/macos/Every Directory.app"
if [[ -d "$app_path" ]]; then
  open "$app_path"
  exit $?
fi
export PATH="$HOME/.cargo/bin:$PATH"
if ! command -v node >/dev/null; then
  print 'Node.js 22.13 이상을 먼저 설치해 주세요: https://nodejs.org/'
  read '?Enter 키를 눌러 닫기'
  exit 1
fi
if ! command -v cargo >/dev/null; then
  print 'Rust를 먼저 설치해 주세요: https://rustup.rs/'
  read '?Enter 키를 눌러 닫기'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci || exit 1
fi
npm run desktop:dev

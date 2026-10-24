import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { privateBuildEnvironment } from "./build-environment.mjs";
import { assertPrivateBinary } from "./check-privacy.mjs";

// Mac에서는 공식 cargo-xwin 경로, Windows에서는 기본 도구로 설치 EXE를 빌드한다.
const cross = process.platform !== "win32";
const env = privateBuildEnvironment({
  ...process.env,
  VITE_ED_VERIFICATION: "0",
  PATH: [
    path.join(homedir(), ".cargo", "bin"),
    ...(process.platform === "darwin"
      ? ["/opt/homebrew/opt/llvm/bin", "/opt/homebrew/opt/lld/bin"]
      : []),
    process.env.PATH,
  ].join(path.delimiter),
});
const args = [
  "node_modules/@tauri-apps/cli/tauri.js",
  "build",
  ...(cross || process.arch !== "x64" ? ["--target", "x86_64-pc-windows-msvc"] : []),
  "--bundles",
  "nsis",
  ...(cross ? ["--runner", "cargo-xwin"] : []),
  ...process.argv.slice(2),
];
const child = spawn(process.execPath, args, { env, stdio: "inherit" });
// 설치 프로그램 생성 실패를 호출한 셸에 그대로 알린다.
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
  if (code === 0 && !process.argv.includes("--debug")) {
    try {
      assertPrivateBinary(path.resolve("src-tauri/target", ...(cross || process.arch !== "x64" ? ["x86_64-pc-windows-msvc"] : []), "release/every-directory.exe"));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
});
// 빌드 도구가 없을 때 실행 오류를 명시한다.
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

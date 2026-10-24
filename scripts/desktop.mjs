import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

// Rust 도구 경로를 포함해 데스크톱 개발·빌드·검증을 실행한다.
const action = process.argv[2] || "dev";
const env = {
  ...process.env,
  PATH:
    path.join(homedir(), ".cargo", "bin") + path.delimiter + process.env.PATH,
};
// 검증 빌드의 화면 설정은 사용자 설정과 분리한다.
env.VITE_ED_VERIFICATION = process.argv.some((arg) =>
  arg.includes("smoke-test"),
)
  ? "1"
  : "0";
const executable =
  action === "test"
    ? process.platform === "win32"
      ? "cargo.exe"
      : "cargo"
    : process.execPath;
const args =
  action === "test"
    ? [
        "test",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        ...process.argv.slice(3),
      ]
    : [
        "node_modules/@tauri-apps/cli/tauri.js",
        action,
        ...process.argv.slice(3),
      ];
const child = spawn(executable, args, { env, stdio: "inherit" });
// 자식 프로세스의 종료 상태를 전달한다.
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
// 설치 누락과 실행 오류를 설명한다.
child.on("error", (error) => {
  console.error(`데스크톱 명령 실행 실패: ${error.message}`);
  process.exitCode = 1;
});

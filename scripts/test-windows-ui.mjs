import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32")
  throw new Error("Windows WebView2에서 실행하는 검증입니다.");
const temporary = await mkdtemp(path.join(os.tmpdir(), "ed-windows-ui-"));
const root = path.join(temporary, "업무 [1]&'()");
const data = path.join(temporary, "data");
await mkdir(path.join(root, "Reports", "하위"), { recursive: true });
await writeFile(path.join(root, "Reports", "원본.txt"), "한글 원본");
await writeFile(path.join(root, ".hidden.txt"), "hidden");
const env = {
  ...process.env,
  EVERY_DIRECTORY_DATA: data,
  EVERY_DIRECTORY_SMOKE_ROOT: root,
  EVERY_DIRECTORY_SKIP_SMOKE: "1",
  EVERY_DIRECTORY_WINDOWS_UI: "1",
};
const build = spawn(
  process.execPath,
  [
    "scripts/desktop.mjs",
    "build",
    "--debug",
    "--no-bundle",
    "--features",
    "smoke-test",
  ],
  { env, stdio: "inherit", windowsHide: true },
);
await new Promise((resolve, reject) => {
  build.once("error", reject);
  build.once("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`검증 빌드 실패 (${code})`)),
  );
});
const executable = path.join(temporary, "EveryDirectory-windows-ui.exe");
await copyFile(path.resolve("src-tauri/target/debug/every-directory.exe"), executable);
const child = spawn(
  executable,
  [],
  { env, stdio: "inherit", windowsHide: true },
);
let startupError;
child.once("error", (error) => {
  startupError = error;
});
try {
  const deadline = Date.now() + 90000;
  let report;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (child.exitCode !== null)
      throw new Error(`앱 조기 종료: ${child.exitCode}`);
    try {
      const value = JSON.parse(
        await readFile(path.join(data, "smoke-report.json"), "utf8"),
      );
      if (value.finished) {
        report = value;
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.log(`검증 기록: ${path.join(data, "smoke-report.json")}`);
  if (!report) throw new Error("Windows UI 검증 시간 초과");
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  // 이 실행에서 만든 앱 프로세스만 종료하고 실패 자료는 임시 폴더에 남긴다.
  child.kill();
  await new Promise((resolve) =>
    child.exitCode !== null ? resolve() : child.once("exit", resolve),
  );
}

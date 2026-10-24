import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  copyFile,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { prepare } from "./e2e-fixtures.mjs";
if (process.platform !== "win32")
  throw new Error("Windows WebView2에서 실행하세요.");
const suite = process.argv[2] ?? "search";
await mkdir("test-results/e2e", {recursive:true});
await writeFile(`test-results/e2e/${suite}.json`,JSON.stringify({suite,passed:false,tests:[],errors:["검증 실행이 완료되지 않았습니다."]}));
let clipboardGuard;
if (suite === "clipboard") {
  clipboardGuard = spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-File",
      path.resolve("scripts/clipboard-guard.ps1"),
    ],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  const preserved = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => { clipboardGuard.kill(); resolve(false); },
      10000,
    );
    clipboardGuard.stdout.on("data", (data) => {
      if (String(data).includes("ED_CLIPBOARD_READY")) {
        clearTimeout(timer);
        resolve(true);
      }
    });
    clipboardGuard.once("error", reject);
    clipboardGuard.once("exit", (code) => {
      clearTimeout(timer);
      // A guard that exits before READY has not changed the clipboard. This can
      // include unsupported formats or a host that cannot execute the helper.
      resolve(false);
    });
  });
  if (!preserved) {
    const reason = "현재 클립보드를 안전하게 백업할 수 없어 기존 내용을 보존하고 검사를 건너뜁니다.";
    await writeFile(`test-results/e2e/${suite}.json`,JSON.stringify({suite,passed:false,skipped:true,reason,tests:[],errors:[],finished:new Date().toISOString()},null,2));
    console.log(reason);
    process.exit(process.env.CI ? 1 : 77);
  }
}
const temp = await mkdtemp(path.join(os.tmpdir(), `ed-e2e-${suite}-`));
const root = path.join(temp, "E2E 한글 [1]&'()");
const data = path.join(temp, "data");
await prepare(root, suite);
const env = {
  ...process.env,
  EVERY_DIRECTORY_DATA: data,
  EVERY_DIRECTORY_SMOKE_ROOT: root,
  EVERY_DIRECTORY_SKIP_SMOKE: "1",
  EVERY_DIRECTORY_E2E_SUITE: suite,
};
if (suite === "quick") env.EVERY_DIRECTORY_QUICK_SMOKE = "1";
if (suite === "windows") env.EVERY_DIRECTORY_WINDOWS_UI = "1";
if (suite === "empty") {
  delete env.EVERY_DIRECTORY_SMOKE_ROOT;
  delete env.EVERY_DIRECTORY_SKIP_SMOKE;
  env.EVERY_DIRECTORY_SMOKE_EMPTY = "1";
}
if (!process.argv.includes("--no-build")) {
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
      code === 0 ? resolve() : reject(new Error(`빌드 실패 ${code}`)),
    );
  });
}
const executable = path.join(temp, "EveryDirectory-e2e.exe");
await copyFile(
  path.resolve(process.env.CARGO_TARGET_DIR || "src-tauri/target", "debug/every-directory.exe"),
  executable,
);
const child = spawn(executable, [], {
  env,
  stdio: "inherit",
  windowsHide: true,
});
let startupError;
child.once("error", (e) => {
  startupError = e;
});
try {
  const deadline = Date.now() + 180000;
  let report;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (child.exitCode !== null)
      throw new Error(`앱 조기 종료 ${child.exitCode}`);
    try {
      const v = JSON.parse(
        await readFile(path.join(data, "smoke-report.json"), "utf8"),
      );
      if (v.finished || v.stage === "complete" || v.stage?.endsWith("failed")) {
        report = { ...v, passed: v.passed ?? v.stage === "complete" };
        break;
      }
    } catch (e) {
      if (e.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`E2E 결과: ${path.join(data, "smoke-report.json")}`);
  console.log(JSON.stringify(report, null, 2));
  await mkdir("test-results/e2e", { recursive: true });
  await writeFile(
    `test-results/e2e/${suite}.json`,
    JSON.stringify(report ?? { passed: false, error: "timeout" }, null, 2),
  );
  if (!report?.passed) process.exitCode = 1;
} finally {
  child.kill();
  await new Promise((r) =>
    child.exitCode !== null ? r() : child.once("exit", r),
  );
  if (clipboardGuard) {
    const restored = new Promise((resolve, reject) => {
      let output = "";
      clipboardGuard.stdout.on("data", (data) => {
        output += String(data);
      });
      clipboardGuard.once("exit", (code) =>
        code === 0 && output.includes("ED_CLIPBOARD_RESTORED")
          ? resolve()
          : reject(new Error("클립보드 복원 실패")),
      );
    });
    clipboardGuard.stdin.end("restore\n");
    await restored;
    console.log("원래 클립보드 복원 완료");
  }
}

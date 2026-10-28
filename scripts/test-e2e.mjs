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
const suite = process.argv[2] ?? "search";
// macOS(WKWebView)에서는 플랫폼 공용 스위트만 실행한다. 나머지는 Windows 경로·셸 동작을 검증한다.
const macSuites = ["ux", "quick", "empty", "desktop", "audit"];
if (process.platform !== "win32" && !(process.platform === "darwin" && macSuites.includes(suite)))
  throw new Error(`Windows WebView2에서 실행하세요. macOS에서는 ${macSuites.join(", ")} 스위트를 지원합니다.`);
const mac = process.platform === "darwin";
await mkdir("test-results/e2e", {recursive:true});
await writeFile(`test-results/e2e/${suite}.json`,JSON.stringify({suite,passed:false,tests:[],errors:["검증 실행이 완료되지 않았습니다."]}));
let clipboardGuard;
const touchesClipboard = ["clipboard","history","history-monitor","quick","desktop","actions","ux"].includes(suite);
if (touchesClipboard) {
  // Windows는 PowerShell, macOS는 Swift 도우미로 모든 클립보드 형식을 메모리에 보관한다.
  clipboardGuard = mac
    ? spawn("swift", [path.resolve("scripts/clipboard-guard-mac.swift")], { stdio: ["pipe", "pipe", "pipe"] })
    : spawn(
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
      mac ? 90000 : 10000,
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
const data = path.join(temp, suite==="portable"?"portable-data":"data");
if(suite==="portable")await writeFile(path.join(temp,"portable.flag"),"portable data beside this executable\n");
await prepare(root, suite);
const env = {
  ...process.env,
  EVERY_DIRECTORY_DATA: data,
  EVERY_DIRECTORY_SMOKE_ROOT: root,
  EVERY_DIRECTORY_SKIP_SMOKE: "1",
  EVERY_DIRECTORY_E2E_SUITE: suite,
};
if(suite==="portable")delete env.EVERY_DIRECTORY_DATA;
if (suite === "quick") env.EVERY_DIRECTORY_QUICK_SMOKE = "1";
if(suite==="history-monitor")env.EVERY_DIRECTORY_TEST_CLIPBOARD_MONITOR="1";
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
const executable = path.join(temp, mac ? "EveryDirectory-e2e" : "EveryDirectory-e2e.exe");
await copyFile(
  path.resolve(process.env.CARGO_TARGET_DIR || "src-tauri/target", mac ? "debug/every-directory" : "debug/every-directory.exe"),
  executable,
);
let child = spawn(executable, [], {
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
  let beforeRestart;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (child.exitCode !== null)
      throw new Error(`앱 조기 종료 ${child.exitCode}`);
    try {
      const v = JSON.parse(
        await readFile(path.join(data, "smoke-report.json"), "utf8"),
      );
      if (v.finished || v.stage === "complete" || v.stage?.endsWith("failed")) {
        if(["history","portable"].includes(suite)&&v.restart&&!beforeRestart){
          beforeRestart=v;
          child.kill();await new Promise(resolve=>child.exitCode!==null?resolve():child.once("exit",resolve));
          await writeFile(path.join(data,"smoke-report.json"),JSON.stringify({stage:"restarting"}));
          child=spawn(executable,[],{env:{...env,EVERY_DIRECTORY_HISTORY_RESTART:"1"},stdio:"inherit",windowsHide:true});
          child.once("error",e=>{startupError=e;});
          continue;
        }
        report = { ...v, passed: v.passed ?? v.stage === "complete" };
        if(beforeRestart)report.tests=[...beforeRestart.tests,...report.tests];
        break;
      }
    } catch (e) {
      if (e.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if(suite==="portable"&&report?.passed){
    const preferences=JSON.parse(await readFile(path.join(data,"preferences.json"),"utf8"));
    const {stat}=await import("node:fs/promises");
    if(preferences.clipboardDays!==23||!(await stat(path.join(data,"webview"))).isDirectory())throw new Error("Portable data/profile location mismatch");
    report.tests.push({name:"설정 파일과 WebView 프로필은 실행 파일 옆 portable-data에 저장",passed:true});
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

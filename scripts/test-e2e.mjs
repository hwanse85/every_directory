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
import { prepare, suggestedFolders } from "./e2e-fixtures.mjs";
const suite = process.argv[2] ?? "search";
// macOS(WKWebView)에서는 플랫폼 공용 스위트만 실행한다. shell-new·history-monitor·windows는 Windows 셸·클립보드 감시를 검증한다.
const macSuites = ["ux", "quick", "empty", "desktop", "audit", "portable", "search", "explorer", "history", "layout", "columns", "tree", "actions", "grid", "clipboard", "drag", "transfer"];
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
// 기존 검사는 검색 결과 선택 시 탐색창이 따라가는 흐름을 쓰므로 켜 두고, ux는 실제 기본값(꺼짐)부터 검증한다.
// search는 본문 검색(content:)도 켜서 확인한다.
if(!["ux","portable","empty"].includes(suite)){await mkdir(data,{recursive:true});await writeFile(path.join(data,"preferences.json"),JSON.stringify({followSearchSelection:true,...(suite==="search"?{contentSearch:true}:{})}));}
const env = {
  ...process.env,
  EVERY_DIRECTORY_DATA: data,
  EVERY_DIRECTORY_SMOKE_ROOT: root,
  EVERY_DIRECTORY_SKIP_SMOKE: "1",
  EVERY_DIRECTORY_E2E_SUITE: suite,
};
if(suite==="portable")delete env.EVERY_DIRECTORY_DATA;
if (suite === "quick") env.EVERY_DIRECTORY_QUICK_SMOKE = "1";
// 빠른 검색 앱 표시: 사용자 앱 대신 검증용 앱 폴더(macOS .app 폴더, Windows .lnk)를 쓴다.
if (suite === "quick") {
  const apps = path.join(temp, "apps");
  await mkdir(apps, { recursive: true });
  if (mac) await mkdir(path.join(apps, "계산 시험 앱.app"), { recursive: true });
  else await writeFile(path.join(apps, "계산 시험 앱.lnk"), "shortcut placeholder");
  env.EVERY_DIRECTORY_APP_DIRS = apps;
}
// 업데이트 확인: GitHub 대신 로컬 릴리스 정보(file://)를 읽는다.
if (["quick", "search"].includes(suite)) {
  const feed = path.join(temp, "release.json");
  await writeFile(feed, JSON.stringify({ tag_name: "v99.0.0", html_url: "https://github.com/hwanse85/every_directory/releases/tag/v99.0.0", published_at: "2026-11-15T00:00:00Z", body: "검증용 릴리스" }));
  env.EVERY_DIRECTORY_UPDATE_FEED = (await import("node:url")).pathToFileURL(feed).href;
}
if(suite==="history-monitor")env.EVERY_DIRECTORY_TEST_CLIPBOARD_MONITOR="1";
if (suite === "windows") env.EVERY_DIRECTORY_WINDOWS_UI = "1";
if (suite === "empty") {
  // 첫 실행 추천 폴더는 사용자 폴더 대신 검증용 임시 폴더를 쓴다.
  env.EVERY_DIRECTORY_SUGGESTED_ROOTS = (await suggestedFolders(path.join(temp, "추천"))).join(path.delimiter);
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
    // macOS WKWebView는 프로필 폴더를 지정하지 않으므로 WebView 프로필 위치는 Windows에서만 확인한다.
    if(preferences.clipboardDays!==23||preferences.followSearchSelection!==true||preferences.showHidden!==true||(!mac&&!(await stat(path.join(data,"webview"))).isDirectory()))throw new Error("Portable data/profile location mismatch");
    const desktop=JSON.parse(await readFile(path.join(data,"desktop.json"),"utf8"));
    if((desktop.defaultSearchMode??desktop.default_search_mode)!=="normal")throw new Error("Portable desktop settings location mismatch");
    report.tests.push({name:mac?"설정 파일은 실행 파일 옆 portable-data에 저장":"설정 파일과 WebView 프로필은 실행 파일 옆 portable-data에 저장",passed:true});
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

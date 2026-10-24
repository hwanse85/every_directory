import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
async function command(args) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
if (process.platform !== "win32")
  throw new Error("Windows WebView2용 E2E입니다.");
if (
  (await command([
    "scripts/desktop.mjs",
    "build",
    "--debug",
    "--no-bundle",
    "--features",
    "smoke-test",
  ])) !== 0
)
  throw new Error("E2E 빌드 실패");
const reports = [];
for (const suite of [
  "search",
  "desktop",
  "actions",
  "quick",
  "grid",
  "clipboard",
  "drag",
  "transfer",
  "empty",
  "windows",
]) {
  const code = await command(["scripts/test-e2e.mjs", suite, "--no-build"]);
  try {
    const report = JSON.parse(
      await readFile(`test-results/e2e/${suite}.json`, "utf8"),
    );
    reports.push({ suite, ...report, skipped:code === 77 && report.skipped === true, passed: code === 0 && report.passed });
  } catch {
    reports.push({ suite, passed: false, errors: ["검증 보고서 생성 실패"] });
  }
}
await mkdir("test-results/e2e", { recursive: true });
const summary = {
  passed: reports.every((r) => r.passed || r.skipped),
  complete: reports.every((r) => !r.skipped),
  skipped: reports.filter((r) => r.skipped).length,
  checks: reports.reduce((n, r) => n + (r.tests?.length ?? 0), 0),
  reports,
  finished: new Date().toISOString(),
};
await writeFile(
  "test-results/e2e/summary.json",
  JSON.stringify(summary, null, 2),
);
console.log(
  `E2E ${reports.filter((r) => r.passed).length}/${reports.length} suites; ${summary.skipped} skipped; ${summary.checks} checks; test-results/e2e/summary.json`,
);
if (!summary.passed) process.exitCode = 1;

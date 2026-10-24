import fs from "node:fs";
import { execFileSync } from "node:child_process";
const inventory = JSON.parse(
  fs.readFileSync("src/third-party-licenses.json", "utf8"),
);
const notices = fs.readFileSync("THIRD_PARTY_NOTICES.txt", "utf8");
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const ids = new Set(
  inventory.map((item) => `${item.ecosystem}:${item.name}@${item.version}`),
);
const errors = [];
for (const [name, item] of Object.entries(lock.packages)) {
  if (
    name &&
    !item.dev &&
    !ids.has(`npm:${name.split("node_modules/").at(-1)}@${item.version}`)
  )
    errors.push(`npm 목록 누락: ${name}@${item.version}`);
}
for (const item of inventory) {
  const id = `${item.ecosystem}:${item.name}@${item.version}`;
  if (!item.license || !notices.includes(id)) errors.push(`고지 누락: ${id}`);
}
if (process.argv.includes("--native")) {
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--manifest-path",
        "src-tauri/Cargo.toml",
        "--locked",
        "--offline",
        "--format-version",
        "1",
        "--filter-platform",
        "x86_64-pc-windows-msvc",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true },
    ),
  );
  for (const item of metadata.packages.filter(
    (item) => item.name !== "every-directory",
  )) {
    const id = `cargo:${item.name}@${item.version}`;
    if (!ids.has(id) || !notices.includes(`${id} (`))
      errors.push(`Windows 의존성 라이선스 전문 누락: ${id}`);
  }
}
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const tauri = JSON.parse(
  fs.readFileSync("src-tauri/tauri.conf.json", "utf8"),
).version;
const cargo = /\nversion = "([^"]+)"/.exec(
  fs.readFileSync("src-tauri/Cargo.toml", "utf8"),
)[1];
if (
  [lock.version, lock.packages[""].version, tauri, cargo].some(
    (value) => value !== version,
  )
)
  errors.push("앱 버전 메타데이터 불일치");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `의존성 목록·고지 ${inventory.length}개 및 앱 버전 ${version} 일치${process.argv.includes("--native") ? "; Windows Cargo 라이선스 전문 확인" : ""}`,
  );

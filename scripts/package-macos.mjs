import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Finder 자동화 없이 빌드된 Mac 앱의 설치 이미지와 압축본을 생성한다.
if (process.platform !== "darwin") throw new Error("macOS에서 실행해 주세요.");
const root = process.cwd();
const app = path.join(root, "src-tauri/target/release/bundle/macos/Every Directory.app");
if (!existsSync(app)) throw new Error("npm run desktop:build -- --bundles app 명령으로 앱을 먼저 빌드해 주세요.");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const architecture = process.arch === "arm64" ? "aarch64" : process.arch;
const destination = path.join(root, "src-tauri/target/release/bundle/dmg");
const staging = mkdtempSync(path.join(tmpdir(), "every-directory-package-"));
const filename = `EveryDirectory_${version}_${architecture}`;
try {
  execFileSync("mkdir", ["-p", destination]);
  // 로컬 배포 번들에 임시 서명을 적용하고 리소스 무결성을 확인한다.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
  execFileSync("ditto", [app, path.join(staging, "Every Directory.app")]);
  symlinkSync("/Applications", path.join(staging, "Applications"));
  execFileSync("hdiutil", ["create", "-volname", "Every Directory", "-srcfolder", staging, "-format", "UDZO", "-ov", path.join(destination, `${filename}.dmg`)], { stdio: "inherit" });
  execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, path.join(destination, `${filename}.zip`)]);
  console.log(`배포 파일: ${destination}/${filename}.{dmg,zip}`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}

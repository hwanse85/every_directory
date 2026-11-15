// Windows 코드 서명: Tauri의 signCommand가 파일마다 부른다. 인증서(PFX)와 암호는 환경 변수로만 받는다.
// 사용: node scripts/sign-windows.mjs <서명할 파일>
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const file = process.argv[2];
const certificate = process.env.WINDOWS_CERTIFICATE_PATH;
const password = process.env.WINDOWS_CERTIFICATE_PASSWORD ?? "";
if (!file || !certificate) {
  console.error("서명할 파일과 WINDOWS_CERTIFICATE_PATH가 필요합니다.");
  process.exit(1);
}
// Windows SDK에서 가장 새 x64 signtool.exe를 찾는다.
const kits = "C:\\Program Files (x86)\\Windows Kits\\10\\bin";
const versions = readdirSync(kits).filter((name) => /^10\./.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const signtool = path.join(kits, versions.at(-1), "x64", "signtool.exe");
// 셸을 거치지 않고 인자 배열로 실행한다(경로의 공백·특수문자 안전).
execFileSync(signtool, ["sign", "/fd", "sha256", "/tr", "http://timestamp.digicert.com", "/td", "sha256", "/f", certificate, "/p", password, file], { stdio: "inherit" });

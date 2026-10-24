import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const emailPattern = /[A-Z0-9._%+-]+@(?:gmail\.com|naver\.com|daum\.net|hanmail\.net|outlook\.com)\b/gi;
const homePattern = /(?:[A-Z]:[\\/]+Users[\\/]+|\/(?:Users|home)\/)([^\\/\s\x00"'<>=]+)/gi;
const secretPattern = /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,})\b|-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g;
const examples = new Set(["me","test","user","username","example","직원","runner","runneradmin","runner~1"]);
const noticePath = path.resolve(fileURLToPath(new URL("../THIRD_PARTY_NOTICES.txt", import.meta.url)));
const creditedEmails = new Set([...fs.readFileSync(noticePath,"utf8").matchAll(emailPattern)].map(m=>m[0].toLowerCase()));

// Never include the matching private value in diagnostics or CI logs.
export function privacyFindings(source, label, { licensed = false } = {}) {
  const findings = [];
  const add = (kind, index) => findings.push({file:label,kind,line:source.slice(0,index).split("\n").length});
  if (!licensed) for (const m of source.matchAll(emailPattern))
    if (!creditedEmails.has(m[0].toLowerCase())) add("personal-email",m.index);
  for (const m of source.matchAll(homePattern))
    if (!examples.has(m[1].toLowerCase()) && !m[1].startsWith("[")) add("personal-home-path",m.index);
  for (const m of source.matchAll(secretPattern)) add("credential-pattern",m.index);
  return findings;
}

export function assertPrivateBinary(filename) {
  const bytes = fs.readFileSync(filename);
  const findings = [
    ...privacyFindings(bytes.toString("utf8"),path.basename(filename)),
    ...privacyFindings(bytes.toString("utf16le"),path.basename(filename)),
  ];
  if (findings.length) throw new Error(`Privacy check failed: ${JSON.stringify(findings.slice(0,10))}`);
  console.log(`Privacy check passed: ${path.basename(filename)}`);
}

function git(args, encoding = "utf8") {
  return execFileSync("git",args,{encoding,maxBuffer:64*1024*1024,windowsHide:true});
}

export function checkRepository(history = false) {
  const findings = [];
  const files = git(["ls-files","-z"]).split("\0").filter(Boolean);
  const scan = (bytes, label) => {
    if (bytes.subarray(0,4096).includes(0)) return;
    findings.push(...privacyFindings(bytes.toString("utf8"),label,{licensed:/(?:^|\/)THIRD_PARTY_NOTICES\.txt$/.test(label)}));
  };
  for (const file of files) {
    if (/\.(?:exe|dmg|zip|pdb|sqlite|db)$/i.test(file)) findings.push({file,kind:"tracked-distribution-or-user-data"});
    scan(fs.readFileSync(file),file);
  }
  let commits = 0;
  if (history) {
    for (const line of git(["log","--all","--format=%H%x00%ae%x00%ce"]).trim().split("\n").filter(Boolean)) {
      const [sha,...emails] = line.split("\0"); commits++;
      if (emails.some(email=>!/@(?:users\.noreply\.github\.com|noreply\.github\.com|github\.com)$/.test(email)))
        findings.push({commit:sha.slice(0,8),kind:"non-noreply-commit-email"});
    }
    const objects = new Map(git(["rev-list","--objects","--all"]).trim().split("\n").map(line=> {
      const space=line.indexOf(" "); return space<0?[line,""]:[line.slice(0,space),line.slice(space+1)];
    }));
    for (const [sha,file] of objects) {
      if (!file) continue;
      if (/\.(?:exe|dmg|zip|pdb|sqlite|db)$/i.test(file)) findings.push({file,kind:"distribution-or-user-data-in-history"});
      if (!/\.(?:[cm]?jsx?|tsx?|rs|md|txt|json|toml|ya?ml|ps1|sh|nsh)$/.test(file)) continue;
      if (git(["cat-file","-t",sha]).trim() !== "blob") continue;
      scan(git(["cat-file","blob",sha],null),file);
    }
  }
  if (findings.length) throw new Error(`Repository privacy check failed: ${JSON.stringify(findings.slice(0,30))}`);
  console.log(`Repository privacy check passed: ${files.length} tracked files${history?`, ${commits} commits and reachable history`:""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const index = process.argv.indexOf("--binary");
    if (index >= 0) {
      const files = process.argv.slice(index+1);
      if (!files.length) throw new Error("Specify an unpacked executable after --binary.");
      for (const file of files) assertPrivateBinary(file);
    } else checkRepository(process.argv.includes("--history"));
  } catch (error) { console.error(error.message); process.exitCode=1; }
}

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-expect-error The scanner is also an executable JavaScript module.
import { privacyFindings } from "../scripts/check-privacy.mjs";

test("privacy diagnostics detect personal paths, emails and credentials without echoing them", () => {
  const account = "fixture-owner";
  const directory = ["", "Users", account, "project"].join("/");
  const email = ["fixture-person", "gmail.com"].join("@");
  const token = ["gh", "p_", "x".repeat(36)].join("");
  const findings = privacyFindings([directory,email,token].join("\n"),"fixture");
  assert.deepEqual(findings.map((x: {kind:string})=>x.kind),["personal-email","personal-home-path","credential-pattern"]);
  for (const value of [account,email,token]) assert.ok(!JSON.stringify(findings).includes(value));
});

test("public test fixtures and generic remapped build paths are permitted", () => {
  for (const account of ["test","me","example","직원","runner","runneradmin"])
    assert.deepEqual(privacyFindings(["","Users",account,"file"].join("/"),"fixture"),[]);
  assert.deepEqual(privacyFindings("/build/user/.cargo/source /build/every-directory/src/main.rs","fixture"),[]);
});

test("running the privacy scanner in a nested folder still checks the repository root", async () => {
  const folder = await mkdtemp(path.join(tmpdir(),"ed-privacy-"));
  try {
    execFileSync("git",["init","--quiet"],{cwd:folder,windowsHide:true});
    const privateEmail = ["fixture-person","gmail.com"].join("@");
    await writeFile(path.join(folder,"data.txt"),privateEmail);
    execFileSync("git",["add","data.txt"],{cwd:folder,windowsHide:true});
    const nested = path.join(folder,"nested");
    await mkdir(nested);
    const script=fileURLToPath(new URL("../scripts/check-privacy.mjs",import.meta.url));
    const result=spawnSync(process.execPath,[script],{cwd:nested,encoding:"utf8",windowsHide:true});
    assert.equal(result.status,1);
    assert.ok(result.stderr.includes("personal-email"));
    assert.ok(result.stderr.includes("data.txt"));
    assert.ok(!result.stderr.includes(privateEmail));
  } finally {
    if(path.dirname(path.resolve(folder))!==path.resolve(tmpdir()) || !path.basename(folder).startsWith("ed-privacy-")) throw new Error("Unexpected fixture path");
    await rm(folder,{recursive:true,force:true});
  }
});

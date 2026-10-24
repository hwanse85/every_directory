import test from "node:test";
import assert from "node:assert/strict";
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

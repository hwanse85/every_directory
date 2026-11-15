import assert from "node:assert/strict";
import test from "node:test";
import { calculate, formatResult, looksLikeMath } from "../src/calculator";

// 빠른 검색 계산: 우선순위·괄호·거듭제곱을 지키고, 파일 이름처럼 보이는 입력은 계산하지 않는다.
test("빠른 검색 계산식", () => {
  assert.equal(calculate("12*3+4"), 40);
  assert.equal(calculate("(1+2)*3"), 9);
  assert.equal(calculate("2^3^2"), 512);
  assert.equal(calculate("10 % 4"), 2);
  assert.equal(calculate("-3 + 5"), 2);
  assert.equal(calculate("1,200 * 3"), 3600);
  assert.equal(calculate("7 ÷ 2"), 3.5);
  assert.equal(calculate("=42"), 42);
  assert.equal(calculate("1/0"), undefined);
  assert.equal(calculate("(1+2"), undefined);
  for (const name of ["2026", "2026-03", "2026-03-15", "010-1234-5678", "v1.2", "보고서 2026", "img_0042", "1.2.3"]) assert.equal(looksLikeMath(name), false, name);
  assert.equal(calculate("2026 - 3"), 2023);
  assert.equal(formatResult(1234567.5), "1,234,567.5");
  assert.equal(formatResult(0.1 + 0.2), "0.3");
});

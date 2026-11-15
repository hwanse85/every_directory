import assert from "node:assert/strict";
import test from "node:test";
import { correctedQuery, englishToHangul, hangulToEnglish } from "../src/keyboard";
import { FileIndex } from "../src/search";
import type { FileEntry } from "../src/types";

// 데스크톱 엔진(keyboard.rs)과 같은 두벌식 변환 규칙을 확인한다.
test("한/영 자판 변환은 두벌식 배열을 따른다", () => {
  assert.equal(englishToHangul("qhrhtj"), "보고서");
  assert.equal(englishToHangul("ghldmlfhr"), "회의록");
  assert.equal(englishToHangul("dkssudgktpdy"), "안녕하세요");
  assert.equal(englishToHangul("rkqt"), "값");
  assert.equal(englishToHangul("ext:pdf qhrhtj"), "ext:pdf 보고서");
  assert.equal(englishToHangul("report"), undefined);
  assert.equal(englishToHangul("str"), undefined);
  assert.equal(hangulToEnglish("메ㅡ"), "apm");
  assert.equal(hangulToEnglish("ㄱ데ㅐㄱㅅ"), "report");
  assert.equal(hangulToEnglish("값"), "rkqt");
  assert.equal(hangulToEnglish("ㅁ"), undefined);
  assert.equal(correctedQuery("qhrhtj"), "보고서");
});

// 결과가 없을 때만 바꾼 검색어로 찾고, 원래 검색어로 찾기를 고르면 보정하지 않는다.
test("웹 검색도 결과가 없으면 한/영 자판을 바꿔 찾는다", () => {
  const entry = (name: string): FileEntry => ({ id: `r:${name}`, rootId: "r", path: name, parent: "", name, kind: "file", extension: name.split(".").pop() ?? "", size: 1, modified: 1 });
  const index = new FileIndex();
  index.replace([entry("보고서.txt"), entry("report.pdf")]);
  const base = { category: "all" as const, rootId: "", fullPath: false, mode: "initials" as const };
  const corrected = index.search({ ...base, query: "qhrhtj" });
  assert.deepEqual([corrected.entries.map((e) => e.name), corrected.corrected], [["보고서.txt"], "보고서"]);
  const plain = index.search({ ...base, query: "report" });
  assert.deepEqual([plain.entries.map((e) => e.name), plain.corrected], [["report.pdf"], undefined]);
  assert.equal(index.search({ ...base, query: "qhrhtj", noCorrect: true }).total, 0);
});

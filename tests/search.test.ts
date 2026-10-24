import test from "node:test";
import assert from "node:assert/strict";
import { FileIndex, filenameFilter } from "../src/search";
import { createDemoEntries } from "../src/demo";
import type { FileEntry, SearchOptions } from "../src/types";

const index = new FileIndex();
const entries = createDemoEntries();
index.replace(entries);

test("folder filters support composed, pasted, mixed and tense Korean initials", () => {
  for (const query of ["ㅂㄱㅅ", "ᄇᄀᄉ", "ﾲﾡﾵ", "보고ㅅ"]) assert.ok(filenameFilter(query)("업무 보고서.txt"), query);
  assert.ok(filenameFilter("ㅆㄹㅁㅇㄷ")("쏠리마인드.txt"));
  assert.ok(!filenameFilter("ㅆㄹㅁㅇㄷ")("업무 보고서.txt"));
});

// 필터 기본값을 포함한 검색을 수행한다.
function search(query: string, extra: Partial<SearchOptions> = {}) {
  return index.search({
    query,
    mode: "normal",
    rootId: "",
    category: "all",
    fullPath: false,
    ...extra,
  });
}

test("Korean and case-insensitive filename search match exact substrings", () => {
  assert.ok(search("프로젝트").total > 1);
  assert.equal(search("readme").entries[0].name, "README.md");
  assert.equal(search("없는파일").total, 0);
});
test("AND words, phrases, and extension filters compose", () => {
  assert.equal(
    search("프로젝트 기획 ext:pdf").entries[0].name,
    "프로젝트 기획서.pdf",
  );
  assert.equal(
    search('"업무 계획"').entries[0].name,
    "2026년 4분기 업무 계획.pdf",
  );
  assert.ok(
    search("ext:pdf,docx").entries.every((e) =>
      ["pdf", "docx"].includes(e.extension),
    ),
  );
  assert.equal(search("ext:nonexistent").total, 0);
});
test("folder, root scope, and path filters do not leak other results", () => {
  assert.ok(
    search("", { category: "folder" }).entries.every(
      (e) => e.kind === "directory",
    ),
  );
  assert.ok(
    search("", { rootId: "demo-documents" }).entries.every(
      (e) => e.rootId === "demo-documents",
    ),
  );
  assert.equal(search("Every Directory").total, 1);
  assert.ok(search("Every Directory", { fullPath: true }).total > 1);
  assert.equal(
    index
      .list("demo-projects", "Every Directory")
      .some((e) => e.parent !== "Every Directory"),
    false,
  );
});
test("result limit retains exact total and index replacement removes stale files", () => {
  const local = new FileIndex();
  local.replace(entries);
  const result = local.search({
    query: "",
    category: "all",
    rootId: "",
    fullPath: false,
    limit: 3,
  });
  assert.equal(result.entries.length, 3);
  assert.equal(result.total, entries.length);
  local.replace([]);
  assert.equal(
    local.search({
      query: "프로젝트",
      category: "all",
      rootId: "",
      fullPath: false,
    }).total,
    0,
  );
  assert.equal(local.list("demo-projects", "").length, 0);
});
test("trigram candidates match a direct substring oracle, including normalized Korean", () => {
  const local = new FileIndex();
  const files: FileEntry[] = Array.from({ length: 3000 }, (_, n) => ({
    id: String(n),
    rootId: "r",
    path: `folder/Report_${n}_기획서.pdf`,
    parent: "folder",
    name: `Report_${n}_기획서.pdf`,
    kind: "file",
    extension: "pdf",
  }));
  local.replace(files);
  for (const word of [
    "Report",
    "11",
    "2799",
    "기획",
    "기획서".normalize("NFD"),
    "zzz",
    "report_1",
  ]) {
    const actual = local.search({
      query: word,
      category: "all",
      rootId: "",
      fullPath: false,
      limit: 5000,
    });
    const expected = files.filter((f) =>
      f.name
        .normalize("NFC")
        .toLowerCase()
        .includes(word.normalize("NFC").toLowerCase()),
    );
    assert.equal(actual.total, expected.length);
    assert.deepEqual(
      actual.entries.map((f) => f.id),
      expected.slice(0, 1000).map((f) => f.id),
    );
  }
});

test("wildcards match the whole target and escape regex punctuation", () => {
  assert.equal(
    search("*기획*.pdf", { mode: "wildcard" }).entries[0].name,
    "프로젝트 기획서.pdf",
  );
  assert.equal(search("기획", { mode: "wildcard" }).total, 0);
  assert.equal(
    search("README.??", { mode: "wildcard" }).entries[0].name,
    "README.md",
  );
  const local = new FileIndex();
  local.replace(
    ["report[1].pdf", "report1.pdf", "a+b.txt", "axb.txt"].map((name, i) => ({
      id: String(i),
      rootId: "r",
      name,
      path: name,
      parent: "",
      kind: "file",
      extension: name.split(".").pop()!,
    })),
  );
  assert.equal(
    local.search({
      query: "*report[1].*",
      mode: "wildcard",
      rootId: "",
      category: "all",
      fullPath: false,
    }).total,
    1,
  );
  assert.equal(
    local.search({
      query: "a+b.*",
      mode: "wildcard",
      rootId: "",
      category: "all",
      fullPath: false,
    }).total,
    1,
  );
});

test("RE2 regex preserves escapes, anchors, alternation, and case sensitivity", () => {
  assert.equal(search(String.raw`^README\.md$`, { mode: "regex" }).total, 1);
  assert.equal(
    search("^readme", { mode: "regex", caseSensitive: true }).total,
    0,
  );
  assert.equal(
    search(String.raw`^\D+\.md$`, { mode: "regex" }).entries.some(
      (entry) => entry.name === "README.md",
    ),
    true,
  );
  assert.ok(
    search(String.raw`기획.*\.(pdf|docx)$`, { mode: "regex" }).total > 0,
  );
  assert.throws(() => search("[", { mode: "regex" }), /정규식 오류/);
  assert.throws(() => search("(?<=abc)def", { mode: "regex" }), /정규식 오류/);
  assert.throws(
    () => search(String.raw`(a)\1`, { mode: "regex" }),
    /정규식 오류/,
  );
});

test("fuzzy supports transpositions and returns exact hits ahead of typos", () => {
  assert.equal(
    search("raedme", { mode: "fuzzy" }).entries[0].name,
    "README.md",
  );
  assert.equal(search("계횟", { mode: "fuzzy" }).total, 0);
  const local = new FileIndex();
  local.replace(
    ["raedme.md", "readme.md", "readne.md", "report.md"].map((name, i) => ({
      id: String(i),
      rootId: "r",
      name,
      path: name,
      parent: "",
      kind: "file",
      extension: "md",
    })),
  );
  const result = local.search({
    query: "readme",
    mode: "fuzzy",
    rootId: "",
    category: "all",
    fullPath: false,
  });
  assert.deepEqual(
    result.entries.map((entry) => entry.name),
    ["readme.md", "raedme.md", "readne.md"],
  );
});

test("Korean initials compose with path scope, AND words, and extension filters", () => {
  assert.ok(search("ㄱㅎㅅ ext:pdf", { mode: "initials" }).total > 0);
  assert.equal(
    search("ㄱㅎㅅ ext:pdf", { mode: "initials" }).entries.some(
      (entry) => entry.name === "프로젝트 기획서.pdf",
    ),
    true,
  );
  assert.ok(search("README", { mode: "initials" }).total > 0);
  assert.equal(search("readme", { caseSensitive: true }).total, 0);
  assert.equal(search("", { limit: 100000 }).partial, false);
  assert.throws(() => search("a".repeat(513)), /512/);
});

// 파일명과 검색어의 공백 위치·종류가 달라도 초성과 필터가 함께 동작한다.
test("Korean initials ignore spacing in names, phrases, and full paths", () => {
  const local = new FileIndex();
  local.replace(
    [
      ["spaced", "데이터분석 발굴.pdf", "r"],
      ["joined", "데이터 분석발굴.pdf", "r"],
      ["unicode", "데이터\t분석\u3000발굴.pdf".normalize("NFD"), "r"],
      ["different", "데이터분석 발명.pdf", "r"],
      ["text", "데이터분석 발굴.txt", "r"],
      ["other-root", "데이터분석 발굴.pdf", "other"],
    ].map(([id, name, rootId]) => ({
      id,
      name,
      rootId,
      path: `한글 자료/${name}`,
      parent: "한글 자료",
      kind: "file",
      extension: name.split(".").pop()!,
    })),
  );
  // 같은 인덱스에 공백 변형과 검색 옵션을 적용한다.
  function find(query: string, extra: Partial<SearchOptions> = {}) {
    return local.search({
      query,
      mode: "initials",
      rootId: "r",
      category: "all",
      fullPath: false,
      ...extra,
    });
  }
  for (const query of [
    "ㄷㅇㅌㅂㅅ ㅂㄱ",
    "ㄷㅇㅌㅂㅅㅂㄱ",
    "ㄷ ㅇㅌ ㅂㅅㅂ ㄱ",
    " ㄷㅇㅌㅂㅅ\tㅂㄱ ",
    '"ㄷㅇㅌㅂㅅㅂㄱ"',
    '"ㄷㅇㅌㅂㅅ\u3000ㅂㄱ"',
    "데이터분석발굴",
  ]) {
    assert.deepEqual(
      find(`${query} ext:pdf`).entries.map((entry) => entry.id),
      ["spaced", "joined", "unicode"],
      query,
    );
  }
  assert.equal(
    find('"ㅎㄱㅈㄹ/ㄷㅇㅌㅂㅅㅂㄱ" ext:pdf', { fullPath: true }).total,
    3,
  );
  assert.equal(find("ㄷㅇㅌㅂㅅㅂㄱ ext:pdf", { category: "code" }).total, 0);
  assert.equal(find("데이터분석발굴", { mode: "normal" }).total, 0);
  assert.equal(find('"데이터분석 발굴"', { mode: "normal" }).total, 2);
  assert.equal(find("^데이터분석발굴", { mode: "regex" }).total, 0);
});

// 기본 통합 검색은 초성·겹받침·혼합 입력과 일반 단어를 함께 정확히 처리한다.
test("default search combines initials with literal Korean and English", () => {
  const local = new FileIndex();
  const names = [
    "업무 보고서.txt",
    "배관 검사.txt",
    "보고서_report.pdf",
    "readme.md",
  ];
  local.replace(
    names.map((name, id) => ({
      id: String(id),
      rootId: "r",
      name,
      path: name,
      parent: "",
      kind: "file",
      extension: name.split(".").at(-1)!,
    })),
  );
  const find = (query: string) =>
    local
      .search({ query, rootId: "r", category: "all", fullPath: false })
      .entries.map((item) => item.name);
  assert.deepEqual(find("ㅂㄳ"), ["업무 보고서.txt", "보고서_report.pdf"]);
  assert.deepEqual(find("보고ㅅ"), ["업무 보고서.txt", "보고서_report.pdf"]);
  assert.deepEqual(find("보고서"), ["업무 보고서.txt", "보고서_report.pdf"]);
  assert.deepEqual(find("report"), ["보고서_report.pdf"]);
  assert.deepEqual(find("*.pdf"), ["보고서_report.pdf"]);
  assert.deepEqual(find("배관"), ["배관 검사.txt"]);
});

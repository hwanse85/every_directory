import test from "node:test";
import assert from "node:assert/strict";
import { entriesCsv } from "../src/export";

// 한글·쉼표·따옴표와 스프레드시트 수식이 들어간 이름을 안전하게 내보낸다.
test("CSV export preserves paths and escapes formulas", () => {
  const csv = entriesCsv(
    [
      {
        id: "1",
        rootId: "root",
        name: '=sum(1,2)".txt',
        path: '문서/=sum(1,2)".txt',
        parent: "문서",
        kind: "file",
        extension: "txt",
        size: 7,
        modified: 1,
      },
      {
        id: "2",
        rootId: "root",
        name: "폴더",
        path: "폴더",
        parent: "",
        kind: "directory",
        extension: "",
      },
    ],
    [
      {
        id: "root",
        name: "자료",
        absolutePath: "C:\\자료",
        count: 2,
        lastIndexed: 0,
        skipped: 0,
      },
    ],
  );
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=sum(1,2)"".txt"'));
  assert.ok(csv.includes('C:\\자료\\문서\\=sum(1,2)"".txt'));
  assert.ok(csv.includes('"7","1970-01-01T00:00:00.001Z"'));
  assert.equal(csv.split("\r\n").length, 4);
});

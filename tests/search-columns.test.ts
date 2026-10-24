import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultSearchColumns,
  normalizeSearchColumns,
  searchColumnValue,
} from "../src/searchColumns";
import type { ConnectedRoot, FileEntry } from "../src/types";

const entry: FileEntry = {
  id: "file",
  rootId: "root",
  name: "업무 보고서.pdf",
  path: "문서/업무 보고서.pdf",
  parent: "문서",
  kind: "file",
  extension: "pdf",
  size: 2048,
  modified: 123456789,
};
const root: ConnectedRoot = {
  id: "root",
  name: "작업",
  absolutePath: "/Users/test/작업/",
  count: 1,
  lastIndexed: 0,
  skipped: 0,
};

test("표시 열 설정의 잘못된 형식·중복·필수 열을 처리한다", () => {
  assert.deepEqual(normalizeSearchColumns(null), defaultSearchColumns);
  assert.deepEqual(normalizeSearchColumns("size"), defaultSearchColumns);
  assert.deepEqual(
    normalizeSearchColumns(["size", "size", "unknown", "location"]),
    ["name", "location", "size"],
  );
  assert.deepEqual(normalizeSearchColumns([]), ["name"]);
});

test("Mac·Windows·브라우저 경로를 표시하고 숫자 속성으로 정렬한다", () => {
  assert.equal(
    searchColumnValue(entry, root, "fullPath"),
    "/Users/test/작업/문서/업무 보고서.pdf",
  );
  assert.equal(
    searchColumnValue(
      entry,
      { ...root, absolutePath: "C:\\작업\\" },
      "fullPath",
    ),
    "C:\\작업\\문서\\업무 보고서.pdf",
  );
  assert.equal(
    searchColumnValue(entry, { ...root, absolutePath: undefined }, "fullPath"),
    "작업/문서/업무 보고서.pdf",
  );
  assert.equal(searchColumnValue(entry, root, "location"), "작업/문서");
  assert.equal(searchColumnValue(entry, root, "type"), "PDF 파일");
  assert.equal(searchColumnValue(entry, root, "extension"), "PDF");
  assert.equal(searchColumnValue(entry, root, "root"), "작업");
  assert.equal(searchColumnValue(entry, root, "size"), 2048);
  assert.equal(searchColumnValue(entry, root, "modified"), 123456789);
});

test("폴더 용량과 확장자를 만들지 않고 미수집 속성을 구분한다", () => {
  const folder: FileEntry = {
    ...entry,
    kind: "directory",
    extension: "",
    size: 4096,
    modified: undefined,
  };
  assert.equal(searchColumnValue(folder, root, "type"), "폴더");
  assert.equal(searchColumnValue(folder, root, "extension"), "");
  assert.equal(searchColumnValue(folder, root, "size"), -1);
  assert.equal(searchColumnValue(folder, root, "modified"), -1);
  assert.equal(
    searchColumnValue(
      { ...entry, extension: "", size: undefined },
      undefined,
      "type",
    ),
    "파일",
  );
  assert.equal(
    searchColumnValue({ ...entry, size: undefined }, undefined, "size"),
    -1,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  addressLocation,
  displayPath,
  fileUri,
  joinDisplayPath,
  locationLabel,
  locationPath,
} from "../src/paths";
import { searchColumnValue } from "../src/searchColumns";
import { entriesCsv } from "../src/export";
import type { ConnectedRoot, FileEntry } from "../src/types";

function root(id: string, absolutePath: string, name = id): ConnectedRoot {
  return { id, absolutePath, name, count: 0, skipped: 0, lastIndexed: 0 };
}
const roots = [
  root("drive", "C:\\", "\\\\?\\C:\\"),
  root("docs", "C:\\Work\\Docs"),
  root("other", "D:\\자료"),
  root("share", "\\\\server\\공유"),
  root("mac", "/Users/test/Documents"),
];

test("Windows drive, UNC and extended paths use one native separator in tables and exports", () => {
  assert.equal(displayPath("\\\\?\\C:\\Work/문서"), "C:\\Work\\문서");
  assert.equal(displayPath("\\\\?\\UNC\\server\\공유"), "\\\\server\\공유");
  assert.equal(
    joinDisplayPath("C:/", "Work/보고서.txt"),
    "C:\\Work\\보고서.txt",
  );
  assert.equal(joinDisplayPath("/", "Users/test"), "/Users/test");
  assert.equal(locationLabel(roots[0], "Work/Docs"), "C:\\Work\\Docs");
  assert.equal(
    locationPath(roots[3], "보고서.txt"),
    "\\\\server\\공유\\보고서.txt",
  );
  const entry: FileEntry = {
    id: "file",
    rootId: "drive",
    name: "보고서.txt",
    path: "Work/보고서.txt",
    parent: "Work",
    extension: "txt",
    kind: "file",
  };
  assert.equal(searchColumnValue(entry, roots[0], "location"), "C:\\Work");
  assert.equal(
    searchColumnValue(entry, roots[0], "fullPath"),
    "C:\\Work\\보고서.txt",
  );
  assert.ok(entriesCsv([entry], roots).includes('"C:\\Work\\보고서.txt"'));
  assert.ok(!entriesCsv([entry], roots).includes("\\\\?\\"));
});

test("file links preserve UNC authority and encode Unicode, spaces and URL punctuation", () => {
  assert.equal(fileUri("C:\\Work\\a #%.txt"), "file:///C:/Work/a%20%23%25.txt");
  assert.equal(
    fileUri("\\\\?\\UNC\\server\\공유\\a.txt"),
    "file://server/%EA%B3%B5%EC%9C%A0/a.txt",
  );
  assert.equal(
    fileUri("/Users/test/a #.txt"),
    "file:///Users/test/a%20%23.txt",
  );
  assert.equal(
    fileUri("C:\\Work\\a(b)'!.txt"),
    "file:///C:/Work/a%28b%29%27%21.txt",
  );
});

test("address navigation chooses the deepest connected root and supports quoted Windows and UNC paths", () => {
  assert.deepEqual(addressLocation('"c:\\work\\docs\\하위"', roots, "drive"), {
    rootId: "docs",
    path: "하위",
  });
  assert.deepEqual(addressLocation("D:/자료/문서", roots, "drive"), {
    rootId: "other",
    path: "문서",
  });
  assert.deepEqual(
    addressLocation("\\\\?\\UNC\\server\\공유\\한글", roots, "drive"),
    { rootId: "share", path: "한글" },
  );
  assert.deepEqual(addressLocation("C:\\", roots, "other"), {
    rootId: "drive",
    path: "",
  });
  assert.deepEqual(addressLocation("문서/초안/../최종", roots, "other"), {
    rootId: "other",
    path: "문서/최종",
  });
  assert.deepEqual(
    addressLocation("/Users/test/Documents/Report", roots, "mac"),
    { rootId: "mac", path: "Report" },
  );
  assert.throws(() => addressLocation("/users/test/Documents", roots, "mac"));
  for (const path of [
    "E:\\outside",
    "C:relative",
    "../outside",
    " ",
    "\\\\server\\공유-other",
  ]) {
    assert.throws(() => addressLocation(path, roots, "other"), path);
  }
  assert.throws(() =>
    addressLocation("C:\\Work\\Docs-other", [roots[1]], "docs"),
  );
  assert.throws(() => addressLocation("D:\\자료\\..\\outside", roots, "other"));
});

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
  symlink,
} from "node:fs/promises";
import { ZipFile } from "yazl";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { LocalFiles, within } from "../server/service";
import { operate, listTrash, nativeCommand } from "../server/operations";
import { safeZipPath } from "../server/archive";
import { renamePreview, validateName } from "../src/rename";
import type { FileProperties, Location, RenameRule } from "../src/types";

const rule: RenameRule = {
  find: "report",
  replace: "보고서",
  regex: false,
  caseSensitive: false,
  preserveExtension: true,
  prefix: "",
  suffix: "_",
  number: true,
  start: 1,
  padding: 2,
};

// 임시 파일 작업 공간과 두 개의 연결 루트를 준비한다.
async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "ed-ops-"));
  const root = path.join(temporary, "root");
  const other = path.join(temporary, "other");
  await mkdir(path.join(root, "folder", "empty"), { recursive: true });
  await mkdir(other);
  await writeFile(path.join(root, "report.txt"), "hello world");
  await writeFile(path.join(root, "folder", "한글.txt"), "한국어 내용");
  const files = new LocalFiles(path.join(temporary, "data"), false);
  await files.initialize();
  const source = await files.scan({ absolutePath: root });
  const target = await files.scan({ absolutePath: other });
  return { files, root, other, source, target, temporary };
}

test("portable filenames and ZIP names reject Windows reserved names and path escapes", () => {
  for (const name of [
    "CON",
    "nul.txt",
    "COM1.md",
    "LPT9.pdf",
    "a:b",
    "a/b",
    "a\\b",
    "..",
    "bad.",
    "bad ",
    "",
    ".every-directory-trash",
    ".ed-work-a",
  ])
    assert.throws(() => validateName(name));
  for (const name of ["기획서 2026.txt", "A+b[1].md", ".env", "report_01.zip"])
    validateName(name);
  for (const name of [
    "../secret",
    "/etc/passwd",
    "C:/bad",
    "a/../../bad",
    "a\\bad",
    "folder/CON.txt",
    "a//b",
  ])
    assert.throws(() => safeZipPath(name));
  assert.equal(safeZipPath("한글/문서.txt"), "한글/문서.txt");
  assert.equal(within("/safe", "/safe-other"), false);
  assert.deepEqual(nativeCommand("C:\\Data\\a b.txt", true, "win32"), {
    command: "explorer.exe",
    args: ["/select,C:\\Data\\a b.txt"],
  });
  assert.deepEqual(nativeCommand("/Users/me/a b.txt", false, "darwin"), {
    command: "open",
    args: ["/Users/me/a b.txt"],
  });
});

test("rename preview preserves extensions, supports captures, and detects duplicate results", () => {
  const entries = [
    { name: "REPORT.txt", kind: "file" as const },
    { name: "report.md", kind: "file" as const },
  ];
  assert.deepEqual(renamePreview(entries, rule), [
    "보고서_01.txt",
    "보고서_02.md",
  ]);
  assert.deepEqual(
    renamePreview([{ name: "report_2026.txt", kind: "file" }], {
      ...rule,
      regex: true,
      find: "report_(\\d+)",
      replace: "$1_보고서",
      suffix: "",
      number: false,
    }),
    ["2026_보고서.txt"],
  );
  assert.deepEqual(
    renamePreview([{ name: "a+b.txt", kind: "file" }], {
      ...rule,
      find: "a+b",
      replace: "$hello",
      number: false,
      suffix: "",
    }),
    ["$hello.txt"],
  );
  assert.throws(
    () =>
      renamePreview(
        [
          { name: "a.txt", kind: "file" },
          { name: "b.txt", kind: "file" },
        ],
        {
          ...rule,
          regex: true,
          find: "^.*$",
          replace: "same",
          number: false,
          suffix: "",
        },
      ),
    /중복/,
  );
});

test("mkdir, copy, cut, rename and collisions preserve source data and update indexes", async () => {
  const f = await fixture();
  const entry: Location = { rootId: f.source.id, path: "report.txt" };
  const destination: Location = { rootId: f.target.id, path: "" };
  try {
    await operate(f.files, { action: "mkdir", destination, name: "새 폴더" });
    await operate(f.files, { action: "copy", entries: [entry], destination });
    assert.equal(
      await readFile(path.join(f.other, "report.txt"), "utf8"),
      "hello world",
    );
    await assert.rejects(
      operate(f.files, { action: "copy", entries: [entry], destination }),
      /같은 이름/,
    );
    await operate(f.files, {
      action: "rename",
      entries: [entry],
      name: "renamed.txt",
    });
    assert.ok(
      f.files.index
        .list(f.source.id, "")
        .some((item) => item.name === "renamed.txt"),
    );
    await operate(f.files, {
      action: "move",
      entries: [{ ...entry, path: "renamed.txt" }],
      destination: { rootId: f.target.id, path: "새 폴더" },
    });
    assert.equal(
      await readFile(path.join(f.other, "새 폴더", "renamed.txt"), "utf8"),
      "hello world",
    );
    assert.ok(
      !f.files.index
        .list(f.source.id, "")
        .some((item) => item.name === "renamed.txt"),
    );
    await assert.rejects(
      operate(f.files, {
        action: "copy",
        entries: [{ rootId: f.source.id, path: "folder" }],
        destination: { rootId: f.source.id, path: "folder/empty" },
      }),
      /원본/,
    );
    await assert.rejects(
      operate(f.files, {
        action: "trash",
        entries: [{ rootId: f.source.id, path: "" }],
      }),
      /루트/,
    );
    await assert.rejects(
      operate(f.files, { action: "mkdir", destination, name: "../bad" }),
    );
  } finally {
    await f.files.close();
    await rm(f.temporary, { recursive: true, force: true });
  }
});

test("trash restores files after server restart, avoids overwrite, and stays out of the index", async () => {
  const f = await fixture();
  try {
    await operate(f.files, {
      action: "trash",
      entries: [{ rootId: f.source.id, path: "report.txt" }],
    });
    const records = await listTrash(f.files);
    assert.equal(records.length, 1);
    assert.ok(
      !f.files.index.entries.some((entry) =>
        entry.path.includes(".every-directory-trash"),
      ),
    );
    const restored = new LocalFiles(path.join(f.temporary, "data"), false);
    await restored.initialize();
    await writeFile(path.join(f.root, "report.txt"), "existing");
    await assert.rejects(
      operate(restored, { action: "restore", trashId: records[0].id }),
      /같은 이름/,
    );
    await rm(path.join(f.root, "report.txt"));
    await operate(restored, { action: "restore", trashId: records[0].id });
    assert.equal(
      await readFile(path.join(f.root, "report.txt"), "utf8"),
      "hello world",
    );
    assert.equal((await listTrash(restored)).length, 0);
    await restored.close();
  } finally {
    await f.files.close();
    await rm(f.temporary, { recursive: true, force: true });
  }
});

test("trash remains restorable after disconnecting and reconnecting its root", async () => {
  const f = await fixture();
  try {
    await operate(f.files, {
      action: "trash",
      entries: [{ rootId: f.source.id, path: "report.txt" }],
    });
    await f.files.remove(f.source.id);
    const reconnected = await f.files.scan({ absolutePath: f.root });
    assert.notEqual(reconnected.id, f.source.id);
    const records = await listTrash(f.files);
    assert.equal(records.length, 1);
    assert.equal(records[0].rootId, reconnected.id);
    await operate(f.files, { action: "restore", trashId: records[0].id });
    assert.equal(
      await readFile(path.join(f.root, "report.txt"), "utf8"),
      "hello world",
    );
  } finally {
    await f.files.close();
    await rm(f.temporary, { recursive: true, force: true });
  }
});

test("ZIP roundtrip retains Unicode contents and empty folders; properties compute SHA-256", async () => {
  const f = await fixture();
  try {
    const destination = { rootId: f.target.id, path: "" };
    await operate(f.files, {
      action: "zip",
      entries: [
        { rootId: f.source.id, path: "folder" },
        { rootId: f.source.id, path: "report.txt" },
      ],
      destination,
      name: "자료.zip",
    });
    await operate(f.files, {
      action: "unzip",
      entries: [{ rootId: f.target.id, path: "자료.zip" }],
      destination,
      name: "풀기",
    });
    assert.equal(
      await readFile(path.join(f.other, "풀기", "folder", "한글.txt"), "utf8"),
      "한국어 내용",
    );
    assert.deepEqual(
      await readdir(path.join(f.other, "풀기", "folder", "empty")),
      [],
    );
    await assert.rejects(
      operate(f.files, {
        action: "unzip",
        entries: [{ rootId: f.target.id, path: "자료.zip" }],
        destination,
        name: "풀기",
      }),
      /같은 이름/,
    );
    const properties = (await operate(f.files, {
      action: "hash",
      entries: [{ rootId: f.source.id, path: "report.txt" }],
    })) as FileProperties;
    assert.equal(properties.bytes, 11);
    assert.equal(
      properties.sha256,
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  } finally {
    await f.files.close();
    await rm(f.temporary, { recursive: true, force: true });
  }
});

test("batch rename checks every target before changing any file", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, "report2.txt"), "second");
    await writeFile(path.join(f.root, "보고서_01.txt"), "existing");
    await f.files.scan(f.source);
    const entries = [
      { rootId: f.source.id, path: "report.txt" },
      { rootId: f.source.id, path: "report2.txt" },
    ];
    await assert.rejects(
      operate(f.files, { action: "batchRename", entries, rule }),
      /같은 이름/,
    );
    assert.equal(
      await readFile(path.join(f.root, "report.txt"), "utf8"),
      "hello world",
    );
    await rm(path.join(f.root, "보고서_01.txt"));
    await operate(f.files, { action: "batchRename", entries, rule });
    assert.equal(
      await readFile(path.join(f.root, "보고서_01.txt"), "utf8"),
      "hello world",
    );
    assert.equal(
      await readFile(path.join(f.root, "보고서2_02.txt"), "utf8"),
      "second",
    );
  } finally {
    await f.files.close();
    await rm(f.temporary, { recursive: true, force: true });
  }
});

test("mutation refuses replaced symlinks and archive symlinks without leaking files", async () => {
  const f = await fixture();
  try {
    await rm(path.join(f.root, "report.txt"));
    await symlink(
      path.join(f.root, "folder", "한글.txt"),
      path.join(f.root, "report.txt"),
    );
    await assert.rejects(
      operate(f.files, {
        action: "copy",
        entries: [{ rootId: f.source.id, path: "report.txt" }],
        destination: { rootId: f.target.id, path: "" },
      }),
      /링크/,
    );
    const zip = new ZipFile();
    const output = path.join(f.root, "link.zip");
    const done = pipeline(zip.outputStream, createWriteStream(output));
    zip.addBuffer(Buffer.from("../../outside"), "link", { mode: 0o120777 });
    zip.end();
    await done;
    await f.files.scan(f.source);
    await assert.rejects(
      operate(f.files, {
        action: "unzip",
        entries: [{ rootId: f.source.id, path: "link.zip" }],
        destination: { rootId: f.target.id, path: "" },
        name: "unsafe",
      }),
      /링크/,
    );
    assert.deepEqual(await readdir(f.other), []);
  } finally {
    await f.files.close();
    await rm(f.temporary, { recursive: true, force: true });
  }
});

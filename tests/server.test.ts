import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  rename,
  realpath,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalFiles, within } from "../server/service";

test("web exclusions persist without hiding folders from browsing",async()=>{
  const temporary=await mkdtemp(path.join(os.tmpdir(),"ed-exclusions-")),directory=path.join(temporary,"workspace"),data=path.join(temporary,"data");
  const files=new LocalFiles(data,false);
  try{
    await mkdir(path.join(directory,"private"),{recursive:true});await mkdir(path.join(directory,"private-copy"));
    await writeFile(path.join(directory,"private/secret.txt"),"private");await writeFile(path.join(directory,"private-copy/visible.txt"),"public");
    await files.initialize();const root=await files.scan({absolutePath:directory,excludedPaths:["private"]});
    assert.ok(!files.index.entries.some(entry=>entry.path.startsWith("private/")));assert.ok(files.index.entries.some(entry=>entry.path==="private-copy/visible.txt"));
    assert.ok((await files.list({rootId:root.id,path:""})).some(entry=>entry.name==="private"));
    const list=await files.list({rootId:root.id,path:"private"});assert.equal(list[0].name,"secret.txt");assert.ok(list[0].created);
    assert.equal(await files.resolveEntry(root.id,"private/secret.txt"),await realpath(path.join(directory,"private/secret.txt")));
    await files.scan({id:root.id});assert.deepEqual(files.roots()[0].excludedPaths,["private"]);
    const restored=new LocalFiles(data,false);await restored.initialize();assert.deepEqual(restored.roots()[0].excludedPaths,["private"]);await restored.close();
    await files.scan({id:root.id,excludedPaths:[]});assert.ok(files.index.entries.some(entry=>entry.path==="private/secret.txt"));
  }finally{await files.close();assert.ok(path.basename(temporary).startsWith("ed-exclusions-"));await rm(temporary,{recursive:true,force:true});}
});

// 실제 임시 폴더에서 서버 인덱싱과 복원을 검증한다.
test("local scanning persists metadata, skips links, and isolates connected paths", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "ed-service-"));
  const directory = path.join(temporary, "workspace");
  const data = path.join(temporary, "data");
  const files = new LocalFiles(data, false);
  try {
    await mkdir(path.join(directory, "빈 폴더"), { recursive: true });
    await mkdir(path.join(directory, "docs"));
    await mkdir(path.join(directory, "node_modules"));
    await writeFile(
      path.join(directory, "docs", "보고서.txt"),
      "로컬 파일 테스트",
    );
    await writeFile(path.join(directory, "README.md"), "# hello");
    await writeFile(
      path.join(directory, "node_modules", "ignored.txt"),
      "skip",
    );
    await mkdir(path.join(temporary, "outside"));
    await writeFile(path.join(temporary, "outside", "secret.txt"), "private");
    await symlink(
      path.join(temporary, "outside"),
      path.join(directory, "link.txt"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await files.initialize();
    const root = await files.scan({ absolutePath: directory });
    assert.equal(root.count, 4);
    assert.equal(root.skipped, 2);
    assert.equal(root.absolutePath, await realpath(directory));
    const result = files.index.search({
      query: "ㅂㄱㅅ",
      mode: "initials",
      rootId: root.id,
      fullPath: false,
      category: "all",
    });
    assert.equal(result.total, 1);
    assert.ok(result.entries[0].size! > 0);
    const filename = await files.resolveEntry(root.id, "docs/보고서.txt");
    assert.equal(await readFile(filename, "utf8"), "로컬 파일 테스트");
    await assert.rejects(files.resolveEntry(root.id, "../outside.txt"));
    await assert.rejects(files.resolveEntry(root.id, "/etc/hosts"));
    await assert.rejects(files.resolveEntry("unknown", "README.md"));
    await assert.rejects(files.resolveEntry(root.id, "link.txt"));
    assert.equal(within(directory, directory + "-other"), false);
    const again = await files.scan({ absolutePath: directory });
    assert.equal(again.id, root.id);
    const restored = new LocalFiles(data, false);
    await restored.initialize();
    assert.equal(restored.roots()[0].id, root.id);
    assert.equal(
      restored.index
        .list(root.id, "")
        .some((entry) => entry.name === "빈 폴더"),
      true,
    );
    await restored.close();
    const listing = await files.directories(directory);
    assert.deepEqual(
      listing.directories.map((entry) => entry.name),
      ["빈 폴더", "docs"],
    );
    await rename(directory, directory + "-gone");
    await assert.rejects(files.scan(root));
    assert.equal(files.roots()[0].count, 4);
    await files.remove(root.id);
    assert.ok(files.roots().every((item) => item.demo));
    assert.equal(
      await readFile(path.join(directory + "-gone", "README.md"), "utf8"),
      "# hello",
    );
  } finally {
    await files.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

// 파일 교체로 생긴 심볼릭 링크가 연결 폴더 밖을 읽지 못하게 한다.
test("file access rejects a symlink substituted after indexing", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "ed-boundary-"));
  const files = new LocalFiles(path.join(temporary, "data"), false);
  try {
    const directory = path.join(temporary, "root");
    await mkdir(directory);
    const filename = path.join(directory, "notes.txt");
    await writeFile(filename, "inside");
    await mkdir(path.join(temporary, "secret"));
    await writeFile(path.join(temporary, "secret", "notes.txt"), "outside");
    await files.initialize();
    const root = await files.scan({ absolutePath: directory });
    await rm(filename);
    await symlink(
      path.join(temporary, "secret"),
      filename,
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(files.resolveEntry(root.id, "notes.txt"), /밖/);
  } finally {
    await files.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

// 운영체제 파일 감시가 추가·수정·삭제를 완료 스냅샷에 반영하는지 확인한다.
test(
  "filesystem watcher refreshes created, renamed, and deleted files",
  { timeout: 15000 },
  async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "ed-watch-"));
    const directory = path.join(temporary, "root");
    const files = new LocalFiles(path.join(temporary, "data"));
    try {
      await mkdir(directory);
      await files.initialize();
      const root = await files.scan({ absolutePath: directory });
      // 변경 감시 초기 열거가 끝난 뒤 변경을 발생시킨다.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await writeFile(path.join(directory, "created.txt"), "hello");
      await waitFor(() =>
        files.index
          .list(root.id, "")
          .some((entry) => entry.name === "created.txt"),
      );
      await writeFile(path.join(directory, "created.txt"), "hello updated");
      await waitFor(() =>
        files.index
          .list(root.id, "")
          .some((entry) => entry.name === "created.txt" && entry.size === 13),
      );
      await rename(
        path.join(directory, "created.txt"),
        path.join(directory, "renamed.txt"),
      );
      await waitFor(
        () =>
          files.index
            .list(root.id, "")
            .some((entry) => entry.name === "renamed.txt") &&
          !files.index
            .list(root.id, "")
            .some((entry) => entry.name === "created.txt"),
      );
      await rm(path.join(directory, "renamed.txt"));
      await waitFor(() => files.index.list(root.id, "").length === 0);
    } finally {
      await files.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

// 조건을 만족할 때까지 짧은 간격으로 상태를 확인한다.
async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 4000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("파일 감시 갱신 시간 초과");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

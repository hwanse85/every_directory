import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// 실제 HTTP 서버에서 세션·검색·파일 스트리밍과 접근 경계를 검증한다.
test(
  "HTTP local session, search modes, range streaming, and origin restrictions",
  { timeout: 20000 },
  async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "ed-http-"));
    const directory = path.join(temporary, "root");
    await mkdir(directory);
    await writeFile(path.join(directory, "README.md"), "hello world");
    await writeFile(path.join(directory, "empty.txt"), "");
    await writeFile(
      path.join(directory, "worker.mjs"),
      "export const worker = true;",
    );
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "server/main.ts", "--production"],
      {
        env: {
          ...process.env,
          PORT: String(port),
          EVERY_DIRECTORY_DATA: path.join(temporary, "data"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const url = `http://127.0.0.1:${port}`;
    try {
      const deadline = Date.now() + 10000;
      while (!output.includes("Every Directory →")) {
        if (child.exitCode !== null || Date.now() > deadline)
          throw new Error(output || "서버 시작 시간 초과");
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      assert.equal((await fetch(url + "/api/session")).status, 403);
      assert.equal(
        (await fetch(url + "/api/init", { method: "POST" })).status,
        401,
      );
      const session = await fetch(url + "/api/session", {
        headers: { "X-ED-Client": "1" },
      });
      const cookie = session.headers.get("set-cookie")!.split(";")[0];
      assert.equal(session.status, 200);
      const headers = {
        "Content-Type": "application/json",
        "X-ED-Client": "1",
        Cookie: cookie,
      };
      // 브라우저와 동일한 JSON API 요청을 만든다.
      async function post(endpoint: string, payload: unknown) {
        return fetch(url + "/api/" + endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
      }
      const connected = await post("scan", { absolutePath: directory });
      assert.equal(connected.status, 200);
      const root = await connected.json();
      assert.equal(root.count, 3);
      for (const [mode, query] of [
        ["wildcard", "README.??"],
        ["regex", String.raw`^README\.md$`],
        ["fuzzy", "raedme"],
      ]) {
        const response = await post("search", {
          query,
          mode,
          category: "all",
          rootId: root.id,
          fullPath: false,
        });
        const result = await response.json();
        assert.equal(result.total, 1);
        assert.equal(result.entries[0].name, "README.md");
      }
      assert.equal(
        (
          await post("search", {
            query: "[",
            mode: "regex",
            category: "all",
            rootId: "",
            fullPath: false,
          })
        ).status,
        400,
      );
      const fileUrl =
        url +
        "/api/file?" +
        new URLSearchParams({ rootId: root.id, path: "README.md" });
      const range = await fetch(fileUrl, {
        headers: { Cookie: cookie, Range: "bytes=0-4" },
      });
      assert.equal(range.status, 206);
      assert.equal(range.headers.get("content-range"), "bytes 0-4/11");
      assert.equal(await range.text(), "hello");
      const empty = await fetch(
        url +
          "/api/file?" +
          new URLSearchParams({ rootId: root.id, path: "empty.txt" }),
        { headers: { Cookie: cookie, Range: "bytes=0-262143" } },
      );
      assert.equal(empty.status, 200);
      assert.equal(await empty.text(), "");
      const moduleFile = await fetch(
        url +
          "/api/file?" +
          new URLSearchParams({ rootId: root.id, path: "worker.mjs" }),
        { headers: { Cookie: cookie } },
      );
      assert.match(moduleFile.headers.get("content-type")!, /text\/javascript/);
      assert.match(
        moduleFile.headers.get("content-security-policy")!,
        /^sandbox;/,
      );
      assert.equal((await fetch(fileUrl)).status, 401);
      assert.equal(
        (
          await fetch(fileUrl, {
            headers: { Cookie: cookie, Origin: "https://evil.example" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(url + "/api/status", {
            method: "POST",
            headers: { ...headers, Origin: "https://evil.example" },
            body: "{}",
          })
        ).status,
        403,
      );
      const traversal = await fetch(
        url +
          "/api/file?" +
          new URLSearchParams({ rootId: root.id, path: "../secret" }),
        { headers: { Cookie: cookie } },
      );
      assert.equal(traversal.status, 400);
      const download = await fetch(fileUrl + "&download=1", {
        headers: { Cookie: cookie },
      });
      assert.match(download.headers.get("content-disposition")!, /attachment/);
      assert.equal(await download.text(), "hello world");
      const destination = { rootId: root.id, path: "" };
      assert.equal(
        (
          await fetch(url + "/api/operation", {
            method: "POST",
            headers: { ...headers, Origin: "https://evil.example" },
            body: JSON.stringify({
              action: "mkdir",
              destination,
              name: "blocked",
            }),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await post("operation", {
            action: "mkdir",
            destination,
            name: "새 폴더",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await post("operation", {
            action: "copy",
            entries: [{ ...destination, path: "README.md" }],
            destination: { ...destination, path: "새 폴더" },
          })
        ).status,
        200,
      );
      const copied = { rootId: root.id, path: "새 폴더/README.md" };
      assert.equal(
        (await post("operation", { action: "trash", entries: [copied] }))
          .status,
        200,
      );
      const records = await (await post("trash", {})).json();
      assert.equal(records.length, 1);
      assert.equal(
        (await post("operation", { action: "restore", trashId: records[0].id }))
          .status,
        200,
      );
      const listed = await (
        await post("list", { ...destination, path: "새 폴더" })
      ).json();
      assert.equal(listed[0].name, "README.md");
      assert.equal(
        (
          await post("operation", {
            action: "mkdir",
            destination,
            name: "../escape",
          })
        ).status,
        400,
      );
      assert.equal(
        (await post("list", { ...destination, path: "missing" })).status,
        400,
      );
      await post("remove", root.id);
      assert.equal(
        await (
          await import("node:fs/promises")
        ).readFile(path.join(directory, "README.md"), "utf8"),
        "hello world",
      );
    } finally {
      child.kill("SIGTERM");
      if (child.exitCode === null)
        await new Promise<void>((resolve) =>
          child.once("exit", () => resolve()),
        );
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

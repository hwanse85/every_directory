import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import type { FileOperation, SearchOptions } from "../src/types";
import type { ViteDevServer } from "vite";
import { operate, listTrash } from "./operations";
import { LocalFiles, within } from "./service";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const production = process.argv.includes("--production");
const port = Number(process.env.PORT || 5173);
const service = new LocalFiles(process.env.EVERY_DIRECTORY_DATA);
await service.initialize();
const session = randomBytes(32).toString("hex");
let vite: ViteDevServer | undefined;
const mimes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/plain",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

// JSON 응답과 상태 코드를 한 번만 전송한다.
function json(response: ServerResponse, value: unknown, status = 200): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

// 크기를 제한하고 JSON 요청 본문을 읽는다.
async function body(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new Error("JSON 요청이 필요합니다.");
  let data = "";
  for await (const chunk of request) {
    data += chunk;
    if (data.length > 262144) throw new Error("요청 크기를 초과했습니다.");
  }
  return data ? JSON.parse(data) : {};
}

// 파일을 스트리밍하고 미디어 탐색을 위한 범위 요청을 지원한다.
async function sendFile(
  request: IncomingMessage,
  response: ServerResponse,
  filename: string,
  attachment = false,
  sandboxed = false,
): Promise<void> {
  const metadata = await stat(filename);
  if (!metadata.isFile()) throw new Error("파일을 선택해 주세요.");
  const range = metadata.size
    ? request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
    : undefined;
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2]
    ? Math.min(Number(range[2]), metadata.size - 1)
    : metadata.size - 1;
  if (range && (start > end || start >= metadata.size)) {
    response.writeHead(416, { "Content-Range": `bytes */${metadata.size}` });
    response.end();
    return;
  }
  response.writeHead(range ? 206 : 200, {
    "Content-Type":
      mimes[path.extname(filename).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": range ? end - start + 1 : metadata.size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...(range
      ? { "Content-Range": `bytes ${start}-${end}/${metadata.size}` }
      : {}),
    ...(attachment
      ? {
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(filename))}`,
        }
      : sandboxed
        ? {
            "Content-Security-Policy":
              "sandbox; default-src 'none'; style-src 'unsafe-inline'",
          }
        : {}),
  });
  await pipeline(
    createReadStream(filename, range ? { start, end } : {}),
    response,
  );
}

// 같은 PC의 브라우저 요청만 허용하고 검색 API와 화면을 제공한다.
const server = http.createServer(async (request, response) => {
  const authority = request.headers.host ?? "";
  const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
  const origin = request.headers.origin;
  if (
    !allowed.includes(authority) ||
    (origin && !allowed.some((host) => origin === `http://${host}`))
  ) {
    json(response, { error: "로컬 브라우저에서 접속해 주세요." }, 403);
    return;
  }
  const url = new URL(request.url ?? "/", `http://${authority}`);
  try {
    if (url.pathname === "/api/session") {
      if (request.headers["x-ed-client"] !== "1") {
        json(response, { error: "클라이언트 확인 실패" }, 403);
        return;
      }
      response.setHeader(
        "Set-Cookie",
        `ed-session=${session}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=86400`,
      );
      json(response, service.status());
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      if (
        !request.headers.cookie
          ?.split(";")
          .some((cookie) => cookie.trim() === `ed-session=${session}`)
      ) {
        json(response, { error: "로컬 서버 연결을 다시 시작해 주세요." }, 401);
        return;
      }
      if (url.pathname === "/api/file" && request.method === "GET") {
        const filename = await service.resolveEntry(
          url.searchParams.get("rootId") ?? "",
          url.searchParams.get("path") ?? "",
        );
        await sendFile(
          request,
          response,
          filename,
          url.searchParams.get("download") === "1",
          true,
        );
        return;
      }
      if (request.method !== "POST" || request.headers["x-ed-client"] !== "1") {
        json(response, { error: "허용하지 않는 요청입니다." }, 405);
        return;
      }
      const payload = await body(request);
      switch (url.pathname) {
        case "/api/operation":
          json(response, await operate(service, payload as FileOperation));
          return;
        case "/api/trash":
          json(response, await listTrash(service));
          return;
        case "/api/init":
          json(response, service.roots());
          return;
        case "/api/status":
          json(response, service.status());
          return;
        case "/api/directories":
          json(
            response,
            await service.directories((payload as { path?: string }).path),
          );
          return;
        case "/api/scan":
          json(
            response,
            await service.scan(
              payload as { id?: string; absolutePath?: string },
            ),
          );
          return;
        case "/api/remove":
          await service.remove(String(payload));
          json(response, null);
          return;
        case "/api/directoryLocation": {
          const location = payload as { rootId: string; path: string };
          if (
            typeof location.rootId !== "string" ||
            typeof location.path !== "string"
          )
            throw new Error("탐색 경로가 올바르지 않습니다.");
          let relative = location.path;
          if (relative) {
            const candidates = service.index.entries.filter(
              (entry) =>
                entry.rootId === location.rootId && entry.kind === "directory",
            );
            const entry =
              candidates.find((entry) => entry.path === relative) ??
              candidates.find(
                (entry) =>
                  process.platform === "win32" &&
                  entry.path.toLowerCase() === relative.toLowerCase(),
              );
            if (!entry)
              throw new Error(
                "인덱스에 없는 폴더입니다. 경로를 확인하거나 새로고침해 주세요.",
              );
            relative = entry.path;
          }
          const target = { rootId: location.rootId, path: relative };
          if (
            !service.roots().find((root) => root.id === location.rootId)
              ?.demo &&
            !(await stat(await service.resolveLocation(target))).isDirectory()
          )
            throw new Error("폴더 경로를 입력해 주세요.");
          json(response, target);
          return;
        }
        case "/api/list": {
          const location = payload as { rootId: string; path: string };
          if (
            typeof location.rootId !== "string" ||
            typeof location.path !== "string"
          )
            throw new Error("탐색 경로가 올바르지 않습니다.");
          if (
            location.path &&
            !service.roots().find((root) => root.id === location.rootId)?.demo
          ) {
            const directory = await service.resolveLocation(location);
            if (!(await stat(directory)).isDirectory())
              throw new Error("탐색 경로는 폴더여야 합니다.");
          }
          json(response, service.index.list(location.rootId, location.path));
          return;
        }
        case "/api/search": {
          const options = payload as SearchOptions;
          if (
            typeof options.query !== "string" ||
            typeof options.rootId !== "string" ||
            typeof options.fullPath !== "boolean" ||
            ![
              "all",
              "document",
              "image",
              "folder",
              "code",
              "audio",
              "archive",
            ].includes(options.category) ||
            (options.mode &&
              !["normal", "wildcard", "regex", "fuzzy", "initials"].includes(
                options.mode,
              )) ||
            (options.caseSensitive !== undefined &&
              typeof options.caseSensitive !== "boolean") ||
            (options.limit !== undefined &&
              (!Number.isInteger(options.limit) ||
                options.limit < 1 ||
                options.limit > 1000))
          )
            throw new Error("검색 조건이 올바르지 않습니다.");
          json(response, service.index.search(options));
          return;
        }
        default:
          json(response, { error: "API를 찾을 수 없습니다." }, 404);
          return;
      }
    }
    if (vite) {
      vite.middlewares(request, response);
      return;
    }
    const dist = path.join(workspace, "dist");
    let filename = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
    if (!within(dist, filename)) throw new Error("올바르지 않은 경로입니다.");
    try {
      if (!(await stat(filename)).isFile())
        filename = path.join(dist, "index.html");
    } catch {
      filename = path.join(dist, "index.html");
    }
    await sendFile(request, response, filename);
  } catch (error) {
    if (!response.headersSent)
      json(
        response,
        { error: error instanceof Error ? error.message : "요청 처리 실패" },
        400,
      );
    else response.destroy();
  }
});
server.requestTimeout = 0;
vite = production
  ? undefined
  : await (
      await import("vite")
    ).createServer({
      root: workspace,
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
server.listen(port, "127.0.0.1", () => {
  console.log(
    `Every Directory → http://127.0.0.1:${port} (${production ? "production" : "development"})`,
  );
  console.log(`인덱스 저장: ${service.dataDirectory}`);
  for (const root of service.roots().filter((root) => !root.demo))
    void service.scan(root).catch(console.error);
});

// 종료 신호를 받으면 파일 감시와 HTTP 서버를 정리한다.
async function shutdown(): Promise<void> {
  await service.close();
  await vite?.close();
  server.close();
  server.closeAllConnections();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

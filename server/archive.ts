import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { ZipFile as ZipWriter } from "yazl";
import { open, type ZipFile, type Entry } from "yauzl";
import { within } from "./service";
import { validateName } from "../src/rename";

// 트리 안의 링크와 내부 작업 폴더를 제외하고 실제 항목을 순회한다.
export async function walk(
  absolute: string,
): Promise<
  { absolute: string; relative: string; directory: boolean; size: number }[]
> {
  const base = await realpath(absolute);
  const queue = [{ absolute, relative: "" }];
  const result = [];
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    const metadata = await lstat(item.absolute);
    if (
      metadata.isSymbolicLink() ||
      !within(base, await realpath(item.absolute))
    )
      throw new Error("하위 심볼릭 링크가 있는 항목은 처리할 수 없습니다.");
    if (!metadata.isFile() && !metadata.isDirectory())
      throw new Error("일반 파일과 폴더만 처리할 수 있습니다.");
    result.push({
      ...item,
      directory: metadata.isDirectory(),
      size: metadata.size,
    });
    if (metadata.isDirectory())
      for (const child of await readdir(item.absolute)) {
        if (child === ".every-directory-trash" || child.startsWith(".ed-work-"))
          continue;
        queue.push({
          absolute: path.join(item.absolute, child),
          relative: item.relative ? `${item.relative}/${child}` : child,
        });
      }
  }
  return result;
}

// 선택 항목의 이름과 빈 폴더를 유지하며 ZIP 스트림을 생성한다.
export async function zipFiles(
  sources: string[],
  target: string,
): Promise<void> {
  const trees = await Promise.all(sources.map(walk));
  const zip = new ZipWriter();
  const output = createWriteStream(target, { flags: "wx" });
  const done = pipeline(zip.outputStream, output);
  zip.on("error", (error) => output.destroy(error));
  for (let i = 0; i < sources.length; i++)
    for (const item of trees[i]) {
      const name =
        path.basename(sources[i]) + (item.relative ? `/${item.relative}` : "");
      if (item.directory) zip.addEmptyDirectory(name);
      else zip.addFile(item.absolute, name);
    }
  zip.end();
  await done;
}

// 압축 내부 경로와 Windows 예약 이름을 검사한다.
export function safeZipPath(name: string): string {
  if (
    typeof name !== "string" ||
    !name ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[a-z]:/i.test(name)
  )
    throw new Error("압축 파일에 올바르지 않은 경로가 있습니다.");
  const relative = name.replace(/\/$/, "");
  for (const part of relative.split("/")) validateName(part);
  return relative;
}

// ZIP 항목을 순서대로 풀고 경로 탈출·링크·과도한 크기를 차단한다.
export async function unzipFile(
  source: string,
  staging: string,
): Promise<void> {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    open(
      source,
      {
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
        autoClose: false,
      },
      (error, value) => (error ? reject(error) : resolve(value!)),
    ),
  );
  let entries = 0;
  let declaredBytes = 0;
  let actualBytes = 0;
  const names = new Set<string>();
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (entry: Entry) => {
        // 한 항목의 쓰기가 끝난 뒤 다음 항목을 요청한다.
        async function extract(): Promise<void> {
          const relative = safeZipPath(entry.fileName);
          const key = relative.normalize("NFC").toLowerCase();
          if (names.has(key))
            throw new Error("압축 파일에 중복 경로가 있습니다.");
          names.add(key);
          if (
            ++entries > 10000 ||
            (declaredBytes += entry.uncompressedSize) > 2 * 1024 ** 3
          )
            throw new Error("압축 해제 한도는 10,000개 항목·2GB입니다.");
          if (
            ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000 ||
            entry.isEncrypted()
          )
            throw new Error("링크 또는 암호화된 ZIP은 지원하지 않습니다.");
          const target = path.join(staging, relative);
          if (!within(staging, target))
            throw new Error("압축 경로가 대상 폴더를 벗어났습니다.");
          if (entry.fileName.endsWith("/"))
            await mkdir(target, { recursive: true });
          else {
            await mkdir(path.dirname(target), { recursive: true });
            const stream = await new Promise<
              ReturnType<typeof createReadStream>
            >((yes, no) =>
              zip.openReadStream(entry, (error, value) =>
                error
                  ? no(error)
                  : yes(value! as ReturnType<typeof createReadStream>),
              ),
            );
            const meter = new Transform({
              // 실제로 풀린 바이트 수가 전체 한도를 넘지 않게 검사한다.
              transform(chunk, _encoding, callback) {
                actualBytes += chunk.length;
                callback(
                  actualBytes > 2 * 1024 ** 3
                    ? new Error("압축 해제 크기 한도를 초과했습니다.")
                    : null,
                  chunk,
                );
              },
            });
            await pipeline(
              stream,
              meter,
              createWriteStream(target, { flags: "wx" }),
            );
          }
          zip.readEntry();
        }
        void extract().catch(reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

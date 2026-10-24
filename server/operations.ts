import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import type {
  FileOperation,
  FileProperties,
  Location,
  TrashItem,
} from "../src/types";
import { renamePreview, validateName } from "../src/rename";
import { LocalFiles, within } from "./service";
import { unzipFile, walk, zipFiles } from "./archive";
import { extractImageText, resizeImages } from "./images";

// 파일의 존재 여부만 확인하고 권한 오류는 숨기지 않는다.
async function exists(filename: string): Promise<boolean> {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

// 복사·이동 대상이 이미 있으면 덮어쓰기를 막는다.
async function requireUnused(filename: string): Promise<void> {
  if (await exists(filename))
    throw new Error(`같은 이름이 이미 있습니다: ${path.basename(filename)}`);
}

// 폴더에 자식과 루트가 함께 선택되면 최상위 항목만 작업한다.
function topSelections(entries: Location[]): Location[] {
  if (!Array.isArray(entries) || entries.length > 500)
    throw new Error("한 번에 최대 500개 항목을 선택해 주세요.");
  const unique = entries.filter(
    (entry, index) =>
      entries.findIndex(
        (other) => other.rootId === entry.rootId && other.path === entry.path,
      ) === index,
  );
  return unique.filter(
    (entry) =>
      !unique.some(
        (other) =>
          other !== entry &&
          other.rootId === entry.rootId &&
          entry.path.startsWith(other.path + "/"),
      ),
  );
}

// 연결된 다른 루트를 포함한 폴더가 변경되는 것을 막는다.
function protectRoots(files: LocalFiles, absolute: string): void {
  if (
    files
      .roots()
      .some((root) => root.absolutePath && within(absolute, root.absolutePath))
  )
    throw new Error(
      "연결 루트 또는 다른 연결 루트를 포함한 폴더는 먼저 연결을 해제해 주세요.",
    );
}

// 앱 휴지통 경로가 일반 폴더이며 해당 루트 안인지 확인한다.
async function trashDirectory(
  files: LocalFiles,
  rootId: string,
  create = false,
): Promise<string> {
  const root = await files.resolveLocation({ rootId, path: "" });
  const directory = path.join(root, ".every-directory-trash");
  if (create) await mkdir(directory, { recursive: true });
  if (
    (await lstat(directory)).isSymbolicLink() ||
    !within(root, await realpath(directory))
  )
    throw new Error("휴지통 경로를 확인해 주세요.");
  return directory;
}

// 연결 폴더별 앱 휴지통에서 복원 가능한 항목을 읽는다.
export async function listTrash(files: LocalFiles): Promise<TrashItem[]> {
  const result: TrashItem[] = [];
  for (const root of files.roots().filter((item) => !item.demo)) {
    let directory: string;
    try {
      directory = await trashDirectory(files, root.id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const id of await readdir(directory)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      try {
        const folder = path.join(directory, id);
        if ((await lstat(folder)).isSymbolicLink()) continue;
        const record = JSON.parse(
          await readFile(path.join(folder, "record.json"), "utf8"),
        ) as TrashItem;
        if (
          record.id === id &&
          typeof record.path === "string" &&
          record.path.length > 0 &&
          typeof record.name === "string" &&
          Number.isFinite(record.deletedAt) &&
          (await exists(path.join(folder, "content")))
        )
          result.push({ ...record, rootId: root.id });
      } catch {
        continue;
      }
    }
  }
  return result.sort((a, b) => b.deletedAt - a.deletedAt);
}

// 원본을 같은 드라이브의 앱 휴지통으로 옮겨 복원 정보를 남긴다.
async function moveToTrash(
  files: LocalFiles,
  location: Location,
  source: string,
): Promise<TrashItem> {
  const record: TrashItem = {
    id: randomUUID(),
    rootId: location.rootId,
    path: location.path,
    name: path.basename(source),
    deletedAt: Date.now(),
  };
  const directory = path.join(
    await trashDirectory(files, record.rootId, true),
    record.id,
  );
  await mkdir(directory);
  await writeFile(path.join(directory, "record.json"), JSON.stringify(record), {
    flag: "wx",
    mode: 0o600,
  });
  await rename(source, path.join(directory, "content"));
  return record;
}

// 복사를 임시 폴더에서 완료한 뒤 목적지에 한 번에 공개한다.
async function copyTo(
  source: string,
  destination: string,
  target: string,
): Promise<void> {
  const staging = await mkdtemp(path.join(destination, ".ed-work-"));
  try {
    await cp(source, path.join(staging, "content"), {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      filter: (candidate) =>
        !candidate
          .split(path.sep)
          .some(
            (part) =>
              part === ".every-directory-trash" || part.startsWith(".ed-work-"),
          ),
    });
    await requireUnused(target);
    await rename(path.join(staging, "content"), target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

// 운영체제 명령에 셸 문자열을 전달하지 않고 앱 또는 탐색기를 실행한다.
export function nativeCommand(
  absolute: string,
  reveal: boolean,
  platform = process.platform,
): { command: string; args: string[] } {
  if (platform === "darwin")
    return { command: "open", args: reveal ? ["-R", absolute] : [absolute] };
  if (platform === "win32")
    return {
      command: "explorer.exe",
      args: [reveal ? `/select,${absolute}` : absolute],
    };
  return {
    command: "xdg-open",
    args: [reveal ? path.dirname(absolute) : absolute],
  };
}

// 사용자가 선택한 항목을 기본 앱 또는 OS 탐색기로 연다.
async function openNative(absolute: string, reveal: boolean): Promise<void> {
  const { command, args } = nativeCommand(absolute, reveal);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
      shell: false,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

// 여러 이름을 임시 폴더로 옮겨 충돌 없이 바꾸고 실패하면 원래 이름을 복구한다.
async function batchRename(sources: string[], names: string[]): Promise<void> {
  if (
    sources.some((source) => path.dirname(source) !== path.dirname(sources[0]))
  )
    throw new Error("일괄 이름 변경은 같은 폴더의 항목을 선택해 주세요.");
  const parent = path.dirname(sources[0]);
  const targets = names.map((name) => path.join(parent, name));
  for (const target of targets) {
    if (
      (await exists(target)) &&
      !sources.some(
        (source) =>
          source.normalize("NFC").toLowerCase() ===
          target.normalize("NFC").toLowerCase(),
      )
    )
      throw new Error(`같은 이름이 이미 있습니다: ${path.basename(target)}`);
  }
  const staging = await mkdtemp(path.join(parent, ".ed-work-"));
  const moved: number[] = [];
  const finished: number[] = [];
  try {
    for (let i = 0; i < sources.length; i++) {
      await rename(sources[i], path.join(staging, String(i)));
      moved.push(i);
    }
    for (let i = 0; i < targets.length; i++) {
      await requireUnused(targets[i]);
      await rename(path.join(staging, String(i)), targets[i]);
      finished.push(i);
    }
  } catch (error) {
    for (const i of finished.reverse())
      await rename(targets[i], path.join(staging, String(i)));
    for (const i of moved)
      await rename(path.join(staging, String(i)), sources[i]);
    throw error;
  } finally {
    // 복구되지 않은 파일이 남으면 임시 폴더를 보존한다.
    if ((await readdir(staging)).length === 0)
      await rm(staging, { recursive: true });
  }
}

// 요청을 검증하고 연결 폴더 안에서 파일 작업을 수행한다.
export async function operate(
  files: LocalFiles,
  request: FileOperation,
): Promise<unknown> {
  if (!request || typeof request.action !== "string")
    throw new Error("파일 작업을 선택해 주세요.");
  const actions = [
    "mkdir",
    "rename",
    "batchRename",
    "copy",
    "move",
    "trash",
    "restore",
    "zip",
    "unzip",
    "properties",
    "hash",
    "reveal",
    "open",
    "resizeImages",
    "ocr",
  ];
  if (!actions.includes(request.action))
    throw new Error("지원하지 않는 파일 작업입니다.");
  // 작업 도중 선택 경로가 바뀌지 않도록 인덱싱 대기열 안에서 확인한다.
  async function execute(): Promise<unknown> {
    const locations = topSelections(request.entries ?? []);
    const sources = await Promise.all(
      locations.map((location) => files.resolveLocation(location)),
    );
    if (!["mkdir", "restore"].includes(request.action) && !sources.length)
      throw new Error("파일 또는 폴더를 선택해 주세요.");
    if (["rename", "move", "trash", "batchRename"].includes(request.action))
      sources.forEach((source) => protectRoots(files, source));
    if (request.action === "ocr") {
      if (sources.length !== 1)
        throw new Error("텍스트를 추출할 이미지 하나를 선택해 주세요.");
      return extractImageText(sources[0], request.language);
    }
    if (["properties", "hash"].includes(request.action)) {
      if (sources.length !== 1)
        throw new Error("속성은 하나의 항목을 선택해 주세요.");
      const items = await walk(sources[0]);
      const metadata = await lstat(sources[0]);
      const result: FileProperties = {
        path: sources[0],
        files: items.filter((item) => !item.directory).length,
        directories: items.filter((item) => item.directory).length,
        bytes: items
          .filter((item) => !item.directory)
          .reduce((sum, item) => sum + item.size, 0),
        modified: metadata.mtimeMs,
      };
      if (request.action === "hash") {
        if (!metadata.isFile())
          throw new Error("해시는 파일에만 사용할 수 있습니다.");
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(sources[0]))
          hash.update(chunk);
        result.sha256 = hash.digest("hex");
      }
      return result;
    }
    if (["open", "reveal"].includes(request.action)) {
      if (sources.length !== 1) throw new Error("하나의 항목을 선택해 주세요.");
      await openNative(sources[0], request.action === "reveal");
      return { count: 1 };
    }
    if (request.action === "restore") {
      const records = await listTrash(files);
      const record = records.find((item) => item.id === request.trashId);
      if (!record) throw new Error("복원할 휴지통 항목이 없습니다.");
      const parent = path.posix.dirname(record.path);
      validateName(path.posix.basename(record.path));
      const directory = await files.resolveLocation({
        rootId: record.rootId,
        path: parent === "." ? "" : parent,
      });
      const target = path.join(directory, path.posix.basename(record.path));
      await requireUnused(target);
      const folder = path.join(
        await trashDirectory(files, record.rootId),
        record.id,
      );
      const content = path.join(folder, "content");
      if ((await lstat(content)).isSymbolicLink())
        throw new Error("휴지통 항목에 링크가 있습니다.");
      await rename(content, target);
      await rm(folder, { recursive: true });
      return { count: 1 };
    }
    if (request.action === "trash") {
      const records: TrashItem[] = [];
      for (let i = 0; i < sources.length; i++)
        records.push(await moveToTrash(files, locations[i], sources[i]));
      return { count: records.length, records };
    }
    if (["rename", "batchRename"].includes(request.action)) {
      if (request.action === "rename" && sources.length !== 1)
        throw new Error("이름 변경은 하나의 항목을 선택해 주세요.");
      const entries = await Promise.all(
        sources.map(async (source) => ({
          name: path.basename(source),
          kind: (await lstat(source)).isDirectory()
            ? ("directory" as const)
            : ("file" as const),
        })),
      );
      const names =
        request.action === "rename"
          ? [request.name!]
          : renamePreview(entries, request.rule!);
      names.forEach(validateName);
      await batchRename(sources, names);
      return { count: sources.length, names };
    }
    if (!request.destination) throw new Error("대상 폴더를 지정해 주세요.");
    const destination = await files.resolveLocation(request.destination);
    if (!(await lstat(destination)).isDirectory())
      throw new Error("대상은 폴더여야 합니다.");
    if (request.action === "mkdir") {
      validateName(request.name!);
      await mkdir(path.join(destination, request.name!));
      return { count: 1 };
    }
    if (request.action === "resizeImages")
      return resizeImages(sources, destination, request.name!, request.image!);
    if (request.action === "zip" || request.action === "unzip") {
      validateName(request.name!);
      if (
        request.action === "unzip" &&
        (sources.length !== 1 ||
          path.extname(sources[0]).toLowerCase() !== ".zip")
      )
        throw new Error("ZIP 파일 하나를 선택해 주세요.");
      const target = path.join(destination, request.name!);
      await requireUnused(target);
      if (sources.some((source) => within(source, target)))
        throw new Error("원본 폴더 안에 압축 결과를 만들 수 없습니다.");
      const staging = await mkdtemp(path.join(destination, ".ed-work-"));
      try {
        const output = path.join(staging, "result");
        if (request.action === "zip") {
          if (!request.name!.toLowerCase().endsWith(".zip"))
            throw new Error("압축 파일 이름은 .zip으로 끝나야 합니다.");
          if (
            new Set(
              sources.map((source) => path.basename(source).toLowerCase()),
            ).size !== sources.length
          )
            throw new Error("압축할 항목의 이름이 중복됩니다.");
          await zipFiles(sources, output);
        } else {
          await mkdir(output);
          await unzipFile(sources[0], output);
        }
        await requireUnused(target);
        await rename(output, target);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
      return { count: sources.length };
    }
    const targets = sources.map((source) =>
      path.join(destination, path.basename(source)),
    );
    if (
      new Set(targets.map((target) => target.toLowerCase())).size !==
      targets.length
    )
      throw new Error("대상 파일 이름이 중복됩니다.");
    for (let i = 0; i < sources.length; i++) {
      if (within(sources[i], targets[i]))
        throw new Error(
          "같은 위치 또는 원본 하위 폴더에는 붙여넣을 수 없습니다.",
        );
      await requireUnused(targets[i]);
      await walk(sources[i]);
    }
    for (let i = 0; i < sources.length; i++) {
      if (request.action === "move") {
        try {
          await rename(sources[i], targets[i]);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
          await copyTo(sources[i], destination, targets[i]);
          try {
            await moveToTrash(files, locations[i], sources[i]);
          } catch (cause) {
            throw new Error(
              `대상 복사는 완료됐지만 원본 휴지통 이동에 실패했습니다: ${String(cause)}`,
            );
          }
        }
      } else await copyTo(sources[i], destination, targets[i]);
    }
    return { count: sources.length };
  }
  return ["properties", "hash", "open", "reveal", "ocr"].includes(
    request.action,
  )
    ? execute()
    : files.mutate(execute);
}

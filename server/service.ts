import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import {
  mkdir,
  lstat,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import chokidar, { type FSWatcher } from "chokidar";
import { FileIndex, fileCollator } from "../src/search";
import { createDemoEntries, demoRoots } from "../src/demo";
import type { ConnectedRoot, FileEntry, IndexProgress } from "../src/types";
import {isIndexExcluded,normalizeExclusions} from "../src/indexExclusions";

interface Snapshot {
  root: ConnectedRoot;
  entries: FileEntry[];
}
export interface DirectoryListing {
  path: string;
  parent: string;
  directories: { name: string; path: string }[];
}

// 연결 폴더의 디스크 인덱스와 변경 감시를 관리한다.
export class LocalFiles {
  readonly instanceId = randomUUID();
  index = new FileIndex();
  version = 0;
  progress?: IndexProgress;
  private snapshots = new Map<string, Snapshot>();
  private watchers = new Map<string, FSWatcher>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private operation: Promise<unknown> = Promise.resolve();
  private closed = false;
  private pending = 0;
  dataDirectory: string;

  // 로컬 저장 위치와 파일 감시 사용 여부를 지정한다.
  constructor(
    dataDirectory = path.join(homedir(), ".every-directory"),
    private watchEnabled = true,
  ) {
    this.dataDirectory = path.resolve(dataDirectory);
  }

  // 저장된 스냅샷을 복원하고 연결 폴더의 변경 감시를 시작한다.
  async initialize(): Promise<void> {
    await mkdir(this.dataDirectory, { recursive: true, mode: 0o700 });
    this.dataDirectory = await realpath(this.dataDirectory);
    try {
      const data = JSON.parse(
        await readFile(path.join(this.dataDirectory, "index.json"), "utf8"),
      ) as { format: number; snapshots: Snapshot[] };
      if (data.format !== 1 || !Array.isArray(data.snapshots))
        throw new Error("지원하지 않는 인덱스 형식입니다.");
      for (const snapshot of data.snapshots)
        this.snapshots.set(snapshot.root.id, snapshot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.rebuild();
    for (const { root } of this.snapshots.values()) this.startWatcher(root);
  }

  // 연결 폴더가 없을 때만 구분된 샘플 공간을 반환한다.
  roots(): ConnectedRoot[] {
    if (this.snapshots.size)
      return [...this.snapshots.values()].map((snapshot) => snapshot.root);
    const entries = createDemoEntries();
    return demoRoots.map((root) => ({
      ...root,
      count: entries.filter((entry) => entry.rootId === root.id).length,
    }));
  }

  // 현재 버전과 인덱싱 진행 상태를 브라우저에 전달한다.
  status() {
    return {
      instanceId: this.instanceId,
      roots: this.roots(),
      version: this.version,
      scanning: this.pending > 0,
      progress: this.progress,
    };
  }

  // 인덱스 파일과 개발 의존성 폴더의 순환 인덱싱을 피한다.
  private ignored(absolute: string): boolean {
    return (
      within(this.dataDirectory, absolute) ||
      path
        .relative(path.parse(absolute).root, absolute)
        .split(path.sep)
        .some(
          (segment) =>
            segment === ".git" ||
            segment === "node_modules" ||
            segment === ".every-directory-trash" ||
            segment.startsWith(".ed-work-"),
        )
    );
  }

  // 파일 변경을 묶어서 다시 인덱싱하고 감시 실패를 상태에 남긴다.
  private startWatcher(root: ConnectedRoot): void {
    if (!this.watchEnabled || this.closed || this.watchers.has(root.id)) return;
    const watcher = chokidar.watch(root.absolutePath!, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (absolute) => this.ignored(absolute),
    });
    watcher.on("all", () => {
      clearTimeout(this.timers.get(root.id));
      this.timers.set(
        root.id,
        setTimeout(() => {
          this.timers.delete(root.id);
          if (this.snapshots.has(root.id) && !this.closed)
            void this.scan(root, true).catch((error: Error) => {
              const current = this.snapshots.get(root.id);
              if (current) {
                current.root.watchError = error.message;
                this.version++;
              }
            });
        }, 750),
      );
    });
    watcher.on("error", (error) => {
      const current = this.snapshots.get(root.id);
      if (current) {
        current.root.watchError = `변경 감시 오류: ${String(error)}`;
        this.version++;
      }
    });
    this.watchers.set(root.id, watcher);
  }

  // 인덱스 교체와 저장 작업을 순서대로 실행한다.
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    this.pending++;
    const next = this.operation.then(action, action).finally(() => {
      this.pending--;
    });
    this.operation = next.catch(() => undefined);
    return next;
  }

  // 실제 폴더를 재귀 순회하고 완료된 결과만 원자적으로 반영한다.
  scan(
    input: Partial<ConnectedRoot>,
    background = false,
  ): Promise<ConnectedRoot> {
    return this.enqueue(() => this.scanNow(input, background));
  }

  // 직렬 작업 안에서 대기열을 다시 만들지 않고 루트를 갱신한다.
  private async scanNow(
    input: Partial<ConnectedRoot>,
    background = false,
  ): Promise<ConnectedRoot> {
    const existing = input.id ? this.snapshots.get(input.id)?.root : undefined;
    if (background && !existing) throw new Error("연결이 해제된 폴더입니다.");
    const requested = existing?.absolutePath ?? input.absolutePath;
    if (!requested || !path.isAbsolute(requested))
      throw new Error("폴더의 절대 경로를 입력해 주세요.");
    const absolutePath = await realpath(requested);
    if (this.ignored(absolutePath))
      throw new Error(
        "인덱스 저장 폴더, .git, node_modules는 연결할 수 없습니다.",
      );
    if (!(await stat(absolutePath)).isDirectory())
      throw new Error("폴더 경로를 선택해 주세요.");
    const duplicate = [...this.snapshots.values()].find(
      (item) => item.root.absolutePath === absolutePath,
    );
    const root: ConnectedRoot = {
      id: duplicate?.root.id ?? randomUUID(),
      name: path.basename(absolutePath) || absolutePath,
      absolutePath,
      count: 0,
      skipped: 0,
      lastIndexed: 0,
      excludedPaths:normalizeExclusions((background?existing?.excludedPaths:input.excludedPaths)??duplicate?.root.excludedPaths??[]),
    };
    const entries: FileEntry[] = [];
    const queue = [""];
    this.startWatcher(root);
    try {
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const parent = queue[cursor];
        const absolute = path.join(absolutePath, parent);
        this.progress = {
          rootId: root.id,
          count: entries.length,
          directory: parent || root.name,
        };
        let children;
        try {
          if (!within(absolutePath, await realpath(absolute))) {
            root.skipped++;
            continue;
          }
          children = await readdir(absolute, { withFileTypes: true });
        } catch (error) {
          if (!parent) throw error;
          root.skipped++;
          continue;
        }
        // 한 번에 처리할 메타데이터 요청 수를 제한한다.
        for (let start = 0; start < children.length; start += 32) {
          await Promise.all(
            children.slice(start, start + 32).map(async (child) => {
              const relative = parent ? `${parent}/${child.name}` : child.name;
              const filename = path.join(absolutePath, relative);
              if (child.isSymbolicLink() || this.ignored(filename)||isIndexExcluded(root.excludedPaths,relative,process.platform==="win32")) {
                root.skipped++;
                return;
              }
              if (!child.isFile() && !child.isDirectory()) return;
              try {
                const metadata = await stat(filename);
                const kind = child.isDirectory() ? "directory" : "file";
                entries.push({
                  id: `${root.id}:${relative}`,
                  rootId: root.id,
                  name: child.name,
                  path: relative,
                  parent,
                  kind,
                  extension:
                    kind === "file"
                      ? path.extname(child.name).slice(1).toLowerCase()
                      : "",
                  size: kind === "file" ? metadata.size : undefined,
                  modified: metadata.mtimeMs,
                  created:metadata.birthtimeMs||undefined,accessed:metadata.atimeMs||undefined,readonly:(metadata.mode&0o222)===0,
                });
                if (kind === "directory") queue.push(relative);
              } catch {
                root.skipped++;
              }
            }),
          );
        }
      }
      root.count = entries.length;
      root.lastIndexed = Date.now();
      const next = new Map(this.snapshots);
      next.set(root.id, { root, entries });
      await this.persist(next);
      this.snapshots = next;
      this.rebuild();
      return root;
    } finally {
      this.progress = undefined;
      if (!this.snapshots.has(root.id)) {
        clearTimeout(this.timers.get(root.id));
        await this.watchers.get(root.id)?.close();
        this.watchers.delete(root.id);
      }
    }
  }

  // 스냅샷 전체를 임시 파일에 저장한 뒤 완료 파일로 교체한다.
  private async persist(snapshots: Map<string, Snapshot>): Promise<void> {
    const temporary = path.join(
      this.dataDirectory,
      `index-${randomUUID()}.tmp`,
    );
    await writeFile(
      temporary,
      JSON.stringify({ format: 1, snapshots: [...snapshots.values()] }),
      { mode: 0o600 },
    );
    await rename(temporary, path.join(this.dataDirectory, "index.json"));
  }

  // 연결 폴더의 완료 스냅샷으로 메모리 검색 인덱스를 만든다.
  private rebuild(): void {
    this.index.replace(
      this.snapshots.size
        ? [...this.snapshots.values()].flatMap((item) => item.entries)
        : createDemoEntries(),
    );
    this.version++;
  }

  // 원본 파일을 유지하면서 연결 정보와 감시만 제거한다.
  remove(rootId: string): Promise<void> {
    return this.enqueue(async () => {
      const next = new Map(this.snapshots);
      next.delete(rootId);
      await this.persist(next);
      clearTimeout(this.timers.get(rootId));
      await this.watchers.get(rootId)?.close();
      this.watchers.delete(rootId);
      this.snapshots = next;
      this.rebuild();
    });
  }

  // 폴더 선택 대화상자에 실제 하위 디렉터리를 제공한다.
  async directories(requested?: string): Promise<DirectoryListing> {
    const absolute = await realpath(requested || homedir());
    const children = await readdir(absolute, { withFileTypes: true });
    return {
      path: absolute,
      parent: path.dirname(absolute),
      directories: children
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !this.ignored(path.join(absolute, entry.name)),
        )
        .map((entry) => ({
          name: entry.name,
          path: path.join(absolute, entry.name),
        }))
        .sort((left, right) => fileCollator.compare(left.name, right.name)),
    };
  }

  // 인덱싱한 항목만 읽고 연결 폴더를 벗어나는 경로는 거부한다.
  async resolveEntry(rootId: string, relative: string): Promise<string> {
    const snapshot = this.snapshots.get(rootId);
    if (
      !snapshot ||
      !relative ||
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).some((part) => part === "..")
    )
      throw new Error("연결 폴더 안의 파일을 선택해 주세요.");
    const entry = snapshot.entries.find(
      (item) => item.path === relative && item.kind === "file",
    );
    if (!entry&&!isIndexExcluded(snapshot.root.excludedPaths,relative,process.platform==="win32"))
      throw new Error("인덱스에 없는 파일입니다. 폴더를 새로고침해 주세요.");
    const absolute = await this.resolveLocation({rootId, path:relative});
    if (!within(snapshot.root.absolutePath!, absolute))
      throw new Error("연결 폴더 밖의 파일은 열 수 없습니다.");
    return absolute;
  }

  // 등록된 루트의 파일과 폴더를 심볼릭 링크 없이 확인한다.
  async resolveLocation(location: {
    rootId: string;
    path: string;
  }): Promise<string> {
    const root = this.snapshots.get(location?.rootId)?.root;
    const relative = location?.path;
    if (
      !root?.absolutePath ||
      typeof relative !== "string" ||
      path.isAbsolute(relative) ||
      relative
        .split(/[\\/]/)
        .some(
          (part) =>
            part === ".." ||
            part === "." ||
            part === ".every-directory-trash" ||
            part.startsWith(".ed-work-"),
        )
    )
      throw new Error("연결 폴더 안의 올바른 경로를 선택해 주세요.");
    if (
      relative &&
      !this.snapshots
        .get(root.id)!
        .entries.some((entry) => entry.path === relative)&&!isIndexExcluded(root.excludedPaths,relative,process.platform==="win32")
    )
      throw new Error("인덱스에 없는 항목입니다. 새로고침해 주세요.");
    let current = root.absolutePath;
    for (const part of relative.split("/").filter(Boolean)) {
      current = path.join(current, part);
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("심볼릭 링크는 연결 폴더 밖으로 이어질 수 있어 파일 작업에서 제외합니다.");
    }
    const absolute = await realpath(current);
    if (!within(root.absolutePath, absolute))
      throw new Error("연결 폴더 밖에는 접근할 수 없습니다.");
    return absolute;
  }

  // 파일 작업과 인덱스 갱신을 같은 대기열에서 실행한다.
  async list(location:{rootId:string;path:string}):Promise<FileEntry[]>{
    const root=this.roots().find(root=>root.id===location.rootId);if(root?.demo)return this.index.list(location.rootId,location.path);
    const absolute=await this.resolveLocation(location);if(!(await stat(absolute)).isDirectory())throw new Error("탐색 경로는 폴더여야 합니다.");
    const entries:FileEntry[]=[];
    for(const child of await readdir(absolute,{withFileTypes:true})){
      const filename=path.join(absolute,child.name);if(child.isSymbolicLink()||this.ignored(filename)||(!child.isDirectory()&&!child.isFile()))continue;
      try{const metadata=await lstat(filename);if(metadata.isSymbolicLink())continue;const relative=location.path?location.path+'/'+child.name:child.name;
        entries.push({id:`${location.rootId}:${relative}`,rootId:location.rootId,path:relative,parent:location.path,name:child.name,kind:metadata.isDirectory()?"directory":"file",extension:metadata.isDirectory()?"":path.extname(child.name).slice(1).toLowerCase(),size:metadata.isDirectory()?undefined:metadata.size,modified:metadata.mtimeMs,created:metadata.birthtimeMs||undefined,accessed:metadata.atimeMs||undefined,hidden:child.name.startsWith('.'),readonly:(metadata.mode&0o222)===0});
      }catch{}
    }
    return entries.sort((a,b)=>Number(b.kind==="directory")-Number(a.kind==="directory")||fileCollator.compare(a.name,b.name));
  }

  mutate<T>(action: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      let result: T;
      let failure: unknown;
      try {
        result = await action();
      } catch (error) {
        failure = error;
      }
      for (const { root } of this.snapshots.values()) {
        try {
          await this.scanNow(root);
        } catch (error) {
          root.watchError = String(error);
          this.version++;
        }
      }
      if (failure) throw failure;
      return result!;
    });
  }

  // 종료 시 감시와 대기 중인 작업을 정리한다.
  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    await this.operation;
    await Promise.all(
      [...this.watchers.values()].map((watcher) => watcher.close()),
    );
  }
}

// 경로 구분자 경계를 포함해 대상이 기준 폴더 안에 있는지 확인한다.
export function within(base: string, candidate: string): boolean {
  const relative = path.relative(base, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

import { writeClipboard, isDesktop } from "../client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  Folder,
  FolderTree as FolderTreeIcon,
  Grid2X2,
  List,
  LoaderCircle,
  Plus,
  RotateCw,
  Star,
  X,
  EyeOff,
} from "lucide-react";
import type { IndexClient } from "../client";
import type {
  ConnectedRoot,
  ExplorerPane,
  ExplorerTab,
  FileEntry,
  Location,
  FileClipboard,
  ToolRequest,
} from "../types";
import { FileActions } from "./FileActions";
import { FileTable } from "./FileTable";
import { FolderTree } from "./FolderTree";
import { FileContextMenu } from "./FileContextMenu";
import { Modal } from "./Modal";
import { WorkbenchTools, type AnalysisKind } from "./WorkbenchTools";
import { exportEntries } from "../export";
import { readPreference, savePreference } from "../storage";

interface Props {
  pane: ExplorerPane;
  revealEntry?: FileEntry;
  roots: ConnectedRoot[];
  client: IndexClient;
  active: boolean;
  revision: number;
  number: number;
  onActivate: () => void;
  onChange: (pane: ExplorerPane) => void;
  onNavigate: (location: Location, newTab?: boolean) => void;
  onPreview: (entry: FileEntry) => void;
  onOpenFile: (entry: FileEntry) => void;
  onFavorite: (location: Location) => void;
  onError: (message: string) => void;
  onRefresh: (rootId: string) => void;
  clipboard?: FileClipboard;
  onClipboard: (value?: FileClipboard) => void;
  onChanged: () => void;
  onMessage: (message: string, error?: boolean) => void;
  toolRequest?: ToolRequest;
  compact?: boolean;
  otherPane?: { location: Location; label: string };
  onNavigateOther: (location: Location) => void;
  onRevealLocation: (location: Location) => void;
}

// 현재 위치로 독립된 이동 기록을 가진 새 탭을 만든다.
export function createTab(location: Location): ExplorerTab {
  return { id: crypto.randomUUID(), history: [location], cursor: 0 };
}

// 기본 위치와 하나의 탭을 가진 탐색창을 만든다.
export function createPane(location: Location): ExplorerPane {
  const tab = createTab(location);
  return {
    id: crypto.randomUUID(),
    tabs: [tab],
    activeTab: tab.id,
    view: "list",
  };
}

// 각 탐색창의 탭, 경로, 이동 기록과 파일 목록을 표시한다.
export function Explorer({
  pane,
  revealEntry,
  roots,
  client,
  active,
  revision,
  number,
  onActivate,
  onChange,
  onNavigate,
  onPreview,
  onOpenFile,
  onFavorite,
  onError,
  onRefresh,
  clipboard,
  onClipboard,
  onChanged,
  onMessage,
  toolRequest,
  compact,
  otherPane,
  onNavigateOther,
  onRevealLocation,
}: Props) {
  const tab = pane.tabs.find((t) => t.id === pane.activeTab) ?? pane.tabs[0];
  const location = tab.history[tab.cursor];
  const root = roots.find((r) => r.id === location.rootId);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<FileEntry>();
  const [selection, setSelection] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reload, setReload] = useState(0);
  const [drop, setDrop] = useState(false);
  const [address, setAddress] = useState<string>();
  const addressRef = useRef<HTMLInputElement>(null);
  const revealed = useRef<FileEntry | undefined>(undefined);
  const [filter, setFilter] = useState("");
  const [tree, setTree] = useState(false);
  const [context, setContext] = useState<{ x: number; y: number }>();
  const [localTool, setLocalTool] = useState<ToolRequest>();
  const [transfer, setTransfer] = useState<Location[]>();
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [showHidden, setShowHidden] = useState(
    readPreference("showHidden", true),
  );
  const [analysis, setAnalysis] = useState<AnalysisKind>();
  const [paneTransfer, setPaneTransfer] = useState<"copy" | "move">();
  const handledExternal = useRef<number | undefined>(undefined);
  const handledLocal = useRef<number | undefined>(undefined);
  const closeContext = useCallback(() => setContext(undefined), []);
  const visibleEntries = entries.filter(
    (entry) =>
      (showHidden || !entry.name.startsWith(".")) &&
      entry.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  useEffect(() => {
    savePreference("showHidden", showHidden);
  }, [showHidden]);

  useEffect(() => {
    if (!toolRequest || handledExternal.current === toolRequest.id || loading)
      return;
    if (toolRequest.entry) {
      const entry = entries.find(
        (entry) =>
          entry.rootId === toolRequest.entry!.rootId &&
          entry.path === toolRequest.entry!.path,
      );
      if (!entry) return;
      setSelected(entry);
      setSelection([entry]);
    }
    handledExternal.current = toolRequest.id;
    setLocalTool(toolRequest);
  }, [toolRequest, entries, loading]);

  useEffect(() => {
    if (!localTool || handledLocal.current === localTool.id) return;
    handledLocal.current = localTool.id;
    const action = localTool.action;
    const entry = selection[0];
    const itemLocation = entry
      ? {
          rootId: entry.rootId,
          path: entry.kind === "directory" ? entry.path : entry.parent,
        }
      : location;
    if (action === "openNewTab") onNavigate(itemLocation, true);
    else if (action === "openOtherPane") onNavigateOther(itemLocation);
    else if (action === "copyOtherPane" || action === "moveOtherPane") {
      if (selection.length && otherPane) {
        setTransferError("");
        setPaneTransfer(action === "copyOtherPane" ? "copy" : "move");
      }
    } else if (
      action === "stats" ||
      action === "duplicates" ||
      action === "compare"
    )
      setAnalysis(action);
    else if (action === "selectAll") {
      setSelection(visibleEntries);
      setSelected(visibleEntries[0]);
    } else if (action === "invertSelection") {
      const inverse = visibleEntries.filter(
        (entry) => !selection.some((selected) => selected.id === entry.id),
      );
      setSelection(inverse);
      setSelected(inverse[0]);
    } else if (action === "toggleHidden") setShowHidden((value) => !value);
    else if (action === "refresh") setReload((value) => value + 1);
    else if (action === "favorite")
      onFavorite(
        entry && isDesktop
          ? { rootId: entry.rootId, path: entry.path }
          : location,
      );
    else if (action === "exportList")
      void exportEntries(visibleEntries, roots).catch((cause) =>
        onError(String(cause)),
      );
    else if (action === "terminal")
      void client
        .request("operation", { action, destination: location })
        .then(() => onMessage("현재 폴더에서 터미널을 열었습니다."))
        .catch((cause) => onError(String(cause)));
    else if (
      ["copyPath", "copyName", "copyRelativePath", "copyMarkdown"].includes(
        action,
      )
    ) {
      const text = selection
        .map((item) => {
          const base =
            roots.find((root) => root.id === item.rootId)?.absolutePath ?? "";
          const separator = base.includes("\\") ? "\\" : "/";
          const path = `${base.replace(/[\\/]+$/, "")}${separator}${item.path.split("/").join(separator)}`;
          const uri = base.includes("\\")
            ? `file:///${path.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/").replace(/%3A/i, ":")}`
            : `file://${path.split("/").map(encodeURIComponent).join("/")}`;
          return action === "copyName"
            ? item.name
            : action === "copyRelativePath"
              ? item.path
              : action === "copyMarkdown"
                ? `[${item.name.replace(/[\[\]]/g, "\\$&")}](${uri})`
                : path;
        })
        .join("\n");
      void writeClipboard(text)
        .then(() =>
          onMessage(`${selection.length}개 항목을 텍스트로 복사했습니다.`),
        )
        .catch((cause) => onError(String(cause)));
    }
  }, [localTool]);

  useEffect(() => {
    // 탐색창별 선택과 위치에 연결된 고급 단축키를 처리한다.
    function shortcuts(event: KeyboardEvent) {
      if (
        !active ||
        event.defaultPrevented ||
        document.querySelector('dialog[open],[role="menu"]') ||
        (event.target instanceof Element &&
          event.target.closest("input,textarea,select,[contenteditable=true]"))
      )
        return;
      const modifier = event.metaKey || event.ctrlKey;
      let action: ToolRequest["action"] | undefined;
      if (event.key === "F5") action = "copyOtherPane";
      else if (event.key === "F7") action = "moveOtherPane";
      else if (modifier && event.shiftKey && event.key.toLowerCase() === "c")
        action = "copyPath";
      else if (modifier && event.shiftKey && event.key.toLowerCase() === "i")
        action = "invertSelection";
      else if (
        modifier &&
        event.shiftKey &&
        (event.key === "." || event.code === "Period")
      )
        action = "toggleHidden";
      else if (modifier && !event.shiftKey && event.key.toLowerCase() === "r")
        action = "refresh";
      if (action) {
        event.preventDefault();
        setLocalTool({ action, id: performance.now() });
      }
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [active]);

  useEffect(() => {
    let alive = true;
    if (!root) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    client
      .request<FileEntry[]>("list", location)
      .then((result) => {
        if (alive) {
          setEntries(result);
          setSelected((previous) =>
            result.find((entry) => entry.id === previous?.id),
          );
          setSelection((previous) =>
            result.filter((entry) =>
              previous.some((item) => item.id === entry.id),
            ),
          );
        }
      })
      .catch((error) => {
        if (alive) {
          onError(error.message);
          if (location.path)
            onNavigate({
              rootId: location.rootId,
              path: location.path.split("/").slice(0, -1).join("/"),
            });
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [client, location.rootId, location.path, revision, reload]);
  useEffect(() => {
    setSelected(undefined);
    setSelection([]);
  }, [location.rootId, location.path, filter]);
  useEffect(() => {
    if (address !== undefined) addressRef.current?.focus();
  }, [address]);
  useEffect(() => {
    if (!revealEntry) revealed.current = undefined;
    else if (revealed.current !== revealEntry) {
      const target = entries.find((entry) => entry.id === revealEntry.id);
      if (target) {
        if (filter) {
          setFilter("");
          return;
        }
        if (target.name.startsWith(".")) setShowHidden(true);
        setSelected(target);
        setSelection([target]);
        revealed.current = revealEntry;
      }
    }
  }, [entries, revealEntry, filter]);

  // 활성 탭의 기록 위치만 바꾸어 뒤로 또는 앞으로 이동한다.
  function travel(delta: number) {
    onChange({
      ...pane,
      tabs: pane.tabs.map((t) =>
        t.id === tab.id ? { ...t, cursor: t.cursor + delta } : t,
      ),
    });
  }

  // 탭을 닫고 남은 인접 탭을 선택한다.
  function closeTab(id: string) {
    const tabs = pane.tabs.filter((t) => t.id !== id);
    if (!tabs.length) return;
    onChange({
      ...pane,
      tabs,
      activeTab:
        pane.activeTab === id ? tabs[tabs.length - 1].id : pane.activeTab,
    });
  }

  // 실제 경로를 클립보드에 복사한다.
  async function copyPath() {
    try {
      const base = root?.absolutePath ?? root?.name ?? "";
      const separator = base.includes("\\") ? "\\" : "/";
      const actualPath = location.path
        ? `${base.replace(/[\\/]+$/, "")}${separator}${location.path.split("/").join(separator)}`
        : base;
      await writeClipboard(actualPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onError(
        "클립보드에 접근할 수 없습니다. 주소 표시줄에서 경로를 복사해 주세요.",
      );
    }
  }

  // 폴더는 이동하고 파일은 운영체제의 기본 앱으로 연다.
  function openEntry(entry: FileEntry) {
    if (entry.kind === "directory")
      onNavigate({ rootId: entry.rootId, path: entry.path });
    else onOpenFile(entry);
  }

  // 다른 탐색창에서 끌어온 파일을 현재 폴더에 복사하거나 이동한다.
  async function transferFiles(move: boolean) {
    if (!transfer || transferring) return;
    setTransferError("");
    setTransferring(true);
    try {
      await client.request("operation", {
        action: move ? "move" : "copy",
        entries: transfer,
        destination: location,
      });
      setTransfer(undefined);
      onChanged();
      onMessage(`${move ? "이동" : "복사"}를 완료했습니다.`);
    } catch (cause) {
      setTransferError(String(cause));
      onChanged();
    } finally {
      setTransferring(false);
    }
  }

  // 목적지를 확인한 뒤 선택 항목을 반대편 탐색창으로 전송한다.
  async function sendToPane() {
    if (!paneTransfer || !otherPane || transferring) return;
    setTransferError("");
    setTransferring(true);
    try {
      await client.request("operation", {
        action: paneTransfer,
        entries: selection.map(({ rootId, path }) => ({ rootId, path })),
        destination: otherPane.location,
      });
      onChanged();
      setPaneTransfer(undefined);
      onMessage("다른 탐색창으로 전송했습니다.");
    } catch (cause) {
      setTransferError(String(cause));
      onChanged();
    } finally {
      setTransferring(false);
    }
  }

  return (
    <section
      className={`explorer-pane ${active ? "active" : ""} ${drop ? "drop-target" : ""}`}
      aria-label={`탐색창 ${number}`}
      onPointerDown={onActivate}
      onFocus={onActivate}
      onDragOver={(e) => {
        if (
          root &&
          !root.demo &&
          e.dataTransfer.types.includes("application/x-ed-files")
        ) {
          e.preventDefault();
          setDrop(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrop(false);
        try {
          const files = JSON.parse(
            e.dataTransfer.getData("application/x-ed-files"),
          ) as Location[];
          if (!root || root.demo || !Array.isArray(files) || !files.length)
            return;
          setTransferError("");
          setTransfer(files);
        } catch {
          onError("이 항목을 열 수 없습니다.");
        }
      }}
    >
      <div className="tab-bar">
        <div
          className="explorer-tabs"
          role="tablist"
          aria-label={`탐색창 ${number} 탭`}
        >
          {pane.tabs.map((t) => {
            const loc = t.history[t.cursor];
            const name =
              loc.path.split("/").pop() ||
              roots.find((r) => r.id === loc.rootId)?.name ||
              "폴더";
            return (
              <div
                className={`explorer-tab ${t.id === tab.id ? "current" : ""}`}
                key={t.id}
                style={
                  t.color && /^#[0-9a-f]{6}$/i.test(t.color)
                    ? {
                        borderTopColor: t.color,
                        backgroundColor: `${t.color}22`,
                      }
                    : undefined
                }
              >
                <button
                  role="tab"
                  aria-selected={t.id === tab.id}
                  title={name}
                  onClick={() => onChange({ ...pane, activeTab: t.id })}
                >
                  <Folder size={14} />
                  <span>{name}</span>
                </button>
                <input
                  className="tab-color-picker"
                  type="color"
                  aria-label={`${name} 탭 색상`}
                  title="탭 색상 변경 · 오른쪽 클릭으로 기본색 복원"
                  value={
                    t.color && /^#[0-9a-f]{6}$/i.test(t.color)
                      ? t.color
                      : "#6389c6"
                  }
                  onChange={(event) =>
                    onChange({
                      ...pane,
                      tabs: pane.tabs.map((item) =>
                        item.id === t.id
                          ? { ...item, color: event.target.value }
                          : item,
                      ),
                    })
                  }
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onChange({
                      ...pane,
                      tabs: pane.tabs.map((item) =>
                        item.id === t.id ? { ...item, color: undefined } : item,
                      ),
                    });
                  }}
                />
                {pane.tabs.length > 1 && (
                  <button
                    className="close-tab"
                    aria-label={`${name} 탭 닫기`}
                    onClick={() => closeTab(t.id)}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
          <button
            className="icon-button add-tab"
            title="새 탭"
            aria-label={`탐색창 ${number}에 새 탭`}
            onClick={() => onNavigate(location, true)}
          >
            <Plus size={16} />
          </button>
        </div>
        <button
          className={`pane-activate ${active ? "chosen" : ""}`}
          aria-label={`탐색창 ${number} 활성화`}
          aria-pressed={active}
          onClick={onActivate}
          title={
            active
              ? "현재 검색 위치를 표시하는 탐색창"
              : "이 탐색창에서 검색 위치 표시"
          }
        >
          <i /> {number}
          <span>{active ? "활성" : "활성화"}</span>
        </button>
      </div>
      <div className="explorer-navigation">
        <div className="navigation-arrows">
          <button
            className="icon-button"
            title="뒤로"
            aria-label="뒤로"
            disabled={tab.cursor === 0}
            onClick={() => travel(-1)}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            className="icon-button"
            title="앞으로"
            aria-label="앞으로"
            disabled={tab.cursor === tab.history.length - 1}
            onClick={() => travel(1)}
          >
            <ArrowRight size={16} />
          </button>
          <button
            className="icon-button"
            title="상위 폴더"
            aria-label="상위 폴더"
            disabled={!location.path}
            onClick={() =>
              onNavigate({
                rootId: location.rootId,
                path: location.path.split("/").slice(0, -1).join("/"),
              })
            }
          >
            <ArrowUp size={16} />
          </button>
        </div>
        {address !== undefined ? (
          <form
            className="address-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const cleaned = address
                .replaceAll("\\", "/")
                .replace(/^\/+|\/+$/g, "");
              const absoluteRoot = root?.absolutePath
                ?.replaceAll("\\", "/")
                .replace(/^\/+|\/+$/g, "");
              const base =
                absoluteRoot &&
                cleaned.toLowerCase().startsWith(absoluteRoot.toLowerCase())
                  ? absoluteRoot
                  : (root?.name ?? "");
              const path =
                cleaned.toLowerCase() === base.toLowerCase()
                  ? ""
                  : cleaned.toLowerCase().startsWith(base.toLowerCase() + "/")
                    ? cleaned.slice(base.length + 1)
                    : cleaned;
              try {
                await client.request("list", { rootId: location.rootId, path });
                onNavigate({ rootId: location.rootId, path });
                setAddress(undefined);
              } catch (cause) {
                onError(
                  cause instanceof Error
                    ? cause.message
                    : "폴더 경로를 확인해 주세요.",
                );
              }
            }}
          >
            <input
              aria-label="폴더 경로"
              ref={addressRef}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={() => setAddress(undefined)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setAddress(undefined);
              }}
            />
          </form>
        ) : (
          <div
            className="breadcrumbs"
            title="두 번 클릭해 경로 복사 또는 입력"
            onDoubleClick={() => setAddress(`${root?.name}/${location.path}`)}
          >
            <Folder size={14} />
            <button
              onClick={() => onNavigate({ rootId: location.rootId, path: "" })}
            >
              {root?.name || "폴더"}
            </button>
            {location.path
              .split("/")
              .filter(Boolean)
              .map((part, i, parts) => (
                <span key={i}>
                  <ChevronRight size={12} />
                  <button
                    onClick={() =>
                      onNavigate({
                        rootId: location.rootId,
                        path: parts.slice(0, i + 1).join("/"),
                      })
                    }
                  >
                    {part}
                  </button>
                </span>
              ))}
          </div>
        )}
        <button
          className="icon-button path-copy"
          title="절대 경로 복사"
          aria-label="경로 복사"
          onClick={copyPath}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <div className="tool-actions navigation-tools">
          <button
            className="icon-button"
            title="현재 폴더 즐겨찾기"
            aria-label="현재 폴더 즐겨찾기"
            onClick={() => onFavorite(location)}
          >
            <Star size={14} />
          </button>
          <button
            className="icon-button"
            title="인덱스 새로고침"
            aria-label="인덱스 새로고침"
            onClick={() => {
              if (root?.demo) setReload((v) => v + 1);
              else onRefresh(location.rootId);
            }}
          >
            <RotateCw size={14} />
          </button>
          <span className="tool-divider" />
          <button
            className={`icon-button ${pane.view === "list" ? "chosen" : ""}`}
            title="목록 보기"
            aria-label="목록 보기"
            aria-pressed={pane.view === "list"}
            onClick={() => onChange({ ...pane, view: "list" })}
          >
            <List size={15} />
          </button>
          <button
            className={`icon-button ${pane.view === "grid" ? "chosen" : ""}`}
            title="격자 보기"
            aria-label="격자 보기"
            aria-pressed={pane.view === "grid"}
            onClick={() => onChange({ ...pane, view: "grid" })}
          >
            <Grid2X2 size={14} />
          </button>
        </div>
      </div>
      <FileActions
        toolRequest={localTool}
        client={client}
        entries={selection}
        location={location}
        disabled={!root || !!root.demo || loading}
        active={active}
        clipboard={clipboard}
        onClipboard={onClipboard}
        onChanged={onChanged}
        onMessage={onMessage}
        onPreview={onPreview}
        onMore={(x, y) => setContext({ x, y })}
        onSelectAll={() => {
          setSelection(visibleEntries);
          setSelected(visibleEntries[0]);
        }}
      />
      <div className="folder-filter">
        <button
          className={tree ? "chosen" : ""}
          aria-label="폴더 트리 표시"
          aria-pressed={tree}
          title="폴더 트리"
          onClick={() => setTree(!tree)}
        >
          <FolderTreeIcon size={14} />
        </button>
        <input
          aria-label={`탐색창 ${number} 파일 필터`}
          placeholder="현재 폴더에서 필터…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {!showHidden && (
          <span className="hidden-status" title="숨김 파일을 감추고 있습니다">
            <EyeOff size={13} />
          </span>
        )}
        {filter && (
          <button aria-label="폴더 필터 지우기" onClick={() => setFilter("")}>
            <X size={12} />
          </button>
        )}
      </div>
      <div
        className="explorer-files"
        onContextMenu={(event) => {
          if (
            (event.target as Element).closest(".file-row,.folder-tree") ||
            !root ||
            root.demo
          )
            return;
          event.preventDefault();
          setSelection([]);
          setSelected(undefined);
          setContext({ x: event.clientX, y: event.clientY });
        }}
      >
        {tree && (
          <FolderTree
            roots={roots}
            location={location}
            client={client}
            revision={revision}
            onNavigate={onNavigate}
          />
        )}
        <FileTable
          resetKey={`${tab.id}:${location.rootId}:${location.path}:${filter}:${showHidden}`}
          compact={compact}
          entries={visibleEntries}
          revealEntry={revealEntry}
          roots={roots}
          selected={selected?.id}
          selectedIds={selection.map((entry) => entry.id)}
          onMultiSelect={setSelection}
          onQuickPreview={onPreview}
          view={pane.view}
          onSelect={setSelected}
          onOpen={openEntry}
          onContextMenu={
            root && !root.demo
              ? (_entry, x, y) => setContext({ x, y })
              : undefined
          }
        />
      </div>
      {context && (
        <FileContextMenu
          {...context}
          entries={selection}
          pasteable={isDesktop || !!clipboard}
          otherPane={!!otherPane}
          hidden={showHidden}
          onClose={closeContext}
          onAction={(action) => setLocalTool({ action, id: performance.now() })}
        />
      )}
      {analysis && (
        <WorkbenchTools
          kind={analysis}
          client={client}
          location={location}
          other={otherPane?.location}
          label={`${root?.name}/${location.path}`}
          otherLabel={otherPane?.label}
          onClose={() => setAnalysis(undefined)}
          onReveal={onRevealLocation}
        />
      )}
      {paneTransfer && otherPane && (
        <Modal
          title={
            paneTransfer === "copy"
              ? "다른 탐색창으로 복사"
              : "다른 탐색창으로 이동"
          }
          subtitle={`${selection.length}개 항목`}
          onClose={() => {
            if (!transferring) setPaneTransfer(undefined);
          }}
        >
          <div className="modal-content">
            <div className="transfer-route">
              <div>
                <small>원본 폴더</small>
                <strong>
                  {root?.name}/{location.path}
                </strong>
              </div>
              <ArrowRight size={18} />
              <div>
                <small>대상 폴더</small>
                <strong>{otherPane.label}</strong>
              </div>
            </div>
            <p className="modal-footnote">
              같은 이름이 있으면 원본을 덮어쓰지 않고 오류를 표시합니다.
            </p>
            {transferError && (
              <p className="operation-error" role="alert">
                {transferError}
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <button
              className="button secondary"
              disabled={transferring}
              onClick={() => setPaneTransfer(undefined)}
            >
              취소
            </button>
            <button
              className="button primary"
              disabled={transferring}
              onClick={() => void sendToPane()}
            >
              {transferring
                ? "전송 중…"
                : paneTransfer === "copy"
                  ? "복사"
                  : "이동"}
            </button>
          </footer>
        </Modal>
      )}
      {transfer && (
        <Modal
          title="파일 가져오기"
          subtitle={`${transfer.length}개 항목 → ${root?.name}/${location.path}`}
          onClose={() => {
            if (!transferring) setTransfer(undefined);
          }}
        >
          <div className="modal-content">
            <p>
              현재 폴더에 파일을 복사하거나 이동합니다. 같은 이름의 파일이
              있으면 덮어쓰지 않고 오류를 표시합니다.
            </p>
            {transferError && (
              <p className="operation-error" role="alert">
                {transferError}
              </p>
            )}
          </div>
          <footer className="modal-footer">
            <button
              className="button secondary"
              disabled={transferring}
              onClick={() => setTransfer(undefined)}
            >
              취소
            </button>
            <button
              className="button secondary"
              disabled={transferring}
              onClick={() => void transferFiles(true)}
            >
              이동
            </button>
            <button
              className="button primary"
              disabled={transferring}
              onClick={() => void transferFiles(false)}
            >
              {transferring ? "처리 중…" : "복사"}
            </button>
          </footer>
        </Modal>
      )}
      <footer className="explorer-footer">
        <span>
          {loading ? (
            <>
              <LoaderCircle size={12} className="spin" /> 불러오는 중
            </>
          ) : (
            <>
              {entries.length.toLocaleString()}개 항목
              {filter && ` · 필터 ${visibleEntries.length}개`}
              {selection.length > 0 && (
                <span className="selection-count">
                  · {selection.length}개 선택
                </span>
              )}
            </>
          )}
        </span>
        {selected ? (
          <button onClick={() => openEntry(selected)}>
            {selected.kind === "directory" ? "폴더 열기" : "기본 앱으로 열기"}
            <ArrowRight size={12} />
          </button>
        ) : (
          <span className={active ? "active-indicator" : ""}>
            <i />
            {active ? "활성 탐색창" : "탐색창"}
          </span>
        )}
      </footer>
      {drop && (
        <div className="drop-label">
          <ArrowDown size={24} /> 이 탐색창에서 위치 열기
        </div>
      )}
    </section>
  );
}

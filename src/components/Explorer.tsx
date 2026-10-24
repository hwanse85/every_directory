import { writeClipboard, isDesktop, importDroppedFiles } from "../client";
import type { FileDrag } from "../fileDrag";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Palette,
} from "lucide-react";
import type { IndexClient } from "../client";
import type {
  ConnectedRoot,
  ExplorerPane,
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
import {
  addressLocation,
  fileUri,
  locationLabel,
  locationPath,
} from "../paths";
import { tabColor } from "../tabs";
import { filenameFilter } from "../search";
import { normalizeSearchInput, searchInputValue } from "../quickSearch";
export { createTab, createPane } from "../tabs";

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
  const composingFilter = useRef(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const [tree, setTree] = useState(false);
  const [context, setContext] = useState<{ x: number; y: number }>();
  const [localTool, setLocalTool] = useState<ToolRequest>();
  const [transfer, setTransfer] = useState<Location[]>();
  const [externalTransfer, setExternalTransfer] = useState<string[]>();
  const [transferDestination, setTransferDestination] = useState<Location>();
  const paneRef = useRef<HTMLElement>(null);
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState("");
  useEffect(() => {
    const targetAt = (x: number, y: number): Location | undefined => {
      if (!root || root.demo || document.querySelector("dialog[open]")) return;
      const element = document.elementFromPoint(x, y);
      if (element?.closest(".explorer-pane") !== paneRef.current) return;
      const folder = element?.closest<HTMLElement>("[data-drop-location]")?.dataset.dropLocation;
      return folder ? JSON.parse(folder) as Location : location;
    };
    const internal = (event: Event) => {
      const detail = (event as CustomEvent<FileDrag>).detail;
      const target = targetAt(detail.x, detail.y);
      setDrop(detail.phase === "over" && !!target);
      if (detail.phase === "drop" && target) {
        setTransferDestination(target);
        setTransferError("");
        setTransfer(detail.entries);
        onActivate();
      }
    };
    window.addEventListener("ed-file-drag", internal);
    let stopped = false;
    let unlisten: (() => void) | undefined;
    if (isDesktop) void import("@tauri-apps/api/webview").then(async ({getCurrentWebview}) => {
      const off = await getCurrentWebview().onDragDropEvent(({payload}) => {
        if (stopped) return;
        if (payload.type === "leave") { setDrop(false); return; }
        const target = targetAt(payload.position.x / window.devicePixelRatio, payload.position.y / window.devicePixelRatio);
        setDrop(payload.type !== "drop" && !!target);
        if (payload.type === "drop" && target && payload.paths.length) {
          setTransferDestination(target);
          setTransferError("");
          setExternalTransfer(payload.paths);
          onActivate();
        }
      });
      if (stopped) off(); else unlisten = off;
    }).catch((cause) => { if (!stopped) onError(`파일 드롭을 준비할 수 없습니다: ${String(cause)}`); });
    return () => { stopped = true; unlisten?.(); window.removeEventListener("ed-file-drag", internal); };
  }, [location.rootId, location.path, root?.demo]);
  const [showHidden, setShowHidden] = useState(
    readPreference("showHidden", true),
  );
  const [analysis, setAnalysis] = useState<AnalysisKind>();
  const [paneTransfer, setPaneTransfer] = useState<"copy" | "move">();
  const handledExternal = useRef<number | undefined>(undefined);
  const handledLocal = useRef<number | undefined>(undefined);
  const closeContext = useCallback(() => setContext(undefined), []);
  const matchesFilter = useMemo(() => filenameFilter(filter), [filter]);
  const visibleEntries = entries.filter(
    (entry) =>
      (showHidden || !(entry.hidden || entry.name.startsWith("."))) &&
      matchesFilter(entry.name),
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
          const path = locationPath(
            roots.find((root) => root.id === item.rootId),
            item.path,
          );
          const uri = fileUri(path);
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
        event.isComposing ||
        document.querySelector('dialog[open],[role="menu"]')
      )
        return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
        return;
      }
      if (modifier && !event.altKey && event.key === "Tab") {
        event.preventDefault();
        const index = pane.tabs.findIndex(item => item.id === tab.id);
        const next = (index + (event.shiftKey ? pane.tabs.length - 1 : 1)) % pane.tabs.length;
        onChange({...pane, activeTab:pane.tabs[next].id});
        return;
      }
      if (
        (modifier &&
          !event.shiftKey &&
          !event.altKey &&
          event.key.toLowerCase() === "l") ||
        (event.altKey && !modifier && event.key.toLowerCase() === "d") ||
        (event.key === "F4" && !modifier && !event.altKey)
      ) {
        event.preventDefault();
        setAddress(locationPath(root, location.path));
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      if (event.key === "Backspace" && !modifier && !event.altKey && location.path) {
        event.preventDefault();
        onNavigate({ rootId: location.rootId, path: location.path.split("/").slice(0, -1).join("/") });
        return;
      }
      if (
        modifier &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "w"
      ) {
        event.preventDefault();
        closeTab(tab.id);
        return;
      }
      if (
        event.altKey &&
        !modifier &&
        ["ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.key)
      ) {
        event.preventDefault();
        if (event.key === "ArrowLeft" && tab.cursor > 0) travel(-1);
        if (event.key === "ArrowRight" && tab.cursor < tab.history.length - 1)
          travel(1);
        if (event.key === "ArrowUp" && location.path)
          onNavigate({
            rootId: location.rootId,
            path: location.path.split("/").slice(0, -1).join("/"),
          });
        return;
      }
      let action: ToolRequest["action"] | undefined;
      if (event.key === "F5")
        action =
          /Mac/.test(navigator.platform) || event.shiftKey
            ? "copyOtherPane"
            : "refresh";
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
  }, [active, pane, root, location, onNavigate, onChange]);

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
    if (address !== undefined) {
      addressRef.current?.focus();
      addressRef.current?.select();
    }
  }, [address !== undefined]);
  useEffect(() => {
    if (!revealEntry) revealed.current = undefined;
    else if (revealed.current !== revealEntry) {
      const target = entries.find((entry) => entry.id === revealEntry.id);
      if (target) {
        if (filter) {
          setFilter("");
          return;
        }
        if (target.hidden || target.name.startsWith(".")) setShowHidden(true);
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
      await writeClipboard(locationPath(root, location.path));
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
    if ((!transfer && !externalTransfer) || transferring) return;
    setTransferError("");
    setTransferring(true);
    try {
      if (externalTransfer) await importDroppedFiles(externalTransfer, transferDestination ?? location);
      else await client.request("operation", {
        action: move ? "move" : "copy",
        entries: transfer,
        destination: transferDestination ?? location,
      });
      setTransfer(undefined);
      setExternalTransfer(undefined);
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
    const started = performance.now();
    try {
      await client.request("operation", {
        action: paneTransfer,
        entries: selection.map(({ rootId, path }) => ({ rootId, path })),
        destination: otherPane.location,
      });
      onChanged();
      setPaneTransfer(undefined);
      onMessage(`${selection.length}개 항목 ${paneTransfer === "copy" ? "복사" : "이동"} 완료 · ${((performance.now()-started)/1000).toFixed(1)}초`);
    } catch (cause) {
      setTransferError(String(cause));
      onChanged();
    } finally {
      setTransferring(false);
    }
  }

  return (
    <section
      ref={paneRef}
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
          const folder = (e.target as Element).closest<HTMLElement>("[data-drop-location]")?.dataset.dropLocation;
          setTransferDestination(folder ? JSON.parse(folder) : location);
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
              locationLabel(roots.find((r) => r.id === loc.rootId)) ||
              "폴더";
            const color = tabColor(t.color);
            return (
              <div
                className={`explorer-tab ${t.id === tab.id ? "current" : ""}`}
                key={t.id}
                style={
                  color
                    ? {
                        borderTopColor: color,
                        backgroundColor: `${color}22`,
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
                <label
                  className={`tab-color-control ${color ? "has-color" : "no-color"}`}
                  title={color ? "탭 색상 변경" : "색상 미지정 · 탭 색상 선택"}
                >
                  {!color && <Palette size={12} aria-hidden="true" />}
                  <input
                    className="tab-color-picker"
                    type="color"
                    aria-label={`${name} 탭 색상`}
                    value={color ?? "#6389c6"}
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
                          item.id === t.id
                            ? { ...item, color: undefined }
                            : item,
                        ),
                      });
                    }}
                  />
                </label>
                {color && (
                  <button
                    className="clear-tab-color"
                    aria-label={`${name} 탭 색상 해제`}
                    title="탭 색상 해제"
                    onClick={() =>
                      onChange({
                        ...pane,
                        tabs: pane.tabs.map((item) =>
                          item.id === t.id
                            ? { ...item, color: undefined }
                            : item,
                        ),
                      })
                    }
                  >
                    <X size={10} />
                  </button>
                )}
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
              try {
                const target = await client.request<Location>(
                  "directoryLocation",
                  addressLocation(address, roots, location.rootId),
                );
                onNavigate(target);
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
            onDoubleClick={() => setAddress(locationPath(root, location.path))}
          >
            <Folder size={14} />
            <button
              onClick={() => onNavigate({ rootId: location.rootId, path: "" })}
            >
              {locationLabel(root) || "폴더"}
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
          ref={filterRef}
          placeholder="현재 폴더에서 필터…"
          title="이름 일부·한글 초성·와일드카드로 필터"
          maxLength={512}
          value={filter}
          onCompositionStart={() => { composingFilter.current = true; }}
          onCompositionEnd={(event) => { composingFilter.current = false; setFilter(normalizeSearchInput(event.currentTarget.value, "initials")); }}
          onChange={(event) => setFilter(searchInputValue(event.currentTarget, "initials", composingFilter))}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !composingFilter.current && !event.nativeEvent.isComposing) {
              event.preventDefault();
              setFilter("");
              paneRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
            }
          }}
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
              {paneTransfer === "copy"
                ? "같은 이름이 있으면 (1), (2) 순서로 사본을 만듭니다."
                : "같은 이름이 있으면 기존 파일을 보호하고 안내합니다."}
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
      {(transfer || externalTransfer) && (
        <Modal
          title="파일 가져오기"
          subtitle={`${transfer?.length ?? externalTransfer?.length}개 항목 → ${locationPath(root, (transferDestination ?? location).path)}`}
          onClose={() => {
            if (!transferring) { setTransfer(undefined); setExternalTransfer(undefined); }
          }}
        >
          <div className="modal-content">
            <p>
              선택한 폴더로 파일을 가져옵니다. 복사할 때 같은 이름이 있으면 (1), (2) 순서로 이름을 붙입니다.
              {externalTransfer ? " 외부 파일은 원본을 보존하여 복사합니다." : " 이동할 때 이름이 충돌하면 기존 파일을 보호하고 안내합니다."}
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
              onClick={() => { setTransfer(undefined); setExternalTransfer(undefined); }}
            >
              취소
            </button>
            <button
              className="button secondary"
              disabled={transferring || !!externalTransfer}
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

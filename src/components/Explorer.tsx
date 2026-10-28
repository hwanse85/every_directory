import {usePreferences,visibleFile,updatePreferences} from "../preferences";
import { writeClipboard, isDesktop, importDroppedFiles, supportsWindowsNew, windowsNewMenu } from "../client";
import type { FileDrag } from "../fileDrag";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  Pin,
  ExternalLink,
  Search,
  ArrowUpDown,
  ChevronDown,
  LayoutGrid,
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
import { FileTable, type FileCursor } from "./FileTable";
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
import { useSearchInput } from "../useSearchInput";
import { SearchTextInput } from "./SearchTextInput";
import { duplicateTab, moveTab, restoreClosedTabs, closedTabSnapshot } from "../tabs";
import { formatSize } from "./FileIcon";
import { TabMenu } from "./TabMenu";
import { useTabReorder } from "../useTabReorder";
import {TreeWidthHandle,treeWidth} from "./TreeWidthHandle";
import {SearchColumnPicker} from "./SearchColumnPicker";
import {defaultExplorerColumns,explorerViews} from "../explorerView";
import {normalizeSearchColumns,normalizeTableSort,searchColumnOptions} from "../searchColumns";
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
  const explorerColumns=normalizeSearchColumns(pane.columns??defaultExplorerColumns);
  const explorerSort=pane.sort??normalizeTableSort(readPreference(`explorerColumnWidths:${pane.id}:sort`,null))??{key:"name" as const,descending:false};
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
  const [cursor, setCursor] = useState<FileCursor>();
  const cursorIntent = useRef<{ focus: boolean; from: Location } | undefined>(undefined);
  const previousLocation = useRef(location);
  const selectedRef = useRef<FileEntry | undefined>(undefined);
  const entriesRef = useRef<FileEntry[]>([]);
  const createdName = useRef<{ name: string; at: number } | undefined>(undefined);
  const revealRef = useRef(revealEntry);
  revealRef.current = revealEntry;
  const [filter, setFilter] = useState("");
  const filterEditing = useSearchInput("initials", setFilter);
  const composingFilter = filterEditing.composing;
  const filterRef = useRef<HTMLInputElement>(null);
  const [tree, setTree] = useState(readPreference(`folderTreeVisible:${pane.id}`,false));
  const [treeSize,setTreeSize]=useState(()=>treeWidth(readPreference(`folderTreeWidth:${pane.id}`,165)));
  useEffect(()=>{savePreference(`folderTreeWidth:${pane.id}`,treeSize);},[pane.id,treeSize]);
  const [closedTabs,setClosedTabs]=useState<ExplorerTab[]>(()=>restoreClosedTabs(readPreference(`closedTabs:${pane.id}`,[])));
  const [tabMenu,setTabMenu]=useState<{id:string;x:number;y:number}>();
  const [renamingTab,setRenamingTab]=useState<{id:string;name:string}>();
  const tabDrag=useTabReorder((id,target,after)=>onChange({...pane,tabs:moveTab(pane.tabs,id,target,after)}));
  const closeTabMenu=useCallback(()=>setTabMenu(undefined),[]);
  useEffect(()=>{savePreference(`closedTabs:${pane.id}`,closedTabs);},[closedTabs,pane.id]);
  useEffect(()=>{savePreference(`folderTreeVisible:${pane.id}`,tree);},[tree,pane.id]);
  const [flyout, setFlyout] = useState<"sort" | "view">();
  const flyoutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flyout) return;
    // 바깥을 누르거나 Esc를 누르면 정렬·보기 메뉴를 닫고 단추로 초점을 돌린다.
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!flyoutRef.current?.contains(target) && !target.closest?.(".search-columns-picker")) setFlyout(undefined);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 마우스로 연 메뉴는 WebView에 따라 초점이 문서에 남으므로 그 경우에도 닫는다.
      const inside = !!flyoutRef.current?.contains(document.activeElement);
      if (!inside && document.activeElement && document.activeElement !== document.body) return;
      event.preventDefault();
      event.stopPropagation();
      flyoutRef.current?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus();
      setFlyout(undefined);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
    };
  }, [flyout]);
  const [context, setContext] = useState<{ x: number; y: number }>();
  const [localTool, setLocalTool] = useState<ToolRequest>();
  const [transfer, setTransfer] = useState<Location[]>();
  const [externalTransfer, setExternalTransfer] = useState<string[]>();
  const [transferDestination, setTransferDestination] = useState<Location>();
  const paneRef = useRef<HTMLElement>(null);
  const [transferring, setTransferring] = useState(false);
  const [nativeCreating, setNativeCreating] = useState(false);
  const currentLocation = useRef(location);
  currentLocation.current = location;
  async function createNative(point: {x: number; y: number}) {
    if (nativeCreating || !root || root.demo) return;
    const destination = {...location};
    const stillCurrent = () => destination.rootId === currentLocation.current.rootId
      && destination.path === currentLocation.current.path;
    setNativeCreating(true);
    try {
      const result = await windowsNewMenu(destination, point);
      if (!result.invoked) return;
      onChanged();
      if (stillCurrent()) {
        const files = await client.request<FileEntry[]>("list", destination);
        const created = files.filter(file => result.created.some(item => item.rootId === file.rootId && item.path === file.path));
        if (stillCurrent() && created.length) {
          setSelection(created);
          setSelected(created[0]);
        }
      }
      onMessage(result.created.length
        ? `${result.created.length}개 항목을 Windows에서 만들었습니다. F2로 이름을 변경할 수 있습니다.`
        : "Windows 새로 만들기를 실행했습니다. 생성이 끝나면 목록에 표시됩니다.");
    } catch (cause) {
      onChanged();
      onError(String(cause));
    } finally {
      setNativeCreating(false);
    }
  }
  const [transferError, setTransferError] = useState("");
  useEffect(() => {
    const paneElement = paneRef.current;
    if (paneElement) delete paneElement.dataset.nativeDropReady;
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
      if (stopped) off(); else {
        unlisten = off;
        if (paneElement) paneElement.dataset.nativeDropReady = "true";
      }
    }).catch((cause) => { if (!stopped) onError(`파일 드롭을 준비할 수 없습니다: ${String(cause)}`); });
    return () => { stopped = true; unlisten?.(); if (paneElement) delete paneElement.dataset.nativeDropReady; window.removeEventListener("ed-file-drag", internal); };
  }, [location.rootId, location.path, root?.id, root?.demo]);
  const {preferences}=usePreferences();
  const [hiddenOverride,setHiddenOverride]=useState<boolean>();
  const showHidden=hiddenOverride??preferences.showHidden;
  const setShowHidden=(next:boolean|((old:boolean)=>boolean))=>{
    const value=typeof next==="function"?next(showHidden):next;setHiddenOverride(value);
    void updatePreferences({...preferences,showHidden:value}).catch(cause=>{setHiddenOverride(undefined);onError(String(cause));});
  };
  const [analysis, setAnalysis] = useState<AnalysisKind>();
  const [paneTransfer, setPaneTransfer] = useState<"copy" | "move">();
  const handledExternal = useRef<number | undefined>(undefined);
  const handledLocal = useRef<number | undefined>(undefined);
  const closeContext = useCallback(() => setContext(undefined), []);
  const matchesFilter = useMemo(() => filenameFilter(filter), [filter]);
  const visibleEntries = entries.filter(
    (entry) =>
      visibleFile(entry,{...preferences,showHidden}) &&
      matchesFilter(entry.name),
  );
  useEffect(()=>setHiddenOverride(undefined),[preferences.showHidden]);

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
        event.keyCode === 229 ||
        (event.target instanceof Element && !!event.target.closest('.search-panel')) ||
        document.querySelector('dialog[open],[role="menu"]')
      )
        return;
      const modifier = event.metaKey || event.ctrlKey;
      if(modifier&&event.shiftKey&&event.key.toLowerCase()==="t"){
        event.preventDefault();reopenTab();return;
      }
      if (modifier && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
        return;
      }
      if (modifier && !event.altKey && (event.key === "Tab" || (["PageUp","PageDown"].includes(event.key)&&(event.target as HTMLElement)?.closest?.('.explorer-pane')))) {
        event.preventDefault();
        const index = pane.tabs.findIndex(item => item.id === tab.id);
        const next = (index + (event.shiftKey || event.key==="PageUp" ? pane.tabs.length - 1 : 1)) % pane.tabs.length;
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
  }, [active, pane, root, location, onNavigate, onChange,closedTabs]);

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
          const intent = cursorIntent.current;
          cursorIntent.current = undefined;
          const before = selectedRef.current;
          const previousEntries = entriesRef.current;
          setEntries(result);
          if (!revealRef.current || revealed.current === revealRef.current) {
            if (intent) {
              // 상위 폴더로 돌아오면 방금 있던 하위 폴더를, 키보드로 들어왔으면 첫 항목을 가리킨다.
              const prefix = location.path ? `${location.path}/` : "";
              const child = intent.from.rootId === location.rootId && intent.from.path.startsWith(prefix) && intent.from.path !== location.path
                ? result.find((entry) => entry.path === prefix + intent.from.path.slice(prefix.length).split("/")[0])
                : undefined;
              // 응답을 기다리는 동안 사용자가 다른 입력칸으로 옮겼다면 초점을 빼앗지 않는다.
              const focus = intent.focus && keyboardInList();
              if (child || focus) setCursor({ token: performance.now(), id: child?.id, focus });
            } else if (createdName.current && performance.now() - createdName.current.at < 5000 && result.some((entry) => entry.parent === location.path && entry.name === createdName.current?.name)) {
              const created = result.find((entry) => entry.parent === location.path && entry.name === createdName.current?.name);
              createdName.current = undefined;
              setCursor({ token: performance.now(), id: created?.id, focus: active && keyboardInList() });
            } else if (before && !result.some((entry) => entry.id === before.id)) {
              // 삭제·이동은 같은 자리의 다음 항목을, 이름 변경은 새 이름의 항목을 선택한다.
              const added = result.filter((entry) => !previousEntries.some((item) => item.id === entry.id));
              setCursor({ token: performance.now(), id: added.length === 1 ? added[0].id : undefined, replaced: before.id, focus: active && keyboardInList() });
            }
          }
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
  selectedRef.current = selected;
  entriesRef.current = entries;
  // 이 탐색창의 파일 목록이 키보드 초점을 가졌는지 확인한다.
  function listFocused() {
    return !!paneRef.current?.querySelector(".file-scroll")?.contains(document.activeElement);
  }
  // 초점이 목록에 있거나, 목록 행이 다시 그려지며 초점이 문서로 떨어진 경우만 목록 초점으로 본다.
  const listHadFocus = useRef(false);
  useEffect(() => {
    const track = (event: FocusEvent) => {
      // 목록에서 연 대화상자·메뉴 안의 초점 이동은 ‘목록 작업 중’ 상태를 지우지 않는다.
      if ((event.target as Element | null)?.closest?.('dialog,[role="menu"]')) return;
      listHadFocus.current = !!paneRef.current?.querySelector(".file-scroll")?.contains(event.target as Node);
    };
    document.addEventListener("focusin", track);
    return () => document.removeEventListener("focusin", track);
  }, []);
  function keyboardInList() {
    return listFocused() || ((!document.activeElement || document.activeElement === document.body) && listHadFocus.current);
  }
  useLayoutEffect(() => {
    const from = previousLocation.current;
    previousLocation.current = location;
    if (from.rootId === location.rootId && from.path === location.path) return;
    cursorIntent.current = { focus: active && listFocused(), from };
  }, [location.rootId, location.path]);
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
    if(tab.locked){onNavigate(tab.history[tab.cursor+delta],true);return;}
    onChange({
      ...pane,
      tabs: pane.tabs.map((t) =>
        t.id === tab.id ? { ...t, cursor: t.cursor + delta } : t,
      ),
    });
  }

  // 탭을 닫고 남은 인접 탭을 선택한다.
  function closeTab(id: string) {
    const closed=pane.tabs.find(tab=>tab.id===id);
    if(!closed||closed.locked)return;
    const tabs = pane.tabs.filter((t) => t.id !== id);
    if (!tabs.length) return;
    setClosedTabs(previous=>[...previous,closedTabSnapshot(closed)].slice(-20));
    onChange({
      ...pane,
      tabs,
      activeTab:
        pane.activeTab === id ? tabs[Math.min(pane.tabs.findIndex(tab=>tab.id===id),tabs.length-1)].id : pane.activeTab,
    });
  }

  function reopenTab(){
    const closed=closedTabs.at(-1);if(!closed)return;
    if(!roots.some(root=>root.id===closed.history[closed.cursor].rootId)){onMessage("닫은 탭의 폴더 연결이 해제되었습니다.",true);return;}
    const restored=pane.tabs.some(tab=>tab.id===closed.id)?{...closed,id:crypto.randomUUID()}:closed;
    setClosedTabs(previous=>previous.slice(0,-1));onChange({...pane,tabs:[...pane.tabs,restored],activeTab:restored.id});
  }

  function closeOtherTabs(id:string,rightOnly=false){
    const position=pane.tabs.findIndex(tab=>tab.id===id);
    const removed=pane.tabs.filter((tab,index)=>tab.id!==id&&!tab.locked&&(!rightOnly||index>position));
    if(!removed.length)return;
    setClosedTabs(previous=>[...previous,...removed.map(closedTabSnapshot)].slice(-20));
    const tabs=pane.tabs.filter(tab=>!removed.includes(tab));onChange({...pane,tabs,activeTab:tabs.some(tab=>tab.id===pane.activeTab)?pane.activeTab:id});
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
            const name = (typeof t.title==="string"&&t.title.trim().slice(0,64)) ||
              loc.path.split("/").pop() ||
              locationLabel(roots.find((r) => r.id === loc.rootId)) ||
              "폴더";
            const color = tabColor(t.color);
            return (
              <div
                className={`explorer-tab ${t.id === tab.id ? "current" : ""} ${tabDrag.visual?.id===t.id?"dragging-tab":""} ${tabDrag.visual?.target===t.id&&tabDrag.visual.id!==t.id?"tab-drop-target":""}`}
                key={t.id}
                data-tab-id={t.id}
                data-drop-edge={tabDrag.visual?.after?"after":"before"}
                onPointerDown={tabDrag.onPointerDown} onPointerMove={tabDrag.onPointerMove} onPointerUp={tabDrag.onPointerUp}
                onPointerCancel={tabDrag.onPointerCancel} onLostPointerCapture={tabDrag.onLostPointerCapture}
                onContextMenu={event=>{if((event.target as HTMLElement).closest('input'))return;event.preventDefault();event.stopPropagation();setTabMenu({id:t.id,x:event.clientX,y:event.clientY});}}
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
                  title={`${locationPath(roots.find(root=>root.id===loc.rootId),loc.path)}${t.locked?" · 고정됨":""}`}
                  onClick={() => {if(!tabDrag.suppressClick(t.id))onChange({ ...pane, activeTab: t.id });}}
                  onAuxClick={event=>{if(event.button===1){event.preventDefault();closeTab(t.id);}}}
                >
                  <Folder size={14} />
                  <span>{name}</span>
                  {t.locked&&<Pin size={11} aria-label="고정된 탭"/>}
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
                {pane.tabs.length > 1 && !t.locked && (
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
          {isDesktop&&<button className="icon-button" title="현재 폴더를 운영체제 기본 탐색기에서 열기" aria-label="기본 탐색기에서 열기" disabled={!root||!!root.demo} onClick={()=>void client.request("operation",{action:"open",entries:[location]}).catch(cause=>onError(String(cause)))}><ExternalLink size={14}/></button>}
        </div>
        <div className="folder-filter">
          <Search size={13} className="filter-icon" aria-hidden="true" />
          <SearchTextInput
            aria-label={`탐색창 ${number} 파일 필터`}
            preview={filterEditing.preview}
            ref={filterRef}
            placeholder={`${location.path.split("/").pop() || locationLabel(root) || "현재 폴더"} 검색`}
            title="이름 일부·한글 초성·와일드카드로 필터"
            maxLength={512}
            value={filter}
            onCompositionStart={filterEditing.onCompositionStart}
            onCompositionEnd={filterEditing.onCompositionEnd}
            onChange={filterEditing.onChange}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && !composingFilter.current && !event.nativeEvent.isComposing) {
                event.preventDefault();
                setCursor({ token: performance.now(), id: selected?.id, focus: true });
                return;
              }
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
        onCreated={(name) => { createdName.current = { name, at: performance.now() }; }}
        extra={<div className="explorer-view-controls" ref={flyoutRef} aria-label={`탐색창 ${number} 보기 설정`}>
          <div className="command-flyout">
            <button className="flyout-trigger" aria-haspopup="true" aria-expanded={flyout === "sort"} title="정렬 기준과 분류" onClick={() => setFlyout(flyout === "sort" ? undefined : "sort")}>
              <ArrowUpDown size={14} /><span>정렬</span><ChevronDown size={12} className="flyout-chevron" />
            </button>
            <div className="flyout-panel" role="group" aria-label={`탐색창 ${number} 정렬`} hidden={flyout !== "sort"}>
              <label><span>정렬 기준</span><select size={Math.min(searchColumnOptions.length, 8)} aria-label={`탐색창 ${number} 정렬 기준`} value={explorerSort.key} onChange={event=>onChange({...pane,sort:{key:event.target.value as typeof explorerSort.key,descending:explorerSort.descending}})}>{searchColumnOptions.map(column=><option key={column.id} value={column.id}>{column.label}</option>)}</select></label>
              <button className="sort-direction" aria-label={`탐색창 ${number} ${explorerSort.descending?"오름차순":"내림차순"}으로 정렬`} title={explorerSort.descending?"내림차순 · 클릭하여 오름차순":"오름차순 · 클릭하여 내림차순"} onClick={()=>onChange({...pane,sort:{...explorerSort,descending:!explorerSort.descending}})}>{explorerSort.descending?<ArrowDown size={13}/>:<ArrowUp size={13}/>}<span>{explorerSort.descending ? "내림차순" : "오름차순"}</span></button>
              <label><span>분류(그룹)</span><select aria-label={`탐색창 ${number} 분류 기준`} value={pane.group??"none"} onChange={event=>onChange({...pane,group:event.target.value as ExplorerPane["group"]})}><option value="none">없음</option>{searchColumnOptions.map(column=><option key={column.id} value={column.id}>{column.label}</option>)}</select></label>
            </div>
          </div>
          <div className="command-flyout">
            <button className="flyout-trigger" aria-haspopup="true" aria-expanded={flyout === "view"} title="보기 방식·탐색 창·표시 항목" onClick={() => setFlyout(flyout === "view" ? undefined : "view")}>
              <LayoutGrid size={14} /><span>보기</span><ChevronDown size={12} className="flyout-chevron" />
            </button>
            <div className="flyout-panel" role="group" aria-label={`탐색창 ${number} 보기`} hidden={flyout !== "view"}>
              <label><span>보기 방식</span><select size={explorerViews.length} aria-label={`탐색창 ${number} 보기 종류`} value={pane.view} onChange={event=>{onChange({...pane,view:event.target.value as ExplorerPane["view"]});}} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();setFlyout(undefined);}}} onClick={event=>{if((event.target as HTMLElement).tagName==="OPTION")setFlyout(undefined);}}>{explorerViews.map(view=><option key={view.id} value={view.id}>{view.label}</option>)}</select></label>
              <button className={`tree-toggle ${tree ? "chosen" : ""}`} aria-label="폴더 트리 표시" aria-pressed={tree} title="폴더 트리(탐색 창)" onClick={() => setTree(!tree)}><FolderTreeIcon size={14} /><span>폴더 트리(탐색 창)</span>{tree && <Check size={13} className="flyout-check" />}</button>
              <SearchColumnPicker label={`탐색창 ${number} 표시 항목`} defaults={defaultExplorerColumns} columns={explorerColumns} onChange={columns=>onChange({...pane,columns,view:"list"})}/>
            </div>
          </div>
        </div>}
      />
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
        {tree && <>
          <FolderTree
            key={tab.id}
            storageKey={`folderTreeExpanded:${pane.id}:${tab.id}`}
            label={`탐색창 ${number} 폴더 트리`}
            width={treeSize}
            showHidden={showHidden}
            roots={roots}
            location={location}
            client={client}
            revision={revision}
            onNavigate={onNavigate}
          />
          <TreeWidthHandle width={treeSize} onChange={setTreeSize}/>
        </>}
        <FileTable
          columnLayoutKey={`explorerColumnWidths:${pane.id}`}
          resetKey={`${tab.id}:${location.rootId}:${location.path}:${filter}:${showHidden}`}
          compact={compact}
          query={filter}
          entries={visibleEntries}
          revealEntry={revealEntry}
          roots={roots}
          selected={selected?.id}
          selectedIds={selection.map((entry) => entry.id)}
          onMultiSelect={setSelection}
          onQuickPreview={onPreview}
          view={pane.view}
          columns={explorerColumns}
          onColumnsChange={columns=>onChange({...pane,columns})}
          groupBy={pane.group??"none"}
          sortState={explorerSort}
          onSortChange={sort=>onChange({...pane,sort:sort??{key:"name",descending:false}})}
          onSelect={setSelected}
          cursor={cursor}
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
          onWindowsNew={supportsWindowsNew&&!nativeCreating&&root&&!root.demo?(point)=>void createNative(point):undefined}
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
                  · {selection.length.toLocaleString()}개 선택{selection.some(entry=>entry.kind==="file")&&` · 파일 ${formatSize(selection.reduce((bytes,entry)=>bytes+(entry.kind==="file"?(entry.size??0):0),0))}`}
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
        {/* 탐색기처럼 상태 표시줄 오른쪽에서 자세히·아이콘 보기를 바로 바꾼다. */}
        <div className="footer-views">
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
      </footer>
      {drop && (
        <div className="drop-label">
          <ArrowDown size={24} /> 이 탐색창에서 위치 열기
        </div>
      )}
      {tabMenu&&(()=>{const target=pane.tabs.find(tab=>tab.id===tabMenu.id);if(!target)return null;return <TabMenu x={tabMenu.x} y={tabMenu.y} onClose={closeTabMenu} items={[
        {label:"탭 복제",run:()=>{const next=duplicateTab(target);onChange({...pane,tabs:[...pane.tabs,next],activeTab:next.id});}},
        {label:"탭 이름 변경…",run:()=>setRenamingTab({id:target.id,name:target.title??""})},
        {label:target.locked?"탭 고정 해제":"탭 고정",run:()=>onChange({...pane,tabs:pane.tabs.map(tab=>tab.id===target.id?{...tab,locked:!tab.locked}:tab)})},
        {label:"다른 탭 닫기",disabled:!pane.tabs.some(tab=>tab.id!==target.id&&!tab.locked),run:()=>closeOtherTabs(target.id)},
        {label:"오른쪽 탭 닫기",disabled:!pane.tabs.slice(pane.tabs.indexOf(target)+1).some(tab=>!tab.locked),run:()=>closeOtherTabs(target.id,true)},
        {label:"닫은 탭 다시 열기 · Ctrl+Shift+T",disabled:!closedTabs.length,run:reopenTab},
        {label:"탭 닫기",disabled:target.locked||pane.tabs.length<=1,run:()=>closeTab(target.id)},
      ]}/>;})()}
      {renamingTab&&<Modal title="탭 이름 변경" onClose={()=>setRenamingTab(undefined)}><form className="modal-content" onSubmit={event=>{event.preventDefault();onChange({...pane,tabs:pane.tabs.map(tab=>tab.id===renamingTab.id?{...tab,title:renamingTab.name.trim()||undefined}:tab)});setRenamingTab(undefined);}}>
        <label>탭 이름<input aria-label="탭 이름" autoFocus maxLength={64} placeholder="비우면 폴더 이름 사용" value={renamingTab.name} onChange={event=>setRenamingTab({...renamingTab,name:event.target.value})}/></label>
        <button className="button primary" type="submit">저장</button>
      </form></Modal>}
    </section>
  );
}

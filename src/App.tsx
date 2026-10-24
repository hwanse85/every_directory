import { version as appVersion } from "../package.json";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowUpRight,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  Database,
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  HardDrive,
  History,
  Keyboard,
  LayoutPanelLeft,
  LoaderCircle,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  X,
  Zap,
  Wrench,
  CopyPlus,
  Files,
  GitCompareArrows,
  Image,
  TextCursorInput,
  Archive,
  FilePlus2,
  Moon,
  Sun,
  PanelBottomClose,
  Monitor,
  Hash,
  FileText,
  Code2,
  Play,
} from "lucide-react";
import {
  IndexClient,
  desktopControl,
  quickAccess,
  isDesktop,
  supportsOCR,
  type DesktopStatus,
} from "./client";
import { demoRoots, createDemoEntries } from "./demo";
import { readPreference, savePreference } from "./storage";
import type {
  Arrangement,
  ConnectedRoot,
  ExplorerPane,
  Favorite,
  FileCategory,
  FileEntry,
  FileClipboard,
  IndexProgress,
  Location,
  Placement,
  SearchResult,
  QuickAccess,
  SearchMode,
  ToolRequest,
} from "./types";
import { Explorer, createPane, createTab } from "./components/Explorer";
import { FileTable } from "./components/FileTable";
import { SearchColumnPicker } from "./components/SearchColumnPicker";
import { normalizeSearchColumns } from "./searchColumns";
import { Modal } from "./components/Modal";
import { FolderPicker } from "./components/FolderPicker";
import { Preview } from "./components/Preview";
import { ResizeHandle } from "./components/ResizeHandle";
import { CommandPalette, type QuickCommand } from "./components/CommandPalette";
import { exportEntries } from "./export";
import { FileContextMenu } from "./components/FileContextMenu";
import { normalizeSearchInput, shortcutLabel } from "./quickSearch";
import { AboutPanel } from "./components/AboutPanel";

const filters = [
  { id: "all", icon: Search, name: "전체" },
  { id: "document", icon: FileText, name: "문서" },
  { id: "image", icon: Image, name: "이미지" },
  { id: "folder", icon: Folder, name: "폴더" },
  { id: "code", icon: Code2, name: "코드" },
  { id: "audio", icon: Play, name: "미디어" },
  { id: "archive", icon: Archive, name: "압축" },
] as const;
const toolCards = [
  {
    action: "batchRename",
    title: "일괄 이름 변경",
    detail: "치환·정규식·연속 번호를 미리 보고 적용",
    icon: TextCursorInput,
  },
  {
    action: "duplicates",
    title: "중복 파일 찾기",
    detail: "이름이 다른 동일 파일도 SHA-256으로 확인",
    icon: Files,
  },
  {
    action: "compare",
    title: "두 폴더 비교",
    detail: "두 탐색창의 파일 경로와 내용 차이 확인",
    icon: GitCompareArrows,
  },
  {
    action: "stats",
    title: "폴더 용량 분석",
    detail: "종류별 사용량과 용량이 큰 파일 확인",
    icon: HardDrive,
  },
  {
    action: "resizeImages",
    title: "이미지 크기·형식 변환",
    detail: "PNG·JPEG·WebP 사본을 일괄 생성",
    icon: Image,
  },
  {
    action: "hash",
    title: "파일 무결성 확인",
    detail: "선택한 파일의 SHA-256 해시 계산",
    icon: Hash,
  },
  {
    action: "duplicate",
    title: "선택 파일 복제",
    detail: "원본 옆에 이름 충돌 없는 사본 생성",
    icon: CopyPlus,
  },
  {
    action: "copyOtherPane",
    title: "다른 창으로 전송",
    detail: "대상 폴더를 확인하고 선택 파일 복사",
    icon: ArrowUpRight,
  },
  {
    action: "zip",
    title: "ZIP 압축",
    detail: "선택한 여러 파일과 폴더를 한 번에 압축",
    icon: Archive,
  },
  {
    action: "unzip",
    title: "ZIP 압축 풀기",
    detail: "새 폴더에 안전하게 압축 해제",
    icon: FolderOpen,
  },
  {
    action: "mkfile",
    title: "새 텍스트 파일",
    detail: "현재 폴더에 빈 텍스트 파일 생성",
    icon: FilePlus2,
  },
  {
    action: "trashList",
    title: "앱 휴지통·복원",
    detail: "앱에서 삭제한 파일을 원래 위치로 복원",
    icon: Archive,
  },
] as const;
const demoEntries = createDemoEntries();
const sampleRoots = demoRoots.map((r) => ({
  ...r,
  count: demoEntries.filter((e) => e.rootId === r.id).length,
}));
const defaultPanes = [
  createPane({ rootId: "demo-projects", path: "Every Directory" }),
  createPane({ rootId: "demo-documents", path: "" }),
];
const initialFavorites: Favorite[] = [
  { rootId: "demo-projects", path: "Every Directory", name: "Every Directory" },
  { rootId: "demo-documents", path: "업무 문서", name: "업무 문서" },
  { rootId: "demo-projects", path: "Brand Assets", name: "Brand Assets" },
];

interface SavedSearch {
  id: string;
  name: string;
  query: string;
  mode: SearchMode;
  category: FileCategory;
  scope: string;
  fullPath: boolean;
  caseSensitive: boolean;
}
interface SavedWorkspace {
  id: string;
  name: string;
  panes: ExplorerPane[];
  placement: Placement;
  ratio: number;
  paneRatio: number;
  arrangement: Arrangement;
}

// 저장된 탐색창 구조가 현재 버전에서 읽을 수 있는지 확인한다.
function restorePanes(): ExplorerPane[] {
  const saved = readPreference<ExplorerPane[]>("panes", defaultPanes);
  if (!Array.isArray(saved) || saved.length < 1 || saved.length > 4)
    return defaultPanes;
  return saved.every(
    (p) =>
      p.id &&
      Array.isArray(p.tabs) &&
      p.tabs.length &&
      p.tabs.every(
        (t) =>
          Array.isArray(t.history) &&
          t.cursor >= 0 &&
          t.cursor < t.history.length &&
          t.history.every(
            (l) => typeof l.rootId === "string" && typeof l.path === "string",
          ),
      ),
  )
    ? saved
    : defaultPanes;
}

// 검색, 폴더 연결과 여러 탐색창을 하나의 작업 공간으로 연결한다.
export default function App() {
  const client = useMemo(() => new IndexClient(), []);
  const [roots, setRoots] = useState<ConnectedRoot[]>(
    isDesktop ? [] : sampleRoots,
  );
  const [panes, setPanes] = useState<ExplorerPane[]>(restorePanes);
  const [activePane, setActivePane] = useState(panes[0].id);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>(
    readPreference<SearchMode>("defaultSearchMode", "initials"),
  );
  const [defaultMode, setDefaultMode] = useState<SearchMode>(
    readPreference("defaultSearchMode", "initials"),
  );
  const [onboarding, setOnboarding] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(
    readPreference("caseSensitive", false),
  );
  const [searchError, setSearchError] = useState("");
  const [folderPicker, setFolderPicker] = useState(false);
  const serverVersion = useRef("");
  const [category, setCategory] = useState<FileCategory>("all");
  const [scope, setScope] = useState("");
  const [fullPath, setFullPath] = useState(readPreference("fullPath", false));
  const [searchColumns, setSearchColumns] = useState(() =>
    normalizeSearchColumns(readPreference("searchColumns", null)),
  );
  const [result, setResult] = useState<SearchResult>({
    entries: [],
    total: 0,
    elapsed: 0,
  });
  const [searching, setSearching] = useState(false);
  const [latency, setLatency] = useState(0);
  const [selected, setSelected] = useState<FileEntry>();
  const [revealTargets, setRevealTargets] = useState<
    Record<string, FileEntry | undefined>
  >({});
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<IndexProgress>();
  const [placement, setPlacement] = useState<Placement>(() => {
    const saved = readPreference<Placement>("placement", "left");
    return ["left", "right", "top", "bottom"].includes(saved) ? saved : "left";
  });
  const [ratio, setRatio] = useState(() =>
    Math.max(25, Math.min(70, Number(readPreference("ratio", 43)) || 43)),
  );
  const [paneRatio, setPaneRatio] = useState(() =>
    Math.max(20, Math.min(80, Number(readPreference("paneRatio", 50)) || 50)),
  );
  const [arrangement, setArrangement] = useState<Arrangement>(() => {
    const saved = readPreference<Arrangement>("arrangement", "column");
    return ["column", "row", "grid"].includes(saved) ? saved : "column";
  });
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [modal, setModal] = useState<
    | "folders"
    | "settings"
    | "help"
    | "commands"
    | "tools"
    | "saveSearch"
    | "saveWorkspace"
    | null
  >(null);
  const [toolRequest, setToolRequest] = useState<
    ToolRequest & { paneId: string }
  >();
  const [clipboard, setClipboard] = useState<FileClipboard>();
  const [preview, setPreview] = useState<FileEntry>();
  const [toast, setToast] = useState<{ message: string; error?: boolean }>();
  const [favorites, setFavorites] = useState<Favorite[]>(
    readPreference("favorites", initialFavorites),
  );
  const [recent, setRecent] = useState<string[]>(readPreference("recent", []));
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(
    readPreference("savedSearches", []),
  );
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspace[]>(
    readPreference("savedWorkspaces", []),
  );
  const [presetName, setPresetName] = useState("");
  const [theme, setTheme] = useState<"light" | "dark" | "system">(
    readPreference("theme", "light"),
  );
  const [systemDark, setSystemDark] = useState(
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [density, setDensity] = useState<"comfortable" | "compact">(
    readPreference("density", "comfortable"),
  );
  const [desktop, setDesktop] = useState<DesktopStatus>();
  const [shortcutDraft, setShortcutDraft] = useState("");
  const [shortcutSaving, setShortcutSaving] = useState(false);
  const [searchContext, setSearchContext] = useState<{
    entry: FileEntry;
    x: number;
    y: number;
  }>();
  const closeSearchContext = useCallback(() => setSearchContext(undefined), []);
  const searchInput = useRef<HTMLInputElement>(null);
  const measurementStart = useRef(0);
  const layoutRef = useRef<HTMLDivElement>(null);
  const scanLock = useRef(false);
  const demo = roots.length > 0 && roots.every((r) => r.demo);
  const count = roots.reduce((total, root) => total + root.count, 0);
  const effectiveTheme =
    theme === "system" ? (systemDark ? "dark" : "light") : theme;
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.dataset.density = density;
    savePreference("theme", theme);
    savePreference("density", density);
  }, [effectiveTheme, theme, density]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function changed() {
      setSystemDark(media.matches);
    }
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    const removers: (() => void)[] = [];
    // 트레이에서 선택한 작업을 현재 작업 공간에 연결한다.
    async function connectDesktop() {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<string>("ed-desktop", (event) => {
        if (disposed) return;
        if (event.payload === "search")
          requestAnimationFrame(() => {
            searchInput.current?.focus();
            searchInput.current?.select();
          });
        else if (event.payload === "tools") setModal("tools");
        else if (event.payload === "folders") setModal("folders");
        else if (event.payload === "settings") setModal("settings");
        else if (event.payload === "settings-changed")
          void desktopControl().then(setDesktop);
      });
      if (disposed) unlisten();
      else removers.push(unlisten);
      const unlistenError = await listen<string>("ed-desktop-error", (event) =>
        setToast({ message: event.payload, error: true }),
      );
      if (disposed) unlistenError();
      else removers.push(unlistenError);
      const unlistenQuick = await listen<QuickAccess>(
        "ed-quick-changed",
        (event) => {
          if (!disposed) {
            setFavorites(event.payload.favorites);
            setRecent(event.payload.recent);
          }
        },
      );
      if (disposed) unlistenQuick();
      else removers.push(unlistenQuick);
      const status = await desktopControl();
      if (!disposed) {
        setDesktop(status);
        setDefaultMode(status.defaultSearchMode);
        setMode(status.defaultSearchMode);
      }
    }
    void connectDesktop().catch((cause) =>
      setToast({ message: String(cause), error: true }),
    );
    return () => {
      disposed = true;
      removers.forEach((remove) => remove());
    };
  }, []);
  const vertical = placement === "top" || placement === "bottom";
  const reverse = placement === "right" || placement === "bottom";

  // 오류와 처리 결과를 잠시 표시한다.
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );

  useEffect(() => {
    client.onProgress = setProgress;
    client.onError = (error) => notify(error.message, true);
    client.onUpdate = (status) => {
      setScanning(status.scanning);
      setProgress(status.progress);
      const version = `${status.instanceId}:${status.version}`;
      if (version !== serverVersion.current) {
        serverVersion.current = version;
        setRoots(status.roots);
        setRevision((value) => value + 1);
      }
    };
    client
      .request<ConnectedRoot[]>("init")
      .then(async (saved) => {
        const current = saved.length || isDesktop ? saved : sampleRoots;
        setRoots(current);
        setPanes((previous) =>
          previous.map((p) => ({
            ...p,
            tabs: p.tabs.map((t) => ({
              ...t,
              history: t.history.map((loc) =>
                current.some((r) => r.id === loc.rootId)
                  ? loc
                  : { rootId: current[0]?.id ?? "", path: "" },
              ),
            })),
          })),
        );
        if (isDesktop) {
          try {
            const access = await quickAccess("migrate", {
              favorites: readPreference("favorites", []),
              recent: readPreference("recent", []),
            });
            setFavorites(access.favorites);
            setRecent(access.recent);
          } catch (cause) {
            notify(String(cause), true);
          }
        }
        if (isDesktop && !saved.length) {
          setOnboarding(true);
          setModal("folders");
        }
        setReady(true);
      })
      .catch((error) =>
        notify(
          `${error.message} ${isDesktop ? "앱을 다시 실행해 주세요." : "로컬 서버 실행 상태를 확인해 주세요."}`,
          true,
        ),
      );
    return () => client.dispose();
  }, [client, notify]);

  useEffect(() => {
    if (ready) savePreference("panes", panes);
  }, [panes, ready]);
  useEffect(() => {
    savePreference("placement", placement);
    savePreference("ratio", ratio);
    savePreference("arrangement", arrangement);
    savePreference("paneRatio", paneRatio);
  }, [placement, ratio, arrangement, paneRatio]);
  useEffect(() => {
    savePreference("favorites", favorites);
  }, [favorites]);
  useEffect(() => {
    savePreference("recent", recent);
  }, [recent]);
  useEffect(() => {
    savePreference("savedSearches", savedSearches);
  }, [savedSearches]);
  useEffect(() => {
    savePreference("savedWorkspaces", savedWorkspaces);
  }, [savedWorkspaces]);
  useEffect(() => {
    savePreference("fullPath", fullPath);
    savePreference("mode", mode);
    savePreference("defaultSearchMode", defaultMode);
    savePreference("caseSensitive", caseSensitive);
  }, [fullPath, mode, defaultMode, caseSensitive]);
  useEffect(() => {
    savePreference("searchColumns", searchColumns);
  }, [searchColumns]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => setToast(undefined),
      toast.error ? 8000 : 3500,
    );
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!layoutOpen) return;
    // 메뉴 바깥을 클릭하거나 Escape를 누르면 레이아웃 메뉴를 닫는다.
    function closeMenu(event: MouseEvent | globalThis.KeyboardEvent) {
      if (
        (event instanceof MouseEvent &&
          !layoutRef.current?.contains(event.target as Node)) ||
        (event instanceof globalThis.KeyboardEvent && event.key === "Escape")
      )
        setLayoutOpen(false);
    }
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeMenu);
    };
  }, [layoutOpen]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const started = performance.now();
    setSearching(true);
    setSearchError("");
    const timer = setTimeout(() => {
      client
        .request<SearchResult>("search", {
          query,
          mode,
          caseSensitive,
          category,
          rootId: scope,
          fullPath,
          limit: 1000,
        })
        .then((data) => {
          if (!alive) return;
          measurementStart.current = started;
          setResult(data);
          setSelected(undefined);
          setSearching(false);
        })
        .catch((error) => {
          if (alive) {
            setSearching(false);
            setSearchError(error.message);
            setResult({ entries: [], total: 0, elapsed: 0 });
          }
        });
    }, 60);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    client,
    ready,
    query,
    category,
    scope,
    fullPath,
    mode,
    caseSensitive,
    revision,
    notify,
  ]);

  useLayoutEffect(() => {
    if (measurementStart.current) {
      setLatency(performance.now() - measurementStart.current);
      measurementStart.current = 0;
    }
  }, [result]);

  // 지정한 탐색창의 현재 탭 또는 새 탭에 폴더를 연다.
  const navigate = useCallback(
    (location: Location, paneId = activePane, newTab = false) => {
      setRevealTargets((previous) => ({ ...previous, [paneId]: undefined }));
      setPanes((previous) =>
        previous.map((pane) => {
          if (pane.id !== paneId) return pane;
          if (newTab) {
            const tab = createTab(location);
            return { ...pane, tabs: [...pane.tabs, tab], activeTab: tab.id };
          }
          return {
            ...pane,
            tabs: pane.tabs.map((tab) => {
              if (tab.id !== pane.activeTab) return tab;
              const current = tab.history[tab.cursor];
              if (
                current.rootId === location.rootId &&
                current.path === location.path
              )
                return tab;
              const history = [
                ...tab.history.slice(0, tab.cursor + 1),
                location,
              ].slice(-100);
              return { ...tab, history, cursor: history.length - 1 };
            }),
          };
        }),
      );
      setActivePane(paneId);
    },
    [activePane],
  );

  // 탐색창 개수를 변경하고 기존 창의 탭 상태를 유지한다.
  function changePaneCount(next: number) {
    const current = panes.find((p) => p.id === activePane) ?? panes[0];
    const tab =
      current.tabs.find((t) => t.id === current.activeTab) ?? current.tabs[0];
    const updated = panes.slice(0, next);
    while (updated.length < next)
      updated.push(createPane(tab.history[tab.cursor]));
    setPanes(updated);
    if (next >= 3 && arrangement === "column") setArrangement("grid");
    if (!updated.some((p) => p.id === activePane)) setActivePane(updated[0].id);
  }

  useEffect(() => {
    // 검색창 초점, 새 탭과 탐색창 전환 단축키를 처리한다.
    function shortcuts(event: globalThis.KeyboardEvent) {
      if (document.querySelector("dialog[open]")) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "p"
      ) {
        event.preventDefault();
        setModal("commands");
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        event.key.toLowerCase() === "t"
      ) {
        event.preventDefault();
        const pane = panes.find((p) => p.id === activePane) ?? panes[0];
        const tab = pane.tabs.find((t) => t.id === pane.activeTab)!;
        navigate(tab.history[tab.cursor], pane.id, true);
      }
      if (event.key === "F6") {
        event.preventDefault();
        setActivePane(
          panes[
            (panes.findIndex((p) => p.id === activePane) + 1) % panes.length
          ].id,
        );
      }
    }
    document.addEventListener("keydown", shortcuts);
    return () => document.removeEventListener("keydown", shortcuts);
  }, [panes, activePane, navigate]);

  // 선택한 폴더를 인덱싱하고 완료된 스냅샷만 화면에 반영한다.
  async function indexRoot(root: ConnectedRoot) {
    if (scanLock.current) {
      notify("현재 인덱싱이 끝난 뒤 다시 시도해 주세요.");
      return;
    }
    scanLock.current = true;
    setScanning(true);
    setProgress({ rootId: root.id, count: 0, directory: root.name });
    try {
      const updated = await client.request<ConnectedRoot>("scan", root);
      setRoots((previous) => [
        ...previous.filter((r) => !r.demo && r.id !== updated.id),
        updated,
      ]);
      if (demo || !roots.length) {
        setPanes((previous) =>
          previous.map((p) => ({
            ...p,
            tabs: p.tabs.map((t) => ({
              ...t,
              history: [{ rootId: updated.id, path: "" }],
              cursor: 0,
            })),
          })),
        );
        setScope("");
      }
      setRevision((v) => v + 1);
      notify(
        `${updated.name}: ${updated.count.toLocaleString()}개 항목 인덱싱 완료${updated.skipped ? ` · 제외 항목 ${updated.skipped}개` : ""}`,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "인덱싱하지 못했습니다.",
        true,
      );
    } finally {
      scanLock.current = false;
      setScanning(false);
      setProgress(undefined);
    }
  }

  // 서버의 실제 폴더 목록을 선택 대화상자로 연다.
  async function connectFolder() {
    if (!ready || scanning) return;
    setModal(null);
    if (isDesktop) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({
          directory: true,
          multiple: false,
          title: "검색할 폴더 선택",
        });
        if (selected)
          await indexRoot({
            id: "",
            name: selected.split(/[\\/]/).pop() || selected,
            absolutePath: selected,
            count: 0,
            skipped: 0,
            lastIndexed: 0,
          });
      } catch (error) {
        notify(String(error), true);
      }
      return;
    }
    setFolderPicker(true);
  }

  // 원본 파일을 건드리지 않고 폴더 연결과 캐시만 제거한다.
  async function disconnect(rootId: string) {
    if (scanning) return;
    try {
      await client.request("remove", rootId);
      const remaining = roots.filter((r) => r.id !== rootId);
      const next = remaining.length || isDesktop ? remaining : sampleRoots;
      setRoots(next);
      setPanes((previous) =>
        previous.map((p) => ({
          ...p,
          tabs: p.tabs.map((t) => ({
            ...t,
            history: t.history.map((loc) =>
              loc.rootId === rootId
                ? { rootId: next[0]?.id ?? "", path: "" }
                : loc,
            ),
          })),
        })),
      );
      setFavorites((previous) => previous.filter((f) => f.rootId !== rootId));
      setScope("");
      setRevision((v) => v + 1);
      notify("폴더 연결을 해제했습니다.");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "연결을 해제하지 못했습니다.",
        true,
      );
    }
  }

  // 현재 폴더의 즐겨찾기를 추가하거나 제거한다.
  function toggleFavorite(location: Location) {
    if (isDesktop) {
      void quickAccess("favorite", { location })
        .then((access) => setFavorites(access.favorites))
        .catch((cause) => notify(String(cause), true));
      return;
    }
    const exists = favorites.some(
      (f) => f.rootId === location.rootId && f.path === location.path,
    );
    setFavorites((previous) =>
      exists
        ? previous.filter(
            (f) => f.rootId !== location.rootId || f.path !== location.path,
          )
        : [
            ...previous,
            {
              ...location,
              name:
                location.path.split("/").pop() ||
                roots.find((r) => r.id === location.rootId)?.name ||
                "폴더",
            },
          ],
    );
    notify(exists ? "즐겨찾기에서 제거했습니다." : "즐겨찾기에 추가했습니다.");
  }

  // 검색 결과가 있는 폴더를 활성 탐색창에 연다.
  function reveal(entry: FileEntry, newTab = false, paneId = activePane) {
    navigate(
      {
        rootId: entry.rootId,
        path: entry.kind === "directory" ? entry.path : entry.parent,
      },
      paneId,
      newTab,
    );
    if (entry.kind === "file") {
      setRevealTargets((previous) => ({ ...previous, [paneId]: { ...entry } }));
      setPanes((previous) =>
        previous.map((p) => (p.id === paneId ? { ...p, view: "list" } : p)),
      );
    }
    if (isDesktop) {
      void quickAccess(entry.kind === "directory" ? "opened" : "query", {
        location: { rootId: entry.rootId, path: entry.path },
        query,
      }).catch((cause) => notify(String(cause), true));
    }
    if (!isDesktop && query.trim())
      setRecent((previous) =>
        [query.trim(), ...previous.filter((q) => q !== query.trim())].slice(
          0,
          5,
        ),
      );
    notify(
      `탐색창 ${panes.findIndex((p) => p.id === paneId) + 1}에서 ${entry.kind === "directory" ? entry.name : "파일 위치"}를 열었습니다.`,
    );
  }

  // 검색 항목을 선택하면 활성 탐색창에서 해당 위치와 파일을 표시한다.
  function selectResult(entry: FileEntry): void {
    setSelected(entry);
    reveal(entry);
  }

  // 검색 파일은 기본 앱으로 실행하고 폴더는 활성 탐색창에서 연다.
  async function openResult(entry: FileEntry): Promise<void> {
    if (entry.kind === "directory") {
      reveal(entry);
      return;
    }
    if (roots.find((root) => root.id === entry.rootId)?.demo) {
      notify(
        "샘플 파일은 실행할 수 없습니다. 폴더를 연결해 실제 파일을 검색해 주세요.",
        true,
      );
      return;
    }
    try {
      notify(`${entry.name} 파일을 여는 중…`);
      await client.request("operation", {
        action: "open",
        entries: [{ rootId: entry.rootId, path: entry.path }],
      });
      notify(`${entry.name} 파일을 기본 앱으로 열었습니다.`);
      if (isDesktop)
        void quickAccess("opened", {
          location: { rootId: entry.rootId, path: entry.path },
          query,
        }).catch((cause) =>
          notify(
            `열기는 완료했지만 기록 저장에 실패했습니다: ${String(cause)}`,
            true,
          ),
        );
    } catch (cause) {
      notify(
        cause instanceof Error ? cause.message : "파일을 열지 못했습니다.",
        true,
      );
    }
  }

  useEffect(() => {
    if (!isDesktop) return;
    let disposed = false;
    let remove: (() => void) | undefined;
    // 빠른 검색창이 전달한 위치를 메인 탐색창에 표시한다.
    async function connectQuickReveal() {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<FileEntry>("ed-quick-reveal", (event) => {
        const entry = event.payload;
        navigate({
          rootId: entry.rootId,
          path: entry.kind === "directory" ? entry.path : entry.parent,
        });
        if (entry.kind === "file")
          setRevealTargets((previous) => ({
            ...previous,
            [activePane]: entry,
          }));
      });
      if (disposed) unlisten();
      else remove = unlisten;
    }
    void connectQuickReveal().catch((cause) => notify(String(cause), true));
    return () => {
      disposed = true;
      remove?.();
    };
  }, [navigate, activePane, notify]);

  // 빠른 명령을 현재 활성 탐색창의 선택 항목에 전달한다.
  function runTool(action: ToolRequest["action"], entry?: FileEntry): void {
    if (entry) {
      navigate({ rootId: entry.rootId, path: entry.parent }, activePane);
      setRevealTargets((previous) => ({ ...previous, [activePane]: entry }));
    }
    setToolRequest({
      action,
      entry,
      id: performance.now(),
      paneId: activePane,
    });
  }

  // 분석 결과를 현재 인덱스 항목과 연결해 활성 탐색창에서 표시한다.
  async function revealLocation(location: Location, open = false) {
    try {
      const parent = location.path.split("/").slice(0, -1).join("/");
      const entries = await client.request<FileEntry[]>("list", {
        rootId: location.rootId,
        path: parent,
      });
      const entry = entries.find((entry) => entry.path === location.path);
      if (entry) {
        if (open) await openResult(entry);
        else reveal(entry);
      } else
        notify("파일 위치가 바뀌었습니다. 목록을 새로고침해 주세요.", true);
    } catch (cause) {
      notify(String(cause), true);
    }
  }

  // 검색 조건 또는 탐색창 조합을 이름을 붙여 저장한다.
  function savePreset() {
    const name = presetName.trim().slice(0, 80);
    if (!name) return;
    if (modal === "saveSearch")
      setSavedSearches((previous) =>
        [
          ...previous,
          {
            id: crypto.randomUUID(),
            name,
            query,
            mode,
            category,
            scope,
            fullPath,
            caseSensitive,
          },
        ].slice(-30),
      );
    else
      setSavedWorkspaces((previous) =>
        [
          ...previous,
          {
            id: crypto.randomUUID(),
            name,
            panes,
            placement,
            ratio,
            paneRatio,
            arrangement,
          },
        ].slice(-20),
      );
    setModal(null);
    notify("저장했습니다. 사이드바에서 다시 열 수 있습니다.");
  }

  // 저장된 폴더 조합을 복원하고 연결 해제된 위치는 현재 연결 폴더로 바꾼다.
  function restoreWorkspace(workspace: SavedWorkspace) {
    const restored = workspace.panes.map((pane) => ({
      ...pane,
      tabs: pane.tabs.map((tab) => ({
        ...tab,
        history: tab.history.map((location) =>
          roots.some((root) => root.id === location.rootId)
            ? location
            : { rootId: roots[0]?.id ?? "", path: "" },
        ),
      })),
    }));
    setPanes(restored);
    setActivePane(restored[0].id);
    setPlacement(workspace.placement);
    setRatio(workspace.ratio);
    setPaneRatio(workspace.paneRatio);
    setArrangement(workspace.arrangement);
    notify(`${workspace.name} 작업 공간을 열었습니다.`);
  }

  // 현재 표시된 검색 결과만 내보내고 결과 제한을 알린다.
  async function exportResults() {
    try {
      if (await exportEntries(result.entries, roots))
        notify(
          `표시된 ${result.entries.length}개 결과를 CSV로 저장했습니다.${result.total > result.entries.length ? " 전체 결과 중 처음 1,000개입니다." : ""}`,
        );
    } catch (cause) {
      notify(String(cause), true);
    }
  }

  const quickCommands: QuickCommand[] = [
    {
      id: "search",
      title: "파일 검색으로 이동",
      detail: "검색어 입력 · Ctrl/⌘ K",
      keywords: "search find",
      run: () => searchInput.current?.focus(),
    },
    {
      id: "connect",
      title: "폴더 연결",
      detail: "검색할 로컬 폴더 추가",
      keywords: "folder index",
      run: connectFolder,
    },
    {
      id: "settings",
      title: "검색 설정",
      detail: "전체 경로 검색과 설정",
      run: () => setModal("settings"),
    },
    ...panes.map((pane, index) => ({
      id: `pane-${index + 1}`,
      title: `탐색창 ${index + 1} 활성화`,
      detail:
        activePane === pane.id
          ? "현재 활성 탐색창"
          : "검색 위치를 표시할 탐색창 선택",
      keywords: "pane active",
      run: () => setActivePane(pane.id),
    })),
    ...(
      [
        ["batchRename", "일괄 이름 변경", "rename PowerRename"],
        ["preview", "빠른 미리보기", "peek preview Space"],
        ["resizeImages", "이미지 크기 변경", "image resize 사진 축소"],
        ["ocr", "이미지 텍스트 추출 · OCR", "text extract 문자 인식"],
        ["open", "기본 앱으로 파일 실행", "open run launch"],
        ["reveal", "Finder / 탐색기에서 보기", "reveal"],
        ["trashList", "앱 휴지통 · 복원", "trash restore 삭제 복원"],
        ["duplicate", "같은 폴더에 복제", "duplicate copy 사본"],
        ["stats", "폴더 용량 분석", "space storage 디스크"],
        ["duplicates", "중복 파일 찾기", "duplicate hash 동일"],
        ["compare", "두 탐색창 폴더 비교", "compare diff 차이"],
        ["mkfile", "새 텍스트 파일", "new text file"],
        ["copyOtherPane", "다른 탐색창으로 복사", "copy pane"],
        ["terminal", "현재 폴더에서 터미널 열기", "terminal cmd"],
      ] as const
    )
      .filter(([action]) => supportsOCR || action !== "ocr")
      .map(([action, title, keywords]) => ({
        id: action,
        title,
        keywords,
        detail: `활성 탐색창 ${panes.findIndex((pane) => pane.id === activePane) + 1}의 선택 항목`,
        run: () => runTool(action),
      })),
  ];

  const workspaceStyle = { "--search-size": `${ratio}%` } as CSSProperties;
  const paneStyle: CSSProperties =
    panes.length === 2 && arrangement !== "grid"
      ? arrangement === "column"
        ? {
            gridTemplateRows: `minmax(0, ${paneRatio}fr) 10px minmax(0, ${100 - paneRatio}fr)`,
          }
        : {
            gridTemplateColumns: `minmax(0, ${paneRatio}fr) 10px minmax(0, ${100 - paneRatio}fr)`,
          }
      : {};

  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            searchInput.current?.focus();
          }}
          aria-label="Every Directory 홈"
        >
          <span className="brand-mark">
            <FolderOpen size={18} strokeWidth={1.7} />
          </span>
          <span>
            Every <span className="brand-light">Directory</span>
          </span>
        </a>
        <div className="header-center">
          <span className="header-divider" />
          <span>LOCAL FILE WORKSPACE</span>
        </div>
        <div className="header-actions">
          <button
            className="command-trigger"
            onClick={() => setModal("commands")}
          >
            <Search size={15} />
            <span>명령 또는 도구 찾기</span>
            <kbd>{/Mac/.test(navigator.platform) ? "⌘⇧P" : "Ctrl+Shift+P"}</kbd>
          </button>
          {isDesktop && (
            <button
              className="icon-button"
              aria-label="빠른 파일 검색 열기"
              title="빠른 파일 검색"
              onClick={() =>
                void desktopControl("quick").catch((cause) =>
                  notify(String(cause), true),
                )
              }
            >
              <Search size={18} />
            </button>
          )}
          <span className="local-badge">
            <span className="connection-dot" />{" "}
            {isDesktop ? "내 컴퓨터" : "로컬 연결"}
          </span>
          {isDesktop && (
            <button
              className="icon-button"
              aria-label="트레이로 숨기기"
              title="트레이로 숨기기 · 검색·감시는 계속 실행"
              onClick={() =>
                void desktopControl("hide").catch((cause) =>
                  notify(String(cause), true),
                )
              }
            >
              <PanelBottomClose size={18} />
            </button>
          )}
          <button
            className="icon-button theme-button"
            aria-label={
              effectiveTheme === "dark"
                ? "라이트 테마로 전환"
                : "다크 테마로 전환"
            }
            title="화면 테마 전환"
            onClick={() =>
              setTheme(effectiveTheme === "dark" ? "light" : "dark")
            }
          >
            {effectiveTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            className="icon-button"
            aria-label="빠른 명령"
            title="빠른 명령 · Ctrl/⌘ Shift P"
            onClick={() => setModal("commands")}
          >
            <Command size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="도움말"
            title="도움말과 단축키"
            onClick={() => setModal("help")}
          >
            <CircleHelp size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="설정"
            title="설정"
            onClick={() => setModal("settings")}
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <span className="sidebar-label">내 파일</span>
          <button
            className="sidebar-nav current"
            onClick={() => {
              setQuery("");
              setCategory("all");
              setScope("");
              searchInput.current?.focus();
            }}
          >
            <LayoutPanelLeft size={18} />
            검색 및 탐색
          </button>
          <button className="sidebar-nav" onClick={() => setModal("folders")}>
            <Database size={17} />
            인덱스 관리
            {!demo && <span className="nav-count">{roots.length}</span>}
          </button>
          <button className="sidebar-nav" onClick={() => setModal("tools")}>
            <Wrench size={17} />
            파일 도구<span className="nav-count">12</span>
          </button>

          <div className="sidebar-section-title">
            <span>즐겨찾기</span>
            <Star size={12} />
          </div>
          <div className="favorite-list">
            {favorites
              .filter((f) => roots.some((r) => r.id === f.rootId))
              .map((f) => (
                <button
                  key={`${f.rootId}:${f.path}`}
                  className="sidebar-folder"
                  onClick={() =>
                    f.kind === "file"
                      ? void revealLocation(f, true)
                      : navigate(f)
                  }
                >
                  {f.kind === "file" ? (
                    <FileText size={15} />
                  ) : (
                    <Folder size={15} />
                  )}
                  <span>{f.name}</span>
                  <ChevronRight size={11} />
                </button>
              ))}
            {!favorites.some((f) => roots.some((r) => r.id === f.rootId)) && (
              <p className="sidebar-empty">
                탐색창의 ☆ 버튼으로
                <br />
                자주 쓰는 파일·폴더를 추가하세요.
              </p>
            )}
          </div>

          <div className="sidebar-section-title">
            <span>{demo ? "샘플 폴더" : "연결된 폴더"}</span>
            <button
              className="icon-button"
              title="폴더 연결"
              aria-label="사이드바에서 폴더 연결"
              disabled={scanning || !ready}
              onClick={() => void connectFolder()}
            >
              <Plus size={14} />
            </button>
          </div>
          {roots.map((root) => (
            <button
              key={root.id}
              className="sidebar-folder root-folder"
              title={`${root.name} · ${root.count.toLocaleString()}개 항목`}
              onClick={() => navigate({ rootId: root.id, path: "" })}
            >
              <HardDrive size={15} />
              <span>{root.name}</span>
              <i />
            </button>
          ))}
          <button
            className="add-folder-link"
            disabled={scanning || !ready}
            onClick={() => void connectFolder()}
          >
            <Plus size={13} />
            폴더 연결하기
          </button>

          {recent.length > 0 && (
            <>
              <div className="sidebar-section-title">
                <span>최근 검색</span>
                <History size={13} />
              </div>
              {recent.slice(0, 8).map((q) => (
                <button
                  key={q}
                  className="sidebar-folder recent-query"
                  onClick={() => setQuery(q)}
                >
                  <Search size={14} />
                  <span>{q}</span>
                </button>
              ))}
            </>
          )}
          <div className="sidebar-section-title">
            <span>저장한 검색</span>
            <button
              className="icon-button"
              aria-label="현재 검색 저장"
              title="현재 검색 저장"
              onClick={() => {
                setPresetName(query);
                setModal("saveSearch");
              }}
            >
              <Plus size={13} />
            </button>
          </div>
          {savedSearches.map((saved) => (
            <div className="saved-preset" key={saved.id}>
              <button
                className="sidebar-folder"
                title={saved.query}
                onClick={() => {
                  setQuery(saved.query);
                  setMode(saved.mode);
                  setCategory(saved.category);
                  setScope(
                    roots.some((root) => root.id === saved.scope)
                      ? saved.scope
                      : "",
                  );
                  setFullPath(saved.fullPath);
                  setCaseSensitive(saved.caseSensitive);
                }}
              >
                <Search size={13} />
                <span>{saved.name}</span>
              </button>
              <button
                className="preset-remove"
                aria-label={`${saved.name} 검색 저장 해제`}
                onClick={() =>
                  setSavedSearches((previous) =>
                    previous.filter((item) => item.id !== saved.id),
                  )
                }
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <div className="sidebar-section-title">
            <span>작업 공간</span>
            <button
              className="icon-button"
              aria-label="현재 작업 공간 저장"
              title="탭과 창 배치 저장"
              onClick={() => {
                setPresetName("내 작업 공간");
                setModal("saveWorkspace");
              }}
            >
              <Plus size={13} />
            </button>
          </div>
          {savedWorkspaces.map((saved) => (
            <div className="saved-preset" key={saved.id}>
              <button
                className="sidebar-folder"
                onClick={() => restoreWorkspace(saved)}
              >
                <Grid2X2 size={13} />
                <span>{saved.name}</span>
              </button>
              <button
                className="preset-remove"
                aria-label={`${saved.name} 작업 공간 저장 해제`}
                onClick={() =>
                  setSavedWorkspaces((previous) =>
                    previous.filter((item) => item.id !== saved.id),
                  )
                }
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <div className="sidebar-bottom">
            <div className="local-index-note">
              <HardDrive size={14} />
              <span>
                <small>검색 가능한 파일·폴더</small>
                <strong>{count.toLocaleString()}</strong>
                <small>
                  <i className="connection-dot" />
                  로컬에 안전하게 저장
                </small>
              </span>
            </div>
            <button className="keyboard-link" onClick={() => setModal("help")}>
              <Keyboard size={15} />
              단축키 안내<span>⌘ K</span>
            </button>
          </div>
        </aside>

        <main className="main-area">
          <div className="workspace-toolbar">
            <div className="workspace-title">
              <LayoutPanelLeft size={17} />
              <div className="workspace-heading">
                <small>YOUR FILES, IN ONE PLACE</small>
                <h2>파일 작업 공간</h2>
              </div>
              <span className="subtle-badge">
                {demo ? "샘플 공간" : `${roots.length}개 폴더 연결됨`}
              </span>
            </div>
            <div className="workspace-actions">
              <button
                className="button secondary toolbox-trigger"
                onClick={() => setModal("tools")}
              >
                <Wrench size={15} />
                파일 도구
              </button>
              <div className="layout-control" ref={layoutRef}>
                <button
                  className={`button secondary layout-button ${layoutOpen ? "pressed" : ""}`}
                  onClick={() => setLayoutOpen(!layoutOpen)}
                  aria-expanded={layoutOpen}
                >
                  <SlidersHorizontal size={14} />
                  <span>레이아웃</span>
                  <ChevronDown size={12} />
                </button>
                {layoutOpen && (
                  <div className="layout-popover">
                    <div className="popover-heading">나에게 맞는 작업 공간</div>
                    <p>검색 영역 위치</p>
                    <div className="placement-options">
                      {(
                        [
                          { id: "left", name: "왼쪽", icon: PanelLeft },
                          { id: "right", name: "오른쪽", icon: PanelRight },
                          { id: "top", name: "위쪽", icon: PanelTop },
                          { id: "bottom", name: "아래쪽", icon: PanelBottom },
                        ] as const
                      ).map(({ id, name, icon: Icon }) => (
                        <button
                          key={id}
                          className={placement === id ? "selected" : ""}
                          onClick={() => setPlacement(id)}
                          aria-pressed={placement === id}
                        >
                          <Icon size={25} strokeWidth={1.4} />
                          <span>{name}</span>
                        </button>
                      ))}
                    </div>
                    <p>탐색창 배치</p>
                    <div className="arrangement-options">
                      {(
                        [
                          { id: "column", name: "위아래" },
                          { id: "row", name: "좌우" },
                          { id: "grid", name: "격자" },
                        ] as const
                      ).map((a) => (
                        <button
                          key={a.id}
                          className={arrangement === a.id ? "selected" : ""}
                          onClick={() => setArrangement(a.id)}
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                    <label className="ratio-label">
                      검색 영역 비율 <span>{Math.round(ratio)}%</span>
                      <input
                        aria-label="검색 영역 비율"
                        type="range"
                        min="25"
                        max="70"
                        value={ratio}
                        onChange={(e) => setRatio(Number(e.target.value))}
                      />
                    </label>
                    <button
                      className="reset-layout"
                      onClick={() => {
                        setPlacement("left");
                        setRatio(43);
                        setArrangement("column");
                        setPaneRatio(50);
                        changePaneCount(2);
                      }}
                    >
                      기본 레이아웃으로 돌아가기
                      <RefreshCw size={12} />
                    </button>
                  </div>
                )}
              </div>
              <label className="pane-count-control">
                <Grid2X2 size={14} />
                <select
                  aria-label="탐색창 개수"
                  value={panes.length}
                  onChange={(e) => changePaneCount(Number(e.target.value))}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      탐색창 {n}개
                    </option>
                  ))}
                </select>
                <ChevronDown size={12} />
              </label>
              <button
                className="button primary"
                disabled={scanning || !ready}
                onClick={() => void connectFolder()}
              >
                {scanning ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <FolderPlus size={15} />
                )}
                <span>{scanning ? "인덱싱 중" : "폴더 연결"}</span>
                <Plus size={13} className="connect-plus" />
              </button>
            </div>
          </div>

          {(demo || (ready && !roots.length)) && (
            <div className="demo-banner">
              <span className="banner-icon">
                <FolderOpen size={15} />
              </span>
              <span>
                <strong>
                  {demo
                    ? "샘플 파일을 표시하고 있습니다."
                    : "검색할 폴더를 연결하세요."}
                </strong>{" "}
                {demo
                  ? "검색할 폴더를 연결해 시작하세요."
                  : "연결한 폴더의 실제 파일을 검색하고 기본 앱으로 열 수 있습니다."}
              </span>
              <button disabled={!ready} onClick={() => void connectFolder()}>
                내 폴더 연결
                <ArrowUpRight size={13} />
              </button>
            </div>
          )}
          {scanning && (
            <div className="index-banner">
              <LoaderCircle className="spin" size={14} />
              <strong>폴더를 인덱싱하고 있습니다</strong>
              <span>
                {progress?.count.toLocaleString() ?? 0}개 발견 ·{" "}
                {progress?.directory}
              </span>
              <span className="index-privacy">
                최초 스캔은 폴더 크기에 따라 시간이 걸릴 수 있습니다.
              </span>
            </div>
          )}

          <div
            className={`workspace-split placement-${placement}`}
            style={workspaceStyle}
          >
            <section className="search-panel" aria-label="빠른 검색">
              <header className="panel-header">
                <div className="panel-heading">
                  <span className="panel-icon">
                    <Search size={17} />
                  </span>
                  <h2>빠른 검색</h2>
                </div>
                <span className={`index-status ${scanning ? "working" : ""}`}>
                  <i />
                  {!ready
                    ? "준비 중"
                    : scanning
                      ? "인덱싱 중"
                      : "검색 준비 완료"}
                </span>
              </header>
              <div className="search-controls">
                <div className="search-input-wrap">
                  <Search size={19} />
                  <input
                    ref={searchInput}
                    aria-label="파일 검색"
                    placeholder="파일 이름으로 검색"
                    value={query}
                    onChange={(e) =>
                      setQuery(normalizeSearchInput(e.target.value, mode))
                    }
                    onCompositionEnd={(event) => {
                      const value = normalizeSearchInput(
                        event.currentTarget.value,
                        mode,
                      );
                      event.currentTarget.value = value;
                      setQuery(value);
                    }}
                    onKeyDown={(e) => {
                      if (
                        e.nativeEvent.isComposing ||
                        e.nativeEvent.keyCode === 229
                      )
                        return;
                      if (e.key === "Enter" && query.trim() && isDesktop) {
                        void quickAccess("query", { query }).catch((cause) =>
                          notify(String(cause), true),
                        );
                        return;
                      }
                      if (e.key === "Escape") {
                        setQuery("");
                        e.currentTarget.blur();
                      }
                      if (e.key === "Enter" && query.trim())
                        setRecent((previous) =>
                          [
                            query.trim(),
                            ...previous.filter((q) => q !== query.trim()),
                          ].slice(0, 5),
                        );
                    }}
                  />
                  {query ? (
                    <button
                      className="icon-button"
                      aria-label="검색어 지우기"
                      onClick={() => setQuery("")}
                    >
                      <X size={15} />
                    </button>
                  ) : (
                    <kbd>
                      <Command size={10} /> K
                    </kbd>
                  )}
                </div>
                <div className="search-method">
                  <label>
                    검색 방식
                    <select
                      aria-label="검색 방식"
                      value={mode}
                      onChange={(event) =>
                        setMode(event.target.value as SearchMode)
                      }
                    >
                      <option value="normal">일반 · 포함 / AND</option>
                      <option value="wildcard">와일드카드 · * ?</option>
                      <option value="regex">정규식</option>
                      <option value="fuzzy">퍼지 · 오타 허용</option>
                      <option value="initials">초성 + 일반 검색</option>
                    </select>
                  </label>
                  <label className="case-option">
                    <input
                      type="checkbox"
                      checked={caseSensitive}
                      disabled={mode === "initials"}
                      onChange={(event) =>
                        setCaseSensitive(event.target.checked)
                      }
                    />
                    대소문자
                  </label>
                </div>
                <p className="search-hint">
                  {mode === "wildcard"
                    ? "전체 파일명에 적용 · 예: *보고서*.pdf, IMG_????.jpg"
                    : mode === "regex"
                      ? "예: ^보고서.*\\.pdf$ · 전후방 탐색·역참조 제외"
                      : mode === "fuzzy"
                        ? "3~5자: 오타 1자 · 6자 이상: 2자 · 정확한 결과 우선"
                        : mode === "initials"
                          ? "ㅂㄱㅅ · 보고서 · Report 모두 검색 · 공백 AND · ext:pdf"
                          : isDesktop
                            ? "공백 AND · | OR · ! 제외 · ext:pdf · size:>10mb · dm:today"
                            : '공백은 AND · "업무 계획"은 구문 검색 · ext:pdf,docx'}
                </p>
                <div className="search-filters">
                  {filters.map((filter) => (
                    <button
                      key={filter.id}
                      className={category === filter.id ? "active" : ""}
                      onClick={() => setCategory(filter.id)}
                      aria-pressed={category === filter.id}
                    >
                      <filter.icon size={13} />
                      {filter.name}
                    </button>
                  ))}
                </div>
                <div className="search-scope">
                  <label>
                    <HardDrive size={12} />
                    <select
                      aria-label="검색할 폴더"
                      value={scope}
                      onChange={(e) => setScope(e.target.value)}
                    >
                      <option value="">모든 연결 폴더</option>
                      {roots.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={11} />
                  </label>
                  <button
                    title="검색 조건 저장"
                    aria-label="검색 조건 저장"
                    onClick={() => {
                      setPresetName(query);
                      setModal("saveSearch");
                    }}
                  >
                    <Star size={12} />
                  </button>
                  <button
                    title={`표시된 ${result.entries.length}개 결과를 CSV로 저장`}
                    aria-label="검색 결과 CSV 내보내기"
                    disabled={!result.entries.length}
                    onClick={() => void exportResults()}
                  >
                    <Download size={12} />
                  </button>
                  <button
                    title="설정에서 전체 경로 검색 변경"
                    onClick={() => setModal("settings")}
                  >
                    {fullPath ? "전체 경로 검색" : "파일명 검색"}
                    <Settings2 size={12} />
                  </button>
                </div>
              </div>
              {searchError && (
                <div className="search-error" role="alert">
                  {searchError}
                </div>
              )}
              {result.partial && (
                <div className="search-error" role="status">
                  시간 한도로 부분 결과를 표시합니다. 검색 폴더·확장자·검색어를
                  좁혀 주세요. 결과 수는 확인된 항목 기준입니다.
                </div>
              )}
              <div className="result-summary">
                <span>
                  {query || category !== "all" || scope ? (
                    <>
                      검색 결과 <strong>{result.total.toLocaleString()}</strong>
                    </>
                  ) : (
                    <>
                      전체 항목 <strong>{count.toLocaleString()}</strong>
                    </>
                  )}
                  {searching && <LoaderCircle size={12} className="spin" />}
                </span>
                <span className="result-hint">
                  {result.total > result.entries.length
                    ? `처음 ${result.entries.length.toLocaleString()}개 표시`
                    : `클릭 → 탐색창 ${panes.findIndex((pane) => pane.id === activePane) + 1} · 더블 클릭 → 실행`}
                  <ArrowUpRight size={11} />
                </span>
                <SearchColumnPicker
                  columns={searchColumns}
                  onChange={setSearchColumns}
                />
              </div>
              <FileTable
                resetKey={JSON.stringify([
                  query,
                  mode,
                  caseSensitive,
                  category,
                  scope,
                  fullPath,
                ])}
                entries={result.entries}
                roots={roots}
                search
                columns={searchColumns}
                selected={selected?.id}
                query={mode === "normal" ? query : ""}
                onSelect={selectResult}
                onOpen={(entry) => void openResult(entry)}
                onQuickPreview={setPreview}
                compact={density === "compact"}
                onContextMenu={(entry, x, y) =>
                  setSearchContext({ entry, x, y })
                }
              />
              {selected && (
                <div className="search-selection">
                  <span title={selected.name}>{selected.name}</span>
                  <button
                    title="활성 탐색창의 새 탭에서 위치 열기"
                    onClick={() => reveal(selected, true)}
                  >
                    새 탭에서 열기
                    <ArrowUpRight size={12} />
                  </button>
                  {selected.kind === "file" && (
                    <button onClick={() => setPreview(selected)}>
                      미리보기
                    </button>
                  )}
                </div>
              )}
              <footer className="search-footer">
                <span
                  title={`로컬 검색 엔진 ${result.elapsed.toFixed(2)}ms · 입력 대기 60ms와 응답 전달 포함 ${latency.toFixed(1)}ms`}
                >
                  <Zap size={12} />
                  <strong>{result.elapsed.toFixed(1)} ms</strong>
                  <span>검색</span>
                </span>
                <span className={latency >= 1000 ? "slow-result" : ""}>
                  <i />
                  {searchError
                    ? "검색 오류"
                    : result.partial
                      ? "부분 결과"
                      : searching
                        ? "검색 중"
                        : latency >= 1000
                          ? "1초 목표 초과"
                          : "1초 이내"}
                  <span className="total-latency">
                    · 전체 {Math.round(latency)}ms
                  </span>
                </span>
              </footer>
            </section>

            <ResizeHandle
              value={ratio}
              vertical={vertical}
              reverse={reverse}
              onChange={setRatio}
              label="검색과 탐색 영역 크기 조절"
            />

            <div className="explorers-section">
              <div className="explorers-heading">
                <div className="panel-heading">
                  <span className="panel-icon explorer">
                    <FolderOpen size={17} />
                  </span>
                  <h2>파일 탐색</h2>
                  <span className="subtle-badge">{panes.length}</span>
                </div>
                <span>
                  검색 위치 → 탐색창{" "}
                  {panes.findIndex((pane) => pane.id === activePane) + 1}
                </span>
              </div>
              <div
                className={`explorers arrangement-${arrangement} panes-${panes.length}`}
                style={paneStyle}
              >
                {panes.map((pane, i) => (
                  <div className="pane-slot" key={pane.id}>
                    {ready && (
                      <Explorer
                        pane={pane}
                        compact={density === "compact"}
                        otherPane={
                          panes.length > 1
                            ? (() => {
                                const other = panes[(i + 1) % panes.length];
                                const tab = other.tabs.find(
                                  (tab) => tab.id === other.activeTab,
                                )!;
                                const location = tab.history[tab.cursor];
                                return {
                                  location,
                                  label: `탐색창 ${((i + 1) % panes.length) + 1} · ${roots.find((root) => root.id === location.rootId)?.name ?? ""}/${location.path}`,
                                };
                              })()
                            : undefined
                        }
                        onNavigateOther={(location) => {
                          if (panes.length > 1)
                            navigate(
                              location,
                              panes[(i + 1) % panes.length].id,
                            );
                        }}
                        onRevealLocation={(location) =>
                          void revealLocation(location)
                        }
                        toolRequest={
                          toolRequest?.paneId === pane.id
                            ? toolRequest
                            : undefined
                        }
                        clipboard={clipboard}
                        onClipboard={setClipboard}
                        onMessage={notify}
                        onChanged={() => setRevision((value) => value + 1)}
                        revealEntry={revealTargets[pane.id]}
                        roots={roots}
                        client={client}
                        active={activePane === pane.id}
                        revision={revision}
                        number={i + 1}
                        onActivate={() => setActivePane(pane.id)}
                        onChange={(updated) =>
                          setPanes((previous) =>
                            previous.map((p) =>
                              p.id === updated.id ? updated : p,
                            ),
                          )
                        }
                        onNavigate={(location, newTab) =>
                          navigate(location, pane.id, newTab)
                        }
                        onPreview={setPreview}
                        onOpenFile={(entry) => void openResult(entry)}
                        onFavorite={toggleFavorite}
                        onError={(message) => notify(message, true)}
                        onRefresh={(rootId) => {
                          const root = roots.find((r) => r.id === rootId);
                          if (root) void indexRoot(root);
                        }}
                      />
                    )}
                  </div>
                ))}
                {panes.length === 2 && arrangement !== "grid" && (
                  <ResizeHandle
                    value={paneRatio}
                    vertical={arrangement === "column"}
                    min={20}
                    max={80}
                    onChange={setPaneRatio}
                    label="두 탐색창 크기 조절"
                  />
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
      <footer className="app-statusbar">
        <span>
          <i className="status-dot" />
          {scanning ? "인덱싱 중" : ready ? "준비됨" : "검색 엔진 시작 중"}
          <span className="status-divider" />
          {demo ? "샘플 모드" : "로컬 모드"}
          <span className="status-divider" />
          {count.toLocaleString()}개 항목 인덱싱됨
        </span>
        <span>
          Every Directory{" "}
          <span className="status-version">
            v{appVersion} {isDesktop ? "· Desktop" : "· Web"}
          </span>
          <span className="status-divider" />
          <Keyboard size={12} />
          <button onClick={() => setModal("help")}>단축키</button>
        </span>
      </footer>

      {modal === "commands" && (
        <CommandPalette
          commands={quickCommands}
          onClose={() => setModal(null)}
        />
      )}
      {folderPicker && (
        <FolderPicker
          client={client}
          onClose={() => setFolderPicker(false)}
          onSelect={(absolutePath) => {
            setFolderPicker(false);
            void indexRoot({
              id: "",
              name: absolutePath,
              absolutePath,
              count: 0,
              lastIndexed: 0,
              skipped: 0,
            });
          }}
        />
      )}
      {searchContext && (
        <FileContextMenu
          x={searchContext.x}
          y={searchContext.y}
          entries={[searchContext.entry]}
          pasteable={isDesktop || !!clipboard}
          otherPane={panes.length > 1}
          hidden={readPreference("showHidden", true)}
          onClose={closeSearchContext}
          onAction={(action) => runTool(action, searchContext.entry)}
        />
      )}
      {modal === "tools" && (
        <Modal
          title="파일 도구"
          subtitle={`활성 탐색창 ${panes.findIndex((pane) => pane.id === activePane) + 1}의 현재 폴더와 선택 항목에 적용합니다.`}
          onClose={() => setModal(null)}
          wide
        >
          <div className="toolbox-grid">
            {toolCards.map((tool) => (
              <button
                key={tool.action}
                className="toolbox-card"
                disabled={
                  ((tool.action === "compare" ||
                    tool.action === "copyOtherPane") &&
                    panes.length < 2) ||
                  (!isDesktop &&
                    ["stats", "duplicates", "compare"].includes(tool.action))
                }
                onClick={() => {
                  setModal(null);
                  runTool(tool.action);
                }}
              >
                <span className={`toolbox-icon tool-${tool.action}`}>
                  <tool.icon size={23} />
                </span>
                <strong>{tool.title}</strong>
                <p>{tool.detail}</p>
                <ArrowUpRight className="toolbox-arrow" size={16} />
              </button>
            ))}
          </div>
          <footer className="toolbox-footer">
            <Keyboard size={15} />
            <span>우클릭 메뉴에서도 도구를 실행할 수 있습니다.</span>
            <kbd>Esc</kbd>
          </footer>
        </Modal>
      )}
      {modal === "folders" && (
        <Modal
          title="인덱스 관리"
          subtitle="검색할 폴더를 연결하고 인덱스를 최신 상태로 유지하세요."
          onClose={() => setModal(null)}
        >
          <div className="modal-content">
            {onboarding && !roots.length && (
              <div className="onboarding-note" role="status">
                <strong>검색할 폴더를 먼저 설정해 주세요.</strong>
                <p>
                  아래의 폴더 연결 버튼으로 자주 사용하는 문서 폴더를 선택하면
                  파일 검색을 시작할 수 있습니다.
                </p>
              </div>
            )}
            <div className="info-note">
              <ShieldCheck size={16} />
              <span>
                파일명·경로·크기·수정일을 이 PC에 인덱싱합니다. 연결 폴더의
                변경을 자동으로 반영합니다. 파일 내용 검색은 포함하지 않습니다.
              </span>
            </div>
            {demo ? (
              <div className="folder-manager-empty">
                <Database size={32} />
                <h3>내 폴더를 연결해 시작하세요</h3>
                <p>현재 표시된 샘플은 실제 파일이 아닙니다.</p>
              </div>
            ) : (
              <div className="managed-roots">
                {roots.map((root) => (
                  <div className="managed-root" key={root.id}>
                    <span className="managed-folder-icon">
                      <Folder size={22} />
                    </span>
                    <div>
                      <strong title={root.absolutePath}>{root.name}</strong>
                      <p className="root-path">{root.absolutePath}</p>
                      {root.watchError && (
                        <p className="error-text">{root.watchError}</p>
                      )}
                      <p>
                        {root.count.toLocaleString()}개 항목 ·{" "}
                        {new Date(root.lastIndexed).toLocaleString("ko-KR")}
                        {root.skipped > 0 && (
                          <span className="error-text">
                            {" "}
                            · 제외 항목 {root.skipped}개
                          </span>
                        )}
                      </p>
                    </div>
                    <button
                      className="icon-button"
                      disabled={scanning}
                      title="로컬 폴더 다시 인덱싱"
                      aria-label={`${root.name} 다시 인덱싱`}
                      onClick={() => void indexRoot(root)}
                    >
                      <RefreshCw size={16} />
                    </button>
                    <button
                      className="icon-button disconnect"
                      disabled={scanning}
                      title="원본은 유지하고 연결만 해제"
                      aria-label={`${root.name} 연결 해제`}
                      onClick={() => void disconnect(root.id)}
                    >
                      <X size={17} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              className="button primary full-width"
              disabled={scanning || !ready}
              onClick={() => void connectFolder()}
            >
              {scanning ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <FolderPlus size={16} />
              )}
              {scanning ? "폴더를 인덱싱하고 있습니다" : "검색할 폴더 연결"}
            </button>
            <p className="modal-footnote">
              인덱스는 이 PC에 저장됩니다. 폴더 변경을 자동 감지하며 연결 해제는
              원본 파일에 영향을 주지 않습니다.
            </p>
          </div>
        </Modal>
      )}
      {modal === "settings" && (
        <Modal
          title="프로그램 설정"
          subtitle="검색, 자동 시작, 트레이와 단축키를 설정하세요."
          onClose={() => setModal(null)}
        >
          <div className="modal-content">
            <label className="setting-row">
              <span>
                <strong>기본 검색 방식</strong>
                <p>
                  초성 + 일반 검색은 ㅂㄱㅅ, 보고서, 영문 파일명을 함께
                  지원합니다.
                </p>
              </span>
              <select
                aria-label="기본 검색 방식"
                value={defaultMode}
                onChange={(event) => {
                  const next = event.target.value as SearchMode;
                  if (isDesktop)
                    void desktopControl(
                      "searchMode",
                      undefined,
                      undefined,
                      next,
                    )
                      .then((status) => {
                        setDesktop(status);
                        setDefaultMode(next);
                        setMode(next);
                      })
                      .catch((cause) => notify(String(cause), true));
                  else {
                    setDefaultMode(next);
                    setMode(next);
                  }
                }}
              >
                <option value="initials">초성 + 일반 검색 (기본)</option>
                <option value="normal">일반 · 포함 / AND</option>
                <option value="wildcard">와일드카드</option>
                <option value="regex">정규식</option>
                <option value="fuzzy">퍼지 · 오타 허용</option>
              </select>
            </label>
            <div className="settings-section-title">
              <Monitor size={16} />
              화면과 작업 환경
            </div>
            <label className="setting-row">
              <span>
                <strong>화면 테마</strong>
                <p>눈에 편한 색상을 선택하세요.</p>
              </span>
              <select
                aria-label="화면 테마"
                value={theme}
                onChange={(event) =>
                  setTheme(event.target.value as typeof theme)
                }
              >
                <option value="light">라이트</option>
                <option value="dark">다크</option>
                <option value="system">시스템 설정</option>
              </select>
            </label>
            <label className="setting-row">
              <span>
                <strong>파일 목록 밀도</strong>
                <p>많은 파일을 한 화면에 표시할 수 있습니다.</p>
              </span>
              <select
                aria-label="파일 목록 밀도"
                value={density}
                onChange={(event) =>
                  setDensity(event.target.value as typeof density)
                }
              >
                <option value="comfortable">기본 · 43px</option>
                <option value="compact">촘촘하게 · 34px</option>
              </select>
            </label>
            {isDesktop && (
              <>
                <div className="settings-section-title">
                  <PanelBottomClose size={16} />
                  트레이·백그라운드
                </div>
                <label className="setting-row">
                  <span>
                    <strong>컴퓨터 로그인 시 자동 시작</strong>
                    <p>
                      {desktop?.autoStartError
                        ? `등록 오류: ${desktop.autoStartError}`
                        : "Windows·macOS에 로그인하면 트레이에서 시작합니다. 기본값은 켜짐입니다."}
                    </p>
                  </span>
                  <input
                    className="toggle"
                    type="checkbox"
                    aria-label="컴퓨터 로그인 시 자동 시작"
                    checked={desktop?.autoStart ?? true}
                    onChange={(event) =>
                      void desktopControl("autoStart", event.target.checked)
                        .then(setDesktop)
                        .catch((cause) => notify(String(cause), true))
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>프로그램을 트레이에서 시작</strong>
                    <p>
                      직접 실행할 때도 메인 창을 숨깁니다. 연결 폴더가 없으면
                      설정 화면을 표시합니다.
                    </p>
                  </span>
                  <input
                    className="toggle"
                    type="checkbox"
                    aria-label="프로그램을 트레이에서 시작"
                    checked={desktop?.startInTray ?? false}
                    onChange={(event) =>
                      void desktopControl("startInTray", event.target.checked)
                        .then(setDesktop)
                        .catch((cause) => notify(String(cause), true))
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    <strong>창을 닫아도 계속 실행</strong>
                    <p>
                      트레이에서 다시 열 수 있으며 파일 변경 감시를 유지합니다.
                    </p>
                  </span>
                  <input
                    className="toggle"
                    type="checkbox"
                    aria-label="창을 닫아도 계속 실행"
                    checked={desktop?.keepRunning ?? true}
                    onChange={(event) =>
                      void desktopControl("background", event.target.checked)
                        .then(setDesktop)
                        .catch((cause) => notify(String(cause), true))
                    }
                  />
                </label>
                <div className="setting-row">
                  <span>
                    <strong>전역 검색 단축키</strong>
                    <p>
                      {desktop?.shortcutError
                        ? `등록하지 못했습니다: ${desktop.shortcutError}`
                        : "다른 앱을 사용 중에도 빠른 검색창을 엽니다. 입력란에서 원하는 키 조합을 누른 뒤 적용하세요."}
                    </p>
                  </span>
                  <div className="shortcut-editor">
                    <input
                      aria-label="전역 검색 단축키"
                      placeholder={shortcutLabel(
                        desktop?.shortcut ?? "CommandOrControl+Shift+Space",
                        /Mac/.test(navigator.platform),
                      )}
                      value={shortcutDraft}
                      readOnly
                      onKeyDown={(event) => {
                        if (event.key === "Tab") return;
                        event.preventDefault();
                        if (
                          event.nativeEvent.isComposing ||
                          event.key === "Escape" ||
                          ["Control", "Shift", "Alt", "Meta"].includes(
                            event.key,
                          )
                        )
                          return;
                        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
                          notify(
                            "Ctrl, Command, Alt 중 하나를 함께 눌러 주세요.",
                            true,
                          );
                          return;
                        }
                        const key =
                          event.code === "Space"
                            ? "Space"
                            : event.code.startsWith("Key")
                              ? event.code.slice(3)
                              : event.code.startsWith("Digit")
                                ? event.code.slice(5)
                                : event.code;
                        setShortcutDraft(
                          [
                            event.ctrlKey && "Control",
                            event.metaKey &&
                              (/Mac/.test(navigator.platform)
                                ? "Command"
                                : "Super"),
                            event.altKey && "Alt",
                            event.shiftKey && "Shift",
                            key,
                          ]
                            .filter(Boolean)
                            .join("+"),
                        );
                      }}
                    />
                    <button
                      disabled={!shortcutDraft || shortcutSaving}
                      onClick={() => {
                        setShortcutSaving(true);
                        void desktopControl(
                          "shortcut",
                          undefined,
                          shortcutDraft,
                        )
                          .then((status) => {
                            setDesktop(status);
                            setShortcutDraft("");
                            notify("검색 단축키를 변경했습니다.");
                          })
                          .catch((cause) => notify(String(cause), true))
                          .finally(() => setShortcutSaving(false));
                      }}
                    >
                      적용
                    </button>
                    <button
                      disabled={shortcutSaving}
                      onClick={() =>
                        setShortcutDraft("CommandOrControl+Shift+Space")
                      }
                    >
                      기본값
                    </button>
                  </div>
                </div>
                <div className="desktop-actions">
                  <button
                    className="button secondary"
                    onClick={() => void desktopControl("hide")}
                  >
                    <PanelBottomClose size={14} />
                    트레이로 숨기기
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => void desktopControl("quit")}
                  >
                    완전히 종료
                  </button>
                </div>
              </>
            )}
            <label className="setting-row">
              <span>
                <strong>전체 경로에서 검색</strong>
                <p>파일명과 함께 상위 폴더 경로도 검색합니다.</p>
              </span>
              <input
                type="checkbox"
                className="toggle"
                checked={fullPath}
                onChange={(e) => setFullPath(e.target.checked)}
              />
            </label>
            <div className="setting-row">
              <span>
                <strong>검색 인덱스</strong>
                <p>
                  {demo ? "샘플 공간" : `${roots.length}개 폴더`} ·{" "}
                  {count.toLocaleString()}개 항목
                </p>
              </span>
              <button
                className="button secondary small"
                onClick={() => setModal("folders")}
              >
                폴더 관리
                <ArrowUpRight size={12} />
              </button>
            </div>
            <AboutPanel />
            <div className="info-note">
              <Zap size={16} />
              <span>
                검색 목표는 인덱싱 완료 후 1초 이내입니다. 하단에서 검색 엔진
                시간과 전체 응답 시간을 확인할 수 있습니다.
              </span>
            </div>
            <div className="info-note">
              <HardDrive size={16} />
              <span>
                연결 폴더와 인덱스, 화면 배치는 이 컴퓨터에 저장됩니다. 파일
                변경 후 자동으로 인덱스를 갱신합니다.
              </span>
            </div>
          </div>
        </Modal>
      )}
      {(modal === "saveSearch" || modal === "saveWorkspace") && (
        <Modal
          title={modal === "saveSearch" ? "검색 조건 저장" : "작업 공간 저장"}
          subtitle={
            modal === "saveSearch"
              ? "검색어·검색 방식·필터를 함께 저장합니다"
              : "현재 창 개수·탭·폴더·배치를 함께 저장합니다"
          }
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              savePreset();
            }}
          >
            <div className="modal-content">
              <label className="field-label">
                이름
                <input
                  autoFocus
                  aria-label="저장할 이름"
                  maxLength={80}
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                />
              </label>
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setModal(null)}
              >
                취소
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={!presetName.trim()}
              >
                저장
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="더 빠르게, 더 편하게"
          subtitle="Every Directory 사용 안내"
          onClose={() => setModal(null)}
        >
          <div className="modal-content">
            <div className="help-intro">
              <span className="panel-icon">
                <Zap size={22} />
              </span>
              <div>
                <strong>검색에서 작업까지, 한 번에</strong>
                <p>
                  검색 결과 클릭 → 활성 탐색창에 위치 표시 · 더블 클릭 → 기본 앱
                  실행
                </p>
              </div>
            </div>
            <div className="shortcut-list">
              <div>
                <span>빠른 명령 검색</span>
                <kbd>⌘ / Ctrl + Shift + P</kbd>
              </div>
              <div>
                <span>검색창으로 이동</span>
                <kbd>⌘ / Ctrl + K</kbd>
              </div>
              <div>
                <span>활성 탐색창에 새 탭</span>
                <kbd>⌘ / Ctrl + T</kbd>
              </div>
              <div>
                <span>활성 탐색창 전환</span>
                <kbd>F6</kbd>
              </div>
              <div>
                <span>선택 항목 열기</span>
                <kbd>Enter</kbd>
              </div>
              <div>
                <span>대화상자 닫기 / 검색어 지우기</span>
                <kbd>Esc</kbd>
              </div>
            </div>
            <div className="help-search">
              <h3>검색 팁</h3>
              <p>
                <code>*보고서*.pdf</code> 와일드카드: *는 여러 글자, ?는 한
                글자입니다.
              </p>
              <p>
                <code>{"^보고서.*\\.pdf$"}</code> 정규식: 전후방 탐색과 역참조는
                제외합니다. 정규식 모드에서는 전체 입력을 패턴으로 해석합니다.
              </p>
              <p>
                <code>raedme</code> 퍼지: readme 같은 오타를 찾고 정확한 결과를
                먼저 보여 줍니다.
              </p>
              <p>
                <code>ㅂㄱㅅ</code> 초성: 보고서를 찾습니다.
              </p>
              <p>
                <code>기획서</code> 파일명에 포함된 글자를 검색합니다.
              </p>
              <p>
                <code>프로젝트 기획</code> 두 단어를 모두 포함한 파일을
                찾습니다.
              </p>
              <p>
                <code>ext:pdf,docx</code> 확장자를 지정할 수 있습니다.
              </p>
              {isDesktop && (
                <>
                  <p>
                    <code>보고서|계획 !초안 ext:pdf</code> OR와 제외를 함께
                    사용합니다. OR를 AND보다 먼저 계산하며{" "}
                    <code>{"<보고서 계획>|회의록"}</code>처럼 그룹을 지정할 수
                    있습니다.
                  </p>
                  <p>
                    <code>file: size:1mb..10mb dm:&gt;=2026-01-01</code> 파일
                    크기와 현지 수정일로 필터링합니다. <code>folder:</code>,{" "}
                    <code>path:문서</code>, <code>dm:today</code>,{" "}
                    <code>dm:yesterday</code>도 지원합니다.
                  </p>
                </>
              )}
              <p>
                검색 조건과 탐색창·탭 조합은 사이드바의 + 버튼으로 저장할 수
                있습니다. 파일을 더블클릭하면 기본 앱으로 열고 Space는
                미리보기를 엽니다.
              </p>
              <p>
                <code>Ctrl/⌘ C · X · V</code> 선택 항목 복사·잘라내기·현재
                탐색창에 붙여넣기
              </p>
              <p>
                <code>F2 · Delete · Space</code> 이름 변경·휴지통 이동·빠른
                미리보기
              </p>
              <p>
                <code>Ctrl/⌘ A · Shift 클릭</code> 전체 선택·범위 선택 (최대
                {isDesktop ? "200" : "500"}개 작업)
              </p>
              <p>
                <code>"업무 계획"</code> 띄어쓰기를 포함해 그대로 찾습니다.
              </p>
            </div>
            <div className="info-note">
              <LayoutPanelLeft size={17} />
              <span>
                경계선을 드래그하거나 방향키로 크기를 조절하세요. 레이아웃
                메뉴에서 검색 위치와 탐색창 배치를 바꿀 수 있습니다.
              </span>
            </div>
          </div>
        </Modal>
      )}
      {preview && roots.find((r) => r.id === preview.rootId) && (
        <Preview
          entry={preview}
          root={roots.find((r) => r.id === preview.rootId)!}
          onClose={() => setPreview(undefined)}
        />
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <CircleHelp size={17} /> : <CheckCheck size={17} />}
          <span>{toast.message}</span>
          <button
            className="icon-button"
            aria-label="알림 닫기"
            onClick={() => setToast(undefined)}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

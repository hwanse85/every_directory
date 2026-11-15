import {usePreferences,visibleFile} from "../preferences";
import {ClipboardHistory} from "./ClipboardHistory";
import {Highlight} from "./Highlight";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  AppWindow,
  Archive,
  Columns2,
  Copy,
  ExternalLink,
  Eye,
  Folder,
  Link,
  Pencil,
  Play,
  History,
  LoaderCircle,
  Search,
  Star,
  X,
} from "lucide-react";
import {
  copyFiles,
  IndexClient,
  quickAccess,
  quickControl,
  quickSearch,
  writeClipboard,
  desktopControl,
  isDesktop,
  openWith,
  userAction,
  zipToClipboard,
} from "../client";
import { QuickPreview } from "./QuickPreview";
import { calculate, formatResult } from "../calculator";
import { filenameFilter } from "../search";
import {
  isComposingKey,
  pathQueryMode,
  pathCandidates,
  pathSearchText,
  quickSearchMode,
  isClipboardKeyword,
} from "../quickSearch";
import { useSearchInput } from "../useSearchInput";
import { SearchTextInput } from "./SearchTextInput";
import { categoryOf } from "../search";
import { readPreference } from "../storage";
import { locationLabel } from "../paths";
import type {
  ConnectedRoot,
  FileCategory,
  FileEntry,
  Location,
  QuickAccess,
  QuickSuggestions,
  SearchMode,
} from "../types";
import { FileIcon } from "./FileIcon";
import { fileDragErrorEvent, startFileDrag } from "../fileDrag";
import "../quick-search.css";

type Action =
  | "open" | "reveal" | "main" | "copy" | "path" | "destination" | "favorite"
  | "preview" | "openWith" | "formats" | "zip" | "split" | "rename" | `user:${number}`;
// 작업 메뉴에서 고르는 하위 목록(열 앱, 경로 형식)
type Choices = { title: string; items: { label: string; detail?: string; value: string }[]; choose: (value: string, label: string) => Promise<void> };
// 빠른 검색에 함께 보여 주는 설치된 앱
type QuickApp = { name: string; stem: string; path: string };
// 파일 결과 위에 놓는 특별한 줄: 클립보드 보기, 계산 결과, 앱
type Special = { kind: "clipboard" } | { kind: "calc"; value: number } | { kind: "app"; app: QuickApp };
// 검색어가 바뀌면 맨 위 줄을 고르도록 쓰는 값(특별한 줄이 있으면 첫 특별한 줄, 없으면 첫 파일)
const TOP = -1000;
// 처음 실행하는 사용자 동작의 확인 내용
type Confirm = { index: number; name: string; program: string; args: string[]; target: FileEntry };
// 빠른 검색에서 한 번에 보여 줄 결과 수. 창에 10개 남짓 보이고 나머지는 목록을 내려 본다.
const quickLimit = 30;
const emptyAccess: QuickAccess = {
  initialized: false,
  favorites: [],
  opened: [],
  recent: [],
};

// 검색 결과에서 바로 파일 작업을 실행하는 독립 검색창이다.
export default function QuickSearch() {
  const {preferences}=usePreferences();
  const client = useMemo(() => new IndexClient(false), []);
  const [query, setQuery] = useState("");
  const clipboardTrigger=isClipboardKeyword(query,preferences.clipboardKeyword);
  const [defaultMode, setDefaultMode] = useState<SearchMode>("initials");
  const [roots, setRoots] = useState<ConnectedRoot[]>([]);
  const [scope, setScope] = useState("");
  const [category, setCategory] = useState<FileCategory>("all");
  const [access, setAccess] = useState<QuickAccess>(emptyAccess);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<"results" | "actions" | "destination" | "clipboard" | "choices" | "rename" | "confirm" | "preview">(
    "results",
  );
  const [choices, setChoices] = useState<Choices>();
  const [choiceIndex, setChoiceIndex] = useState(0);
  const [renameValue, setRenameValue] = useState("");
  const [confirm, setConfirm] = useState<Confirm>();
  const [actionIndex, setActionIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [partial, setPartial] = useState(false);
  // 한/영 자판을 바꿔 찾았을 때의 검색어와, 보정 없이 그대로 찾기로 한 검색어
  const [corrected, setCorrected] = useState<string>();
  const [literalQuery, setLiteralQuery] = useState("");
  const highlightQuery = preferences.highlightMatches ? corrected ?? query : "";
  const [revision, setRevision] = useState(0);
  const [destination, setDestination] = useState<Location>();
  // 경로 입력이 실제 위치와 일치한 항목. Enter로 Every Directory 탐색창에서 그 위치를 연다.
  const [pathMatch, setPathMatch] = useState<string>();
  const pathInput = !!pathQueryMode(query, defaultMode);
  const [directories, setDirectories] = useState<FileEntry[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const searchEditing = useSearchInput(text => quickSearchMode(text,defaultMode), text=>{
    requestVersion.current+=1;
    selectedId.current=undefined;
    setQuery(text);
    setSelected(TOP);
  });
  const composing = searchEditing.composing;
  const busyRef = useRef(false);
  const requestVersion = useRef(0);
  const previousSearch = useRef("");
  const selectedId = useRef<string | undefined>(undefined);
  const mac = /Mac/.test(navigator.platform);
  const modifier = mac ? "⌘" : "Ctrl";
  const [apps, setApps] = useState<QuickApp[]>([]);
  const calcValue = preferences.quickCalculator ? calculate(query) : undefined;
  const matchedApps = useMemo(() => {
    if (!preferences.quickApps || !query.trim() || pathInput) return [];
    const matches = filenameFilter(query);
    return apps.filter((app) => matches(app.name) || matches(app.stem)).slice(0, 4);
  }, [apps, query, pathInput, preferences.quickApps]);
  const specials: Special[] = [
    ...(clipboardTrigger ? [{ kind: "clipboard" } as const] : []),
    ...(calcValue !== undefined ? [{ kind: "calc", value: calcValue } as const] : []),
    ...matchedApps.map((app) => ({ kind: "app", app }) as const),
  ];
  const specialCount = specials.length;
  // 실제로 고른 줄: 음수는 특별한 줄(-specialCount..-1), 0 이상은 파일 결과
  const current = specialCount
    ? Math.max(-specialCount, Math.min(selected, entries.length - 1))
    : Math.max(0, Math.min(selected, entries.length - 1));
  const entry = current >= 0 ? entries[current] : undefined;
  const special = current < 0 ? specials[current + specialCount] : undefined;
  const rowId = (index: number) => (index >= 0 ? `quick-result-${index}` : specials[index + specialCount]?.kind === "clipboard" ? "quick-clipboard-trigger" : `quick-special-${index + specialCount}`);
  const isFavorite =
    !!entry &&
    access.favorites.some(
      (f) => f.rootId === entry.rootId && f.path === entry.path,
    );
  const actions: { id: Action; title: string; key?: string }[] = [
    {
      id: "open",
      title: entry?.kind === "directory" ? "폴더 열기" : "기본 앱으로 열기",
      key: "Enter",
    },
    {
      id: "reveal",
      title: mac ? "Finder에서 보기" : "탐색기에서 보기",
      key: `${modifier}+Enter`,
    },
    { id: "preview", title: "미리보기", key: `${modifier}+Y` },
    { id: "openWith", title: mac ? "다른 앱으로 열기…" : "연결 프로그램 선택…" },
    { id: "copy", title: "파일·폴더 복사", key: `${modifier}+C` },
    { id: "path", title: "전체 경로 복사", key: `${modifier}+Shift+C` },
    { id: "formats", title: "경로 형식 복사…" },
    { id: "zip", title: "압축해서 보내기 (ZIP을 클립보드에)" },
    { id: "destination", title: "다른 폴더로 복사…" },
    { id: "main", title: "Every Directory에서 위치 열기" },
    { id: "split", title: "탐색창 두 곳에 나란히 열기" },
    { id: "rename", title: "이름 바꾸기…", key: "F2" },
    { id: "favorite", title: isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가" },
    ...preferences.userActions.map((action, index) => ({ id: `user:${index}` as Action, title: action.name })),
  ];

  // 저장된 테마를 두 창에서 같은 기준으로 적용한다.
  const applyTheme = useCallback(() => {
    const theme = readPreference<string>("theme", "light");
    document.documentElement.dataset.theme =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
  }, []);

  // 검색창 호출 때 새 기록을 읽고 검색 입력에 초점을 준다.
  const refresh = useCallback(async () => {
    applyTheme();
    const settings = await desktopControl();
    setDefaultMode(settings.defaultSearchMode);
    setView("results");
    setError("");
    setMessage("");
    setRevision((n) => n + 1);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  }, [applyTheme]);

  useEffect(() => {
    document.documentElement.classList.add("quick-window");
    let disposed = false;
    const removers: (() => void)[] = [];
    // 비동기 이벤트 등록 중 창이 해제되어도 리스너를 남기지 않는다.
    async function connect() {
      const show = await listen("ed-quick-show", () => {
        void refresh();
      });
      if (disposed) show();
      else removers.push(show);
      const changed = await listen<QuickAccess>("ed-quick-changed", (event) => {
        setAccess(event.payload);
        setRevision((n) => n + 1);
      });
      if (disposed) changed();
      else removers.push(changed);
      await refresh();
    }
    void connect().catch((cause) => setError(String(cause)));
    return () => {
      disposed = true;
      removers.forEach((remove) => remove());
      client.dispose();
      document.documentElement.classList.remove("quick-window");
    };
  }, [client, refresh]);

  useEffect(() => {
    const file = current >= 0 ? entries[current] : undefined;
    if (file) selectedId.current = file.id;
  }, [entries, current]);

  // 앱 표시를 켰으면 설치된 앱 목록을 읽는다(검색창을 열 때마다 새로 읽음).
  useEffect(() => {
    if (!preferences.quickApps) {
      setApps([]);
      return;
    }
    void client.request<QuickApp[]>("apps").then(setApps).catch(() => setApps([]));
  }, [client, preferences.quickApps, revision]);

  // 다른 앱으로 끌기를 시작하지 못한 이유를 검색창 아래에 표시한다.
  useEffect(() => {
    const failed = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener(fileDragErrorEvent, failed);
    return () => window.removeEventListener(fileDragErrorEvent, failed);
  }, []);

  // 클립보드 이력은 여러 항목과 미리보기를 함께 보도록 창을 넓히고, 돌아오면 원래 크기로 되돌린다.
  const clipboardView = view === "clipboard";
  useEffect(() => {
    void quickControl(clipboardView ? "expand" : "restore").catch(() => undefined);
  }, [clipboardView]);

  // 검색어·범위·클립보드 키워드 일치가 바뀌거나, 검색 결과에 영향을 주는 설정이 바뀔 때만 다시 검색한다(다른 설정 변경으로 고른 줄이 바뀌지 않게).
  useEffect(() => {
    const version = ++requestVersion.current;
    const searchKey = JSON.stringify([query, scope, category,clipboardTrigger]);
    if (previousSearch.current !== searchKey) {
      previousSearch.current = searchKey;
      selectedId.current = undefined;
      setSelected(TOP);
      setEntries([]);
    }
    setError("");
    setPartial(false);
    setCorrected(undefined);
    setSearching(true);
    // 기록 변경으로 순위가 갱신되어도 사용자가 선택한 파일을 유지한다.
    function applyEntries(next: FileEntry[]) {
      setSelected((previous) =>
        previous < 0 && !selectedId.current
          ? previous
          : Math.max(0, next.findIndex((file) => file.id === selectedId.current)),
      );
      setEntries(next);
    }
    const timer = setTimeout(
      () => {
        // 입력 전에는 저장된 위치를 현재 인덱스에서 복원한다.
        async function search() {
          try {
            const suggestions =
              await client.request<QuickSuggestions>("quickSuggestions");
            if (version !== requestVersion.current) return;
            setRoots(suggestions.roots);
            setAccess(suggestions.access);
            if (suggestions.warning) setError(suggestions.warning);
            if (!query.trim()) {
              setPathMatch(undefined);
              applyEntries(
                suggestions.entries.filter(
                  (e) =>
                    visibleFile(e,preferences) &&
                    (!scope || e.rootId === scope) &&
                    (category === "all" || categoryOf(e) === category),
                ),
              );
              return;
            }
            // 경로를 입력하면 연결 폴더 안의 실제 위치를 먼저 찾고, 그 아래 항목을 경로 검색으로 보여 준다.
            let located: FileEntry | undefined;
            const pathMode = pathQueryMode(query, defaultMode);
            if (pathMode) {
              for (const location of pathCandidates(query, suggestions.roots, scope)) {
                try {
                  located = await client.request<FileEntry>("quickEntry", location);
                  break;
                } catch {
                  // 다음 후보를 확인한다.
                }
              }
              if (version !== requestVersion.current) return;
            }
            const text = pathMode ? pathSearchText(query, suggestions.roots, scope) : query;
            const result = text
              ? await quickSearch({
                  query: text,
                  mode: pathMode ?? quickSearchMode(query, defaultMode),
                  rootId: scope,
                  category,
                  fullPath: !!pathMode || preferences.quickFullPath,
                  limit: quickLimit,
                  noCorrect: literalQuery === query,
                })
              : { entries: [], total: 0, elapsed: 0 };
            if (version !== requestVersion.current) return;
            setPathMatch(located?.id);
            applyEntries(located ? [located, ...result.entries.filter((file) => file.id !== located.id)].slice(0, quickLimit) : result.entries);
            setPartial(!!result.partial);
            setCorrected(result.corrected);
          } catch (cause) {
            if (version === requestVersion.current) {
              setError(String(cause));
              setPathMatch(undefined);
              setEntries([]);
            }
          } finally {
            if (version === requestVersion.current) setSearching(false);
          }
        }
        void search();
      },
      query.trim() ? 70 : 0,
    );
    return () => {
      clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [client, query, scope, category, revision, defaultMode, clipboardTrigger, literalQuery, preferences.quickFullPath, preferences.showHidden, preferences.showTemporary, preferences.showRecycleBin]);

  useEffect(() => {
    document
      .getElementById(rowId(current))
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, entries]);

  // 성공한 작업만 최근 검색과 사용 기록에 반영한다.
  async function record(target: FileEntry) {
    await quickAccess("opened", {
      location: { rootId: target.rootId, path: target.path },
      query,
      learn: preferences.learnRanking,
    });
  }

  // 대상 항목을 고정해 비동기 처리 중 선택 변경과 중복 실행을 막는다.
  async function run(action: Action) {
    if (!entry || searching || busyRef.current) return;
    const target = entry;
    const location = { rootId: target.rootId, path: target.path };
    busyRef.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (action === "favorite") {
        setAccess(await quickAccess("favorite", { location }));
        setView("results");
        setMessage(
          isFavorite
            ? "즐겨찾기에서 제거했습니다."
            : "즐겨찾기에 추가했습니다.",
        );
      } else if (action === "preview") {
        setView("preview");
      } else if (action === "openWith") {
        if (mac) {
          const apps = await client.request<{ name: string; path: string; default: boolean }[]>("openWithApps", location);
          if (!apps.length) throw new Error("이 파일을 열 수 있는 앱을 찾지 못했습니다.");
          openChoices({
            title: `‘${target.name}’을(를) 열 앱`,
            items: apps.map((app) => ({ label: app.default ? `${app.name} (기본 앱)` : app.name, detail: app.path, value: app.path })),
            choose: async (app) => {
              await openWith(location, app);
              await record(target);
              await quickControl("hide");
            },
          });
        } else {
          // Windows는 운영체제 ‘연결 프로그램’ 창을 띄운다. 창이 떠 있는 동안 검색창을 숨기지 않는다.
          await quickControl("dialogStart");
          try {
            await openWith(location);
          } finally {
            await quickControl("dialogEnd");
          }
          await record(target);
        }
      } else if (action === "formats") {
        const formats = await client.request<{ plain: string; quoted: string; url: string; network?: string; relative: string }>("quickPathFormats", location);
        const items = [
          { label: "전체 경로", detail: formats.plain, value: formats.plain },
          { label: "따옴표로 감싼 경로", detail: formats.quoted, value: formats.quoted },
          { label: "file:// 주소", detail: formats.url, value: formats.url },
          ...(formats.network ? [{ label: mac ? "서버 주소(smb:// 등)" : "네트워크 경로(UNC)", detail: formats.network, value: formats.network }] : []),
          { label: "연결 폴더 기준 경로", detail: formats.relative, value: formats.relative },
        ];
        openChoices({
          title: "복사할 경로 형식",
          items,
          choose: async (value, label) => {
            await writeClipboard(value);
            setView("results");
            setMessage(`${label}을(를) 복사했습니다.`);
            await quickAccess("query", { query });
          },
        });
      } else if (action === "zip") {
        const name = await zipToClipboard([location]);
        setView("results");
        setMessage(`‘${name}’을(를) 복사했습니다. 메일·메신저 창에 붙여넣어 보내세요.`);
        await record(target);
      } else if (action === "split") {
        await quickControl("revealSplit", location);
        await record(target);
      } else if (action === "rename") {
        setRenameValue(target.name);
        setView("rename");
      } else if (action.startsWith("user:")) {
        const index = Number(action.slice(5));
        const result = await userAction(index, location);
        if (result.confirm) {
          setConfirm({ index, name: preferences.userActions[index]?.name ?? "", program: result.program ?? "", args: result.args ?? [], target });
          setView("confirm");
        } else {
          setView("results");
          setMessage(`‘${preferences.userActions[index]?.name}’을(를) 실행했습니다.`);
          await record(target);
        }
      } else if (action === "destination") {
        setView("destination");
        setDestination(undefined);
        setDirectories([]);
      } else if (action === "copy") {
        await copyFiles([location]);
        setMessage(
          `${target.name} 복사됨 · ${mac ? "Finder에서 ⌘V" : "탐색기에서 Ctrl+V"}로 붙여넣으세요.`,
        );
        setView("results");
        await record(target);
      } else if (action === "path") {
        const path = await client.request<string>("quickPath", location);
        await writeClipboard(path);
        setView("results");
        setMessage("전체 경로를 복사했습니다.");
        await quickAccess("query", { query });
      } else if (action === "main") {
        await quickControl("reveal", location);
        await record(target);
      } else {
        await client.request("operation", { action, entries: [location] });
        // 열기 성공과 기록 저장 실패를 구분해서 안내한다.
        try {
          await record(target);
        } catch (cause) {
          setError(
            `열기는 완료했지만 기록을 저장하지 못했습니다: ${String(cause)}`,
          );
          return;
        }
        await quickControl("hide");
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
      input.current?.focus();
    }
  }

  // 특별한 줄을 실행한다: 클립보드 보기, 계산 결과 복사, 앱 실행
  async function runSpecial(item: Special) {
    if (busyRef.current) return;
    setError("");
    setMessage("");
    try {
      if (item.kind === "clipboard") setView("clipboard");
      else if (item.kind === "calc") {
        await writeClipboard(String(Math.round(item.value * 1e12) / 1e12));
        setMessage(`계산 결과 ${formatResult(item.value)}을(를) 복사했습니다.`);
      } else {
        await client.request("launchApp", { path: item.app.path });
        await quickControl("hide");
      }
    } catch (cause) {
      setError(String(cause));
    }
  }

  // 하위 선택 목록(열 앱, 경로 형식)을 연다.
  function openChoices(next: Choices) {
    setChoices(next);
    setChoiceIndex(0);
    setView("choices");
  }

  // 하위 목록에서 고른 값을 실행한다.
  async function choose(index: number) {
    const item = choices?.items[index];
    if (!choices || !item || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await choices.choose(item.value, item.label);
    } catch (cause) {
      setError(String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
      input.current?.focus();
    }
  }

  // 입력한 새 이름을 적용하고 결과를 다시 찾는다.
  async function applyRename() {
    const name = renameValue.trim();
    if (!entry || !name || busyRef.current) return;
    if (name === entry.name) {
      setView("results");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await client.request("operation", { action: "rename", entries: [{ rootId: entry.rootId, path: entry.path }], name });
      setView("results");
      setMessage(`‘${name}’(으)로 이름을 바꿨습니다.`);
      setRevision((n) => n + 1);
    } catch (cause) {
      setError(String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
      input.current?.focus();
    }
  }

  // 확인한 사용자 동작을 실행한다.
  async function runConfirmed() {
    if (!confirm || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await userAction(confirm.index, { rootId: confirm.target.rootId, path: confirm.target.path }, true);
      setView("results");
      setMessage(`‘${confirm.name}’을(를) 실행했습니다.`);
      await record(confirm.target);
    } catch (cause) {
      setError(String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setConfirm(undefined);
      input.current?.focus();
    }
  }

  // 연결한 폴더 안에서 복사 대상을 선택한다.
  async function browse(location: Location) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const listing = await client.request<FileEntry[]>("list", location);
      setDirectories(listing.filter((e) => e.kind === "directory"));
      setDestination(location);
    } catch (cause) {
      setError(String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // 선택한 폴더에 사본을 만들고 충돌은 기존 엔진의 검증 결과로 알린다.
  async function copyToDestination() {
    if (!entry || !destination || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await client.request("operation", {
        action: "copy",
        entries: [{ rootId: entry.rootId, path: entry.path }],
        destination,
      });
      setView("results");
      setMessage("선택한 폴더에 복사했습니다.");
      await record(entry);
    } catch (cause) {
      setError(String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
      input.current?.focus();
    }
  }

  // 검색어 편집 단축키를 보존하고 결과 탐색 키만 처리한다.
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (isComposingKey(event.nativeEvent, composing.current)||view==="clipboard") return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (busyRef.current) return;
      if (view !== "results") {
        setView("results");
        input.current?.focus();
      } else
        void quickControl("dismiss").catch((cause) => setError(String(cause)));
      return;
    }
    if (
      view === "destination" ||
      view === "rename" ||
      view === "confirm" ||
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLButtonElement
    )
      return;
    // 하위 선택 목록: ↑↓로 고르고 Enter로 실행한다.
    if (view === "choices" && choices) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setChoiceIndex((n) => (n + delta + choices.items.length) % choices.items.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        void choose(choiceIndex);
      }
      return;
    }
    // Ctrl/⌘+Y로 미리보기를 켜고 끈다.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y" && entry) {
      event.preventDefault();
      setView(view === "preview" ? "results" : "preview");
      return;
    }
    if (event.key === "F2" && entry && (view === "results" || view === "preview")) {
      event.preventDefault();
      void run("rename");
      return;
    }
    if (event.key === "Tab" && entry && !event.shiftKey && view === "results") {
      event.preventDefault();
      input.current?.setSelectionRange(query.length, query.length);
      setActionIndex(0);
      setView("actions");
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      input.current?.setSelectionRange(query.length, query.length);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      if (view === "actions")
        setActionIndex((n) => (n + delta + actions.length) % actions.length);
      else if (view === "preview" && entries.length)
        setSelected((n) => (n + delta + entries.length) % entries.length);
      else {
        const total = specialCount + entries.length;
        if (total) setSelected(((current + specialCount + delta + total) % total) - specialCount);
      }
    } else if (event.key === "Enter" && special && view === "results") {
      event.preventDefault();
      void runSpecial(special);
    } else if (event.key === "Enter" && entry) {
      event.preventDefault();
      void run(
        view === "actions"
          ? actions[actionIndex].id
          : event.metaKey || event.ctrlKey
            ? "reveal"
            : entry.id === pathMatch
              ? "main"
              : "open",
      );
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "c" &&
      entry
    ) {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.selectionStart !== event.target.selectionEnd
      )
        return;
      event.preventDefault();
      void run(event.shiftKey ? "path" : "copy");
    }
  }

  return (
    <main className={`quick-shell ${clipboardView ? "quick-clipboard" : ""}`} onKeyDown={handleKey}>
      <header className="quick-header" data-tauri-drag-region>
        <span data-tauri-drag-region>
          <Search size={15} /> Every Directory <small>빠른 검색</small>
        </span>
        <div>
          <button
            aria-label="메인 탐색창 열기"
            title="메인 탐색창 열기"
            onClick={() => void quickControl("main")}
          >
            <ExternalLink size={15} />
          </button>
          <button
            aria-label="검색창 숨기기"
            onClick={() => void quickControl("dismiss")}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="quick-input-row">
        <Search size={21} />
        <SearchTextInput
          ref={input}
          preview={searchEditing.preview}
          autoFocus
          role="combobox"
          aria-label="파일·폴더 빠른 검색"
          aria-controls="quick-results"
          aria-expanded={view === "results"}
          aria-activedescendant={
            view === "results" && (special || entry) ? rowId(current) : undefined
          }
          placeholder="파일이나 폴더 이름을 입력하세요"
          maxLength={512}
          value={query}
          onCompositionStart={searchEditing.onCompositionStart}
          onCompositionEnd={searchEditing.onCompositionEnd}
          onChange={(event) => {
            searchEditing.onChange(event);
            setView("results");
            setMessage("");
          }}
        />
        {searching || busy ? (
          <LoaderCircle className="spin" size={19} />
        ) : (
          query && (
            <button
              aria-label="검색어 지우기"
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
            >
              <X size={17} />
            </button>
          )
        )}
      </div>
      <div className="quick-filters" hidden={clipboardView}>
        <select
          aria-label="빠른 검색 범위"
          value={scope}
          onChange={(event) => setScope(event.target.value)}
        >
          <option value="">모든 연결 폴더</option>
          {roots.map((root) => (
            <option key={root.id} value={root.id}>
              {root.name}
            </option>
          ))}
        </select>
        <select
          aria-label="빠른 검색 파일 종류"
          value={category}
          onChange={(event) => setCategory(event.target.value as FileCategory)}
        >
          <option value="all">모든 종류</option>
          <option value="document">문서</option>
          <option value="folder">폴더</option>
          <option value="image">이미지</option>
          <option value="code">코드</option>
          <option value="archive">압축</option>
        </select>
        <span>
          {quickSearchMode(query, defaultMode) === "initials"
            ? "초성 + 일반 검색"
            : "이름 검색"}
        </span>
      </div>
      {view === "results" && !query && access.recent.length > 0 && (
        <div className="quick-history">
          <History size={13} />
          {access.recent.slice(0, 5).map((recent) => (
            <button
              key={recent}
              onClick={() => {
                setQuery(recent);
                input.current?.focus();
              }}
            >
              {recent}
            </button>
          ))}
          <button
            aria-label="최근 기록 지우기"
            title="최근 검색과 열기 기록 지우기"
            onClick={() =>
              void quickAccess("clearRecent").catch((cause) =>
                setError(String(cause)),
              )
            }
          >
            <X size={12} />
          </button>
        </div>
      )}
      <section className="quick-content">
        {view === "clipboard" ? <ClipboardHistory compact onClose={()=>{setView("results");input.current?.focus();}}/> : view === "destination" ? (
          <>
            <div className="quick-section-title">
              <button onClick={() => setView("actions")}>
                <ArrowLeft size={14} /> 뒤로
              </button>
              <strong>‘{entry?.name}’ 복사할 폴더</strong>
            </div>
            <p className="quick-destination-path">
              {destination
                ? locationLabel(
                    roots.find((r) => r.id === destination.rootId),
                    destination.path,
                  )
                : "연결 폴더를 선택하세요"}
            </p>
            <div className="quick-destinations">
              {destination ? (
                <>
                  <button
                    onClick={() =>
                      destination.path
                        ? void browse({
                            ...destination,
                            path: destination.path
                              .split("/")
                              .slice(0, -1)
                              .join("/"),
                          })
                        : setDestination(undefined)
                    }
                  >
                    <ArrowUp size={16} />
                    상위 폴더
                  </button>
                  {directories.map((directory) => (
                    <button
                      key={directory.id}
                      onClick={() =>
                        void browse({
                          rootId: directory.rootId,
                          path: directory.path,
                        })
                      }
                    >
                      <Folder size={16} />
                      {directory.name}
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </>
              ) : (
                roots.map((root) => (
                  <button
                    key={root.id}
                    onClick={() => void browse({ rootId: root.id, path: "" })}
                  >
                    <Folder size={16} />
                    {root.name}
                    <ChevronRight size={14} />
                  </button>
                ))
              )}
            </div>
            <div className="quick-copy-confirm">
              <span>같은 이름이 있으면 덮어쓰지 않습니다.</span>
              <button
                disabled={!destination || busy}
                onClick={() => void copyToDestination()}
              >
                <Copy size={14} /> 이 폴더에 복사
              </button>
            </div>
          </>
        ) : view === "choices" && choices ? (
          <>
            <div className="quick-section-title">
              <button onClick={() => setView("actions")}>
                <ArrowLeft size={14} /> 작업
              </button>
              <strong>{choices.title}</strong>
            </div>
            <div className="quick-actions" role="menu" aria-label={choices.title}>
              {choices.items.map((item, index) => (
                <button
                  role="menuitem"
                  key={item.label + item.value}
                  className={index === choiceIndex ? "active" : ""}
                  disabled={busy}
                  onMouseMove={(event) => {
                    if (event.movementX || event.movementY) setChoiceIndex(index);
                  }}
                  onClick={() => void choose(index)}
                >
                  <ChevronRight size={16} />
                  <span>{item.label}</span>
                  {item.detail && <small className="quick-choice-detail" title={item.detail}>{item.detail}</small>}
                </button>
              ))}
            </div>
          </>
        ) : view === "rename" && entry ? (
          <>
            <div className="quick-section-title">
              <button onClick={() => setView("actions")}>
                <ArrowLeft size={14} /> 작업
              </button>
              <strong title={entry.name}>‘{entry.name}’ 이름 바꾸기</strong>
            </div>
            <form className="quick-rename" onSubmit={(event) => { event.preventDefault(); void applyRename(); }}>
              <input
                aria-label="새 이름"
                autoFocus
                maxLength={255}
                value={renameValue}
                onFocus={(event) => {
                  // 확장자 앞까지만 골라 이름만 바로 고치게 한다.
                  const dot = entry.kind === "file" ? event.target.value.lastIndexOf(".") : -1;
                  event.target.setSelectionRange(0, dot > 0 ? dot : event.target.value.length);
                }}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setView("results");
                    input.current?.focus();
                  }
                }}
              />
              <button className="button primary small" disabled={busy || !renameValue.trim()}>바꾸기</button>
            </form>
          </>
        ) : view === "confirm" && confirm ? (
          <div className="quick-confirm" role="alertdialog" aria-label="사용자 동작 실행 확인">
            <strong>‘{confirm.name}’을(를) 처음 실행합니다. 아래 명령이 맞는지 확인하세요.</strong>
            <pre>{[confirm.program, ...confirm.args.map((arg) => (/[\s"']/.test(arg) ? JSON.stringify(arg) : arg))].join(" ")}</pre>
            <p>셸을 거치지 않고 프로그램에 인자를 그대로 넘깁니다. 한 번 확인하면 프로그램·인자 틀이 바뀔 때까지 다시 묻지 않습니다.</p>
            <div>
              <button className="button secondary small" onClick={() => { setConfirm(undefined); setView("results"); input.current?.focus(); }}>취소</button>
              <button className="button primary small" autoFocus disabled={busy} onClick={() => void runConfirmed()}>실행</button>
            </div>
          </div>
        ) : view === "preview" && entry ? (
          <QuickPreview entry={entry} />
        ) : view === "actions" && entry ? (
          <>
            <div className="quick-section-title">
              <button onClick={() => setView("results")}>
                <ArrowLeft size={14} /> 검색 결과
              </button>
              <strong title={entry.name}>{entry.name}</strong>
            </div>
            <div
              className="quick-actions"
              role="menu"
              aria-label="선택 항목 작업"
            >
              {actions.map((action, index) => (
                <button
                  role="menuitem"
                  key={action.id}
                  className={index === actionIndex ? "active" : ""}
                  disabled={busy}
                  onMouseMove={(event) => {
                    if (event.movementX || event.movementY)
                      setActionIndex(index);
                  }}
                  onClick={() => void run(action.id)}
                >
                  {action.id === "favorite" ? (
                    <Star size={16} />
                  ) : action.id === "copy" || action.id === "path" ? (
                    <Copy size={16} />
                  ) : action.id === "preview" ? (
                    <Eye size={16} />
                  ) : action.id === "openWith" ? (
                    <AppWindow size={16} />
                  ) : action.id === "formats" ? (
                    <Link size={16} />
                  ) : action.id === "zip" ? (
                    <Archive size={16} />
                  ) : action.id === "split" ? (
                    <Columns2 size={16} />
                  ) : action.id === "rename" ? (
                    <Pencil size={16} />
                  ) : action.id.startsWith("user:") ? (
                    <Play size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                  <span>{action.title}</span>
                  {action.key && <kbd>{action.key}</kbd>}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {corrected && (
              <div className="quick-corrected" role="status">
                <span>‘{corrected}’(으)로 찾은 결과</span>
                <button onClick={() => { setLiteralQuery(query); input.current?.focus(); }}>‘{query}’ 그대로 찾기</button>
              </div>
            )}
            <div className="quick-section-title">
              <span>{query ? "검색 결과" : "즐겨찾기 · 최근 사용 항목"}</span>
              <span>
                {partial
                  ? "일부 결과 · 검색어를 구체화하세요"
                  : `${entries.length}개`}
              </span>
            </div>
            <div
              id="quick-results"
              role="listbox"
              aria-label="빠른 검색 결과"
              className="quick-results"
              aria-busy={searching}
            >
              {specials.map((item, position) => {
                const index = position - specialCount;
                const active = index === current;
                return item.kind === "clipboard" ? (
                  <button id="quick-clipboard-trigger" key="clipboard" role="option" aria-selected={active} className={`quick-result clipboard-trigger ${active ? "active" : ""}`} onClick={() => setView("clipboard")}>클립보드 보기 <small>최신 순 이력 · Enter</small></button>
                ) : (
                  <button
                    id={`quick-special-${position}`}
                    key={item.kind === "app" ? item.app.path : "calc"}
                    role="option"
                    aria-selected={active}
                    className={`quick-result quick-special ${item.kind} ${active ? "active" : ""}`}
                    onMouseMove={(event) => { if (event.movementX || event.movementY) setSelected(index); }}
                    onClick={() => void runSpecial(item)}
                  >
                    {item.kind === "calc" ? (
                      <>
                        <span className="quick-special-icon">=</span>
                        <strong>{formatResult(item.value)}</strong>
                        <small>계산 결과 · Enter로 복사</small>
                      </>
                    ) : (
                      <>
                        <AppWindow size={18} />
                        <strong>{item.app.name}</strong>
                        <small>앱 · Enter로 실행</small>
                      </>
                    )}
                  </button>
                );
              })}
              {entries.map((file, index) => (
                <div
                  id={`quick-result-${index}`}
                  role="option"
                  aria-selected={index === current}
                  key={file.id}
                  className={`quick-result ${index === current ? "active" : ""}`}
                  onMouseMove={(event) => {
                    if (!busy && (event.movementX || event.movementY))
                      setSelected(index);
                  }}
                  onClick={() => {
                    setSelected(index);
                    input.current?.focus();
                    input.current?.setSelectionRange(
                      query.length,
                      query.length,
                    );
                  }}
                  onDoubleClick={() => void run("open")}
                  onPointerDown={isDesktop ? (event) => startFileDrag(event, [{ rootId: file.rootId, path: file.path }], { immediate: true }) : undefined}
                >
                  <FileIcon entry={file} pixels={20} />
                  <div className="quick-result-text">
                    <strong title={file.name}><Highlight text={file.name} query={highlightQuery} mode={quickSearchMode(query,defaultMode)}/></strong>
                    <span
                      title={locationLabel(
                        roots.find((r) => r.id === file.rootId),
                        file.parent,
                      )}
                    >
                      <Highlight text={locationLabel(roots.find(r=>r.id===file.rootId),file.parent)} query={highlightQuery} mode={quickSearchMode(query,defaultMode)} field="path"/>
                    </span>
                  </div>
                  {access.favorites.some(
                    (f) => f.rootId === file.rootId && f.path === file.path,
                  ) && (
                    <Star
                      className="quick-star"
                      size={13}
                      fill="currentColor"
                    />
                  )}
                  {file.id === pathMatch && <small className="path-match">경로 일치 · Enter 이동</small>}
                  <small>
                    {file.kind === "directory"
                      ? "폴더"
                      : file.extension.toUpperCase()}
                  </small>
                  <button
                    aria-label={`${file.name} 작업`}
                    title="작업 메뉴"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelected(index);
                      setActionIndex(0);
                      setView("actions");
                      input.current?.focus();
                    }}
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              ))}
              {!entries.length && !searching && (
                <div className="quick-empty">
                  <Search size={27} />
                  <strong>
                    {!roots.length
                      ? "검색할 폴더를 먼저 연결하세요"
                      : pathInput && !error
                        ? "연결된 폴더에서 이 경로를 찾지 못했습니다"
                        : query && error
                        ? "검색을 완료하지 못했습니다"
                        : query
                          ? "일치하는 항목이 없습니다"
                          : "자주 쓰는 문서를 바로 찾아보세요"}
                  </strong>
                  <p>
                    {error
                      ? "아래 안내를 확인하고 다시 시도해 주세요."
                      : pathInput
                        ? "연결 폴더 안의 전체 경로나 일부 경로(예: 업무 자료\\프로젝트)를 입력하세요. 다른 위치는 먼저 폴더를 연결해야 합니다."
                        : query
                        ? "파일 이름 일부나 한글 초성으로 검색해 보세요."
                        : "이름을 검색하거나 파일·폴더를 즐겨찾기에 추가하세요."}
                  </p>
                  {!roots.length && (
                    <button onClick={() => void quickControl("folders")}>
                      폴더 연결하기 <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </section>
      {error && (
        <div className="quick-message error" role="alert">
          {error}
        </div>
      )}
      {message && !error && (
        <div className="quick-message" role="status">
          <Check size={14} />
          {message}
        </div>
      )}
      <footer className="quick-footer">
        {clipboardView ? (
          <span>
            <kbd>↑↓</kbd> 선택 <kbd>Enter</kbd> 복사 <kbd>{modifier}+1~5</kbd> 종류
          </span>
        ) : (
          view === "preview" ? (
            <span>
              <kbd>↑↓</kbd> 다른 파일 <kbd>Enter</kbd> 열기 <kbd>{modifier}+Y</kbd> 미리보기 닫기
            </span>
          ) : (
          <span>
            <kbd>↑↓</kbd> 선택 <kbd>Enter</kbd> {entry && entry.id === pathMatch ? "위치로 이동" : "열기"} <kbd>Tab</kbd> 작업 <kbd>{modifier}+Y</kbd> 미리보기
          </span>
          )
        )}
        <span>
          <kbd>Esc</kbd> {clipboardView ? "파일 검색으로" : "닫기"}
        </span>
      </footer>
    </main>
  );
}

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
  Copy,
  ExternalLink,
  Folder,
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
} from "../client";
import {
  isComposingKey,
  quickSearchMode,
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
import "../quick-search.css";

type Action =
  "open" | "reveal" | "main" | "copy" | "path" | "destination" | "favorite";
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
  const clipboardTrigger=query.trim().toLocaleLowerCase()===preferences.clipboardKeyword.toLocaleLowerCase();
  const [defaultMode, setDefaultMode] = useState<SearchMode>("initials");
  const [roots, setRoots] = useState<ConnectedRoot[]>([]);
  const [scope, setScope] = useState("");
  const [category, setCategory] = useState<FileCategory>("all");
  const [access, setAccess] = useState<QuickAccess>(emptyAccess);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState(0);
  const [view, setView] = useState<"results" | "actions" | "destination" | "clipboard">(
    "results",
  );
  const [actionIndex, setActionIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [partial, setPartial] = useState(false);
  const [revision, setRevision] = useState(0);
  const [destination, setDestination] = useState<Location>();
  const [directories, setDirectories] = useState<FileEntry[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const searchEditing = useSearchInput(text => quickSearchMode(text,defaultMode), text=>{
    requestVersion.current+=1;
    selectedId.current=undefined;
    setQuery(text);
    setSelected(text.trim().toLocaleLowerCase()===preferences.clipboardKeyword.toLocaleLowerCase()?-1:0);
  });
  const composing = searchEditing.composing;
  const busyRef = useRef(false);
  const requestVersion = useRef(0);
  const previousSearch = useRef("");
  const selectedId = useRef<string | undefined>(undefined);
  const mac = /Mac/.test(navigator.platform);
  const modifier = mac ? "⌘" : "Ctrl";
  const entry = entries[selected];
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
    { id: "copy", title: "파일·폴더 복사", key: `${modifier}+C` },
    { id: "path", title: "전체 경로 복사", key: `${modifier}+Shift+C` },
    { id: "destination", title: "다른 폴더로 복사…" },
    { id: "main", title: "Every Directory에서 위치 열기" },
    { id: "favorite", title: isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가" },
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
    const current = entries[selected];
    if (current) selectedId.current = current.id;
  }, [entries, selected]);

  useEffect(() => {
    const version = ++requestVersion.current;
    const searchKey = JSON.stringify([query, scope, category,clipboardTrigger]);
    if (previousSearch.current !== searchKey) {
      previousSearch.current = searchKey;
      selectedId.current = undefined;
      setSelected(clipboardTrigger?-1:0);
      setEntries([]);
    }
    setError("");
    setPartial(false);
    setSearching(true);
    // 기록 변경으로 순위가 갱신되어도 사용자가 선택한 파일을 유지한다.
    function applyEntries(next: FileEntry[]) {
      setSelected(current=>clipboardTrigger&&current===-1?-1:
        Math.max(
          0,
          next.findIndex((file) => file.id === selectedId.current),
        ),
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
            const result = await quickSearch({
              query,
              mode: quickSearchMode(query, defaultMode),
              rootId: scope,
              category,
              fullPath: preferences.quickFullPath,
              limit: 12,
            });
            if (version !== requestVersion.current) return;
            applyEntries(result.entries);
            setPartial(!!result.partial);
          } catch (cause) {
            if (version === requestVersion.current) {
              setError(String(cause));
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
  }, [client, query, scope, category, revision, defaultMode,preferences]);

  useEffect(() => {
    document
      .getElementById(`quick-result-${selected}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, entries]);

  // 성공한 작업만 최근 검색과 사용 기록에 반영한다.
  async function record(target: FileEntry) {
    await quickAccess("opened", {
      location: { rootId: target.rootId, path: target.path },
      query,
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
      event.target instanceof HTMLSelectElement ||
      event.target instanceof HTMLButtonElement
    )
      return;
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
      else if(clipboardTrigger)setSelected(n=>(n+1+delta+entries.length+1)%(entries.length+1)-1);
      else if (entries.length)
        setSelected((n) => (n + delta + entries.length) % entries.length);
    } else if(event.key==="Enter"&&clipboardTrigger&&selected===-1){event.preventDefault();setView("clipboard");
    } else if (event.key === "Enter" && entry) {
      event.preventDefault();
      void run(
        view === "actions"
          ? actions[actionIndex].id
          : event.metaKey || event.ctrlKey
            ? "reveal"
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
    <main className="quick-shell" onKeyDown={handleKey}>
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
        <Search size={23} />
        <SearchTextInput
          ref={input}
          preview={searchEditing.preview}
          autoFocus
          role="combobox"
          aria-label="파일·폴더 빠른 검색"
          aria-controls="quick-results"
          aria-expanded={view === "results"}
          aria-activedescendant={
            clipboardTrigger&&selected===-1?"quick-clipboard-trigger":entry && view === "results" ? `quick-result-${selected}` : undefined
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
      <div className="quick-filters">
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
              {clipboardTrigger&&<button id="quick-clipboard-trigger" role="option" aria-selected={selected===-1} className={`quick-result clipboard-trigger ${selected===-1?"active":""}`} onClick={()=>setView("clipboard")}>클립보드 보기 <small>최신 순 이력 · Enter</small></button>}
              {entries.map((file, index) => (
                <div
                  id={`quick-result-${index}`}
                  role="option"
                  aria-selected={index === selected}
                  key={file.id}
                  className={`quick-result ${index === selected ? "active" : ""}`}
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
                >
                  <FileIcon entry={file} />
                  <div className="quick-result-text">
                    <strong title={file.name}><Highlight text={file.name} query={preferences.highlightMatches?query:""} mode={quickSearchMode(query,defaultMode)}/></strong>
                    <span
                      title={locationLabel(
                        roots.find((r) => r.id === file.rootId),
                        file.parent,
                      )}
                    >
                      <Highlight text={locationLabel(roots.find(r=>r.id===file.rootId),file.parent)} query={preferences.highlightMatches?query:""} mode={quickSearchMode(query,defaultMode)} field="path"/>
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
                    <ChevronRight size={17} />
                  </button>
                </div>
              ))}
              {!entries.length && !searching && (
                <div className="quick-empty">
                  <Search size={27} />
                  <strong>
                    {!roots.length
                      ? "검색할 폴더를 먼저 연결하세요"
                      : query && error
                        ? "검색을 완료하지 못했습니다"
                        : query
                          ? "일치하는 항목이 없습니다"
                          : "자주 쓰는 문서를 바로 찾아보세요"}
                  </strong>
                  <p>
                    {error
                      ? "아래 안내를 확인하고 다시 시도해 주세요."
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
        <span>
          <kbd>↑↓</kbd> 선택 <kbd>Enter</kbd> 열기 <kbd>Tab</kbd> 작업
        </span>
        <span>
          <kbd>Esc</kbd> 닫기
        </span>
      </footer>
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, SearchX } from "lucide-react";
import { FileIcon, formatSize } from "./FileIcon";
import { fileCollator } from "../search";
import type { ConnectedRoot, FileEntry } from "../types";
import {
  defaultSearchColumns,
  searchColumnOptions,
  searchColumnValue,
  type SearchColumn,
} from "../searchColumns";

const modifiedFormat = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

interface Props {
  entries: FileEntry[];
  roots: ConnectedRoot[];
  search?: boolean;
  columns?: SearchColumn[];
  compact?: boolean;
  view?: "list" | "grid";
  selected?: string;
  revealEntry?: FileEntry;
  selectedIds?: string[];
  onMultiSelect?: (entries: FileEntry[]) => void;
  onQuickPreview?: (entry: FileEntry) => void;
  query?: string;
  onSelect: (entry: FileEntry) => void;
  onOpen: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, x: number, y: number) => void;
  resetKey?: string;
}

// 검색어와 일치하는 파일명 부분을 강조한다.
function Highlight({ text, query = "" }: { text: string; query?: string }) {
  const word = query
    .split(/\s+/)
    .find((t) => t && !t.startsWith("ext:"))
    ?.replaceAll('"', "");
  if (!word) return <>{text}</>;
  const index = text.toLocaleLowerCase().indexOf(word.toLocaleLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + word.length)}</mark>
      {text.slice(index + word.length)}
    </>
  );
}

// 화면에 보이는 행만 렌더링하는 파일 목록과 격자 보기를 제공한다.
export function FileTable({
  entries,
  roots,
  search,
  columns = defaultSearchColumns,
  compact,
  view = "list",
  selected,
  revealEntry,
  selectedIds,
  onMultiSelect,
  onQuickPreview,
  query,
  onSelect,
  onOpen,
  onContextMenu,
  resetKey,
}: Props) {
  const anchor = useRef<string | undefined>(undefined);
  const rowHeight = compact ? 34 : 43;
  const container = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [horizontalScroll, setHorizontalScroll] = useState(0);
  const [height, setHeight] = useState(400);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [sort, setSort] = useState<SearchColumn>();
  const [descending, setDescending] = useState(false);
  const lastSelection = useRef<string | undefined>(undefined);
  const lastReveal = useRef<FileEntry | undefined>(undefined);
  const rootById = useMemo(
    () => new Map(roots.map((root) => [root.id, root])),
    [roots],
  );
  const visibleColumns = searchColumnOptions.filter((column) =>
    columns.includes(column.id),
  );
  const searchWidth = visibleColumns.reduce(
    (total, column) => total + column.width,
    48,
  );
  const searchGrid = [
    ...visibleColumns.map(
      (column) =>
        `minmax(${column.width}px, ${column.id === "name" || column.id === "location" ? "1fr" : `${column.width}px`})`,
    ),
    "24px",
  ].join(" ");
  const sorted = useMemo(
    () =>
      search && !sort
        ? entries
        : [...entries].sort((a, b) => {
            const first = searchColumnValue(
              a,
              rootById.get(a.rootId),
              sort ?? "name",
            );
            const second = searchColumnValue(
              b,
              rootById.get(b.rootId),
              sort ?? "name",
            );
            return (
              Number(b.kind === "directory") - Number(a.kind === "directory") ||
              (typeof first === "number" && typeof second === "number"
                ? first - second
                : fileCollator.compare(String(first), String(second))) *
                (descending ? -1 : 1)
            );
          }),
    [entries, search, sort, descending, rootById],
  );
  useEffect(() => {
    if (search && sort && !columns.includes(sort)) setSort(undefined);
  }, [columns, search, sort]);
  const grid = view === "grid" && !search;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height);
      setViewportWidth(entry.contentRect.width);
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setScroll(0);
    if (container.current) container.current.scrollTop = 0;
  }, [resetKey, view, sort, descending]);
  useEffect(() => {
    const changed =
      selected !== lastSelection.current || revealEntry !== lastReveal.current;
    lastSelection.current = selected;
    lastReveal.current = revealEntry;
    if (!changed) return;
    if (!selected || grid || !container.current) return;
    const index = sorted.findIndex((entry) => entry.id === selected);
    if (index < 0) return;
    const top = index * rowHeight;
    const current = container.current;
    if (top < current.scrollTop) current.scrollTop = top;
    else if (top + rowHeight > current.scrollTop + current.clientHeight)
      current.scrollTop = top + rowHeight - current.clientHeight;
  }, [selected, sorted, grid, revealEntry, rowHeight]);
  const start = grid ? 0 : Math.max(0, Math.floor(scroll / rowHeight) - 5);
  const end = grid
    ? Math.min(sorted.length, 300)
    : Math.min(sorted.length, start + Math.ceil(height / rowHeight) + 10);

  // 표시 열을 기준으로 정렬 방향을 변경한다.
  function changeSort(key: SearchColumn) {
    if (sort === key) setDescending(!descending);
    else {
      setSort(key);
      setDescending(false);
    }
  }

  // 검색 속성을 사람이 읽기 쉬운 크기와 날짜로 표시한다.
  function columnText(entry: FileEntry, column: SearchColumn): string {
    const value = searchColumnValue(entry, rootById.get(entry.rootId), column);
    if (column === "size")
      return Number(value) < 0 ? "—" : formatSize(Number(value));
    if (column === "modified")
      return Number(value) < 0 || !Number.isFinite(Number(value))
        ? "—"
        : modifiedFormat.format(Number(value));
    return String(value || "—");
  }

  // Ctrl 또는 Command는 토글하고 Shift는 마지막 선택부터 범위를 선택한다.
  function selectEntry(entry: FileEntry, toggle = false, range = false): void {
    onSelect(entry);
    if (!onMultiSelect) return;
    if (range && anchor.current) {
      const from = sorted.findIndex((item) => item.id === anchor.current);
      const to = sorted.findIndex((item) => item.id === entry.id);
      onMultiSelect(
        sorted.slice(Math.min(Math.max(0, from), to), Math.max(from, to) + 1),
      );
    } else if (toggle) {
      const previous = new Set(selectedIds ?? []);
      if (previous.has(entry.id)) previous.delete(entry.id);
      else previous.add(entry.id);
      onMultiSelect(sorted.filter((item) => previous.has(item.id)));
      anchor.current = entry.id;
    } else {
      onMultiSelect([entry]);
      anchor.current = entry.id;
    }
  }

  return (
    <div
      className={`file-table ${search ? "search-table" : ""} ${grid ? "grid-table" : ""}`}
    >
      {search && (
        <div className="search-column-viewport">
          <div
            className="file-columns search-column-headings"
            role="row"
            style={{
              gridTemplateColumns: searchGrid,
              width: Math.max(viewportWidth, searchWidth),
              transform: `translateX(${-horizontalScroll}px)`,
            }}
          >
            {visibleColumns.map((column) => (
              <span
                key={column.id}
                role="columnheader"
                data-column={column.id}
                aria-sort={
                  sort === column.id
                    ? descending
                      ? "descending"
                      : "ascending"
                    : "none"
                }
              >
                <button
                  aria-label={`${column.label}${column.id === "name" ? "으로" : "로"} 정렬`}
                  onClick={() => changeSort(column.id)}
                >
                  {column.label}
                  {sort === column.id &&
                    (descending ? (
                      <ArrowDown size={11} />
                    ) : (
                      <ArrowUp size={11} />
                    ))}
                </button>
              </span>
            ))}
            <span aria-hidden="true" />
          </div>
        </div>
      )}
      {!grid && !search && (
        <div className="file-columns" role="row">
          <button onClick={() => changeSort("name")} aria-label="이름으로 정렬">
            이름{" "}
            {(sort === "name" || (!sort && !search)) &&
              (descending ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
          </button>
          <button onClick={() => changeSort("extension")}>유형</button>
          <button onClick={() => changeSort("size")} aria-label="크기로 정렬">
            크기 {sort === "size" && (descending ? "↓" : "↑")}
          </button>
          <button
            className="file-modified"
            onClick={() => changeSort("modified")}
            aria-label="수정일로 정렬"
          >
            수정일 {sort === "modified" && (descending ? "↓" : "↑")}
          </button>
          <span />
        </div>
      )}
      <div
        className="file-scroll"
        ref={container}
        onScroll={(e) => {
          setScroll(e.currentTarget.scrollTop);
          if (search) setHorizontalScroll(e.currentTarget.scrollLeft);
        }}
        role="grid"
        aria-label={search ? "검색 결과" : "폴더 내용"}
        aria-colcount={search ? visibleColumns.length + 1 : undefined}
      >
        {!sorted.length ? (
          <div className="empty-files">
            <SearchX size={30} />
            <strong>
              {search ? "검색 결과가 없습니다" : "폴더가 비어 있습니다"}
            </strong>
            <span>
              {search
                ? "다른 검색어나 파일 유형으로 찾아보세요."
                : "위쪽 경로에서 다른 폴더로 이동해 보세요."}
            </span>
          </div>
        ) : (
          <div
            className={grid ? "file-grid" : "virtual-list"}
            style={
              grid
                ? undefined
                : {
                    height: sorted.length * rowHeight,
                    minWidth: search ? searchWidth : undefined,
                  }
            }
          >
            {sorted.slice(start, end).map((entry, i) => (
              <div
                key={entry.id}
                className={`file-row ${(selectedIds ? selectedIds.includes(entry.id) : selected === entry.id) ? "selected" : ""}`}
                style={
                  grid
                    ? undefined
                    : {
                        position: "absolute",
                        top: (start + i) * rowHeight,
                        height: rowHeight,
                        width: "100%",
                        gridTemplateColumns: search ? searchGrid : undefined,
                      }
                }
                role="row"
                tabIndex={0}
                aria-selected={
                  selectedIds
                    ? selectedIds.includes(entry.id)
                    : selected === entry.id
                }
                data-index={start + i}
                title={`${roots.find((r) => r.id === entry.rootId)?.name ?? ""}/${entry.path}`}
                onClick={(event) =>
                  selectEntry(
                    entry,
                    event.metaKey || event.ctrlKey,
                    event.shiftKey,
                  )
                }
                onDoubleClick={(event) => {
                  if (!(event.target as HTMLElement).closest("button,input"))
                    onOpen(entry);
                }}
                onContextMenu={(event) => {
                  if (!onContextMenu) return;
                  event.preventDefault();
                  if (!selectedIds?.includes(entry.id)) selectEntry(entry);
                  onContextMenu(entry, event.clientX, event.clientY);
                }}
                onKeyDown={(e) => {
                  if ((e.target as HTMLElement).closest("input,button")) return;
                  if (
                    onContextMenu &&
                    (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))
                  ) {
                    e.preventDefault();
                    const bounds = e.currentTarget.getBoundingClientRect();
                    selectEntry(entry);
                    onContextMenu(entry, bounds.left + 32, bounds.top + 16);
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onOpen(entry);
                  }
                  if (e.key === " ") {
                    e.preventDefault();
                    if (onQuickPreview && entry.kind === "file")
                      onQuickPreview(entry);
                    else selectEntry(entry, true);
                  }
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const nextIndex =
                      start + i + (e.key === "ArrowDown" ? 1 : -1);
                    const next = sorted[nextIndex];
                    if (next) {
                      selectEntry(next, false, e.shiftKey);
                      container.current?.scrollTo({
                        top: Math.max(0, nextIndex * rowHeight - height / 2),
                      });
                      requestAnimationFrame(() =>
                        container.current
                          ?.querySelector<HTMLElement>(
                            `[data-index="${nextIndex}"]`,
                          )
                          ?.focus({ preventScroll: true }),
                      );
                    }
                  }
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(
                    "application/x-ed-entry",
                    JSON.stringify(entry),
                  );
                  const dragged = selectedIds?.includes(entry.id)
                    ? entries.filter((item) => selectedIds.includes(item.id))
                    : [entry];
                  e.dataTransfer.setData(
                    "application/x-ed-files",
                    JSON.stringify(
                      dragged.map(({ rootId, path }) => ({ rootId, path })),
                    ),
                  );
                  e.dataTransfer.effectAllowed = "copyMove";
                }}
              >
                <span
                  className="file-name"
                  role="gridcell"
                  data-column={search ? "name" : undefined}
                >
                  {onMultiSelect && (
                    <input
                      className="file-checkbox"
                      type="checkbox"
                      tabIndex={-1}
                      aria-label={`${entry.name} 선택`}
                      checked={selectedIds?.includes(entry.id) ?? false}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => selectEntry(entry, true)}
                    />
                  )}
                  <FileIcon entry={entry} large={grid} />
                  <span>
                    <Highlight text={entry.name} query={query} />
                  </span>
                  {grid && (
                    <small>
                      {entry.kind === "directory"
                        ? "폴더"
                        : entry.extension.toUpperCase()}
                    </small>
                  )}
                </span>
                {!grid &&
                  (search ? (
                    visibleColumns
                      .filter((column) => column.id !== "name")
                      .map((column) => (
                        <span
                          key={column.id}
                          className={`search-cell search-cell-${column.id}`}
                          data-column={column.id}
                          role="gridcell"
                          title={columnText(entry, column.id)}
                        >
                          {columnText(entry, column.id)}
                        </span>
                      ))
                  ) : (
                    <>
                      <span className="file-type" role="gridcell">
                        {entry.kind === "directory"
                          ? "폴더"
                          : entry.extension.toUpperCase() || "파일"}
                      </span>
                      <span className="file-size" role="gridcell">
                        {formatSize(entry.size)}
                      </span>
                      <span
                        className="file-modified"
                        role="gridcell"
                        title={
                          entry.modified
                            ? new Date(entry.modified).toLocaleString("ko-KR")
                            : ""
                        }
                      >
                        {entry.modified
                          ? new Date(entry.modified).toLocaleDateString(
                              "ko-KR",
                              {
                                year: "2-digit",
                                month: "2-digit",
                                day: "2-digit",
                              },
                            )
                          : "—"}
                      </span>
                    </>
                  ))}
                {!grid && (
                  <button
                    className="row-open icon-button"
                    title={entry.kind === "file" ? "기본 앱으로 열기" : "열기"}
                    aria-label={`${entry.name} 열기`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(entry);
                    }}
                  >
                    <ArrowUpRight size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {grid && sorted.length > 300 && (
          <p className="grid-limit">
            격자에서는 처음 300개를 표시합니다. 전체 항목은 목록 보기에서
            확인하세요.
          </p>
        )}
      </div>
    </div>
  );
}

import {Highlight} from "./Highlight";
import {usePreferences} from "../preferences";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpRight, Columns3, SearchX } from "lucide-react";
import { FileIcon, formatSize } from "./FileIcon";
import { fileCollator, choseong, categoryOf } from "../search";
import type { ConnectedRoot, ExplorerView, FileEntry, TableSort, SearchSortKey } from "../types";
import {defaultExplorerColumns,groupedEntries} from "../explorerView";
import { locationPath } from "../paths";
import { isDesktop } from "../client";
import { startFileDrag } from "../fileDrag";
import { ColumnResizeHandle } from "./ColumnResizeHandle";
import { clampColumnWidth, normalizeColumnWidths, resolveColumnWidths, type ColumnWidths } from "../columnWidths";
import { readPreference, savePreference } from "../storage";
import {
  defaultSearchColumns,
  searchColumnOptions,
  searchColumnValue,
  normalizeTableSort,
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
  view?: ExplorerView;
  groupBy?:SearchSortKey|"none";
  selected?: string;
  revealEntry?: FileEntry;
  selectedIds?: string[];
  onMultiSelect?: (entries: FileEntry[]) => void;
  onQuickPreview?: (entry: FileEntry) => void;
  query?: string;
  searchMode?:import("../types").SearchMode;
  caseSensitive?:boolean;
  onSelect: (entry: FileEntry, multi?:boolean) => void;
  onOpen: (entry: FileEntry) => void;
  onContextMenu?: (entry: FileEntry, x: number, y: number) => void;
  resetKey?: string;
  columnLayoutKey?: string;
  sortState?: TableSort | null;
  onSortChange?: (sort:TableSort|undefined)=>void;
  onColumnsChange?:(columns:SearchColumn[])=>void;
  cursor?: FileCursor;
}

// 목록이 바뀐 뒤 선택·초점을 둘 항목을 요청한다. id가 없으면 사라진 항목 자리나 첫 항목을 고른다.
// select가 false면 탐색기처럼 초점만 두고 선택(체크)하지 않는다.
export interface FileCursor { token: number; id?: string; replaced?: string; focus: boolean; select?: boolean }

// 화면에 보이는 행만 렌더링하는 파일 목록과 격자 보기를 제공한다.
export function FileTable({
  entries,
  roots,
  search,
  columns,
  compact,
  view = "list",
  groupBy="none",
  selected,
  revealEntry,
  selectedIds,
  onMultiSelect,
  onQuickPreview,
  query,
  searchMode="initials",
  caseSensitive=false,
  onSelect,
  onOpen,
  onContextMenu,
  resetKey,
  columnLayoutKey = search ? "searchColumnWidths" : "explorerColumnWidths",
  sortState,
  onSortChange,
  onColumnsChange,
  cursor,
}: Props) {
  const {preferences}=usePreferences();
  const highlightQuery=preferences.highlightMatches?query:"";
  const anchor = useRef<string | undefined>(undefined);
  const rowHeight = !search&&view==="content"?60:compact ? 26 : 32;
  const handledCursor = useRef<number | undefined>(undefined);
  const previousSorted = useRef<FileEntry[]>([]);
  const container = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [horizontalScroll, setHorizontalScroll] = useState(0);
  const [height, setHeight] = useState(400);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [localSort, setLocalSort] = useState<TableSort|undefined>(()=>normalizeTableSort(readPreference(`${columnLayoutKey}:sort`,null)));
  const actualSort=sortState===undefined?localSort:sortState;
  const sort=actualSort?.key;
  const descending=actualSort?.descending??false;
  const [gridLimit, setGridLimit] = useState(300);
  const [columnWidths, setColumnWidths] = useState<ColumnWidths>(() => normalizeColumnWidths(readPreference(columnLayoutKey, null)));
  const [columnMenu, setColumnMenu] = useState<{x: number; y: number}>();
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const beforeResize = useRef<ColumnWidths | undefined>(undefined);
  const lastSelection = useRef<string | undefined>(undefined);
  const lastReveal = useRef<FileEntry | undefined>(undefined);
  const typeAhead=useRef({text:"",time:0});
  const rootById = useMemo(
    () => new Map(roots.map((root) => [root.id, root])),
    [roots],
  );
  const activeColumns=columns??(search?defaultSearchColumns:defaultExplorerColumns);
  const visibleColumns = searchColumnOptions.filter(column=>activeColumns.includes(column.id)).map(column=>search?column:{...column,label:column.id==="extension"?"유형":column.label,width:column.id==="modified"?100:column.width});
  const resolvedWidths = resolveColumnWidths(visibleColumns, columnWidths, viewportWidth);
  const tableWidth = Math.max(viewportWidth, resolvedWidths.reduce((sum, width) => sum + width, 48));
  const tableGrid = [...resolvedWidths.map(width => `${width}px`), "minmax(24px, 1fr)"].join(" ");
  function updateWidth(id: SearchColumn, width: number, persist: boolean) {
    if(!persist && beforeResize.current===undefined)beforeResize.current=columnWidths;
    const next = {...columnWidths, ...Object.fromEntries(visibleColumns.map((column,index) => [column.id,resolvedWidths[index]])), [id]:clampColumnWidth(id,width)};
    setColumnWidths(next);
    if (persist) { savePreference(columnLayoutKey, next);beforeResize.current=undefined; }
  }
  // Measure real rendered fonts, including Unicode names; avoid mounting thousands of DOM rows.
  function fitWidth(id: SearchColumn): number {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return 200;
    const cell = container.current?.querySelector<HTMLElement>(`[data-column="${id}"]`);
    context.font = getComputedStyle(cell ?? container.current!).font || "13px sans-serif";
    const column = visibleColumns.find(column => column.id === id)!;
    const extra = id === "name" ? (onMultiSelect ? 68 : 44) : 24;
    return clampColumnWidth(id, Math.max(context.measureText(column.label).width + 40, ...entries.slice(0, 1000).map(entry => context.measureText(columnText(entry,id)).width + extra)));
  }
  function fitAllColumns() {
    const next = {...columnWidths, ...Object.fromEntries(visibleColumns.map(column => [column.id, fitWidth(column.id)]))};
    setColumnWidths(next);savePreference(columnLayoutKey,next);setColumnMenu(undefined);
  }
  useEffect(() => {
    if(!columnMenu)return;
    const close=(event:PointerEvent) => {if(!columnMenuRef.current?.contains(event.target as Node)&&!menuTrigger.current?.contains(event.target as Node))setColumnMenu(undefined);};
    const key=(event:KeyboardEvent) => {if(event.key==="Escape"){event.stopPropagation();setColumnMenu(undefined);menuTrigger.current?.focus();}};
    const resize=()=>setColumnMenu(undefined);
    document.addEventListener("pointerdown",close);document.addEventListener("keydown",key,true);window.addEventListener("resize",resize);
    columnMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus({preventScroll:true});
    const bounds=columnMenuRef.current?.getBoundingClientRect();if(bounds&&bounds.bottom>innerHeight-8)setColumnMenu(previous=>previous?{...previous,y:Math.max(8,innerHeight-bounds.height-8)}:previous);
    return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",key,true);window.removeEventListener("resize",resize);};
  },[columnMenu]);
  const ordered = useMemo(
    () =>
      (search&&onSortChange) || (search && !sort)
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
    [entries, search, sort, descending, rootById,onSortChange],
  );
  const grouped=useMemo(()=>groupedEntries(ordered,search?"none":groupBy,roots),[ordered,groupBy,search,roots]);
  const sorted=grouped.entries,displayRows=grouped.rows;
  const positions=useMemo(()=>new Map(displayRows.flatMap((row,index)=>row.kind==="entry"?[[row.entry.id,index] as const]:[])),[displayRows]);
  useEffect(() => {
    if (search && sort && !activeColumns.includes(sort)) {
      if(onSortChange)onSortChange(undefined);else setLocalSort(undefined);
    }
  }, [columns, search, sort,onSortChange]);
  const grid = !search&&(view==="grid"||view.startsWith("icons-"));
  // Windows 탐색기 보기별 아이콘 크기(작은 16·보통 48·큰 96·아주 큰 128)에 맞춘다.
  const iconPixels = search ? 16 : ({ "icons-extra": 128, "icons-large": 96, "icons-medium": 48, "icons-small": 20, grid: 48, content: 32 } as Partial<Record<ExplorerView, number>>)[view] ?? 16;
  const details=search||view==="list";
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
    setGridLimit(300);
    if (container.current) container.current.scrollTop = 0;
  }, [resetKey, view, sort, descending]);
  useEffect(() => {
    const changed =
      selected !== lastSelection.current || revealEntry !== lastReveal.current;
    lastSelection.current = selected;
    lastReveal.current = revealEntry;
    if (!changed && !grid) return;
    if (!selected || !container.current) return;
    const index = sorted.findIndex((entry) => entry.id === selected);
    if (index < 0) return;
    if (grid) {
      setGridLimit((previous) =>
        Math.max(previous, Math.ceil(((positions.get(selected)??index) + 1) / 300) * 300),
      );
      return;
    }
    const top = (positions.get(selected)??index) * rowHeight;
    const current = container.current;
    if (top < current.scrollTop) current.scrollTop = top;
    else if (top + rowHeight > current.scrollTop + current.clientHeight)
      current.scrollTop = top + rowHeight - current.clientHeight;
  }, [selected, sorted, grid, revealEntry, rowHeight,positions]);
  useEffect(() => {
    if (!cursor || handledCursor.current === cursor.token) return;
    handledCursor.current = cursor.token;
    let target = cursor.id ? sorted.find((entry) => entry.id === cursor.id) : undefined;
    if (!target && cursor.replaced) {
      // 여러 항목을 지워도 원래 자리 뒤에서 남아 있는 첫 항목, 없으면 앞쪽 항목을 고른다.
      const old = previousSorted.current;
      const index = old.findIndex((entry) => entry.id === cursor.replaced);
      if (index >= 0) {
        const remaining = new Map(sorted.map((entry) => [entry.id, entry]));
        const survivor = old.slice(index).find((entry) => remaining.has(entry.id)) ?? old.slice(0, index).reverse().find((entry) => remaining.has(entry.id));
        target = survivor ? remaining.get(survivor.id) : sorted[Math.min(index, sorted.length - 1)];
      }
    }
    if (!target && cursor.focus) target = sorted[0];
    if (target && cursor.select !== false) selectEntry(target);
    if (cursor.focus) focusEntry(target);
  }, [cursor, sorted]);
  useEffect(() => {
    previousSorted.current = sorted;
  }, [sorted]);
  const start = grid ? 0 : Math.max(0, Math.floor(scroll / rowHeight) - 5);
  const end = grid
    ? Math.min(displayRows.length, gridLimit)
    : Math.min(displayRows.length, start + Math.ceil(height / rowHeight) + 10);
  const rendered = displayRows.slice(start, end);
  const currentId = selected && positions.has(selected) ? selected : sorted[0]?.id;
  const tabStopId = rendered.some((row) => row.kind === "entry" && row.entry.id === currentId)
    ? currentId
    : rendered.find((row) => row.kind === "entry")?.entry.id;

  // 가상 목록에서 대상 행을 화면에 꺼낸 뒤 키보드 초점을 옮긴다.
  function focusEntry(entry?: FileEntry) {
    const scroller = container.current;
    if (!scroller) return;
    if (!entry) {
      scroller.focus({ preventScroll: true });
      return;
    }
    const index = sorted.findIndex((item) => item.id === entry.id);
    const position = positions.get(entry.id) ?? index;
    if (grid) setGridLimit((previous) => Math.max(previous, Math.ceil((position + 1) / 300) * 300));
    else if (position * rowHeight < scroller.scrollTop || (position + 1) * rowHeight > scroller.scrollTop + scroller.clientHeight)
      scroller.scrollTop = Math.max(0, position * rowHeight - scroller.clientHeight / 3);
    const attempt = (tries: number) => {
      const row = container.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
      if (row) {
        row.focus({ preventScroll: true });
        if (grid) row.scrollIntoView({ block: "nearest" });
      } else if (tries < 8) setTimeout(() => attempt(tries + 1), 16);
    };
    // 숨겨진 창에서도 동작하도록 화면 갱신 대신 짧은 타이머로 다시 시도한다.
    attempt(0);
  }

  // 표시 열을 기준으로 정렬 방향을 변경한다.
  function changeSort(key: SearchColumn) {
    const next={key,descending:sort===key?!descending:false};
    if(onSortChange)onSortChange(next);else{setLocalSort(next);savePreference(`${columnLayoutKey}:sort`,next);}
  }

  // 검색 속성을 사람이 읽기 쉬운 크기와 날짜로 표시한다.
  function columnText(entry: FileEntry, column: SearchColumn): string {
    if(!search&&column==="extension"&&entry.kind==="directory")return "폴더";
    const value = searchColumnValue(entry, rootById.get(entry.rootId), column);
    if (column === "size")
      return Number(value) < 0 ? "—" : formatSize(Number(value));
    if (["modified","created","accessed"].includes(column))
      return Number(value) < 0 || !Number.isFinite(Number(value))
        ? "—"
        : modifiedFormat.format(Number(value));
    return String(value || "—");
  }

  // Ctrl 또는 Command는 토글하고 Shift는 마지막 선택부터 범위를 선택한다.
  function selectEntry(entry: FileEntry, toggle = false, range = false): void {
    onSelect(entry,toggle||range);
    if (!onMultiSelect) return;
    if (range) {
      const from = sorted.findIndex((item) => item.id === (anchor.current??sorted[0]?.id));
      const to = sorted.findIndex((item) => item.id === entry.id);
      const selectedRange=sorted.slice(Math.min(Math.max(0,from),to),Math.max(from,to)+1);
      if(toggle){const ids=new Set([...(selectedIds??[]),...selectedRange.map(item=>item.id)]);onMultiSelect(sorted.filter(item=>ids.has(item.id)));}
      else onMultiSelect(selectedRange);
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
      className={`file-table ${search ? "search-table" : ""} ${grid ? "grid-table" : ""} view-${view}`}
      data-view={view} data-group={groupBy}
      style={!grid ? {"--file-columns":tableGrid} as CSSProperties : undefined}
      onKeyDown={event=>{
        if((event.target as HTMLElement).closest("input,textarea,select"))return;
        if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="a"&&onMultiSelect){event.preventDefault();event.stopPropagation();onMultiSelect(sorted);}
        if((event.ctrlKey||event.metaKey)&&["+","Add"].includes(event.key)&&!grid){event.preventDefault();event.stopPropagation();fitAllColumns();}
      }}
    >
      {details && (
        <div className="search-column-viewport table-column-viewport" onContextMenu={event => {
          event.preventDefault();event.stopPropagation();setColumnMenu({x:Math.max(8,Math.min(event.clientX,innerWidth-224)),y:Math.max(8,Math.min(event.clientY,innerHeight-142))});
        }}>
          <div
            className={`file-columns ${search ? "search-column-headings" : ""} resizable-column-headings`}
            role="row"
            style={{
              gridTemplateColumns: tableGrid,
              width: tableWidth,
              transform: `translateX(${-horizontalScroll}px)`,
            }}
          >
            {visibleColumns.map((column, index) => (
              <span
                key={column.id}
                role="columnheader"
                data-column={column.id}
                aria-sort={
                  sort === column.id || (!search && !sort && column.id === "name")
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
                  {(sort === column.id || (!search && !sort && column.id === "name")) &&
                    (descending ? (
                      <ArrowDown size={11} />
                    ) : (
                      <ArrowUp size={11} />
                    ))}
                </button>
                <ColumnResizeHandle id={column.id} label={column.label} width={resolvedWidths[index]}
                  onCancel={() => {if(beforeResize.current!==undefined)setColumnWidths(beforeResize.current);beforeResize.current=undefined;}}
                  onResize={(width,persist) => updateWidth(column.id,width,persist)} onFit={() => updateWidth(column.id,fitWidth(column.id),true)} />
              </span>
            ))}
            <button ref={menuTrigger} className="column-options-button" aria-label="칼럼 너비 설정" title="칼럼 자동 맞춤 · 너비 초기화" aria-expanded={Boolean(columnMenu)}
              onClick={event => {const bounds=event.currentTarget.getBoundingClientRect();setColumnMenu(columnMenu?undefined:{x:Math.max(8,Math.min(bounds.right-216,innerWidth-224)),y:Math.min(bounds.bottom+4,innerHeight-142)});}}><Columns3 size={13}/></button>
          </div>
        </div>
      )}
      {columnMenu && createPortal(<div className="column-width-menu" ref={columnMenuRef} role="dialog" aria-label="칼럼 너비 설정" style={{left:columnMenu.x,top:columnMenu.y}} onContextMenu={event=>event.preventDefault()}>
        <button onClick={fitAllColumns}>모든 칼럼 내용에 맞춤</button>
        <button onClick={()=>{setColumnWidths({});savePreference(columnLayoutKey,{});setColumnMenu(undefined);menuTrigger.current?.focus();}}>기본 너비로 복원</button>
        {onColumnsChange&&<fieldset className="column-menu-fields"><legend>표시할 속성</legend>{searchColumnOptions.map(column=><label key={column.id}><input type="checkbox" disabled={column.id==="name"} checked={activeColumns.includes(column.id)} onChange={event=>onColumnsChange(searchColumnOptions.filter(item=>item.id==="name"||(item.id===column.id?event.target.checked:activeColumns.includes(item.id))).map(item=>item.id))}/>{column.label}</label>)}</fieldset>}
        <small>경계선 드래그 · 더블클릭 자동 맞춤<br/>방향키 10px · Shift+방향키 40px</small>
      </div>,document.body)}
      <div
        className="file-scroll"
        ref={container}
        onScroll={(e) => {
          setScroll(e.currentTarget.scrollTop);
          setHorizontalScroll(e.currentTarget.scrollLeft);
        }}
        role="grid"
        tabIndex={-1}
        aria-label={search ? "검색 결과" : "폴더 내용"}
        aria-colcount={!grid ? visibleColumns.length + 1 : undefined}
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
                    height: displayRows.length * rowHeight,
                    minWidth: details?tableWidth:undefined,
                  }
            }
          >
            {rendered.map((record, i) => record.kind==="group"?<div key={`group:${record.label}`} className="file-group-heading" role="row" style={grid?undefined:{position:"absolute",top:(start+i)*rowHeight,height:rowHeight,left:0,right:0}}><strong>{record.label}</strong><span>{record.count.toLocaleString()}개</span></div>:(()=>{const entry=record.entry,index=record.index;return (
              <div
                key={entry.id}
                data-category={entry.kind==="directory"?"directory":categoryOf(entry)}
                className={`file-row ${(selectedIds ? selectedIds.includes(entry.id) : selected === entry.id) ? "selected" : ""}`}
                style={
                  grid
                    ? undefined
                    : {
                        position: "absolute",
                        top: (start + i) * rowHeight,
                        height: rowHeight,
                        width: "100%",
                        gridTemplateColumns: details?tableGrid:"minmax(0,1fr) 24px",
                      }
                }
                role="row"
                tabIndex={entry.id === tabStopId ? 0 : -1}
                aria-selected={
                  selectedIds
                    ? selectedIds.includes(entry.id)
                    : selected === entry.id
                }
                data-index={index}
                data-drop-location={entry.kind === "directory" ? JSON.stringify({ rootId: entry.rootId, path: entry.path }) : undefined}
                title={locationPath(rootById.get(entry.rootId), entry.path)}
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
                  if(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return;
                  if ((e.target as HTMLElement).closest("input,button")) return;
                  if (
                    onContextMenu &&
                    (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))
                  ) {
                    e.preventDefault();
                    const bounds = e.currentTarget.getBoundingClientRect();
                    if(!selectedIds?.includes(entry.id))selectEntry(entry);
                    onContextMenu(entry, bounds.left + 32, bounds.top + 16);
                    return;
                  }
                  if (e.key === "Enter" && !e.altKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    onOpen(entry);
                  }
                  if (e.key === " ") {
                    e.preventDefault();
                    if (e.ctrlKey || e.metaKey) selectEntry(entry, true);
                    else if (onQuickPreview && entry.kind === "file")
                      onQuickPreview(entry);
                    else selectEntry(entry, true);
                  }
                  // 폴더에 들어와 초점만 있고 선택이 없으면 첫 ↑↓는 초점 항목을 선택한다(Windows 탐색기와 같음).
                  if (!e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && ["ArrowDown", "ArrowUp"].includes(e.key) && !selected && !selectedIds?.length) {
                    e.preventDefault();
                    selectEntry(entry);
                    return;
                  }
                  // Alt+방향키는 탐색창의 뒤로·앞으로·상위 폴더 단축키로 넘긴다.
                  if (!e.altKey && (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(e.key) || (grid && ["ArrowLeft", "ArrowRight"].includes(e.key)))) {
                    e.preventDefault();
                    const page = Math.max(1, Math.floor(height / rowHeight));
                    const gridElement = container.current?.querySelector(".file-grid");
                    const columns = grid && gridElement ? getComputedStyle(gridElement).gridTemplateColumns.split(" ").length : 1;
                    const delta = e.key === "ArrowDown" ? columns : e.key === "ArrowUp" ? -columns : e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : e.key === "PageDown" ? page : -page;
                    const nextIndex = e.key === "Home" ? 0 : e.key === "End" ? sorted.length - 1 : Math.max(0, Math.min(sorted.length - 1, index + delta));
                    const next = sorted[nextIndex];
                    if (next) {
                      if(e.shiftKey)selectEntry(next,e.ctrlKey||e.metaKey,true);
                      else if (!e.ctrlKey && !e.metaKey) selectEntry(next);
                      if (grid) setGridLimit((previous) => Math.max(previous, Math.ceil(((positions.get(next.id)??nextIndex) + 1) / 300) * 300));
                      else container.current?.scrollTo({
                        top: Math.max(0, (positions.get(next.id)??nextIndex) * rowHeight - height / 2),
                      });
                      requestAnimationFrame(() => {
                        const nextRow = container.current
                          ?.querySelector<HTMLElement>(
                            `[data-index="${nextIndex}"]`,
                          );
                        nextRow?.focus({ preventScroll: true });
                        if (grid) nextRow?.scrollIntoView({ block: "nearest" });
                      });
                    }
                  }else if(e.key.length===1&&e.key!==" "&&!e.altKey&&!e.ctrlKey&&!e.metaKey){
                    const time=performance.now(),old=time-typeAhead.current.time<900?typeAhead.current.text:"";
                    const text=(old+e.key).slice(-64),repeat=Array.from(text).every(char=>char.toLocaleLowerCase()===e.key.toLocaleLowerCase());
                    const query=(repeat?e.key:text).normalize("NFC").toLocaleLowerCase();typeAhead.current={text,time};
                    const initial=choseong(query).replaceAll(" ","");
                    const from=old&&!repeat?index:index+1;
                    const korean=/[ㄱ-ㅎ]/.test(query);let nextIndex:number|undefined;
                    for(let offset=0;offset<sorted.length;offset++){const index=(from+offset)%sorted.length;if(sorted[index].name.toLocaleLowerCase().startsWith(query)||(korean&&choseong(sorted[index].name).replaceAll(" ","").startsWith(initial))){nextIndex=index;break;}}
                    if(nextIndex!==undefined){
                      e.preventDefault();selectEntry(sorted[nextIndex]);
                      if(grid)setGridLimit(previous=>Math.max(previous,Math.ceil(((positions.get(sorted[nextIndex].id)??nextIndex)+1)/300)*300));
                      else container.current?.scrollTo({top:Math.max(0,(positions.get(sorted[nextIndex].id)??nextIndex)*rowHeight-height/2)});
                      requestAnimationFrame(()=>container.current?.querySelector<HTMLElement>(`[data-index="${nextIndex}"]`)?.focus({preventScroll:true}));
                    }
                  }
                }}
                draggable={!isDesktop}
                onPointerDown={isDesktop ? (event) => {
                  const dragged = selectedIds?.includes(entry.id)
                    ? entries.filter((item) => selectedIds.includes(item.id)) : [entry];
                  startFileDrag(event, dragged.map(({rootId, path}) => ({rootId, path})));
                } : undefined}
                onDragStart={(e) => {
                  if (isDesktop) { e.preventDefault(); return; }
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
                  data-column="name"
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
                  <FileIcon entry={entry} large={grid} pixels={iconPixels} />
                  <span>
                    <Highlight text={entry.name} query={highlightQuery} mode={searchMode} caseSensitive={caseSensitive} />
                  </span>
                  {grid && (
                    <small>
                      {entry.kind === "directory"
                        ? "폴더"
                        : entry.extension.toUpperCase()}
                    </small>
                  )}
                </span>
                {details &&
                  (
                    visibleColumns
                      .filter((column) => column.id !== "name")
                      .map((column) => (
                        <span
                          key={column.id}
                        className={`search-cell search-cell-${column.id} ${!search?`file-${column.id==="extension"?"type":column.id}`:""}`}
                          data-column={column.id}
                          role="gridcell"
                          title={columnText(entry, column.id)}
                        >
                          <Highlight text={columnText(entry,column.id)} query={highlightQuery} mode={searchMode} field={column.id} caseSensitive={caseSensitive}/>
                        </span>
                      ))
                  )}
                {!search&&view==="content"&&<span className="content-meta">{columnText(entry,"type")} · {formatSize(entry.size)} · {columnText(entry,"modified")}</span>}
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
            );})())}
          </div>
        )}
        {grid && displayRows.length > end && (
          <p className="grid-limit">
            {end.toLocaleString()} / {sorted.length.toLocaleString()}개 표시{" "}
            <button
              className="button secondary small"
              aria-label="격자 파일 더 보기"
              onClick={() => setGridLimit((value) => value + 300)}
            >
              다음 파일 더 보기
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

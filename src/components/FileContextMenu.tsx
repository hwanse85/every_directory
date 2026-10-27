import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CheckSquare,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Eye,
  File,
  FilePlus2,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  GitCompareArrows,
  HardDrive,
  Hash,
  Image,
  Info,
  Link,
  ListChecks,
  PanelTop,
  Pencil,
  RefreshCw,
  ScanEye,
  Scissors,
  Search,
  Star,
  Terminal,
  TextCursorInput,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { createPortal } from "react-dom";
import { isDesktop } from "../client";
import type { FileEntry, ToolRequest } from "../types";

type Action = ToolRequest["action"];
interface Item {
  action?: Action;
  group?: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
}
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = mac ? "⌘" : "Ctrl+";

// 아이콘·단축키를 갖춘 파일 메뉴를 호버와 키보드로 탐색한다.
export function FileContextMenu({
  x,
  y,
  entries,
  pasteable,
  otherPane,
  hidden,
  onAction,
  onClose,
  pasteLabel = "현재 폴더에 붙여넣기",
  onWindowsNew,
}: {
  x: number;
  y: number;
  entries: FileEntry[];
  pasteable: boolean;
  otherPane: boolean;
  hidden: boolean;
  onAction: (action: Action) => void;
  onClose: () => void;
  pasteLabel?: string;
  onWindowsNew?:(point:{x:number;y:number})=>void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const submenu = useRef<HTMLDivElement>(null);
  const parentButton = useRef<HTMLButtonElement | null>(null);
  const focusSubmenu = useRef(false);
  const submenuId = useId();
  const [group, setGroup] = useState("main");
  const [anchor, setAnchor] = useState({ left: 0, right: 0, top: 0 });
  const [submenuPosition, setSubmenuPosition] = useState({ left: 8, top: 8 });
  const count = entries.length;
  const single = count === 1;
  const file = single && entries[0].kind === "file";
  const many = count > 1;
  const groups: Record<string, { title: string; items: Item[] }> = {
    main: {
      title: count
        ? many
          ? `${count}개 항목 선택`
          : entries[0].name
        : "현재 폴더",
      items: [
        {
          action: "open",
          label: "기본 앱으로 열기",
          icon: ExternalLink,
          shortcut: "Enter",
          disabled: !single,
        },
        {
          action: "preview",
          label: "빠른 미리보기",
          icon: Eye,
          shortcut: "Space",
          disabled: !file,
        },
        {
          action: "openNewTab",
          label: "새 탭에서 위치 열기",
          icon: PanelTop,
          disabled: !single,
        },
        {
          action: "cut",
          label: "잘라내기",
          icon: Scissors,
          shortcut: `${mod}X`,
          disabled: !count,
          separator: true,
        },
        {
          action: "copy",
          label: "복사",
          icon: Copy,
          shortcut: `${mod}C`,
          disabled: !count,
        },
        {
          action: "paste",
          label: pasteLabel,
          icon: ClipboardPaste,
          shortcut: `${mod}V`,
          disabled: !pasteable,
        },
        {
          action: "duplicate",
          label: "같은 폴더에 복제",
          icon: CopyPlus,
          shortcut: `${mod}D`,
          disabled: !count,
        },
        {
          action: many ? "batchRename" : "rename",
          label: many ? "일괄 이름 변경…" : "이름 변경…",
          icon: Pencil,
          shortcut: many ? undefined : "F2",
          disabled: !count,
        },
        {
          group: "transfer",
          label: "다른 탐색창으로",
          icon: ArrowLeftRight,
          separator: true,
        },
        {
          group: "copyAs",
          label: "이름·경로 복사",
          icon: Link,
          disabled: !count,
        },
        { group: "tools", label: "파일 도구", icon: ScanEye },
        {
          group: "create",
          label: "새로 만들기",
          icon: FolderPlus,
          separator: true,
        },
        { group: "view", label: "보기·선택", icon: ListChecks },
        {
          action: "terminal",
          label: "여기서 터미널 열기",
          icon: Terminal,
          disabled: !isDesktop,
        },
        {
          action: "reveal",
          label: mac ? "Finder에서 보기" : "파일 탐색기에서 보기",
          icon: FolderOpen,
          disabled: !single,
        },
        {
          action: "properties",
          label: "속성·크기 확인…",
          icon: Info,
          shortcut: `${mod}I`,
          disabled: !count,
        },
        {
          action: "trash",
          label: "앱 휴지통으로 이동…",
          icon: Trash2,
          shortcut: mac ? "⌘⌫" : "Delete",
          disabled: !count,
          danger: true,
          separator: true,
        },
      ],
    },
    transfer: {
      title: "다른 탐색창으로",
      items: [
        {
          action: "openOtherPane",
          label: "다른 창에서 위치 열기",
          icon: PanelTop,
          disabled: !single || !otherPane,
        },
        {
          action: "copyOtherPane",
          label: "다른 창으로 복사…",
          icon: Copy,
          shortcut: mac ? "F5" : "Shift+F5",
          disabled: !count || !otherPane,
        },
        {
          action: "moveOtherPane",
          label: "다른 창으로 이동…",
          icon: ArrowLeftRight,
          shortcut: "F7",
          disabled: !count || !otherPane,
        },
        {
          action: "compare",
          label: "두 탐색창 폴더 비교…",
          icon: GitCompareArrows,
          disabled: !otherPane || !isDesktop,
          separator: true,
        },
      ],
    },
    copyAs: {
      title: "이름·경로 복사",
      items: [
        { action: "copyName", label: "파일 이름", icon: File },
        {
          action: "copyPath",
          label: "전체 경로",
          icon: Folder,
          shortcut: `${mod}⇧C`,
        },
        {
          action: "copyRelativePath",
          label: "연결 폴더 기준 상대 경로",
          icon: FolderOpen,
        },
        { action: "copyMarkdown", label: "Markdown 파일 링크", icon: Link },
      ],
    },
    tools: {
      title: "파일 도구",
      items: [
        {
          action: "batchRename",
          label: "일괄 이름 변경…",
          icon: TextCursorInput,
          disabled: !count,
        },
        {
          action: "resizeImages",
          label: "이미지 크기·형식 변환…",
          icon: Image,
          disabled:
            !count ||
            entries.some(
              (entry) =>
                !["png", "jpg", "jpeg", "webp"].includes(entry.extension),
            ),
        },
        {
          action: "hash",
          label: "SHA-256 무결성 확인…",
          icon: Hash,
          disabled: !file,
        },
        {
          action: "zip",
          label: "ZIP 압축…",
          icon: Archive,
          disabled: !count,
          separator: true,
        },
        {
          action: "unzip",
          label: "ZIP 압축 풀기…",
          icon: ArchiveRestore,
          disabled: !single || entries[0]?.extension !== "zip",
        },
        {
          action: "stats",
          label: "현재 폴더 용량 분석…",
          icon: HardDrive,
          disabled: !isDesktop,
          separator: true,
        },
        {
          action: "duplicates",
          label: "현재 폴더 중복 파일 찾기…",
          icon: Files,
          disabled: !isDesktop,
        },
        {
          action: "compare",
          label: "다른 창 폴더와 비교…",
          icon: GitCompareArrows,
          disabled: !otherPane || !isDesktop,
        },
        {
          action: "exportList",
          label: "파일 목록 내보내기…",
          icon: Download,
        },
        {
          action: "trashList",
          label: "앱 휴지통·복원…",
          icon: ArchiveRestore,
          separator: true,
        },
      ],
    },
    create: {
      title: "새로 만들기",
      items: [
        ...(onWindowsNew?[{action:"nativeNew" as const,label:"Windows 새로 만들기…",icon:FilePlus2}]:[]),
        {
          action: "mkdir",
          label: "새 폴더…",
          icon: FolderPlus,
          shortcut: `${mod}⇧N`,
        },
        { action: "mkfile", label: "새 텍스트 파일…", icon: FilePlus2 },
      ],
    },
    view: {
      title: "보기·선택",
      items: [
        {
          action: "selectAll",
          label: "전체 선택",
          icon: CheckSquare,
          shortcut: `${mod}A`,
        },
        {
          action: "invertSelection",
          label: "선택 반전",
          icon: ListChecks,
          shortcut: `${mod}⇧I`,
        },
        {
          action: "toggleHidden",
          label: hidden ? "숨김 파일 감추기" : "숨김 파일 표시",
          icon: Eye,
          shortcut: `${mod}⇧.`,
          separator: true,
        },
        {
          action: "refresh",
          label: "현재 목록 새로고침",
          icon: RefreshCw,
          shortcut: `${mod}R`,
        },
        { action: "favorite", label: "즐겨찾기 추가 / 해제", icon: Star },
        {
          action: "openNewTab",
          label: "현재 위치 새 탭",
          icon: ArrowUpRight,
          disabled: count > 0,
        },
      ],
    },
  };
  // 메뉴 밖 클릭과 화면 변경 시 메뉴를 닫고 원래 초점을 복원한다.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // 주 메뉴와 하위 메뉴 바깥을 누르면 전체 메뉴를 닫는다.
    function outside(event: PointerEvent) {
      if (!layer.current?.contains(event.target as Node)) onClose();
    }
    // 화면 크기가 바뀌면 이전 좌표의 메뉴를 닫는다.
    function dismiss() {
      onClose();
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [onClose]);
  useEffect(() => {
    menu.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
  }, []);
  useLayoutEffect(() => {
    if (group === "main" || !submenu.current) return;
    const bounds = submenu.current.getBoundingClientRect();
    const right = anchor.right - 1;
    const left =
      right + bounds.width <= window.innerWidth - 8
        ? right
        : anchor.left - bounds.width + 1;
    setSubmenuPosition({
      left: Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8)),
      top: Math.max(
        8,
        Math.min(anchor.top, window.innerHeight - bounds.height - 8),
      ),
    });
    if (focusSubmenu.current) {
      submenu.current
        .querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus({ preventScroll: true });
      focusSubmenu.current = false;
    }
  }, [group, anchor]);

  // 부모 항목 옆에 하위 메뉴를 즉시 열고 키보드 요청일 때만 초점을 이동한다.
  function openGroup(item: Item, button: HTMLButtonElement, focus = false) {
    if (!item.group || item.disabled) return;
    const row = button.getBoundingClientRect();
    const bounds = menu.current!.getBoundingClientRect();
    parentButton.current = button;
    focusSubmenu.current = focus;
    setAnchor({ left: bounds.left, right: bounds.right, top: row.top });
    setGroup(item.group);
  }

  // 하위 메뉴를 접고 필요하면 해당 부모 항목으로 초점을 돌려준다.
  function closeSubmenu(restoreFocus = false) {
    setGroup("main");
    if (restoreFocus) parentButton.current?.focus({ preventScroll: true });
  }

  // 메뉴 항목 실행과 하위 작업 그룹 이동을 구분한다.
  function choose(item: Item,source?:HTMLElement) {
    if (item.disabled) return;
    if(item.action==="nativeNew"&&onWindowsNew){const bounds=(source??document.activeElement as HTMLElement)?.getBoundingClientRect();const point={x:bounds?.left??x,y:bounds?.bottom??y};onClose();onWindowsNew(point);return;}
    if (item.action) {
      onAction(item.action);
      onClose();
    }
  }
  // 위아래·Home·End·좌우 키로 메뉴 전체를 조작한다.
  function keys(event: KeyboardEvent) {
    const modifier = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    let action: Action | undefined;
    if (modifier) {
      if (event.shiftKey && key === "c") action = "copyPath";
      else if (event.shiftKey && key === "n") action = "mkdir";
      else if (event.shiftKey && key === "i") action = "invertSelection";
      else if (event.shiftKey && (key === "." || event.code === "Period"))
        action = "toggleHidden";
      else if (!event.shiftKey)
        action = (
          {
            c: "copy",
            x: "cut",
            v: "paste",
            d: "duplicate",
            i: "properties",
            a: "selectAll",
            r: "refresh",
            backspace: "trash",
          } as Record<string, Action>
        )[key];
    } else if (key === "f2" && single) action = "rename";
    else if (key === "f5") action = "copyOtherPane";
    else if (key === "f7") action = "moveOtherPane";
    else if (key === "delete") action = "trash";
    else if (key === " " && file) action = "preview";
    if (action) {
      event.preventDefault();
      event.stopPropagation();
      const item = Object.values(groups)
        .flatMap((value) => value.items)
        .find((value) => value.action === action);
      if (item) choose(item);
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape" && group !== "main") closeSubmenu(true);
      else onClose();
      return;
    }
    if (event.key === "ArrowLeft" && group !== "main") {
      event.preventDefault();
      event.stopPropagation();
      closeSubmenu(true);
      return;
    }
    const buttons = [
      ...(submenu.current?.contains(event.target as Node)
        ? submenu.current
        : menu.current)!.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp")
      next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      const button = buttons[index];
      const item = groups.main.items.find(
        (value) => value.group === button?.dataset.group,
      );
      if (button && item?.group) openGroup(item, button, true);
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    if (!submenu.current?.contains(event.target as Node)) closeSubmenu();
    buttons[next]?.focus();
  }
  return createPortal(
    <div
      ref={layer}
      className="file-context-layer"
      onKeyDown={keys}
      onPointerLeave={() => closeSubmenu()}
    >
      <div
        ref={menu}
        className="file-context-menu"
        role="menu"
        aria-label="파일 메뉴"
        style={{
          left: Math.max(8, Math.min(x, window.innerWidth - 328)),
          top: Math.max(
            8,
            Math.min(
              y,
              window.innerHeight - Math.min(720, window.innerHeight - 16),
            ),
          ),
        }}
      >
        <header className="context-header">
          <span className="context-file-icon">
            {single && entries[0].kind === "directory" ? (
              <Folder size={17} />
            ) : (
              <File size={17} />
            )}
          </span>
          <div>
            <strong title={groups.main.title}>{groups.main.title}</strong>
            <small>{count ? `${count}개 항목 · 파일 작업` : "폴더 작업"}</small>
          </div>
        </header>
        <div className="context-items" onScroll={() => closeSubmenu()}>
          {groups.main.items.map((item) => (
            <button
              key={item.action ?? item.group}
              role="menuitem"
              className={`${item.separator ? "menu-separator" : ""} ${item.danger ? "menu-danger" : ""}`}
              disabled={item.disabled}
              data-group={item.group}
              aria-haspopup={item.group ? "menu" : undefined}
              aria-expanded={item.group ? group === item.group : undefined}
              aria-controls={
                item.group && group === item.group ? submenuId : undefined
              }
              onPointerEnter={(event) => {
                if (event.pointerType === "touch") return;
                if (item.group && !item.disabled)
                  openGroup(item, event.currentTarget);
                else closeSubmenu();
              }}
              onClick={(event) =>
                item.group==="create"&&onWindowsNew
                  ? choose({action:"nativeNew",label:"Windows 새로 만들기",icon:FilePlus2},event.currentTarget)
                  : item.group
                  ? openGroup(item, event.currentTarget, event.detail === 0)
                  : choose(item,event.currentTarget)
              }
            >
              <item.icon size={16} />
              <span>{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
              {item.group && (
                <ChevronRight className="menu-chevron" size={15} />
              )}
            </button>
          ))}
        </div>
        <footer>
          <Search size={12} />
          <span>↑ ↓ 이동 · Enter 선택 · Esc 닫기</span>
        </footer>
      </div>
      {group !== "main" && (
        <div
          ref={submenu}
          id={submenuId}
          className="file-context-menu context-submenu"
          role="menu"
          aria-label={`${groups[group].title} 하위 메뉴`}
          style={submenuPosition}
        >
          <header className="context-header">
            <button aria-label="상위 메뉴로" onClick={() => closeSubmenu(true)}>
              <ArrowLeft size={16} />
            </button>
            <div>
              <strong>{groups[group].title}</strong>
              <small>← 상위 메뉴로 이동</small>
            </div>
          </header>
          <div className="context-items">
            {groups[group].items.map((item) => (
              <button
                key={item.action}
                role="menuitem"
                className={`${item.separator ? "menu-separator" : ""} ${item.danger ? "menu-danger" : ""}`}
                disabled={item.disabled}
                onClick={event => choose(item,event.currentTarget)}
              >
                <item.icon size={16} />
                <span>{item.label}</span>
                {item.shortcut && <kbd>{item.shortcut}</kbd>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

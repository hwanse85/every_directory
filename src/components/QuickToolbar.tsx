import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, PencilLine, RotateCcw, type LucideIcon } from "lucide-react";

// 상단 도구 막대에 둘 수 있는 편의 기능 하나.
export interface ToolbarAction { id: string; label: string; icon: LucideIcon; run: () => void; detail?: string }

// 저장된 순서에서 알 수 없는 항목·중복을 버린다.
export function normalizeToolbar(value: unknown, known: string[], fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value.filter((id): id is string => typeof id === "string" && known.includes(id)))];
}

// 기본 아이콘(검색·도구·레이아웃·탐색창) 뒤에 사용자가 고른 편의 아이콘을 보여 주고, 추가·삭제·순서 변경을 편집한다.
export function QuickToolbar({ actions, items, defaults, onChange }: { actions: ToolbarAction[]; items: string[]; defaults: string[]; onChange: (items: string[]) => void }) {
  const [editing, setEditing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const byId = new Map(actions.map((action) => [action.id, action]));
  const shown = items.filter((id) => byId.has(id));
  // 상단 줄에 들어가는 아이콘 수. 남는 아이콘은 편집 단추의 팝업에서 바로 실행한다.
  const [limit, setLimit] = useState(Infinity);
  useLayoutEffect(() => {
    const toolbar = box.current, header = toolbar?.closest<HTMLElement>(".app-header");
    if (!toolbar || !header) return;
    // 이 아이콘 묶음을 뺀 상단 줄 내용의 실제 폭(여백·간격 포함)을 더한다.
    const widthOf = (container: Element): number => {
      const style = getComputedStyle(container);
      const children = [...container.children].filter((child) => { const look = getComputedStyle(child); return look.display !== "none" && look.position !== "absolute"; });
      const gap = parseFloat(style.columnGap) || 0;
      return children.reduce((sum, child) => sum + (child === toolbar ? 0 : child.contains(toolbar) ? widthOf(child) : child.getBoundingClientRect().width), 0)
        + gap * Math.max(0, children.length - 1) + (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    };
    const fit = () => setLimit(Math.max(0, Math.floor((header.clientWidth - widthOf(header) - 26 - 16) / 34)));
    const observer = new ResizeObserver(fit);
    observer.observe(header);
    fit();
    return () => observer.disconnect();
  }, [shown.length]);
  const visible = shown.slice(0, limit), hidden = shown.slice(limit);
  // 편집 목록: 표시 중인 항목을 순서대로 먼저, 나머지는 뒤에 둔다.
  const ordered = [...shown, ...actions.map((action) => action.id).filter((id) => !shown.includes(id))];
  useEffect(() => {
    if (!editing) return;
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setEditing(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setEditing(false);
      box.current?.querySelector<HTMLButtonElement>(".toolbar-edit-button")?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [editing]);
  // 표시 중인 항목의 순서를 한 칸 옮긴다.
  function move(id: string, delta: number) {
    const index = shown.indexOf(id), next = index + delta;
    if (index < 0 || next < 0 || next >= shown.length) return;
    const copy = [...shown];
    [copy[index], copy[next]] = [copy[next], copy[index]];
    onChange(copy);
  }
  return (
    <div className="quick-toolbar" ref={box} role="group" aria-label="편의 기능 아이콘"
      onContextMenu={(event) => { event.preventDefault(); setEditing(true); }}>
      {visible.map((id) => {
        const action = byId.get(id)!;
        const Icon = action.icon;
        return (
          <button key={id} className="icon-button quick-tool" data-tool={id} aria-label={action.label} title={action.detail ? `${action.label} · ${action.detail}` : action.label} onClick={action.run}>
            <Icon size={16} />
          </button>
        );
      })}
      <button className="icon-button toolbar-edit-button" aria-label="도구 막대 편집" aria-expanded={editing} title={hidden.length ? `창이 좁아 숨긴 아이콘 ${hidden.length}개 · 아이콘 추가·삭제·순서 바꾸기` : "아이콘 추가·삭제·순서 바꾸기 · 아이콘에서 우클릭해도 열림"} onClick={() => setEditing(!editing)}>
        <PencilLine size={15} />
        {hidden.length > 0 && <span className="toolbar-more-count">+{hidden.length}</span>}
      </button>
      {editing && (
        <div className="toolbar-editor" role="dialog" aria-label="도구 막대 편집">
          {hidden.length > 0 && (
            <div className="toolbar-overflow" role="group" aria-label="창이 좁아 숨긴 아이콘">
              {hidden.map((id) => {
                const action = byId.get(id)!;
                const Icon = action.icon;
                return <button key={id} data-tool={id} onClick={() => { setEditing(false); action.run(); }}><Icon size={15} aria-hidden="true" />{action.label}</button>;
              })}
            </div>
          )}
          <div className="popover-heading">도구 막대 편집</div>
          <p className="toolbar-editor-hint">검색·도구·레이아웃·탐색창은 기본 아이콘입니다. 그 뒤에 둘 아이콘을 고르고 ↑↓로 순서를 바꾸세요.</p>
          <ul>
            {ordered.map((id) => {
              const action = byId.get(id)!;
              const Icon = action.icon;
              const on = shown.includes(id);
              const index = shown.indexOf(id);
              return (
                <li key={id} className={on ? "on" : ""}>
                  <label>
                    <input type="checkbox" checked={on} aria-label={`${action.label} 표시`}
                      onChange={(event) => onChange(event.target.checked ? [...shown, id] : shown.filter((item) => item !== id))} />
                    <Icon size={15} aria-hidden="true" />
                    <span>{action.label}</span>
                  </label>
                  <button className="icon-button" aria-label={`${action.label} 앞으로`} disabled={!on || index === 0} onClick={() => move(id, -1)}><ArrowUp size={13} /></button>
                  <button className="icon-button" aria-label={`${action.label} 뒤로`} disabled={!on || index === shown.length - 1} onClick={() => move(id, 1)}><ArrowDown size={13} /></button>
                </li>
              );
            })}
          </ul>
          <button className="reset-layout" onClick={() => onChange(defaults)}>기본 아이콘으로 되돌리기 <RotateCcw size={12} /></button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Columns3, RotateCcw, X } from "lucide-react";
import {
  defaultSearchColumns,
  normalizeSearchColumns,
  searchColumnOptions,
  type SearchColumn,
} from "../searchColumns";

// 검색 결과 열을 선택하고 기본 구성을 복원하는 설정 창을 제공한다.
export function SearchColumnPicker({
  columns,
  onChange,
}: {
  columns: SearchColumn[];
  onChange: (columns: SearchColumn[]) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  // 키보드로 닫을 때 설정 버튼으로 초점을 돌려준다.
  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = panel.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        8,
        Math.min(
          anchor.right - bounds.width,
          window.innerWidth - bounds.width - 8,
        ),
      ),
      top: Math.max(
        8,
        Math.min(anchor.bottom + 6, window.innerHeight - bounds.height - 8),
      ),
    });
    panel.current
      .querySelector<HTMLInputElement>("input:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // 설정 창과 버튼 밖을 누르면 현재 선택을 유지하고 창만 닫는다.
    function outside(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !panel.current?.contains(target) &&
        !trigger.current?.contains(target)
      )
        close(false);
    }
    // 화면 크기가 바뀌면 이전 위치의 설정 창을 닫는다.
    function resize() {
      close(false);
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resize);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        className="search-columns-trigger"
        aria-label="검색 결과 표시 항목"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Columns3 size={13} />
        <span>표시 항목</span>
        <small>{columns.length}</small>
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            className="search-columns-picker"
            role="dialog"
            aria-label="검색 결과 표시 항목"
            style={position}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
          >
            <header>
              <div>
                <strong>검색 결과 표시 항목</strong>
                <p>보고 싶은 파일 속성을 선택하세요.</p>
              </div>
              <button
                className="icon-button"
                aria-label="표시 항목 닫기"
                onClick={() => close()}
              >
                <X size={16} />
              </button>
            </header>
            <div className="search-column-options">
              {searchColumnOptions.map((column) => (
                <label key={column.id}>
                  <input
                    type="checkbox"
                    checked={columns.includes(column.id)}
                    disabled={column.id === "name"}
                    onChange={(event) =>
                      onChange(
                        normalizeSearchColumns(
                          event.target.checked
                            ? [...columns, column.id]
                            : columns.filter((id) => id !== column.id),
                        ),
                      )
                    }
                  />
                  <span>
                    <strong>
                      {column.label}
                      {column.id === "name" && <small>항상 표시</small>}
                    </strong>
                    <small>{column.hint}</small>
                  </span>
                </label>
              ))}
            </div>
            <footer>
              <span>자동 저장 · 열이 많으면 가로로 스크롤</span>
              <button onClick={() => onChange([...defaultSearchColumns])}>
                <RotateCcw size={12} />
                기본값
              </button>
            </footer>
          </div>,
          document.body,
        )}
    </>
  );
}

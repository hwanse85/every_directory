import type { PointerEvent as ReactPointerEvent } from "react";
import type { Location } from "./types";

export interface FileDrag {
  phase: "over" | "drop" | "leave";
  entries: Location[];
  x: number;
  y: number;
}

// Windows의 네이티브 외부 파일 드롭과 충돌하지 않도록 앱 내부 드래그는 포인터로 처리한다.
export function startFileDrag(event: ReactPointerEvent, entries: Location[]): void {
  if (event.button !== 0 || (event.target as Element).closest("input,button")) return;
  const origin = { x: event.clientX, y: event.clientY };
  let dragging = false;
  let ghost: HTMLDivElement | undefined;
  const emit = (phase: FileDrag["phase"], e: PointerEvent) =>
    window.dispatchEvent(new CustomEvent<FileDrag>("ed-file-drag", {
      detail: { phase, entries, x: e.clientX, y: e.clientY },
    }));
  const cleanup = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("keydown", escape);
    ghost?.remove();
  };
  const cancel = () => {
    cleanup();
    window.dispatchEvent(new CustomEvent<FileDrag>("ed-file-drag", {
      detail: { phase: "leave", entries, x: -1, y: -1 },
    }));
  };
  const escape = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
  const move = (e: PointerEvent) => {
    if (!dragging && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 6) return;
    if (!dragging) {
      dragging = true;
      ghost = document.createElement("div");
      ghost.className = "file-drag-ghost";
      ghost.textContent = `${entries.length}개 항목`;
      document.body.append(ghost);
    }
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    ghost!.style.left = `${e.clientX + 14}px`;
    ghost!.style.top = `${e.clientY + 14}px`;
    emit("over", e);
  };
  const up = (e: PointerEvent) => {
    if (dragging) {
      e.preventDefault();
      const suppress = (click: MouseEvent) => { click.preventDefault(); click.stopPropagation(); };
      document.addEventListener("click", suppress, { capture: true, once: true });
      setTimeout(() => document.removeEventListener("click", suppress, true), 0);
      emit("drop", e);
    }
    cleanup();
  };
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  window.addEventListener("keydown", escape);
}

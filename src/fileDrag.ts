import type { PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Location } from "./types";

export interface FileDrag {
  // native: 창 밖으로 나가 운영체제 드래그로 넘겼다. 앱 안의 놓을 곳 표시는 지운다.
  phase: "over" | "drop" | "leave" | "native";
  entries: Location[];
  x: number;
  y: number;
}

// 운영체제 드래그를 시작하지 못한 이유를 알림으로 표시할 수 있게 전달한다.
export const fileDragErrorEvent = "ed-file-drag-error";

// Windows의 네이티브 외부 파일 드롭과 충돌하지 않도록 앱 내부 드래그는 포인터로 처리한다.
// 포인터가 창 밖으로 나가면 운영체제 드래그로 넘겨 브라우저·탐색기·Finder 같은 다른 앱에 놓을 수 있게 한다.
// immediate는 앱 안에 놓을 곳이 없는 빠른 검색처럼 끌기 시작부터 운영체제 드래그를 쓴다.
export function startFileDrag(event: ReactPointerEvent, entries: Location[], options: { immediate?: boolean } = {}): void {
  if (event.button !== 0 || (event.target as Element).closest("input,button")) return;
  const origin = { x: event.clientX, y: event.clientY };
  let dragging = false;
  let ghost: HTMLDivElement | undefined;
  const outside = (e: MouseEvent) =>
    e.clientX < 0 || e.clientY < 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight;
  // 앱 내부 끌기를 끝내고 같은 항목으로 운영체제 드래그를 시작한다.
  const handOff = (e: PointerEvent | MouseEvent) => {
    cleanup();
    window.dispatchEvent(new CustomEvent<FileDrag>("ed-file-drag", {
      detail: { phase: "native", entries, x: e.clientX, y: e.clientY },
    }));
    void invoke("drag_files", { locations: entries }).catch((cause) =>
      window.dispatchEvent(new CustomEvent<string>(fileDragErrorEvent, { detail: String(cause) })),
    );
  };
  // 버튼을 누른 채 문서 밖으로 나가는 경우도 운영체제 드래그로 넘긴다.
  const leave = (e: MouseEvent) => {
    if (dragging && !e.relatedTarget && e.buttons & 1) handOff(e);
  };
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
    document.removeEventListener("mouseout", leave);
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
    // 단추를 놓는 이벤트를 놓쳤다면 끌기를 끝낸다.
    if (!(e.buttons & 1)) return cancel();
    if (!dragging && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < 6) return;
    if (options.immediate || (dragging && outside(e))) {
      e.preventDefault();
      dragging = true;
      handOff(e);
      return;
    }
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
  document.addEventListener("mouseout", leave);
}

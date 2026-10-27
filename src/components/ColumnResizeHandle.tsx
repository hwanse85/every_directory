import { useEffect, useRef } from "react";
import { clampColumnWidth, minimumColumnWidth } from "../columnWidths";
import type { SearchColumn } from "../searchColumns";

export function ColumnResizeHandle({id, label, width, onResize, onFit, onCancel}: {
  id: SearchColumn; label: string; width: number;
  onResize: (width: number, persist: boolean) => void; onFit: () => void;
  onCancel: () => void;
}) {
  const drag = useRef<{x: number; width: number; current: number; pointer: number} | undefined>(undefined);
  useEffect(() => () => document.documentElement.classList.remove("resizing-column"), []);
  return <span role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={`${label} 칼럼 너비`} aria-valuemin={minimumColumnWidth(id)} aria-valuemax={2000} aria-valuenow={Math.round(width)}
    className="column-resizer" title="드래그로 너비 조절 · 더블클릭 자동 맞춤 · ←/→ 조절 · Esc 취소"
    onClick={event => {event.preventDefault();event.stopPropagation();}}
    onDoubleClick={event => {event.preventDefault();event.stopPropagation();onFit();}}
    onPointerDown={event => {
      if(event.button!==0)return;
      event.preventDefault();event.stopPropagation();
      event.currentTarget.focus({preventScroll:true});
      drag.current={x:event.clientX,width,current:width,pointer:event.pointerId};
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Detached/synthetic pointers have no capture target. */ }
      document.documentElement.classList.add("resizing-column");
    }}
    onPointerMove={event => {
      const current=drag.current;if(!current)return;
      current.current=clampColumnWidth(id,current.width+event.clientX-current.x);
      onResize(current.current,false);
    }}
    onPointerUp={event => {
      if(!drag.current)return;
      const current=drag.current.current;drag.current=undefined;
      document.documentElement.classList.remove("resizing-column");
      if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
      onResize(current,true);
    }}
    onPointerCancel={() => {if(drag.current)onCancel();drag.current=undefined;document.documentElement.classList.remove("resizing-column");}}
    onLostPointerCapture={() => {if(drag.current){onResize(drag.current.current,true);drag.current=undefined;}document.documentElement.classList.remove("resizing-column");}}
    onKeyDown={event => {
      if(event.key==="Escape"&&drag.current){event.preventDefault();event.stopPropagation();onCancel();drag.current=undefined;document.documentElement.classList.remove("resizing-column");}
      else if(event.key==="ArrowLeft"||event.key==="ArrowRight"){
        event.preventDefault();event.stopPropagation();onResize(clampColumnWidth(id,width+(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?40:10)),true);
      }else if(event.key==="Enter"){event.preventDefault();event.stopPropagation();onFit();}
    }} />;
}

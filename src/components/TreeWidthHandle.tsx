import {useEffect,useRef,type PointerEvent} from "react";

export const treeWidth=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?Math.round(Math.max(80,Math.min(600,value))):165;
export function TreeWidthHandle({width,onChange}:{width:number;onChange:(width:number)=>void}){
  const drag=useRef<{x:number;width:number;original:number;pointer:number}|undefined>(undefined);
  const stop=()=>{drag.current=undefined;document.documentElement.classList.remove("resizing-column");};
  useEffect(()=>stop,[]);
  function down(event:PointerEvent<HTMLDivElement>){if(event.button!==0)return;event.preventDefault();drag.current={x:event.clientX,width:event.currentTarget.previousElementSibling?.getBoundingClientRect().width??width,original:width,pointer:event.pointerId};try{event.currentTarget.setPointerCapture(event.pointerId);}catch{}document.documentElement.classList.add("resizing-column");}
  return <div className="tree-width-handle" role="separator" aria-label="폴더 트리 너비 조절" aria-orientation="vertical" aria-valuenow={width} aria-valuemin={80} aria-valuemax={600} tabIndex={0}
    title="드래그로 너비 조절 · 방향키 10px · 더블클릭 기본값"
    onPointerDown={down} onPointerMove={event=>{if(drag.current)onChange(treeWidth(drag.current.width+event.clientX-drag.current.x));}}
    onPointerUp={stop} onPointerCancel={()=>{if(drag.current)onChange(drag.current.original);stop();}} onLostPointerCapture={stop}
    onDoubleClick={()=>onChange(165)} onKeyDown={event=>{if(event.key==="Escape"&&drag.current){event.preventDefault();onChange(drag.current.original);stop();}else if(["ArrowLeft","ArrowRight","Home"].includes(event.key)){event.preventDefault();onChange(event.key==="Home"?165:treeWidth(width+(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?40:10)));}}}/>;
}

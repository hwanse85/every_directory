import {useRef,useState,type PointerEvent} from "react";

// Pointer capture works with Tauri's native file-drop handler enabled on Windows.
export function useTabReorder(onMove:(id:string,target:string,after:boolean)=>void){
  const latest=useRef(onMove);latest.current=onMove;
  const pending=useRef<{id:string;x:number;y:number;active:boolean;target?:string;after:boolean}|undefined>(undefined);
  const suppress=useRef<string|undefined>(undefined);
  const [visual,setVisual]=useState<{id:string;target?:string;after:boolean}>();
  const clear=()=>{pending.current=undefined;setVisual(undefined);};
  return {
    visual,
    suppressClick:(id:string)=>{if(suppress.current===id){suppress.current=undefined;return true;}return false;},
    onPointerDown:(event:PointerEvent<HTMLDivElement>)=>{
      if(event.button!==0||!(event.target as Element).closest('[role="tab"]'))return;
      const id=event.currentTarget.dataset.tabId!;pending.current={id,x:event.clientX,y:event.clientY,active:false,after:false};
      const button=(event.target as Element).closest<HTMLElement>('[role="tab"]')!;
      try{button.setPointerCapture(event.pointerId);}catch{/* Synthetic pointers have no OS capture. */}
    },
    onPointerMove:(event:PointerEvent<HTMLDivElement>)=>{
      const drag=pending.current;if(!drag)return;
      if(!drag.active&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;
      drag.active=true;event.preventDefault();
      const strip=event.currentTarget.closest<HTMLElement>('.explorer-tabs')!;
      const bounds=strip.getBoundingClientRect();
      if(event.clientX>bounds.right-24)strip.scrollLeft+=12;else if(event.clientX<bounds.left+24)strip.scrollLeft-=12;
      const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-tab-id]');
      if(target&&target.closest('.explorer-tabs')===strip){drag.target=target.dataset.tabId;const box=target.getBoundingClientRect();drag.after=event.clientX>box.left+box.width/2;}
      setVisual({id:drag.id,target:drag.target,after:drag.after});
    },
    onPointerUp:(event:PointerEvent<HTMLDivElement>)=>{
      const drag=pending.current;if(!drag)return;
      if(drag.active){event.preventDefault();suppress.current=drag.id;if(drag.target&&drag.target!==drag.id)latest.current(drag.id,drag.target,drag.after);requestAnimationFrame(()=>{suppress.current=undefined;});}
      clear();
    },
    onPointerCancel:clear,
    onLostPointerCapture:clear,
  };
}

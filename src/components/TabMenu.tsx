import {useEffect,useRef} from "react";
import {createPortal} from "react-dom";

export function TabMenu({x,y,items,onClose}:{x:number;y:number;items:{label:string;disabled?:boolean;run:()=>void}[];onClose:()=>void}){
  const menu=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
    const outside=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node))onClose();};
    const resize=()=>onClose();document.addEventListener("pointerdown",outside);window.addEventListener("resize",resize);
    return()=>{document.removeEventListener("pointerdown",outside);window.removeEventListener("resize",resize);};
  },[onClose]);
  return createPortal(<div ref={menu} className="tab-context-menu" role="menu" aria-label="탐색 탭 메뉴" style={{left:Math.max(8,Math.min(x,innerWidth-236)),top:Math.max(8,Math.min(y,innerHeight-items.length*34-20))}}
    onContextMenu={event=>event.preventDefault()} onKeyDown={event=>{
      const buttons=[...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onClose();}
      else if(["ArrowDown","ArrowUp","Home","End"].includes(event.key)){event.preventDefault();event.stopPropagation();const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowDown"?1:buttons.length-1))%buttons.length;buttons[next]?.focus();}
    }}>
    {items.map(item=><button key={item.label} role="menuitem" disabled={item.disabled} onClick={()=>{onClose();item.run();}}>{item.label}</button>)}
  </div>,document.body);
}

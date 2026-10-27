import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder, LoaderCircle } from "lucide-react";
import type { IndexClient } from "../client";
import type { ConnectedRoot, FileEntry, Location } from "../types";
import { fileCollator } from "../search";
import { readPreference, savePreference } from "../storage";
import { onTreePath, restoreTreeExpansion, treeAncestors, treeKey } from "../treePaths";

interface TreeContext {
  current: Location; client: IndexClient; revision: number; showHidden: boolean;
  expanded: Set<string>; toggle: (key:string) => void;
  onNavigate: (location:Location,newTab?:boolean) => void;
}

// Only load expanded branches. Reveal ancestors without moving keyboard focus.
function Branch({name,location,context,depth=0}:{name:string;location:Location;context:TreeContext;depth?:number}) {
  const key=treeKey(location),open=context.expanded.has(key);
  const selected=context.current.rootId===location.rootId&&context.current.path===location.path;
  const [children,setChildren]=useState<FileEntry[]>([]);
  const [loading,setLoading]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  const item=useRef<HTMLDivElement>(null);
  useEffect(()=>{setLoaded(false);},[context.revision]);
  useEffect(()=>{
    if(!open){setLoading(false);return;}
    let alive=true;setLoading(true);setError("");
    context.client.request<FileEntry[]>("list",location).then(items=>{
      if(alive){setChildren(items.filter(entry=>entry.kind==="directory").sort((a,b)=>fileCollator.compare(a.name,b.name)));setLoaded(true);}
    }).catch(cause=>{if(alive)setError(String(cause));}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[open,location.rootId,location.path,context.client,context.revision,retry]);
  useEffect(()=>{
    if(!selected)return;
    const frame=requestAnimationFrame(()=>item.current?.scrollIntoView({block:"nearest",inline:"nearest"}));
    return()=>cancelAnimationFrame(frame);
  },[selected]);
  const visible=children.filter(entry=>context.showHidden||!(entry.hidden||entry.name.startsWith("."))||onTreePath({rootId:entry.rootId,path:entry.path},context.current));
  const expandable=!loaded||Boolean(visible.length)||Boolean(error);
  return <div ref={item} className="tree-node" role="treeitem" tabIndex={-1} aria-label={name} aria-level={depth+1}
    aria-selected={selected} aria-expanded={expandable?open:undefined} aria-busy={loading||undefined}
    data-tree-key={key} data-tree-location={JSON.stringify(location)}>
    <div className={`tree-folder ${selected?"current":""}`} style={{paddingLeft:depth*12}} data-drop-location={JSON.stringify(location)}>
      <button className="tree-toggle" tabIndex={-1} aria-label={`${name} ${open?"접기":"펼치기"}`}
        disabled={!expandable} onClick={()=>{context.toggle(key);item.current?.focus({preventScroll:true});}}>
        {loading?<LoaderCircle size={12} className="spin"/>:!expandable?<span className="tree-leaf-spacer"/>:open?<ChevronDown size={12}/>:<ChevronRight size={12}/>}
      </button>
      <button className="tree-name" tabIndex={-1} title={`${name} · Ctrl+클릭으로 새 탭`}
        onClick={event=>{item.current?.focus({preventScroll:true});context.onNavigate(location,event.ctrlKey||event.metaKey);}}
        onAuxClick={event=>{if(event.button===1){event.preventDefault();context.onNavigate(location,true);}}}>
        <Folder size={13}/><span>{name}</span>
      </button>
    </div>
    {open&&<div role="group">
      {error?<div className="tree-error" role="alert"><span>{error}</span><button onClick={()=>setRetry(value=>value+1)}>다시 시도</button></div>
        :visible.map(child=><Branch key={child.id} name={child.name} location={{rootId:child.rootId,path:child.path}} context={context} depth={depth+1}/>)}
    </div>}
  </div>;
}

export function FolderTree({roots,location,client,revision,onNavigate,storageKey,showHidden,label,width=165}:{
  roots:ConnectedRoot[];location:Location;client:IndexClient;revision:number;
  onNavigate:(location:Location,newTab?:boolean)=>void;storageKey:string;showHidden:boolean;label:string;width?:number;
}) {
  const [expanded,setExpanded]=useState(()=>restoreTreeExpansion(readPreference(storageKey,[]),location));
  const tree=useRef<HTMLElement>(null);
  useEffect(()=>{setExpanded(previous=>new Set([...previous,...treeAncestors(location)]));},[location.rootId,location.path]);
  useEffect(()=>{savePreference(storageKey,[...expanded].slice(-512));},[expanded,storageKey]);
  const toggle=(key:string)=>setExpanded(previous=>{const next=new Set(previous);if(next.has(key))next.delete(key);else next.add(key);return next;});
  const context:TreeContext={current:location,client,revision,showHidden,expanded,toggle,onNavigate};
  return <aside ref={tree} style={{width}} className="folder-tree" role="tree" aria-label={label} tabIndex={0}
    onFocus={event=>{if(event.target===event.currentTarget)tree.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({preventScroll:true});}}
    onKeyDown={event=>{
      if((event.target as HTMLElement).closest("button"))return;
      const current=(event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');if(!current)return;
      const nodes=[...tree.current!.querySelectorAll<HTMLElement>('[role="treeitem"]')];
      const index=nodes.indexOf(current),key=current.dataset.treeKey!;
      const focus=(element:HTMLElement|undefined|null)=>{element?.focus({preventScroll:true});element?.scrollIntoView({block:"nearest",inline:"nearest"});};
      if(["ArrowUp","ArrowDown","Home","End","ArrowLeft","ArrowRight","Enter"," "].includes(event.key)){
        event.preventDefault();event.stopPropagation();
        if(event.key==="ArrowDown")focus(nodes[Math.min(nodes.length-1,index+1)]);
        else if(event.key==="ArrowUp")focus(nodes[Math.max(0,index-1)]);
        else if(event.key==="Home")focus(nodes[0]);
        else if(event.key==="End")focus(nodes.at(-1));
        else if(event.key==="ArrowRight"){
          if(current.getAttribute("aria-expanded")==="false")toggle(key);
          else focus(current.querySelector<HTMLElement>('[role="group"] > [role="treeitem"]'));
        }else if(event.key==="ArrowLeft"){
          if(current.getAttribute("aria-expanded")==="true")toggle(key);
          else focus(current.parentElement?.closest<HTMLElement>('[role="treeitem"]'));
        }else onNavigate(JSON.parse(current.dataset.treeLocation!),event.ctrlKey||event.metaKey);
      }
    }}>
    {roots.map(root=><Branch key={root.id} name={root.name} location={{rootId:root.id,path:""}} context={context}/>)}
  </aside>;
}

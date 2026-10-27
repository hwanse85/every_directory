import {readPreference} from "./storage";
import type { ExplorerPane, ExplorerTab, Location } from "./types";
import {normalizeExplorerView} from "./explorerView";
import {normalizeSearchColumns,normalizeTableSort,searchColumnOptions} from "./searchColumns";

export function tabColor(color: unknown): string | undefined {
  return typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)
    ? color
    : undefined;
}

// 새 탭은 색상을 상속하지 않고 독립적인 이동 기록으로 시작한다.
export function createTab(location: Location): ExplorerTab {
  return { id: crypto.randomUUID(), history: [{ ...location }], cursor: 0 };
}

export function createPane(location: Location): ExplorerPane {
  const tab = createTab(location);
  return {
    id: crypto.randomUUID(),
    tabs: [tab],
    activeTab: tab.id,
    view: normalizeExplorerView(readPreference<{defaultExplorerView?:unknown}>("preferences",{}).defaultExplorerView),
  };
}

export function duplicateTab(tab:ExplorerTab):ExplorerTab {
  return {id:crypto.randomUUID(),history:tab.history.map(location=>({...location})),cursor:tab.cursor,...(tab.title?{title:tab.title}:{})};
}
export function closedTabSnapshot(tab:ExplorerTab):ExplorerTab {
  return {...tab,history:tab.history.map(location=>({...location})),locked:false};
}
export function moveTab(tabs:ExplorerTab[],id:string,before:string,after=false):ExplorerTab[] {
  if(id===before||!tabs.some(tab=>tab.id===id)||!tabs.some(tab=>tab.id===before))return tabs;
  const moved=tabs.find(tab=>tab.id===id)!,next=tabs.filter(tab=>tab.id!==id);
  next.splice(next.findIndex(tab=>tab.id===before)+(after?1:0),0,moved);return next;
}
export function restoreClosedTabs(value:unknown):ExplorerTab[] {
  if(!Array.isArray(value))return [];
  return value.filter((tab):tab is ExplorerTab=>Boolean(tab&&typeof tab.id==="string"&&Array.isArray(tab.history)&&tab.history.length&&Number.isInteger(tab.cursor)&&tab.cursor>=0&&tab.cursor<tab.history.length&&tab.history.every((location:Location)=>location&&typeof location.rootId==="string"&&typeof location.path==="string"))).slice(-20).map(tab=>({...tab,color:tabColor(tab.color),title:typeof tab.title==="string"?tab.title.trim().slice(0,64)||undefined:undefined,locked:false,history:tab.history.map(location=>({...location}))}));
}

// A damaged preference must not prevent the workspace from opening.
export function restorePaneState(value:unknown,fallback:ExplorerPane[]):ExplorerPane[] {
  if(!Array.isArray(value)||value.length<1||value.length>4)return fallback;
  const ids=new Set<string>();
  const panes:ExplorerPane[]=[];
  for(const candidate of value){
    if(!candidate||typeof candidate.id!=="string"||!candidate.id||ids.has(candidate.id)||!Array.isArray(candidate.tabs)||!candidate.tabs.length)return fallback;
    ids.add(candidate.id);const tabIds=new Set<string>();
    const tabs:ExplorerTab[]=[];
    for(const tab of candidate.tabs){
      if(!tab||typeof tab.id!=="string"||!tab.id||tabIds.has(tab.id)||!Array.isArray(tab.history)||!tab.history.length||!Number.isInteger(tab.cursor)||tab.cursor<0||tab.cursor>=tab.history.length||!tab.history.every((location:Location)=>location&&typeof location.rootId==="string"&&typeof location.path==="string"))return fallback;
      tabIds.add(tab.id);tabs.push({id:tab.id,history:tab.history.map((location:Location)=>({rootId:location.rootId,path:location.path})),cursor:tab.cursor,color:tabColor(tab.color),title:typeof tab.title==="string"?tab.title.trim().slice(0,64)||undefined:undefined,locked:tab.locked===true});
    }
    panes.push({id:candidate.id,tabs,activeTab:tabIds.has(candidate.activeTab)?candidate.activeTab:tabs[0].id,view:normalizeExplorerView(candidate.view),columns:candidate.columns?normalizeSearchColumns(candidate.columns):undefined,sort:normalizeTableSort(candidate.sort),group:searchColumnOptions.some(column=>column.id===candidate.group)?candidate.group:"none"});
  }
  return panes;
}

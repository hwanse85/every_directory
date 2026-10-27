import type {ConnectedRoot,ExplorerView,FileEntry,SearchSortKey} from "./types";
import {searchColumnValue} from "./searchColumns";
import {choseong,fileCollator} from "./search";

export const explorerViews:{id:ExplorerView;label:string}[]=[{id:"icons-extra",label:"아주 큰 아이콘"},{id:"icons-large",label:"큰 아이콘"},{id:"icons-medium",label:"보통 아이콘"},{id:"icons-small",label:"작은 아이콘"},{id:"compact",label:"간단히"},{id:"list",label:"자세히"},{id:"grid",label:"타일"},{id:"content",label:"내용"}];
export const defaultExplorerColumns:SearchSortKey[]=["name","extension","size","modified"];
export function normalizeExplorerView(value:unknown):ExplorerView{return explorerViews.some(view=>view.id===value)?value as ExplorerView:"list";}
export type GroupRow={kind:"group";label:string;count:number}|{kind:"entry";entry:FileEntry;index:number};
export function groupedEntries(entries:FileEntry[],by:SearchSortKey|"none"="none",roots:ConnectedRoot[]=[],now=Date.now()):{entries:FileEntry[];rows:GroupRow[]}{
  if(by==="none")return {entries,rows:entries.map((entry,index)=>({kind:"entry",entry,index}))};
  const buckets=new Map<string,{label:string;rank:number;entries:FileEntry[]}>();
  const midnight=new Date(now);midnight.setHours(0,0,0,0);
  for(const entry of entries){
    let label:string,rank=0;
    if(by==="name"){label=choseong(entry.name.trim()[0]??"#").toLocaleUpperCase();if(!/[\p{L}\p{N}]/u.test(label))label="#";}
    else if(["modified","created","accessed"].includes(by)){
      const timestamp=entry[by as "modified"|"created"|"accessed"];
      const days=timestamp?Math.floor((midnight.getTime()-new Date(new Date(timestamp).setHours(0,0,0,0)).getTime())/86400000):Infinity;
      rank=days<0?0:days===0?1:days===1?2:days<7?3:days<30?4:days<Infinity?5:6;
      label=["이후","오늘","어제","최근 7일","최근 30일","이전","알 수 없음"][rank];
    }else if(by==="size"){
      rank=entry.kind==="directory"?0:entry.size===undefined?6:entry.size===0?1:entry.size<1024?2:entry.size<1024*1024?3:entry.size<1024**3?4:5;
      label=["폴더","빈 파일","1KB 미만","1KB–1MB","1MB–1GB","1GB 이상","알 수 없음"][rank];
    }else label=String(searchColumnValue(entry,roots.find(root=>root.id===entry.rootId),by))||"미지정";
    const key=`${rank}:${label}`;let bucket=buckets.get(key);if(!bucket){bucket={label,rank,entries:[]};buckets.set(key,bucket);}bucket.entries.push(entry);
  }
  const ordered:FileEntry[]=[],rows:GroupRow[]=[];
  for(const group of [...buckets.values()].sort((a,b)=>a.rank-b.rank||fileCollator.compare(a.label,b.label))){rows.push({kind:"group",label:group.label,count:group.entries.length});for(const entry of group.entries){rows.push({kind:"entry",entry,index:ordered.length});ordered.push(entry);}}
  return {entries:ordered,rows};
}

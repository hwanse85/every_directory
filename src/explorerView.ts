import type {ConnectedRoot,ExplorerView,FileEntry,SearchSortKey} from "./types";
import {searchColumnOptions,searchColumnValue} from "./searchColumns";
import {choseong,fileCollator} from "./search";

export const explorerViews:{id:ExplorerView;label:string}[]=[{id:"icons-extra",label:"아주 큰 아이콘"},{id:"icons-large",label:"큰 아이콘"},{id:"icons-medium",label:"보통 아이콘"},{id:"icons-small",label:"작은 아이콘"},{id:"compact",label:"간단히"},{id:"list",label:"자세히"},{id:"grid",label:"타일"},{id:"content",label:"내용"}];
export const defaultExplorerColumns:SearchSortKey[]=["name","extension","size","modified"];
export function normalizeExplorerView(value:unknown):ExplorerView{return explorerViews.some(view=>view.id===value)?value as ExplorerView:"list";}
// 탐색창 정렬: 폴더 먼저 → 고른 속성 → 같으면 이름(자연 순서) → 그래도 같으면 id.
// 표시·전체 선택·내보내기가 모두 이 순서를 쓴다.
export function sortEntries(entries:FileEntry[],roots:ConnectedRoot[],key:SearchSortKey="name",descending=false):FileEntry[]{
  const rootById=new Map(roots.map(root=>[root.id,root]));
  // 고른 속성 값끼리 비교한다(숫자는 크기, 글자는 파일 이름 규칙).
  const compareValue=(a:FileEntry,b:FileEntry)=>{
    const first=searchColumnValue(a,rootById.get(a.rootId),key),second=searchColumnValue(b,rootById.get(b.rootId),key);
    return typeof first==="number"&&typeof second==="number"?first-second:fileCollator.compare(String(first),String(second));
  };
  return [...entries].sort((a,b)=>
    Number(b.kind==="directory")-Number(a.kind==="directory")||
    compareValue(a,b)*(descending?-1:1)||
    (key==="name"?0:fileCollator.compare(a.name,b.name))||
    fileCollator.compare(a.id,b.id));
}
export type GroupRow={kind:"group";label:string;count:number}|{kind:"entry";entry:FileEntry;index:number};
// 분류(그룹)할 수 있는 기준. 전체 경로는 항목마다 묶음이 하나씩 생겨 분류 의미가 없으므로 뺀다.
export const explorerGroupOptions=searchColumnOptions.filter(column=>column.id!=="fullPath");
// 겹자음은 Windows 탐색기처럼 기본 자음 묶음에 넣는다(ㄲ → ㄱ).
const baseInitial:Record<string,string>={"ㄲ":"ㄱ","ㄸ":"ㄷ","ㅃ":"ㅂ","ㅆ":"ㅅ","ㅉ":"ㅈ"};
// 이름 첫 글자 묶음: 숫자 → 0–9, 영문 → 대문자, 한글 → 초성, 그 밖의 글자 → #
function nameGroup(name:string):string{
  const first=choseong(name.trim()[0]??"").toLocaleUpperCase();
  if(/^\p{N}$/u.test(first))return "0–9";
  if(!/^\p{L}$/u.test(first))return "#";
  return baseInitial[first]??first;
}
// 탐색창 분류: 이미 정렬된 항목을 기준별 묶음으로 나눈다. 묶음 안 순서는 정렬 순서를 그대로 따른다.
// 폴더 묶음은 정렬 규칙(폴더 먼저)처럼 맨 앞, 값을 모르는 묶음은 맨 뒤에 둔다.
// 묶음 순서: 분류 기준과 정렬 기준이 같으면 정렬 방향을 따르고, 다르면 날짜는 최근 것부터, 나머지는 오름차순이다.
export function groupedEntries(entries:FileEntry[],by:SearchSortKey|"none"="none",roots:ConnectedRoot[]=[],now=Date.now(),sort?:{key:SearchSortKey;descending:boolean}):{entries:FileEntry[];rows:GroupRow[]}{
  if(by==="none")return {entries,rows:entries.map((entry,index)=>({kind:"entry",entry,index}))};
  // rank: 0 폴더(맨 앞) · 1 일반 값 · 2 알 수 없음(맨 뒤). order는 같은 rank 안에서 묶음 순서를 정한다.
  const buckets=new Map<string,{label:string;rank:number;order:number;entries:FileEntry[]}>();
  const midnight=new Date(now);midnight.setHours(0,0,0,0);
  for(const entry of entries){
    let label:string,rank=1,order=0;
    if(by==="name")label=nameGroup(entry.name);
    else if(by==="modified"||by==="created"||by==="accessed"){
      const timestamp=entry[by];
      const days=timestamp?Math.floor((midnight.getTime()-new Date(new Date(timestamp).setHours(0,0,0,0)).getTime())/86400000):Infinity;
      // 오래된 날짜일수록 order가 작다(오름차순 = 오래된 것부터, 날짜 정렬과 같은 방향).
      order=days<0?5:days===0?4:days===1?3:days<7?2:days<30?1:0;
      label=days===Infinity?"알 수 없음":["이전","최근 30일","최근 7일","어제","오늘","이후"][order];
      if(days===Infinity)rank=2;
    }else if(by==="size"){
      if(entry.kind==="directory"){rank=0;label="폴더";}
      else if(entry.size===undefined){rank=2;label="알 수 없음";}
      else{order=entry.size===0?0:entry.size<1024?1:entry.size<1024*1024?2:entry.size<1024**3?3:4;label=["빈 파일","1KB 미만","1KB–1MB","1MB–1GB","1GB 이상"][order];}
    }else if(entry.kind==="directory"&&(by==="type"||by==="extension")){rank=0;label="폴더";}
    else if(by==="attributes")label=String(searchColumnValue(entry,undefined,by))||"일반";
    else if(by==="extension")label=entry.extension?entry.extension.toUpperCase():"확장자 없음";
    else label=String(searchColumnValue(entry,roots.find(root=>root.id===entry.rootId),by))||"미지정";
    const key=`${rank}:${label}`;let bucket=buckets.get(key);if(!bucket){bucket={label,rank,order,entries:[]};buckets.set(key,bucket);}bucket.entries.push(entry);
  }
  const dates=by==="modified"||by==="created"||by==="accessed";
  const direction=(sort?.key===by?sort.descending:dates)?-1:1;
  const ordered:FileEntry[]=[],rows:GroupRow[]=[];
  for(const group of [...buckets.values()].sort((a,b)=>a.rank-b.rank||((a.order-b.order)||fileCollator.compare(a.label,b.label))*direction)){rows.push({kind:"group",label:group.label,count:group.entries.length});for(const entry of group.entries){rows.push({kind:"entry",entry,index:ordered.length});ordered.push(entry);}}
  return {entries:ordered,rows};
}

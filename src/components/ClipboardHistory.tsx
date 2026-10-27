import {useEffect,useRef,useState} from "react";
import {invoke,isTauri} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
import {writeClipboard,quickControl} from "../client";
import {usePreferences,updatePreferences} from "../preferences";
import {formatSize} from "./FileIcon";
interface Clip {id:string;kind:string;preview:string;createdAt:number;bytes:number;favorite:boolean}
interface Content {kind:string;text:string;paths:string[];png:number[]}
interface Snapshot {items:Clip[];error?:string;bytes:number;quota:number;enabled:boolean;days:number}
export function clipboardAction<T=Snapshot>(action:string,id?:string,destination?:string,query?:string):Promise<T>{return invoke<T>("clipboard_control",{action,id:id??null,destination:destination??null,query:query??null});}
export function ClipboardHistory({compact=false,onClose}:{compact?:boolean;onClose?:()=>void}){
 const {preferences}=usePreferences();const [snapshot,setSnapshot]=useState<Snapshot>();const [query,setQuery]=useState("");const [type,setType]=useState("all");const [favorites,setFavorites]=useState(false);const [clearConfirm,setClearConfirm]=useState(false);const [selected,setSelected]=useState("");const [content,setContent]=useState<Content>();const [image,setImage]=useState("");const [error,setError]=useState("");const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);const [limit,setLimit]=useState(100);const input=useRef<HTMLInputElement>(null);const queryRef=useRef(query);queryRef.current=query;const request=useRef(0);
 const items=(snapshot?.items??[]).filter(c=>(type==="all"||c.kind===type)&&(!favorites||c.favorite));const item=items.find(c=>c.id===selected)??items[0];
 async function refresh(){const version=++request.current;try{const result=await clipboardAction("list",undefined,undefined,queryRef.current);if(version===request.current){setSnapshot(result);setError("");}}catch(e){if(version===request.current)setError(String(e));}}
 useEffect(()=>{if(!isTauri())return;void refresh();input.current?.focus();let disposed=false,remove:(()=>void)|undefined;void listen("ed-clipboard-changed",()=>void refresh()).then(fn=>{if(disposed)fn();else remove=fn;});let removeError:(()=>void)|undefined;void listen<string>("ed-clipboard-error",event=>setError(event.payload)).then(fn=>{if(disposed)fn();else removeError=fn;});const timer=setInterval(()=>void refresh(),3000);return()=>{disposed=true;request.current++;remove?.();removeError?.();clearInterval(timer);};},[]);
 useEffect(()=>{const timer=setTimeout(()=>{if(isTauri())void refresh();},180);return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{let alive=true;setContent(undefined);if(item)void clipboardAction<Content>("read",item.id).then(c=>{if(alive)setContent(c);}).catch(e=>{if(alive)setError(String(e));});return()=>{alive=false;};},[item?.id]);
 useEffect(()=>{if(!content?.png?.length){setImage("");return;}const url=URL.createObjectURL(new Blob([new Uint8Array(content.png)],{type:"image/png"}));setImage(url);return()=>URL.revokeObjectURL(url);},[content]);
 async function action(kind:string){if(!item||busy)return;setBusy(true);setError("");setMessage("");try{
  if(kind==="save"){
   if(compact)await quickControl("dialogStart");
   const {save,open}=await import("@tauri-apps/plugin-dialog");const destination=content?.kind==="files"?await open({directory:true,multiple:false,title:"파일 사본을 저장할 폴더"}):await save({defaultPath:content?.kind==="image"?"clipboard.png":"clipboard.txt",title:"클립보드 내용 저장"});
   if(typeof destination!=="string")return;await clipboardAction("save",item.id,destination);setMessage("사본을 저장했습니다.");
  }else if(kind==="plain"){await writeClipboard(content?.kind==="files"?content.paths.join("\n"):content?.text??"");setMessage("텍스트로 복사했습니다.");}
  else{await clipboardAction(kind,item.id);if(kind==="copy")setMessage("클립보드에 복사했습니다. Ctrl+V로 붙여넣을 수 있습니다.");await refresh();}
 }catch(e){setError(String(e));}finally{if(compact&&kind==="save")await quickControl("dialogEnd").catch(()=>undefined);setBusy(false);}}
 if(!isTauri())return <p className="empty-state">클립보드 이력은 데스크톱 앱에서 이용할 수 있습니다.</p>;
 return <section className={`clipboard-history ${compact?"clipboard-compact":""}`} aria-label="클립보드 이력" onKeyDown={e=>{
  if(e.key==="Escape"&&clearConfirm){e.preventDefault();e.stopPropagation();setClearConfirm(false);return;}
  if(e.key==="Escape"&&onClose){e.preventDefault();e.stopPropagation();onClose();return;}if(e.target instanceof HTMLSelectElement)return;
  const option=e.target instanceof HTMLButtonElement&&e.target.getAttribute("role")==="option";
  if(e.target instanceof HTMLButtonElement&&!option)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="f"){e.preventDefault();e.stopPropagation();input.current?.focus();input.current?.select();return;}
  if(e.key==="Delete"&&option){e.preventDefault();e.stopPropagation();void action("delete");return;}
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();e.stopPropagation();const index=Math.max(0,items.findIndex(c=>c.id===item?.id));const n=(index+(e.key==="ArrowDown"?1:-1)+items.length)%Math.max(1,items.length);setSelected(items[n]?.id??"");setLimit(l=>Math.max(l,n+1));requestAnimationFrame(()=>{const row=document.getElementById(`clip-${items[n]?.id}`);row?.scrollIntoView({block:"nearest"});if(option)row?.focus();});}
  else if(e.key==="Enter"&&item){e.preventDefault();e.stopPropagation();void action("copy");}
 }}>
 <div className="clipboard-toolbar"><input ref={input} type="search" aria-label="클립보드 이력 검색" placeholder="클립보드 이력에서 찾기" value={query} onChange={e=>{setQuery(e.target.value);setLimit(100);}}/><select aria-label="클립보드 종류" value={type} onChange={e=>setType(e.target.value)}><option value="all">모든 종류</option><option value="text">텍스트</option><option value="image">이미지·캡처</option><option value="files">파일·폴더</option></select><label><input type="checkbox" checked={favorites} onChange={e=>setFavorites(e.target.checked)}/>즐겨찾기</label><button className="button secondary small" onClick={()=>void refresh()}>새로고침</button>{!compact&&<button className="button secondary small" onClick={()=>void updatePreferences({...preferences,clipboardEnabled:!preferences.clipboardEnabled}).catch(e=>setError(String(e)))}>{preferences.clipboardEnabled?"기록 일시정지":"기록 재개"}</button>}</div>
 <p className="clipboard-status">{preferences.clipboardEnabled?"기록 중":"기록 일시정지"} · {preferences.clipboardDays}일 보관 · {snapshot?.items.length??0}개 · {formatSize(snapshot?.bytes??0)} / 200 MB · 최신 순</p>
 <div className="clipboard-workspace"><div className="clipboard-list" role="listbox" aria-label="저장된 클립보드 목록">{items.slice(0,limit).map(c=><button id={`clip-${c.id}`} role="option" aria-selected={item?.id===c.id} className={item?.id===c.id?"selected":""} key={c.id} tabIndex={item?.id===c.id?0:-1} onClick={()=>setSelected(c.id)} onDoubleClick={()=>void action("copy")}><strong>{c.favorite?"★ ":""}{c.preview||"빈 내용"}</strong><small>{c.kind==="image"?"이미지":c.kind==="files"?"파일":"텍스트"} · {new Date(c.createdAt).toLocaleString()} · {formatSize(c.bytes)}</small></button>)}{!items.length&&<p className="empty-state">{query?"일치하는 이력이 없습니다.":"복사한 텍스트·파일·이미지가 여기에 표시됩니다."}</p>}{items.length>limit&&<button onClick={()=>setLimit(n=>n+100)}>100개 더 보기</button>}</div>
 <div className="clipboard-preview" aria-label="클립보드 내용 미리보기">{image?<img src={image} alt="저장된 클립보드 이미지"/>:content?<pre>{content.kind==="files"?content.paths.join("\n"):content.text}</pre>:<p>내용을 선택하세요.</p>}</div></div>
 <div className="clipboard-actions"><button className="button primary small" disabled={!item||busy} onClick={()=>void action("copy")}>클립보드로 복사</button><button className="button secondary small" disabled={!content||content.kind==="image"||busy} onClick={()=>void action("plain")}>텍스트로 복사</button><button className="button secondary small" disabled={!content||busy} onClick={()=>void action("save")}>사본 저장</button><button className="button secondary small" disabled={!item||busy} onClick={()=>void action("favorite")}>{item?.favorite?"즐겨찾기 해제":"즐겨찾기"}</button><button className="button secondary small" disabled={!item||busy} onClick={()=>void action("delete")}>삭제</button><button className="button secondary small" onClick={()=>setClearConfirm(true)}>전체 이력 삭제</button></div>
 {clearConfirm&&<div role="alert" className="clipboard-clear-confirm">저장된 이력을 모두 삭제할까요? <button className="button secondary small" onClick={()=>{setClearConfirm(false);void clipboardAction("clear").then(()=>refresh()).catch(e=>setError(String(e)));}}>전체 삭제 확인</button><button className="button secondary small" onClick={()=>setClearConfirm(false)}>취소</button></div>}
 <p role="status" className={error||snapshot?.error?"error-text":""}>{error||snapshot?.error||message||"↑↓ 이동 · Enter 복사 · 파일은 원본 경로를 보관합니다."}</p>
 </section>;
}

import {useState} from "react";
import {FolderPlus,LoaderCircle} from "lucide-react";
import {Modal} from "./Modal";
import type {ConnectedRoot} from "../types";
import {isDesktop} from "../client";
import {addressLocation} from "../paths";

export function IndexExclusions({root,onSave,onClose}:{root:ConnectedRoot;onSave:(root:ConnectedRoot)=>Promise<boolean>;onClose:()=>void}){
  const [text,setText]=useState((root.excludedPaths??[]).join("\n")),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function choose(){try{const {open}=await import("@tauri-apps/plugin-dialog");const selected=await open({directory:true,multiple:true,defaultPath:root.absolutePath,title:"인덱스에서 제외할 하위 폴더 선택"});if(!selected)return;const folders=(Array.isArray(selected)?selected:[selected]).map(path=>addressLocation(path,[root],root.id));if(folders.some(location=>!location||!location.path))throw new Error("현재 연결 폴더의 하위 폴더를 선택하세요. 전체 연결 해제는 인덱스 관리에서 할 수 있습니다.");setText(previous=>[...new Set([...previous.split(/\r?\n/).filter(Boolean),...folders.map(location=>location!.path)])].join("\n"));setError("");}catch(cause){setError(String(cause));}}
  return <Modal title="인덱스 제외 폴더" subtitle={root.name} onClose={()=>{if(!busy)onClose();}}><form className="modal-content index-exclusions" onSubmit={async event=>{event.preventDefault();setError("");const rules=[...new Set(text.split(/\r?\n/).map(rule=>rule.trim().replaceAll("\\","/").replace(/\/+$/,'')).filter(Boolean))];if(rules.length>128){setError("최대 128개 폴더를 지정할 수 있습니다.");return;}setBusy(true);try{if(await onSave({...root,excludedPaths:rules}))onClose();else setError("저장하지 못했습니다. 인덱스 상태와 오류 메시지를 확인하세요.");}finally{setBusy(false);}}}>
    <p>이 폴더들은 검색·인덱싱에서 제외합니다. 파일은 삭제하지 않으며 탐색창에서는 계속 열 수 있습니다.</p>
    <p className="root-path">{root.absolutePath}</p>
    {isDesktop&&<button className="button secondary" type="button" disabled={busy} onClick={()=>void choose()}><FolderPlus size={15}/>폴더 선택하여 추가</button>}
    <label>제외할 하위 폴더 <span className="field-hint">한 줄에 하나 · 연결 폴더 기준 상대 경로</span><textarea aria-label="제외 폴더 경로" value={text} onChange={event=>setText(event.target.value)} rows={7} disabled={busy} placeholder={'예: 백업\n자료/임시 파일'} spellCheck={false}/></label>
    <p className="modal-footnote">줄을 지우고 저장하면 다시 포함합니다. 존재하지 않는 경로도 규칙으로 저장할 수 있습니다. 저장 시 해당 연결 폴더를 다시 인덱싱합니다. .git·node_modules·앱 내부 폴더와 심볼릭 링크는 기본적으로 제외합니다.</p>
    {error&&<p role="alert" className="error-text">{error}</p>}
    <div className="exclusion-actions"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>취소</button><button type="submit" className="button primary" disabled={busy}>{busy?<><LoaderCircle size={14} className="spin"/>적용 중…</>:"저장하고 다시 인덱싱"}</button></div>
  </form></Modal>;
}

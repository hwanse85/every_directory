import {useEffect,useState,type MutableRefObject,type ReactNode} from "react";
import {defaultPreferences,updatePreferences,usePreferences,type Preferences} from "../preferences";
import {explorerViews} from "../explorerView";
import {invoke} from "@tauri-apps/api/core";
import {isDesktop} from "../client";
import {formatSize} from "./FileIcon";
// 본문 색인 상태(문서 수·크기·남은 문서)
type ContentStatus={enabled:boolean;documents:number;textBytes:number;diskBytes:number;sourceBytes:number;pending:number;failed:number};
// 본문 색인 진행 상태를 2초마다 읽어 보여 준다.
function ContentIndexStatus(){
 const [status,setStatus]=useState<ContentStatus>();
 useEffect(()=>{if(!isDesktop)return;let alive=true;const read=()=>void invoke<ContentStatus>("ed_request",{kind:"contentStatus",payload:{}}).then(s=>{if(alive)setStatus(s);}).catch(()=>undefined);read();const timer=setInterval(read,2000);return()=>{alive=false;clearInterval(timer);};},[]);
 if(!status?.enabled)return null;
 return <p className="muted content-status" role="status">본문 색인: 문서 {status.documents.toLocaleString()}개 · 저장 {formatSize(status.diskBytes)}(원본 {formatSize(status.sourceBytes)}){status.pending?` · 남은 문서 ${status.pending.toLocaleString()}개`:" · 최신"}{status.failed?` · 읽지 못한 문서 ${status.failed}개`:""}</p>;
}
// 사용자 설정을 편집하고, 창 아래에 고정한 저장 단추로 저장한다. 저장하지 않은 변경이 있으면 닫기 전에 묻는다.
export function AdvancedPreferences({children,closeRequest,onClose}:{children?:ReactNode;closeRequest:MutableRefObject<()=>void>;onClose:()=>void}){
 const {preferences,preferencesError}=usePreferences();const [draft,setDraft]=useState(preferences);const [dirty,setDirty]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [asking,setAsking]=useState(false);
 useEffect(()=>{if(!dirty)setDraft(preferences);},[preferences,dirty]);
 // 창 닫기(X·Esc·바깥 클릭)는 저장하지 않은 변경이 있으면 아래 고정 영역에서 저장 여부를 묻는다.
 useEffect(()=>{closeRequest.current=()=>{if(dirty)setAsking(true);else onClose();};});
 // 편집 중인 값을 저장하고, 성공하면 필요에 따라 창을 닫는다.
 function save(close=false){setBusy(true);void updatePreferences(draft).then(()=>{setDirty(false);setAsking(false);setMessage("사용자 설정을 저장했습니다.");if(close)onClose();}).catch(e=>setMessage(String(e))).finally(()=>setBusy(false));}
 function set<K extends keyof Preferences>(key:K,value:Preferences[K]){setDraft(p=>({...p,[key]:value}));setDirty(true);setAsking(false);setMessage("");}
 const toggle=(key:keyof Preferences,title:string,detail:string)=> <label className="setting-row" key={key}><span><strong>{title}</strong><p>{detail}</p></span><input type="checkbox" className="toggle" aria-label={title} checked={Boolean(draft[key])} onChange={e=>set(key,e.target.checked as never)}/></label>;
 const range=(key:"clipboardDays"|"fontScale"|"searchDelay"|"searchPageSize"|"clipboardMaxMb",title:string,min:number,max:number,suffix:string,step=1)=><label className="setting-row" key={key}><span><strong>{title}</strong><p><output>{draft[key]}{suffix}</output></p></span><input type="range" aria-label={title} min={min} max={max} step={step} value={draft[key]} onChange={e=>set(key,Number(e.target.value))}/></label>;
 return <><section className="advanced-preferences" aria-label="사용자 편의 설정"><p>변경 후 창 아래의 ‘사용자 설정 저장’을 누르세요. 저장한 값은 다시 실행해도 유지됩니다.</p>
 <h3>검색 결과와 탐색</h3>
 {toggle("showHidden","숨김 파일 표시","숨김 속성 및 숨김 폴더 안의 검색 결과를 표시합니다. 기본값은 꺼짐입니다.")}
 {toggle("showTemporary","임시·잠금 파일 표시","~$ Office 잠금 파일, .tmp·.temp·.swp 등의 임시 파일을 표시합니다. $로만 시작하는 일반 파일은 숨기지 않습니다.")}
 {toggle("showRecycleBin","휴지통 항목 표시","Windows $Recycle.Bin 등 휴지통의 인덱싱 가능한 항목을 검색에 포함합니다. 권한·인덱스 제외 규칙은 유지합니다.")}
 {toggle("highlightMatches","검색어 매칭 강조","초성·일반 검색에서 이름과 경로 등 표시된 속성의 일치 부분을 강조합니다.")}
 {toggle("followSearchSelection","검색 결과 선택 시 탐색창 따라가기","켜면 검색 결과를 클릭하거나 화살표로 옮길 때 활성 탐색창이 그 위치로 이동합니다. 기본값은 꺼짐이며, 이때는 Ctrl+Enter·‘새 탭에서 열기’·폴더 더블클릭으로 위치를 엽니다.")}
 {toggle("quickFullPath","빠른 검색에서 경로도 검색","파일명 외에 인덱스의 폴더 경로에서도 검색합니다.")}
 {toggle("contentSearch","본문 검색(content:)","문서 내용을 이 PC에 색인해 content:계약 처럼 본문으로 찾습니다. txt·md·코드·PDF·docx·xlsx·pptx·hwpx(파일당 20MB까지, 앞 64KB)를 읽습니다. 끄면 본문 색인을 지웁니다."+(navigator.platform.includes("Mac")?" 끈 상태에서 content:를 쓰면 macOS Spotlight 결과를 대신 보여 줍니다.":""))}
 {draft.contentSearch&&preferences.contentSearch&&<ContentIndexStatus/>}
 {toggle("quickApps","빠른 검색에 앱 표시",(navigator.platform.includes("Mac")?"응용 프로그램 폴더의 앱":"시작 메뉴의 앱")+"을 이름·초성으로 찾아 결과 맨 위에 보여 주고 Enter로 실행합니다. 기본값은 꺼짐입니다.")}
 {toggle("quickCalculator","빠른 검색 계산","12*3+4 처럼 계산식을 입력하면 결과를 맨 위에 보여 주고 Enter로 결과를 복사합니다. 2026-03 같은 날짜·번호는 계산하지 않습니다. 기본값은 꺼짐입니다.")}
 {toggle("learnRanking","고른 항목을 순위에 반영","빠른 검색에서 어떤 검색어로 연 파일을 기억해, 같은 검색어를 다시 치면 앞에 보여 줍니다. 기록은 이 PC에만 두며 빠른 검색의 ‘최근 기록 지우기’로 함께 지웁니다.")}
 {range("searchDelay","검색 입력 대기",40,500," ms",10)}
 {range("searchPageSize","한 번에 불러올 검색 결과",100,1000,"개",100)}
 <h3>빠른 검색 사용자 동작</h3>
 <p className="muted">빠른 검색 작업 메뉴(Tab)에 나올 동작입니다. 인자는 한 줄에 하나씩 쓰고 {"{path}"}(전체 경로)·{"{dir}"}(폴더)·{"{name}"}(이름)·{"{stem}"}(확장자 뺀 이름)·{"{ext}"}(확장자)를 넣을 수 있습니다. 셸을 거치지 않고 실행하며, 처음 실행할 때 명령을 보여 주고 확인을 받습니다.</p>
 {draft.userActions.map((action,index)=><div className="user-action-row" key={index}>
  <input aria-label={`사용자 동작 ${index+1} 이름`} placeholder="이름 (예: VS Code로 열기)" maxLength={40} value={action.name} onChange={e=>set("userActions",draft.userActions.map((a,i)=>i===index?{...a,name:e.target.value}:a))}/>
  <input aria-label={`사용자 동작 ${index+1} 프로그램`} placeholder="프로그램 (예: /usr/local/bin/code, C:\Windows\notepad.exe)" value={action.program} onChange={e=>set("userActions",draft.userActions.map((a,i)=>i===index?{...a,program:e.target.value}:a))}/>
  <textarea aria-label={`사용자 동작 ${index+1} 인자`} placeholder={"인자 (한 줄에 하나)\n{path}"} rows={2} value={action.args.join("\n")} onChange={e=>set("userActions",draft.userActions.map((a,i)=>i===index?{...a,args:e.target.value.split("\n")}:a))}/>
  <button className="button secondary small" aria-label={`사용자 동작 ${index+1} 삭제`} onClick={()=>set("userActions",draft.userActions.filter((_,i)=>i!==index))}>삭제</button>
 </div>)}
 <button className="button secondary small" disabled={draft.userActions.length>=20} onClick={()=>set("userActions",[...draft.userActions,{name:"",program:"",args:["{path}"]}])}>사용자 동작 추가</button>
 {toggle("updateCheck","시작할 때 새 버전 확인","하루 한 번 GitHub 릴리스에서 새 버전이 있는지 확인하고 알려 줍니다. GitHub에 최신 릴리스 정보만 요청하며 이 PC의 정보는 보내지 않습니다. 정보 화면의 ‘업데이트 확인’으로 직접 확인할 수도 있습니다.")}
 <h3>작업 화면</h3>
 {range("fontScale","파일 목록 글자 크기",90,140,"%",5)}
 <label className="setting-row"><span><strong>활성 탐색창 강조 색</strong><p>굵은 테두리와 상단 강조선에 적용합니다.</p></span><select aria-label="활성 탐색창 강조 색" value={draft.activePaneAccent} onChange={e=>set("activePaneAccent",e.target.value as Preferences["activePaneAccent"])}><option value="blue">파랑</option><option value="violet">보라</option><option value="orange">주황</option><option value="green">초록</option></select></label>
 <label className="setting-row"><span><strong>새 탐색창 기본 보기</strong><p>기존 창의 개별 보기 설정은 유지합니다.</p></span><select aria-label="새 탐색창 기본 보기" value={draft.defaultExplorerView} onChange={e=>set("defaultExplorerView",e.target.value as Preferences["defaultExplorerView"])}>{explorerViews.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
 <h3>클립보드 이력</h3>
 {toggle("clipboardEnabled","클립보드 이력 기록","앱이 실행 중일 때 복사한 내용을 이 PC에 기록합니다. Windows는 사용자 계정 키로 암호화하고, macOS는 현재 사용자만 읽을 수 있는 파일로 보관합니다.")}
 {range("clipboardDays","클립보드 보관 기간",1,60,"일")}
 <label className="setting-row"><span><strong>빠른 검색 클립보드 키워드</strong><p>기본값 clip. 이 키워드나 clip·클립·클립보드를 입력하면 파일 검색 결과 위에 ‘클립보드 보기’가 표시됩니다.</p></span><input aria-label="빠른 검색 클립보드 키워드" maxLength={32} value={draft.clipboardKeyword} onChange={e=>set("clipboardKeyword",e.target.value)}/></label>
 {toggle("clipboardText","텍스트 기록","일반 텍스트를 저장합니다. 앱 전용 서식이나 비밀번호 저장소는 복제하지 않습니다.")}
 {toggle("clipboardImages","이미지·화면 캡처 기록","이미지를 PNG로 저장합니다. 최대 1,677만 픽셀까지 지원합니다.")}
 {toggle("clipboardFiles","파일·폴더 기록","원본 위치를 기록합니다. 원본을 이동·삭제하면 파일 복원이 불가능할 수 있습니다.")}
 {range("clipboardMaxMb","항목당 최대 저장 크기",1,64," MB")}
 <label className="setting-row"><span><strong>클립보드 기록 제외 앱</strong><p>실행 파일·앱 이름을 ;로 구분합니다. Windows의 기록 금지 표시와 macOS 비밀번호 관리자의 숨김 표시도 존중합니다.</p></span><input aria-label="클립보드 기록 제외 앱" value={draft.clipboardExcludedApps} onChange={e=>set("clipboardExcludedApps",e.target.value)}/></label>
 <p className="muted">전체 이력은 최대 200 MB / 2,000개입니다. 보관 기간이나 한도를 넘으면 오래된 순으로 삭제합니다. 즐겨찾기에도 같은 보관 기간을 적용합니다.</p>
 </section>
 {children}
 <div className={`preference-actions${dirty?" dirty":""}`}>
  <p role="status">{asking?"저장하지 않은 사용자 설정이 있습니다. 저장할까요?":message||preferencesError||(dirty?"저장하지 않은 변경이 있습니다.":"")}</p>
  {asking?<>
   <button className="button secondary" disabled={busy} onClick={onClose}>저장하지 않고 닫기</button>
   <button className="button secondary" disabled={busy} onClick={()=>setAsking(false)}>계속 편집</button>
   <button className="button primary" disabled={busy} onClick={()=>save(true)}>저장하고 닫기</button>
  </>:<>
   <button className="button secondary" disabled={busy} onClick={()=>{setDraft({...defaultPreferences});setDirty(true);setMessage("");}}>사용자 설정 기본값 복원</button>
   <button className="button primary" disabled={busy||!dirty} onClick={()=>save()}>사용자 설정 저장</button>
  </>}
 </div></>;
}

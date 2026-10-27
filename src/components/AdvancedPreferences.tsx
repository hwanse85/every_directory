import {useEffect,useState} from "react";
import {defaultPreferences,updatePreferences,usePreferences,type Preferences} from "../preferences";
import {explorerViews} from "../explorerView";
export function AdvancedPreferences(){
 const {preferences,preferencesError}=usePreferences();const [draft,setDraft]=useState(preferences);const [dirty,setDirty]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 useEffect(()=>{if(!dirty)setDraft(preferences);},[preferences,dirty]);
 function set<K extends keyof Preferences>(key:K,value:Preferences[K]){setDraft(p=>({...p,[key]:value}));setDirty(true);setMessage("");}
 const toggle=(key:keyof Preferences,title:string,detail:string)=> <label className="setting-row" key={key}><span><strong>{title}</strong><p>{detail}</p></span><input type="checkbox" className="toggle" aria-label={title} checked={Boolean(draft[key])} onChange={e=>set(key,e.target.checked as never)}/></label>;
 const range=(key:"clipboardDays"|"fontScale"|"searchDelay"|"searchPageSize"|"clipboardMaxMb",title:string,min:number,max:number,suffix:string,step=1)=><label className="setting-row" key={key}><span><strong>{title}</strong><p><output>{draft[key]}{suffix}</output></p></span><input type="range" aria-label={title} min={min} max={max} step={step} value={draft[key]} onChange={e=>set(key,Number(e.target.value))}/></label>;
 return <section className="advanced-preferences" aria-label="사용자 편의 설정"><p>변경 후 ‘사용자 설정 저장’을 누르세요. 저장한 값은 다시 실행해도 유지됩니다.</p>
 <h3>검색 결과와 탐색</h3>
 {toggle("showHidden","숨김 파일 표시","숨김 속성 및 숨김 폴더 안의 검색 결과를 표시합니다. 기본값은 꺼짐입니다.")}
 {toggle("showTemporary","임시·잠금 파일 표시","~$ Office 잠금 파일, .tmp·.temp·.swp 등의 임시 파일을 표시합니다. $로만 시작하는 일반 파일은 숨기지 않습니다.")}
 {toggle("showRecycleBin","휴지통 항목 표시","Windows $Recycle.Bin 등 휴지통의 인덱싱 가능한 항목을 검색에 포함합니다. 권한·인덱스 제외 규칙은 유지합니다.")}
 {toggle("highlightMatches","검색어 매칭 강조","초성·일반 검색에서 이름과 경로 등 표시된 속성의 일치 부분을 강조합니다.")}
 {toggle("quickFullPath","빠른 검색에서 경로도 검색","파일명 외에 인덱스의 폴더 경로에서도 검색합니다.")}
 {range("searchDelay","검색 입력 대기",40,500," ms",10)}
 {range("searchPageSize","한 번에 불러올 검색 결과",100,1000,"개",100)}
 <h3>작업 화면</h3>
 {range("fontScale","파일 목록 글자 크기",90,140,"%",5)}
 <label className="setting-row"><span><strong>활성 탐색창 강조 색</strong><p>굵은 테두리와 상단 강조선에 적용합니다.</p></span><select aria-label="활성 탐색창 강조 색" value={draft.activePaneAccent} onChange={e=>set("activePaneAccent",e.target.value as Preferences["activePaneAccent"])}><option value="blue">파랑</option><option value="violet">보라</option><option value="orange">주황</option><option value="green">초록</option></select></label>
 <label className="setting-row"><span><strong>새 탐색창 기본 보기</strong><p>기존 창의 개별 보기 설정은 유지합니다.</p></span><select aria-label="새 탐색창 기본 보기" value={draft.defaultExplorerView} onChange={e=>set("defaultExplorerView",e.target.value as Preferences["defaultExplorerView"])}>{explorerViews.map(v=><option key={v.id} value={v.id}>{v.label}</option>)}</select></label>
 <h3>클립보드 이력</h3>
 {toggle("clipboardEnabled","클립보드 이력 기록","앱이 실행 중일 때 복사한 내용을 이 PC에 기록합니다. Windows에서는 사용자 계정 키로 암호화합니다.")}
 {range("clipboardDays","클립보드 보관 기간",1,60,"일")}
 <label className="setting-row"><span><strong>빠른 검색 클립보드 키워드</strong><p>기본값 clip. 입력하면 파일 검색 결과 위에 ‘클립보드 보기’가 표시됩니다.</p></span><input aria-label="빠른 검색 클립보드 키워드" maxLength={32} value={draft.clipboardKeyword} onChange={e=>set("clipboardKeyword",e.target.value)}/></label>
 {toggle("clipboardText","텍스트 기록","일반 텍스트를 저장합니다. 앱 전용 서식이나 비밀번호 저장소는 복제하지 않습니다.")}
 {toggle("clipboardImages","이미지·화면 캡처 기록","이미지를 PNG로 저장합니다. 최대 1,677만 픽셀까지 지원합니다.")}
 {toggle("clipboardFiles","파일·폴더 기록","원본 위치를 기록합니다. 원본을 이동·삭제하면 파일 복원이 불가능할 수 있습니다.")}
 {range("clipboardMaxMb","항목당 최대 저장 크기",1,64," MB")}
 <label className="setting-row"><span><strong>클립보드 기록 제외 앱</strong><p>실행 파일 이름을 ;로 구분합니다. Windows의 기록 금지 표시도 존중합니다.</p></span><input aria-label="클립보드 기록 제외 앱" value={draft.clipboardExcludedApps} onChange={e=>set("clipboardExcludedApps",e.target.value)}/></label>
 <p className="muted">전체 이력은 최대 200 MB / 2,000개입니다. 보관 기간이나 한도를 넘으면 오래된 순으로 삭제합니다. 즐겨찾기에도 같은 보관 기간을 적용합니다.</p>
 <div className="preference-actions"><button className="button secondary" disabled={busy} onClick={()=>{setDraft({...defaultPreferences});setDirty(true);}}>사용자 설정 기본값 복원</button><button className="button primary" disabled={busy||!dirty} onClick={()=>{setBusy(true);void updatePreferences(draft).then(()=>{setDirty(false);setMessage("사용자 설정을 저장했습니다.");}).catch(e=>setMessage(String(e))).finally(()=>setBusy(false));}}>사용자 설정 저장</button></div>
 <p role="status">{message||preferencesError}</p></section>;
}

(async()=>{
 const invoke=window.__TAURI_INTERNALS__.invoke,report={suite:"history",tests:[],errors:[],passed:false};
 const wait=async(check,label)=>{const end=Date.now()+16000;while(Date.now()<end){const r=await check();if(r)return r;await new Promise(r=>setTimeout(r,50));}throw new Error(`시간 초과: ${label}`);};
 const verify=(name,value)=>{if(!value)throw new Error(name);report.tests.push({name,passed:true});};
 const clip=(action,id,extra={})=>invoke("clipboard_control",{action,id:id??null,destination:null,query:null,...extra});
 const prefs=()=>invoke("preferences_control",{next:null});const save=next=>invoke("preferences_control",{next});
 const text=value=>invoke("plugin:clipboard-manager|write_text",{text:value});
 function value(el,v){Object.getOwnPropertyDescriptor(el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype,"value").set.call(el,v);el.dispatchEvent(new Event(el.tagName==="SELECT"?"change":"input",{bubbles:true}));}
 const key=(el,k)=>el.dispatchEvent(new KeyboardEvent("keydown",{key:k,bubbles:true,cancelable:true}));
 const button=label=>[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===label);
 try{
  await wait(()=>document.querySelector('.explorer-pane .file-row'),"앱 준비");
  if(window.__historyRestart){
   const p=await prefs();verify("프로그램 종료 후 다시 실행해도 보관 기간·키워드·강조 색 유지",p.clipboardDays===17&&p.clipboardKeyword==="memo"&&p.activePaneAccent==="violet"&&p.fontScale===120);
   const s=await clip("list");verify("재실행 후 텍스트·파일·이미지 이력과 즐겨찾기 복원",["text","files","image"].every(k=>s.items.some(c=>c.kind===k))&&s.items.some(c=>c.favorite));
   document.querySelector('[aria-label="도구 열기"]').click();await wait(()=>button("클립보드"),"도구 탭");button("클립보드").click();await wait(()=>document.querySelector('.clipboard-list [role="option"]'),"복원된 목록");verify("재실행한 실제 화면에서 이력 목록 표시",true);
   const before=s.items.length;await text("restart duplicate");await clip("capture");await text("restart duplicate");await clip("capture");verify("재실행 후에도 동일 내용 중복 병합",(await clip("list")).items.length===before+1);
   await clip("clear");verify("전체 이력 삭제",(await clip("list")).items.length===0);
  }else{
   let p=await prefs();verify("기본 정책과 10일 보관·clip 키워드",!p.showHidden&&!p.showTemporary&&!p.showRecycleBin&&p.clipboardDays===10&&p.clipboardKeyword==="clip");
   const root=(await invoke("ed_request",{kind:"init",payload:{}}))[0];
   const search=query=>invoke("ed_request",{kind:"search",payload:{query,mode:"initials",rootId:root.id,category:"all",fullPath:true}});
   let found=await search("");verify("숨김·Office 잠금·임시·휴지통은 기본 검색에서 제외",!found.entries.some(e=>e.name.startsWith("~$")||e.name==="cache.tmp"||e.path.includes("$Recycle.Bin")||e.path.startsWith(".hidden")||e.name==="native-hidden.txt"));
   verify("달러로 시작하는 일반 파일은 정상 검색",found.entries.some(e=>e.name==="$budget.txt"));
   await save({...p,showTemporary:true});verify("임시 파일 표시 설정은 숨김 정책과 별도로 동작",(await search("")).entries.some(e=>e.name==="~$lock.docx"));
   await save({...p,showHidden:true,showRecycleBin:true});found=await search("");verify("숨김 속성과 휴지통 표시 설정 반영",found.entries.some(e=>e.name==="native-hidden.txt")&&found.entries.some(e=>e.path.includes("$Recycle.Bin/")));await save(p);
   const input=document.querySelector('[aria-label="파일 검색"]');value(input,"ㅂㄱㅅ");await wait(()=>document.querySelector('.search-table .file-row mark'),"초성 하이라이트");verify("초성 검색 결과에서 한글 음절 강조",[...document.querySelectorAll('.search-table mark')].some(m=>m.textContent==="보고서"));
   value(input,"path:ㄱㄹㅂㄱㅅ");await wait(()=>document.querySelector('.search-table [data-column="location"] mark'),"경로 하이라이트");verify("이름 외에 경로에서 매칭된 초성도 강조",[...document.querySelectorAll('.search-table [data-column="location"] mark')].some(m=>m.textContent==="경로 보고서"));
   document.querySelector('[aria-label="설정"]').click();await wait(()=>document.querySelector('[aria-label="클립보드 보관 기간"]'),"설정 화면");
   value(document.querySelector('[aria-label="클립보드 보관 기간"]'),"17");value(document.querySelector('[aria-label="빠른 검색 클립보드 키워드"]'),"memo");value(document.querySelector('[aria-label="활성 탐색창 강조 색"]'),"violet");value(document.querySelector('[aria-label="파일 목록 글자 크기"]'),"120");button("사용자 설정 저장").click();await wait(async()=> (await prefs()).clipboardKeyword==="memo","설정 저장");
   verify("기간 슬라이더는 1~60일, 1일 단위",document.querySelector('[aria-label="클립보드 보관 기간"]').min==="1"&&document.querySelector('[aria-label="클립보드 보관 기간"]').max==="60"&&document.querySelector('[aria-label="클립보드 보관 기간"]').step==="1");document.querySelector('dialog[open] [aria-label="닫기"]').click();
   await wait(()=>getComputedStyle(document.querySelector('.explorer-pane.active')).outlineWidth==="3px","활성 테두리");verify("활성 탐색창의 굵은 테두리와 강조 색",getComputedStyle(document.querySelector('.explorer-pane.active')).outlineWidth==="3px");
   p=await prefs();let rejected=false;try{await save({...p,clipboardDays:61});}catch{rejected=true;}verify("유효하지 않은 설정은 기존 저장값을 보존",rejected&&(await prefs()).clipboardDays===17);
   await clip("clear");await text("first clip");await clip("capture");const long="long clip "+"x".repeat(320)+" needle-at-end";await text(long);await clip("capture");let s=await clip("list");verify("텍스트 이력 저장과 최신 순 표시",s.items.length===2&&s.items[0].preview.startsWith("long clip"));
   await text("first clip");await clip("capture");s=await clip("list");verify("중복 이력은 합치고 최신 위치로 이동",s.items.length===2&&s.items[0].preview==="first clip");
   const first=s.items[0];await clip("favorite",first.id);verify("이력 즐겨찾기",(await clip("list")).items[0].favorite);
   const match=await clip("list",null,{query:"needle-at-end"});verify("미리보기 밖의 텍스트 본문도 이력 검색",match.items.length===1);
   await save({...p,clipboardEnabled:false});await text("paused content");await clip("capture");verify("기록 일시정지는 새 이력을 수집하지 않음",(await clip("list")).items.length===2);await save(p);
   await invoke("copy_files",{locations:[{rootId:root.id,path:"업무 보고서.txt"}],cut:false});await clip("capture");s=await clip("list");verify("운영체제 파일 클립보드 경로 저장",s.items[0].kind==="files"&&(await clip("read",s.items[0].id)).paths[0].endsWith("업무 보고서.txt"));
   await clip("testImage");await clip("capture");s=await clip("list");verify("이미지·화면 캡처 PNG 저장",s.items[0].kind==="image"&&(await clip("read",s.items[0].id)).png.slice(0,4).join(",")==="137,80,78,71");const image=s.items[0];
   await clip("copy",first.id);await clip("capture");verify("이력 텍스트를 시스템 클립보드로 복원",(await clip("list")).items[0].preview==="first clip");
   await clip("copy",image.id);await clip("capture");verify("이력 이미지를 시스템 이미지로 복원",(await clip("list")).items[0].kind==="image");
   const count=(await clip("list")).items.length;await clip("testProtected");await clip("capture");verify("Windows 기록 금지 표시가 있는 내용은 저장하지 않음",(await clip("list")).items.length===count);
   await clip("save",first.id,{destination:root.absolutePath+"/history-export.txt"});verify("텍스트 이력을 파일로 사본 저장",(await invoke("ed_request",{kind:"list",payload:{rootId:root.id,path:""}})).some(e=>e.name==="history-export.txt"));
   rejected=false;try{await clip("save",first.id,{destination:root.absolutePath+"/history-export.txt"});}catch{rejected=true;}verify("이력 저장 시 기존 파일 덮어쓰기 방지",rejected);
   document.querySelector('[aria-label="도구 열기"]').click();await wait(()=>button("클립보드"),"도구 탭");verify("도구 안에 파일 도구·클립보드 별도 탭",!!button("파일 도구")&&!!button("클립보드"));button("클립보드").click();await wait(()=>document.querySelector('.clipboard-list [role="option"]'),"이력 화면");verify("클립보드 전용 화면에서 목록과 미리보기 제공",!!document.querySelector('.clipboard-preview'));
   value(document.querySelector('[aria-label="클립보드 이력 검색"]'),"needle-at-end");await wait(()=>document.querySelectorAll('.clipboard-list [role="option"]').length===1,"본문 이력 검색 화면");verify("이력 검색 UI는 본문 일치 결과를 표시",true);
   await clip("delete",match.items[0].id);verify("개별 이력 삭제",!(await clip("list")).items.some(c=>c.id===match.items[0].id));
   report.restart=true;
  }
  report.passed=true;
 }catch(e){report.errors.push(String(e));report.screen=document.body.innerText.slice(-3500);}
 report.finished=new Date().toISOString();await invoke("ed_request",{kind:"smokeReport",payload:report});
})();

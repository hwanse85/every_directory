(async()=>{
 const invoke=window.__TAURI_INTERNALS__.invoke,report={suite:"history-monitor",tests:[],errors:[],passed:false};
 const wait=async(check,label)=>{const end=Date.now()+14000;while(Date.now()<end){const r=await check();if(r)return r;await new Promise(r=>setTimeout(r,80));}throw new Error(`시간 초과: ${label}`);};
 const pause=()=>new Promise(r=>setTimeout(r,700));
 const verify=(name,value)=>{if(!value)throw new Error(name);report.tests.push({name,passed:true});};
 const clip=(action,id)=>invoke("clipboard_control",{action,id:id??null,destination:null,query:null});
 const text=value=>invoke("plugin:clipboard-manager|write_text",{text:value});
 const prefs=()=>invoke("preferences_control",{next:null});const save=next=>invoke("preferences_control",{next});
 try{
  await wait(()=>document.querySelector('.explorer-pane .file-row'),"앱 준비");await clip("clear");
  await text("automatic monitor text");await wait(async()=> (await clip("list")).items.some(c=>c.preview==="automatic monitor text"),"자동 텍스트 기록");verify("별도 수집 명령 없이 실제 OS 클립보드 변경을 자동 기록",true);
  const root=(await invoke("ed_request",{kind:"init",payload:{}}))[0];await invoke("copy_files",{locations:[{rootId:root.id,path:"업무 보고서.txt"}],cut:false});await wait(async()=> (await clip("list")).items[0]?.kind==="files","파일 자동 기록");verify("탐색기 파일 복사는 자동으로 파일 이력에 기록",true);
  await clip("testImage");await wait(async()=> (await clip("list")).items[0]?.kind==="image","이미지 자동 기록");verify("시스템 이미지·캡처는 자동으로 PNG 이력에 기록",true);
  const p=await prefs(),count=(await clip("list")).items.length;await save({...p,clipboardEnabled:false});await text("automatic monitor paused");await pause();verify("백그라운드 감시도 기록 일시정지 설정을 준수",(await clip("list")).items.length===count);
  await save({...p,clipboardExcludedApps:"EveryDirectory-e2e.exe"});await invoke("copy_files",{locations:[{rootId:root.id,path:"README.md"}],cut:false});await pause();verify("설정한 실행 파일의 클립보드는 자동 기록에서 제외",(await clip("list")).items.length===count);
  await save(p);await text("automatic monitor resumed");await wait(async()=> (await clip("list")).items[0]?.preview==="automatic monitor resumed","자동 기록 재개");verify("제외 해제·기록 재개 후 자동 수집 복구",true);
  report.passed=true;
 }catch(e){report.errors.push(String(e));report.screen=document.body.innerText.slice(-2000);}
 report.finished=new Date().toISOString();await invoke("ed_request",{kind:"smokeReport",payload:report});
})();

(async()=>{
 const invoke=window.__TAURI_INTERNALS__.invoke,report={suite:"portable",tests:[],errors:[],passed:false};
 const wait=async(check,label)=>{const end=Date.now()+14000;while(Date.now()<end){const r=await check();if(r)return r;await new Promise(r=>setTimeout(r,60));}throw new Error(`시간 초과: ${label}`);};
 const verify=(name,value)=>{if(!value)throw new Error(name);report.tests.push({name,passed:true});};
 try{
  await wait(()=>document.querySelector('.explorer-pane .file-row'),"포터블 앱 준비");
  const p=await invoke("preferences_control",{next:null});
  const desktop=await invoke("desktop_control",{action:"status",value:null,shortcut:null,mode:null});
  verify("포터블 실행은 로그인 자동 시작을 기본 등록하지 않음",desktop.autoStart===false);
  if(window.__portableRestart){
   verify("포터블 실행 파일 옆의 설정을 종료 후 재실행해 복원",p.clipboardDays===23&&p.clipboardKeyword==="portableclip"&&p.fontScale===115);
   verify("포터블 창에 저장된 글자 크기 적용",document.documentElement.style.getPropertyValue("--user-font-scale")==="1.15");
  }else{
   await invoke("preferences_control",{next:{...p,clipboardDays:23,clipboardKeyword:"portableclip",fontScale:115,clipboardEnabled:false}});
   verify("포터블 사용자 설정 저장",(await invoke("preferences_control",{next:null})).clipboardKeyword==="portableclip");report.restart=true;
  }
  report.passed=true;
 }catch(e){report.errors.push(String(e));}
 report.finished=new Date().toISOString();await invoke("ed_request",{kind:"smokeReport",payload:report});
})();

(async () => {
  const invoke=window.__TAURI_INTERNALS__.invoke;
  const report={suite:"transfer",tests:[],errors:[],passed:false};
  const pane=n=>document.querySelector(`.explorer-pane[aria-label="탐색창 ${n}"]`);
  async function until(check,label) {
    const end=Date.now()+10000;
    while(Date.now()<end) {const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,40));}
    throw new Error(`시간 초과: ${label}`);
  }
  const row=(p,name)=>[...p.querySelectorAll(".file-row")].find(x=>x.title.endsWith(`\\${name}`));
  function verify(name,condition,extra={}) {if(!condition)throw new Error(name);report.tests.push({name,passed:true,...extra});}
  async function transfer(name,move=false) {
    const file=await until(()=>row(pane(1),name),"원본 목록");file.click();file.focus();
    await until(()=>pane(1).classList.contains("active") && row(pane(1),name)?.classList.contains("selected") && !pane(1).querySelector('[aria-label="추가 파일 도구"]').disabled,"작업 준비");
    file.dispatchEvent(new KeyboardEvent("keydown",{key:move?"F7":"F5",shiftKey:!move,bubbles:true,cancelable:true}));
    const confirm=await until(()=>document.querySelector("dialog[open] .button.primary"),"다른 창 전송 확인");
    const start=performance.now();confirm.click();
    await until(()=>!document.querySelector("dialog[open]"),"전송 완료");
    return performance.now()-start;
  }
  try {
    await until(()=>pane(2)?.querySelector(".file-row"),"탐색창 초기화");
    const root=(await invoke("ed_request",{kind:"init",payload:{}}))[0];
    const list=path=>invoke("ed_request",{kind:"list",payload:{rootId:root.id,path}});
    const destination=row(pane(2),"대상");destination.click();destination.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
    await until(()=>pane(2).querySelector(".breadcrumbs")?.textContent.includes("대상") && !pane(2).querySelector('[aria-label="추가 파일 도구"]').disabled,"두 번째 창 목적지");
    const copyMs=await transfer("업무 보고서.txt");
    await until(()=>row(pane(2),"업무 보고서.txt"),"대상 목록 즉시 반영");
    verify("첫 번째 창 → 두 번째 창 실제 복사와 원본 보존",(await list("")).some(x=>x.name==="업무 보고서.txt"),{elapsedMs:copyMs});
    verify("전송 완료 메시지에 실제 소요 시간 표시",/복사 완료.*\d+\.\d초/.test(document.querySelector(".toast")?.textContent??""));
    await transfer("업무 보고서.txt");
    await until(()=>row(pane(2),"업무 보고서 (1).txt"),"번호 사본 목록");
    verify("창 사이 반복 복사의 번호 이름과 양쪽 목록 유지",(await list("대상")).filter(x=>x.name.startsWith("업무 보고서")).length===2);
    const moveMs=await transfer("README.md",true);
    await until(()=>row(pane(2),"README.md") && !row(pane(1),"README.md"),"이동 양쪽 목록");
    verify("첫 번째 창 → 두 번째 창 이동과 원본 목록 제거",!(await list("")).some(x=>x.name==="README.md"),{elapsedMs:moveMs});
    await transfer("문서");
    verify("폴더 전송 뒤 하위 파일도 즉시 탐색 가능",(await list("대상/문서")).some(x=>x.name==="메모.txt"));
    const search=await invoke("ed_request",{kind:"search",payload:{query:"메모",mode:"normal",rootId:root.id}});
    verify("전송 후 검색 인덱스에 새 경로 즉시 반영",search.entries.some(x=>x.path==="대상/문서/메모.txt"));
    report.passed=true;
  } catch(error) {report.errors.push(String(error));report.screen=document.body.innerText.slice(-2500);}
  report.finished=new Date().toISOString();
  await invoke("ed_request",{kind:"smokeReport",payload:report});
})();

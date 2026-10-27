(async()=>{
  const invoke=window.__TAURI_INTERNALS__.invoke;
  const checkpoint="ed:tree-checkpoint",previous=sessionStorage.getItem(checkpoint);
  const report=previous?JSON.parse(previous):{suite:"tree",passed:false,tests:[],errors:[]};
  const until=async(check,label)=>{const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,45));}throw new Error(`시간 초과: ${label}`);};
  const verify=(name,value)=>{if(!value)throw new Error(name);report.tests.push({name,passed:true});};
  const pause=()=>new Promise(r=>setTimeout(r,100));
  const value=(input,text)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,text);input.dispatchEvent(new Event("input",{bubbles:true}));};
  const key=(target,key,props={})=>target.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true,...props}));
  const node=(pane,path)=>[...pane.querySelectorAll('.folder-tree [role="treeitem"]')].find(item=>JSON.parse(item.dataset.treeLocation).path===path);
  const selected=pane=>pane.querySelector('.folder-tree [aria-selected="true"]');
  const currentPath=pane=>selected(pane)?JSON.parse(selected(pane).dataset.treeLocation).path:null;
  try{
    await until(()=>document.querySelector('.explorer-pane .file-row'),"탐색창 준비");
    const panes=[...document.querySelectorAll('.explorer-pane')],first=panes[0],second=panes[1];
    const roots=await invoke("ed_request",{kind:"init",payload:{}}),root=roots[0];
    async function navigate(pane,path){
      pane.click();pane.querySelector('.breadcrumbs').dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
      await until(()=>pane.querySelector('.address-form input'),"주소 입력");
      const input=pane.querySelector('.address-form input');
      value(input,root.absolutePath.replaceAll("/","\\").replace(/\\$/,'')+(path?'\\'+path.replaceAll("/","\\"):''));
      await pause();pane.querySelector('.address-form').requestSubmit();
      await until(()=>!pane.querySelector('.address-form input'),"주소 확정");
      await until(()=>currentPath(pane)===path,"현재 경로 트리 선택");
    }
    if(previous){
      verify("창별 트리 표시 설정 재실행 복원",first.querySelector('.folder-tree')&&second.querySelector('.folder-tree'));
      await until(()=>currentPath(first)==="문서/2026/분기"&&currentPath(second)==="대상","저장 경로 복원");
      verify("탭 경로와 트리 선택 재실행 복원",true);
      sessionStorage.removeItem(checkpoint);report.passed=true;
    }else{
      first.querySelector('[aria-label="폴더 트리 표시"]').click();second.querySelector('[aria-label="폴더 트리 표시"]').click();
      await until(()=>node(first,"문서")&&node(second,"문서"),"루트 자동 펼침");
      verify("트리를 켜면 현재 연결 폴더 자동 펼침",Boolean(node(first,"문서")&&selected(first)));
      await navigate(first,"문서/2026/분기");
      verify("주소로 깊은 폴더 이동 시 전체 상위 가지 자동 펼침",["","문서","문서/2026"].every(path=>node(first,path)?.getAttribute("aria-expanded")==="true"));
      verify("현재 폴더 하나만 선택 표시",first.querySelectorAll('.folder-tree [aria-selected="true"]').length===1);
      verify("다른 탐색창 트리는 독립 유지",currentPath(second)==="");
      first.click();key(document.body,".",{ctrlKey:true,shiftKey:true,code:"Period"});
      await until(()=>!node(first,".숨김"),"숨김 폴더 감추기");
      verify("숨김 파일 설정은 트리에도 동일 적용",true);
      key(document.body,".",{ctrlKey:true,shiftKey:true,code:"Period"});await until(()=>node(first,".숨김"),"숨김 폴더 표시 복원");
      const name=selected(first).querySelector('.tree-name');
      verify("트리 드롭 대상은 해당 폴더",JSON.parse(name.parentElement.dataset.dropLocation).path==="문서/2026/분기");
      first.querySelector('[aria-label="뒤로"]').click();await until(()=>currentPath(first)==="","뒤로 동기화");
      first.querySelector('[aria-label="앞으로"]').click();await until(()=>currentPath(first)==="문서/2026/분기","앞으로 동기화");
      verify("뒤로·앞으로 기록 이동과 트리 동기화",true);
      node(first,"대상").querySelector('.tree-name').dispatchEvent(new MouseEvent("click",{ctrlKey:true,bubbles:true}));
      await until(()=>first.querySelectorAll('[role="tab"]').length===2&&currentPath(first)==="대상","새 탭 이동");
      verify("Ctrl+트리 클릭은 새 탭에서 해당 위치 열기",true);
      await until(()=>node(first,"대상/보관"),"대상 자동 펼침");
      verify("새 탭에 이전 탭의 무관한 펼침 상태가 섞이지 않음",!node(first,"문서/2026"));
      node(first,"대상/보관").querySelector('.tree-toggle').click();
      await until(()=>node(first,"대상/보관").getAttribute("aria-busy")!=="true"&&node(first,"대상/보관").getAttribute("aria-expanded")===null,"빈 폴더 확인");
      await invoke("ed_request",{kind:"operation",payload:{action:"mkdir",destination:{rootId:root.id,path:"대상/보관"},name:"신규 폴더"}});
      await until(()=>node(first,"대상/보관/신규 폴더"),"빈 폴더 하위 생성 후 트리 갱신");
      verify("비어 있던 폴더도 새 하위 폴더 생성 후 트리 갱신",true);
      first.querySelector('[role="tab"]').click();await until(()=>currentPath(first)==="문서/2026/분기","첫 탭 복원");
      verify("탭 전환은 해당 탭의 경로와 펼침 상태 복원",Boolean(node(first,"문서/2026/분기")));
      first.querySelector('[role="tab"]').click();
      await until(()=>selected(first).getAttribute("aria-busy")!=="true","선택 폴더 자식 확인");
      const current=selected(first);current.focus();key(current,"ArrowLeft");
      await until(()=>document.activeElement===node(first,"문서/2026"),"트리 상위 키보드 초점");
      key(document.activeElement,"Enter");await until(()=>currentPath(first)==="문서/2026","키보드 폴더 이동");
      verify("트리 방향키와 Enter 탐색",true);
      await navigate(first,"문서/2026/분기");
      await navigate(second,"대상");
      verify("창 전환과 다른 위치 이동도 첫 창 트리에 영향 없음",currentPath(first)==="문서/2026/분기");
      first.click();first.querySelector('[aria-label="폴더 트리 표시"]').click();
      await until(()=>!first.querySelector('.folder-tree'),"트리 숨김");
      first.querySelector('[aria-label="폴더 트리 표시"]').click();
      await until(()=>currentPath(first)==="문서/2026/분기","트리 재표시");
      verify("트리를 껐다 켜도 현재 폴더까지 자동 복원",true);
      await pause();sessionStorage.setItem(checkpoint,JSON.stringify(report));location.reload();return;
    }
  }catch(error){report.errors.push(String(error));sessionStorage.removeItem(checkpoint);}
  report.finished=new Date().toISOString();await invoke("ed_request",{kind:"smokeReport",payload:report});
})();

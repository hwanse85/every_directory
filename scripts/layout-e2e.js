// Measure the actual WebView layout and exercise the controls that were moved.
(async () => {
  const invoke=window.__TAURI_INTERNALS__.invoke;
  const checkpoint="ed:layout-e2e-checkpoint";
  const previous=sessionStorage.getItem(checkpoint);
  const report=previous?JSON.parse(previous):{suite:"layout",tests:[],errors:[],passed:false};
  const until=async(check,label)=>{
    const end=Date.now()+10000;
    while(Date.now()<end){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,40));}
    throw new Error(`시간 초과: ${label}`);
  };
  const verify=(name,value)=>{if(!value)throw new Error(name);report.tests.push({name,passed:true});};
  const rect=selector=>document.querySelector(selector).getBoundingClientRect();
  const settle=async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
  try {
    await until(()=>document.querySelector('.explorer-pane .file-row'),"작업 화면 준비");
    await settle();
    if(previous){
      await until(()=>document.querySelector('[aria-label="사이드바 펼치기"]'),"다시 연 화면의 사이드바 설정");
      verify("사이드바 접힘 설정은 화면을 다시 열어도 유지",getComputedStyle(document.querySelector('.sidebar')).display==="none");
      document.querySelector('[aria-label="사이드바 펼치기"]').click();
      await until(()=>document.querySelector('[aria-label="사이드바 접기"]'),"사이드바 복원");
      sessionStorage.removeItem(checkpoint);
      await invoke("ed_request",{kind:"smokeResize",payload:{width:900,height:640}});
      await until(()=>Math.abs(innerWidth-900)<2&&Math.abs(innerHeight-640)<2,"900×640 작은 창");
      await settle();
      const smallHeader=rect('.app-header'),smallWorkspace=rect('.workspace-split');
      report.geometry.small={viewport:{width:innerWidth,height:innerHeight},workspace:{top:smallWorkspace.top,height:smallWorkspace.height},searchResultsTop:rect('.result-summary').top};
      verify("900×640에서도 작업창 높이 90% 이상 확보",smallWorkspace.height/innerHeight>=0.9);
      verify("작은 창에서도 상단 한 줄 유지",smallHeader.height<=44&&smallWorkspace.top<=54);
      verify("작은 창에서도 상단 버튼과 선택 상자가 화면 안에 유지",[...document.querySelectorAll('.app-header button,.app-header select')].filter(x=>getComputedStyle(x).display!=="none").every(x=>{const r=x.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=smallHeader.bottom;}));
      verify("작은 검색창에서도 조건 조작부가 180px 이하",rect('.result-summary').top-smallWorkspace.top<=180);
      await invoke("ed_request",{kind:"smokeResize",payload:report.geometry.viewport});
      await until(()=>Math.abs(innerWidth-report.geometry.viewport.width)<2,"원래 창 크기 복원");
      report.passed=true;
    } else {
      const header=rect('.app-header');
      const workspace=rect('.workspace-split');
      report.geometry={viewport:{width:innerWidth,height:innerHeight},header:{height:header.height},workspace:{top:workspace.top,height:workspace.height,width:workspace.width},searchResultsTop:rect('.result-summary').top};
      verify("상단 도구 모음은 한 줄 44px 이하",header.height<=44);
      verify("큰 제목·홍보 문구·중복 패널 제목 제거",!document.querySelector('.workspace-toolbar,.header-center,.panel-header,.explorers-heading,.app-statusbar,.search-footer'));
      verify("검색·탐색 작업창이 화면 맨 위에서 54px 안에 시작",workspace.top<=54);
      verify("작업창이 화면 높이의 90% 이상 차지",workspace.height/innerHeight>=0.9);
      verify("검색 결과 위 조작 영역은 170px 이하",rect('.result-summary').top-workspace.top<=170);
      const buttons=[...document.querySelectorAll('.app-header button,.app-header select')].filter(x=>getComputedStyle(x).display!=="none");
      verify("상단 조작은 화면 밖으로 넘치지 않음",buttons.every(x=>{const r=x.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=header.top&&r.bottom<=header.bottom;}));
      verify("검색과 탐색창은 같은 높이에서 시작",Math.abs(rect('.search-panel').top-rect('.explorer-pane').top)<2);
      const width=workspace.width;
      document.querySelector('[aria-label="사이드바 접기"]').click();
      await until(()=>rect('.workspace-split').width>width+100,"사이드바 폭 반환");
      verify("사이드바를 접으면 작업 폭을 100px 이상 더 확보",rect('.workspace-split').width>width+100);
      document.querySelector('.layout-button').click();
      await until(()=>document.querySelector('.layout-popover'),"레이아웃 메뉴");
      const popup=rect('.layout-popover');
      report.geometry.layoutMenu={top:popup.top,bottom:popup.bottom,left:popup.left,right:popup.right};
      verify("이동한 레이아웃 메뉴는 잘리지 않고 화면 안에 열림",popup.left>=0&&popup.right<=innerWidth&&popup.top>=header.bottom&&popup.bottom<=innerHeight);
      document.querySelector('.layout-button').click();
      const count=document.querySelector('[aria-label="탐색창 개수"]');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(count,"3");
      count.dispatchEvent(new Event("change",{bubbles:true}));
      await until(()=>document.querySelectorAll('.explorer-pane').length===3,"탐색창 세 개");
      verify("상단으로 옮긴 탐색창 개수 조작 동작",document.querySelectorAll('.explorer-pane').length===3);
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(count,"2");
      count.dispatchEvent(new Event("change",{bubbles:true}));
      await until(()=>document.querySelectorAll('.explorer-pane').length===2,"탐색창 두 개 복원");
      document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true,cancelable:true}));
      await until(()=>document.activeElement===document.querySelector('[aria-label="파일 검색"]'),"검색 단축키");
      verify("간결한 화면에서도 Ctrl+K로 검색 초점 이동",true);
      sessionStorage.setItem(checkpoint,JSON.stringify(report));
      location.reload();
      return;
    }
  }catch(error){report.errors.push(String(error));report.screen=document.body.innerText.slice(-2400);sessionStorage.removeItem(checkpoint);}
  report.finished=new Date().toISOString();
  await invoke("ed_request",{kind:"smokeReport",payload:report});
})();

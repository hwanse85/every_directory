(async()=>{
  const invoke=window.__TAURI_INTERNALS__.invoke;
  const checkpoint="ed:columns-e2e";
  const previous=sessionStorage.getItem(checkpoint);
  const report=previous?JSON.parse(previous):{suite:"columns",passed:false,tests:[],errors:[]};
  const until=async(check,label)=>{const end=Date.now()+10000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,40));}throw new Error(`시간 초과: ${label}`);};
  const settle=async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);};
  const verify=(name,value)=>{if(!value)throw new Error(name);report.tests.push({name,passed:true});};
  const cell=(table,id)=>table.querySelector(`[role="columnheader"][data-column="${id}"]`);
  const width=(table,id)=>cell(table,id).getBoundingClientRect().width;
  const handle=(table,id)=>cell(table,id).querySelector('[role="separator"]');
  const key=(target,name,shift=false)=>target.dispatchEvent(new KeyboardEvent("keydown",{key:name,shiftKey:shift,bubbles:true,cancelable:true}));
  async function drag(table,id,delta){
    const target=handle(table,id),r=target.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+10;
    target.dispatchEvent(new PointerEvent("pointerdown",{clientX:x,clientY:y,pointerId:11,button:0,buttons:1,bubbles:true,cancelable:true}));
    target.dispatchEvent(new PointerEvent("pointermove",{clientX:x+delta,clientY:y,pointerId:11,buttons:1,bubbles:true}));
    target.dispatchEvent(new PointerEvent("pointerup",{clientX:x+delta,clientY:y,pointerId:11,button:0,bubbles:true}));
    await settle();
  }
  try{
    await until(()=>document.querySelector('.search-table .file-row')&&document.querySelectorAll('.explorer-pane .file-row').length,"목록 준비");
    const search=document.querySelector('.search-table');
    const explorer=document.querySelector('.explorer-pane .file-table');
    if(previous){
      verify("검색 칼럼 너비가 재실행 후 유지",Math.abs(width(search,"location")-report.savedSearch)<2);
      verify("탐색창별 칼럼 너비가 재실행 후 유지",Math.abs(width(explorer,"name")-report.savedExplorer)<2);
      sessionStorage.removeItem(checkpoint);report.passed=true;
    }else{
      for(const [name,table] of [["검색",search],["탐색",explorer]]){
        verify(`${name} 모든 칼럼에 조절 경계 제공`,table.querySelectorAll('[role="separator"]').length===4);
        const color=getComputedStyle(handle(table,"name"),"::after").backgroundColor;
        verify(`${name} 경계선은 항상 시각적으로 구분`,color!=="transparent"&&color!=="rgba(0, 0, 0, 0)");
        const initial=width(table,"name");
        const sort=cell(table,"name").getAttribute("aria-sort");
        await drag(table,"name",85);
        verify(`${name} 드래그는 너비만 변경하고 정렬을 실행하지 않음`,Math.abs(width(table,"name")-initial-85)<2&&cell(table,"name").getAttribute("aria-sort")===sort);
        const data=table.querySelector('.file-row [data-column="name"]');
        verify(`${name} 헤더와 파일 행의 경계 정렬`,Math.abs(data.getBoundingClientRect().width-width(table,"name"))<2);
        key(handle(table,"name"),"ArrowRight",true);await settle();
        verify(`${name} Shift+방향키로 40px 조절`,Math.abs(width(table,"name")-initial-125)<2);
        const beforeCancel=width(table,"name"),target=handle(table,"name");
        target.dispatchEvent(new PointerEvent("pointerdown",{clientX:200,clientY:100,pointerId:12,button:0,bubbles:true,cancelable:true}));
        target.dispatchEvent(new PointerEvent("pointermove",{clientX:250,clientY:100,pointerId:12,buttons:1,bubbles:true}));await settle();
        key(target,"Escape");await settle();
        verify(`${name} Esc로 진행 중 너비 조절 취소`,Math.abs(width(table,"name")-beforeCancel)<2&&!document.documentElement.classList.contains("resizing-column"));
        await drag(table,"name",-5000);
        verify(`${name} 최소 너비 보호`,width(table,"name")===100);
        handle(table,"name").dispatchEvent(new MouseEvent("dblclick",{bubbles:true,cancelable:true}));await settle();
        verify(`${name} 더블클릭 내용 맞춤`,width(table,"name")>100&&width(table,"name")<=2000);
        const modified=table.querySelector('.file-row [data-column="modified"]');
        verify(`${name} 좁은 창에서도 수정일 칼럼을 임의로 숨기지 않음`,getComputedStyle(modified).display!=="none");
        const sortButton=cell(table,"size").querySelector("button");sortButton.click();await settle();
        verify(`${name} 크기 정렬 방향 표시`,cell(table,"size").getAttribute("aria-sort")==="ascending");
      }
      await drag(search,"location",700);
      const scroll=search.querySelector('.file-scroll');scroll.scrollLeft=180;await settle();
      verify("가로 스크롤 중 헤더와 내용 위치 일치",scroll.scrollLeft>0&&Math.abs(cell(search,"location").getBoundingClientRect().left-search.querySelector('.file-row [data-column="location"]').getBoundingClientRect().left)<2);
      const header=search.querySelector('.file-columns');header.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:300,clientY:200}));
      await until(()=>document.querySelector('.column-width-menu'),"너비 메뉴");
      [...document.querySelectorAll('.column-width-menu button')].find(x=>x.textContent.includes("기본 너비")).click();await settle();
      verify("기본 너비 복원과 저장",JSON.stringify(JSON.parse(sessionStorage.getItem("ed:searchColumnWidths")))==="{}");
      header.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:300,clientY:200}));
      await until(()=>document.querySelector('.column-width-menu'),"내용 맞춤 메뉴");
      [...document.querySelectorAll('.column-width-menu button')].find(x=>x.textContent.includes("모든 칼럼")).click();await settle();
      verify("모든 칼럼 자동 맞춤과 저장",Object.keys(JSON.parse(sessionStorage.getItem("ed:searchColumnWidths"))).length===4&&width(search,"name")>=100);
      const second=document.querySelectorAll('.explorer-pane .file-table')[1];const untouched=width(second,"name");
      await drag(explorer,"name",120);await drag(search,"location",90);
      verify("각 탐색창 너비를 독립적으로 조절",Math.abs(width(second,"name")-untouched)<2);
      report.savedSearch=width(search,"location");report.savedExplorer=width(explorer,"name");
      sessionStorage.setItem(checkpoint,JSON.stringify(report));location.reload();return;
    }
  }catch(error){report.errors.push(String(error));sessionStorage.removeItem(checkpoint);}
  report.finished=new Date().toISOString();await invoke("ed_request",{kind:"smokeReport",payload:report});
})();

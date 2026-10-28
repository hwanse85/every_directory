(async()=>{
  const invoke=window.__TAURI_INTERNALS__.invoke,checkpoint="ed:audit-checkpoint",previous=sessionStorage.getItem(checkpoint);
  const report=previous?JSON.parse(previous):{suite:"audit",passed:false,tests:[],errors:[]};
  const pause=()=>new Promise(r=>setTimeout(r,120));
  const until=async(check,label)=>{const end=Date.now()+15000;while(Date.now()<end){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,40));}throw new Error(`시간 초과: ${label}`);};
  const verify=(name,value)=>{if(!value)throw new Error(name);report.tests.push({name,passed:true});};
  const value=(input,text)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,text);input.dispatchEvent(new Event("input",{bubbles:true}));};
  const key=(target,key,props={})=>target.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true,...props}));
  const search=()=>document.querySelector('.search-panel'),first=()=>document.querySelector('.explorer-pane'),tabs=()=>[...(first()?.querySelectorAll('[role="tab"]')??[])];
  const rows=()=>[...(search()?.querySelectorAll('.file-row')??[])];
  const name=row=>row.querySelector('.file-name')?.textContent;
  // Windows는 역슬래시, macOS는 슬래시 경로를 쓴다.
  const windows=/Win/.test(navigator.platform),separator=windows?'\\':'/',nativePath=value=>windows?value.replaceAll('/','\\'):value;
  const settled=()=>!search().querySelector('.result-summary .spin');
  const menu=async(tab,label)=>{tab.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:300,clientY:160}));await until(()=>document.querySelector('.tab-context-menu'),"탭 메뉴");const button=[...document.querySelectorAll('.tab-context-menu button')].find(item=>item.textContent===label);if(!button||button.disabled)throw new Error(`사용 불가능한 탭 메뉴: ${label}`);button.click();await pause();};
  try{
    await until(()=>rows().length&&tabs().length,"실제 앱 초기화");
    const root=(await invoke("ed_request",{kind:"init",payload:{}}))[0];
    const input=document.querySelector('[aria-label="파일 검색"]');
    if(previous){
      value(input,"audit_");await pause();
      await until(()=>search().querySelector('[data-column="size"]').getAttribute('aria-sort')==="descending"&&settled(),"저장 정렬 복원");
      verify("검색 정렬 재실행 복원",name(rows()[0])==="audit_1204.txt");
      verify("탭 순서·이름·고정 재실행 복원",tabs()[0].textContent.includes("고정 업무")&&tabs()[0].querySelector('[aria-label="고정된 탭"]'));
      verify("탐색창 정렬 재실행 복원",first().querySelector('[data-column="size"]').getAttribute('aria-sort')==="descending");
      sessionStorage.removeItem(checkpoint);report.passed=true;
    }else{
      value(input,"audit_");
      await until(()=>search().querySelector('.result-summary strong')?.textContent==="1,205"&&settled(),"1205개 검색");
      verify("1천 개 초과 결과 수와 추가 불러오기 제공",Boolean(search().querySelector('.load-more-results')));
      // 백그라운드 색인 갱신은 의도적으로 첫 페이지부터 다시 불러오므로, 초기화되면 더 보기를 다시 누르고 버전 변화를 기록한다.
      report.loadMore={clicks:0,versionBefore:(await invoke("ed_request",{kind:"status",payload:{}})).version};
      await until(()=>{if(!search().querySelector('.load-more-results'))return settled();const more=search().querySelector('.load-more-results');if(settled()&&!more.disabled&&report.loadMore.clicks<6&&Date.now()-(report.loadMore.at??0)>2500){report.loadMore.clicks++;report.loadMore.at=Date.now();more.click();}return false;},"나머지 205개 불러오기",30000);
      report.loadMore.versionAfter=(await invoke("ed_request",{kind:"status",payload:{}})).version;delete report.loadMore.at;
      rows()[0].focus();key(document.activeElement,"a",{ctrlKey:true});await pause();
      verify("Ctrl+A는 불러온 1205개 전체를 선택",search().querySelector('.search-selection')?.textContent.includes("1,205개 선택"));
      value(input,"audit_1204");await until(()=>rows().length===1&&name(rows()[0])==="audit_1204.txt"&&settled(),"다른 검색어");
      verify("페이지를 추가한 뒤 검색어 변경은 첫 페이지와 선택 초기화",!search().querySelector('.search-selection'));
      value(input,"audit_");await until(()=>rows().length>1&&settled(),"검색 복원");
      const size=search().querySelector('[data-column="size"] button');size.click();await until(()=>settled()&&name(rows()[0])==="audit_0000.txt","전역 오름차순");
      size.click();await until(()=>settled()&&name(rows()[0])==="audit_1204.txt","전역 내림차순");
      verify("정렬은 처음 1000개가 아닌 전체 1205개에 적용",true);
      rows()[0].click();await pause();rows()[2].dispatchEvent(new MouseEvent("click",{bubbles:true,shiftKey:true}));await pause();
      verify("검색 Shift 범위 선택",search().querySelectorAll('.file-row.selected').length===3);
      rows()[4].dispatchEvent(new MouseEvent("click",{bubbles:true,ctrlKey:true}));await pause();
      verify("검색 Ctrl 추가 선택",search().querySelectorAll('.file-row.selected').length===4);
      rows()[4].focus();key(document.activeElement,"Delete");await until(()=>document.querySelector('dialog[open]'),"검색 삭제 확인");
      verify("검색 Delete는 선택한 4개를 대상으로 확인",document.querySelector('dialog[open]').textContent.includes("4개"));
      document.querySelector('dialog[open] [aria-label="닫기"]').click();await pause();
      const second=document.querySelectorAll('.explorer-pane')[1];
      const target=[...second.querySelectorAll('.file-row')].find(row=>row.title.replaceAll('\\','/').endsWith('/대상'));target.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
      await until(()=>second.querySelector('.breadcrumbs').textContent.includes("대상"),"전송 대상 탐색창");
      rows()[4].focus();key(document.activeElement,"F5",{shiftKey:true});await until(()=>document.querySelector('[aria-label="검색 결과 전송 대상"]'),"검색 그룹 전송");
      verify("검색 선택 그룹을 다른 탐색창으로 전송하는 확인 제공",document.querySelector('dialog[open]').textContent.includes("4개"));
      const transferSelect=document.querySelector('[aria-label="검색 결과 전송 대상"]');
      const transferOption=[...transferSelect.options].find(option=>option.textContent.includes('탐색창 2')&&option.textContent.endsWith('대상'));
      if(!transferOption)throw new Error("전송 대상의 현재 폴더가 표시되지 않음");
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(transferSelect,transferOption.value);transferSelect.dispatchEvent(new Event('change',{bubbles:true}));await pause();
      document.querySelector('dialog[open] .button.primary').click();
      await until(async()=>{const entries=await invoke("ed_request",{kind:"list",payload:{rootId:root.id,path:"대상"}});return entries.filter(entry=>entry.name.startsWith("audit_")).length===4;},"검색 그룹 실제 복사");
      await until(()=>!document.querySelector('dialog[open]')&&settled(),"그룹 복사 완료");verify("검색 다중 선택 파일 4개를 대상 창 폴더에 실제 복사",true);
      rows()[0].focus();key(document.activeElement,"F3");await pause();verify("F3로 검색어 입력 이동",document.activeElement===input);
      key(input,"F1");await until(()=>document.querySelector('dialog[open]'),"F1 도움말");verify("F1 도움말 제공",document.querySelector('dialog[open]').textContent.includes("단축키"));document.querySelector('dialog[open] [aria-label="닫기"]').click();await pause();
      tabs()[0].focus();await menu(tabs()[0],"탭 복제");await until(()=>tabs().length===2,"탭 복제");
      verify("복제한 탭의 최초 색상은 미지정",!first().querySelectorAll('.explorer-tab')[1].style.backgroundColor);
      await menu(tabs()[1],"탭 이름 변경…");await until(()=>document.querySelector('[aria-label="탭 이름"]'),"탭 이름 입력");value(document.querySelector('[aria-label="탭 이름"]'),"고정 업무");await pause();document.querySelector('dialog[open] form').requestSubmit();await until(()=>tabs()[1]?.textContent.includes("고정 업무"),"탭 이름 저장");
      await menu(tabs()[1],"탭 고정");verify("고정된 탭에 표시 제공",Boolean(tabs()[1].querySelector('[aria-label="고정된 탭"]')));
      tabs()[1].focus();key(document.activeElement,"w",{ctrlKey:true});await pause();verify("고정 탭은 Ctrl+W로 닫히지 않음",tabs().length===2);
      const pinned=tabs()[1].parentElement,destination=tabs()[0].parentElement,a=tabs()[1].getBoundingClientRect(),b=destination.getBoundingClientRect();
      tabs()[1].dispatchEvent(new PointerEvent('pointerdown',{pointerId:19,button:0,buttons:1,clientX:a.left+20,clientY:a.top+10,bubbles:true}));
      pinned.dispatchEvent(new PointerEvent('pointermove',{pointerId:19,buttons:1,clientX:b.left+3,clientY:b.top+10,bubbles:true,cancelable:true}));
      pinned.dispatchEvent(new PointerEvent('pointerup',{pointerId:19,button:0,clientX:b.left+3,clientY:b.top+10,bubbles:true,cancelable:true}));await pause();
      verify("포인터 드래그로 탭 순서 변경",tabs()[0].textContent.includes("고정 업무"));
      // Changing location from a pinned tab opens a separate, uncolored tab.
      tabs()[0].click();await pause();first().querySelector('.breadcrumbs').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
      const address=await until(()=>first().querySelector('.address-form input'),"고정 탭 주소 입력");value(address,nativePath(root.absolutePath)+separator+'대상');await pause();first().querySelector('.address-form').requestSubmit();
      await until(()=>tabs().length===3&&first().querySelector('.breadcrumbs').textContent.includes("대상"),"고정 폴더 보존");
      verify("고정 폴더에서 다른 위치 이동은 새 탭 사용",tabs()[0].title.endsWith("고정됨")&&!first().querySelectorAll('.explorer-tab')[2].style.backgroundColor);
      tabs()[2].focus();key(document.activeElement,"w",{ctrlKey:true});await until(()=>tabs().length===2,"탭 닫기");
      tabs()[0].focus();key(document.activeElement,"t",{ctrlKey:true,shiftKey:true});await until(()=>tabs().length===3,"닫은 탭 복원");
      verify("Ctrl+Shift+T로 닫은 탭의 위치 복원",tabs()[2].textContent.includes("대상"));
      tabs()[0].click();await pause();const sort=first().querySelector('[data-column="size"] button');sort.click();await pause();sort.click();await pause();
      for(const extension of ["csv","txt","tsv","html"]){
        const destination=nativePath(root.absolutePath)+separator+`audit-export.${extension}`;
        await invoke("ed_request",{kind:"saveExport",payload:{destination,content:extension==="html"?"<!doctype html><p>검증</p>":"검증\r\n"}});
        let protectedFile=false;try{await invoke("ed_request",{kind:"saveExport",payload:{destination,content:"overwrite"}});}catch{protectedFile=true;}
        verify(`${extension.toUpperCase()} 목록 저장과 기존 파일 보호`,protectedFile);
      }
      // Closed tabs, name, pin, order and both sorts must survive a real WebView reload.
      await pause();sessionStorage.setItem(checkpoint,JSON.stringify(report));location.reload();return;
    }
  }catch(error){report.errors.push(String(error));report.screen=document.body.innerText.slice(-4000);report.panes=JSON.parse(sessionStorage.getItem('ed:panes')??'null');sessionStorage.removeItem(checkpoint);}
  report.finished=new Date().toISOString();await invoke("ed_request",{kind:"smokeReport",payload:report});
})();

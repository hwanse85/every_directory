(async()=>{
  const invoke=window.__TAURI_INTERNALS__.invoke,checkpoint='ed:explorer-checkpoint',previous=sessionStorage.getItem(checkpoint);
  const report=previous?JSON.parse(previous):{suite:'explorer',passed:false,tests:[],errors:[]};
  const until=async(check,label)=>{const end=Date.now()+15000;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,40));}throw new Error(`시간 초과: ${label}`);};
  const pause=()=>new Promise(r=>setTimeout(r,100));
  const verify=(name,value)=>{if(!value)throw new Error(name);report.tests.push({name,passed:true});};
  const set=(input,value)=>{Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement?HTMLSelectElement.prototype:input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));};
  const key=(target,key,props={})=>target.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...props}));
  const pane=n=>document.querySelectorAll('.explorer-pane')[n-1];
  const rows=()=>[...pane(1).querySelectorAll('.file-row')];
  const find=name=>rows().find(row=>row.title.endsWith('\\'+name));
  const treeWidth=n=>pane(n).querySelector('.folder-tree').getBoundingClientRect().width;
  const close=()=>document.querySelector('dialog[open] [aria-label="닫기"]').click();
  try{
    await until(()=>pane(1)?.querySelector('.file-row'),'앱 초기화');
    const root=(await invoke('ed_request',{kind:'init',payload:{}}))[0];
    const view=pane(1).querySelector('[aria-label="탐색창 1 보기 종류"]');
    const sort=pane(1).querySelector('[aria-label="탐색창 1 정렬 기준"]');
    const group=pane(1).querySelector('[aria-label="탐색창 1 분류 기준"]');
    if(previous){
      verify('탭·WebView 재시작 후 창별 트리 너비 유지',Math.abs(treeWidth(1)-report.treeWidth)<2&&Math.abs(treeWidth(2)-165)<2);
      verify('보기·정렬·분류·칼럼 재시작 복원',view.value==='content'&&sort.value==='created'&&group.value==='type'&&JSON.parse(sessionStorage.getItem('ed:panes'))[0].columns.includes('created'));
      verify('제외 폴더 재시작 복원',root.excludedPaths?.includes('비공개'));
      const result=await invoke('ed_request',{kind:'search',payload:{query:'제외 검증',limit:1000}});verify('재시작 후 제외 파일 검색에 나타나지 않음',result.total===0);
      sessionStorage.removeItem(checkpoint);report.passed=true;
    }else{
      for(const n of [1,2])pane(n).querySelector('[aria-label="폴더 트리 표시"]').click();await until(()=>pane(1).querySelector('.folder-tree [role="treeitem"]'),'트리 표시');
      const handle=pane(1).querySelector('[aria-label="폴더 트리 너비 조절"]'),initial=treeWidth(1),rect=handle.getBoundingClientRect();
      handle.dispatchEvent(new PointerEvent('pointerdown',{button:0,buttons:1,pointerId:23,clientX:rect.left+2,bubbles:true,cancelable:true}));
      handle.dispatchEvent(new PointerEvent('pointermove',{pointerId:23,buttons:1,clientX:rect.left+62,bubbles:true}));
      handle.dispatchEvent(new PointerEvent('pointerup',{pointerId:23,button:0,bubbles:true}));await pause();
      verify('트리 드래그 너비 변경과 다른 창 독립',Math.abs(treeWidth(1)-initial-60)<2&&Math.abs(treeWidth(2)-165)<2);
      handle.focus();key(handle,'ArrowRight');await pause();verify('트리 경계선 키보드 조절',Math.abs(treeWidth(1)-initial-70)<2);
      const savedWidth=treeWidth(1);pane(1).querySelector('[role="tab"]').focus();key(document.activeElement,'t',{ctrlKey:true});await until(()=>pane(1).querySelectorAll('[role="tab"]').length===2,'새 탭');
      verify('새 탭에서 창의 트리 너비 유지',Math.abs(treeWidth(1)-savedWidth)<2);pane(1).querySelector('[role="tab"]').click();await pause();verify('이전 탭으로 돌아와도 트리 너비 유지',Math.abs(treeWidth(1)-savedWidth)<2);
      verify('Windows 형식의 보기 종류 여덟 개 제공',view.options.length===8);
      verify('폴더의 기본 유형 칼럼은 폴더로 표시',find('문서').querySelector('[data-column="extension"]').textContent==='폴더');
      for(const option of [...view.options]){set(view,option.value);await pause();verify(`${option.textContent} 보기 실제 적용`,pane(1).querySelector('.file-table').dataset.view===option.value&&rows().length>0);}
      set(view,'list');set(sort,'created');await pause();verify('만든 날짜 정렬 기준 제공',pane(1).querySelector('[data-column="name"]').getAttribute('aria-sort')==='none');
      pane(1).querySelector('[aria-label="탐색창 1 표시 항목"]').click();const picker=await until(()=>document.querySelector('.search-columns-picker'),'속성 칼럼 선택');
      for(const label of ['만든 날짜','액세스한 날짜','특성']){const row=[...picker.querySelectorAll('label')].find(row=>row.querySelector('strong')?.textContent===label);row.querySelector('input').click();await pause();}
      picker.querySelector('[aria-label="표시 항목 닫기"]').click();await pause();
      verify('탐색창의 생성·접근·특성 칼럼 추가', ['created','accessed','attributes'].every(id=>pane(1).querySelector(`[role="columnheader"][data-column="${id}"]`)));
      verify('파일 시스템 생성 날짜 실제 표시',find('업무 보고서.txt').querySelector('[data-column="created"]').textContent!=='—');
      verify('다른 탐색창의 칼럼 설정 독립',!pane(2).querySelector('[data-column="created"]'));
      const heading=pane(1).querySelector('.file-columns');heading.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:500,clientY:220}));await until(()=>document.querySelector('.column-menu-fields'),'헤더 속성 메뉴');
      verify('헤더 우클릭에서도 속성 칼럼 선택 가능',document.querySelector('.column-menu-fields').textContent.includes('만든 날짜'));key(document.activeElement,'Escape');await pause();
      set(group,'type');await until(()=>pane(1).querySelector('.file-group-heading'),'유형 그룹');verify('유형별 분류 헤더와 항목 수 표시',pane(1).querySelector('.file-group-heading').textContent.includes('개'));
      rows()[0].focus();key(document.activeElement,'a',{ctrlKey:true});await pause();verify('분류 헤더를 제외한 모든 파일만 전체 선택',pane(1).querySelectorAll('.file-row.selected').length===rows().length&&!pane(1).querySelector('.file-group-heading.selected'));
      set(group,'none');await pause();find('업무 보고서.txt').click();find('업무 보고서.txt').focus();key(document.activeElement,' ');
      const preview=await until(()=>document.querySelector('.preview-modal'),'Space 미리보기');await until(()=>preview.querySelector('pre'),'텍스트 미리보기');
      const bounds=preview.getBoundingClientRect();verify('Space 미리보기는 화면 높이 90% 이상과 넓은 폭 사용',bounds.height>=innerHeight*.9&&bounds.width>=Math.min(1200,innerWidth*.9));
      verify('미리보기 내용 영역 높이 확보',preview.querySelector('.preview-body').getBoundingClientRect().height>=innerHeight*.65);close();await pause();
      const nativeButton=pane(1).querySelector('[aria-label="기본 탐색기에서 열기"]');verify('현재 폴더를 기본 탐색기로 여는 진입점 제공',nativeButton&&!nativeButton.disabled&&nativeButton.title.includes('현재 폴더'));
      document.querySelector('[aria-label="폴더 관리"]')?.click();
      if(!document.querySelector('dialog[open]'))[...document.querySelectorAll('.sidebar-nav')].find(button=>button.textContent.includes('인덱스 관리')).click();
      const excludeButton=await until(()=>document.querySelector('[aria-label$="인덱스 제외 폴더 설정"]'),'인덱스 제외 메뉴');excludeButton.click();await until(()=>document.querySelector('[aria-label="제외 폴더 경로"]'),'제외 입력');
      set(document.querySelector('[aria-label="제외 폴더 경로"]'),'비공개');await pause();document.querySelector('.index-exclusions button[type="submit"]').click();
      await until(()=>!document.querySelector('.index-exclusions'),'제외 설정 저장');close();await pause();
      const result=await invoke('ed_request',{kind:'search',payload:{query:'제외 검증',limit:1000}});verify('제외 폴더는 검색 결과에서 제거',result.total===0);
      const top=await invoke('ed_request',{kind:'list',payload:{rootId:root.id,path:''}});verify('제외 폴더는 탐색에서 유지',top.some(entry=>entry.name==='비공개'));
      const contents=await invoke('ed_request',{kind:'list',payload:{rootId:root.id,path:'비공개/하위'}});verify('제외 폴더 안의 파일은 탐색 가능',contents.some(entry=>entry.name==='제외 검증.txt'));
      set(view,'content');set(group,'type');await pause();report.treeWidth=treeWidth(1);sessionStorage.setItem(checkpoint,JSON.stringify(report));location.reload();return;
    }
  }catch(error){report.errors.push(String(error));report.screen=document.body.innerText.slice(-5000);sessionStorage.removeItem(checkpoint);}
  report.finished=new Date().toISOString();await invoke('ed_request',{kind:'smokeReport',payload:report});
})();

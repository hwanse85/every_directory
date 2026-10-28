// 키보드 커서 유지·OS 아이콘·정렬/보기 메뉴·클립보드 종류 탭·빠른 검색 창 확대를 실제 WebView에서 검증한다(Windows·macOS 공용).
(async()=>{
  const invoke=window.__TAURI_INTERNALS__.invoke;
  const report={suite:'ux',platform:navigator.platform,passed:false,tests:[],errors:[]};
  const until=async(check,label,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,40));}throw new Error(`시간 초과: ${label}`);};
  const pause=(ms=150)=>new Promise(r=>setTimeout(r,ms));
  const verify=(name,value)=>{if(!value)throw new Error(name);report.tests.push({name,passed:true});};
  const set=(input,value)=>{Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}));};
  const key=(target,key,props={})=>target.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...props}));
  const clip=(action,id)=>invoke('clipboard_control',{action,id:id??null,destination:null,query:null});
  const pane=n=>document.querySelectorAll('.explorer-pane')[n-1];
  const rows=(n=1)=>[...(pane(n)?.querySelectorAll('.file-row')??[])];
  const nameOf=row=>row?.querySelector('.file-name > span:not(.file-icon)')?.textContent;
  const row=(text,n=1)=>rows(n).find(item=>nameOf(item)===text);
  const crumbs=(n=1)=>pane(n)?.querySelector('.breadcrumbs')?.textContent??'';
  // 목록을 다시 불러오는 동안은 파일 작업 단축키가 잠기므로 준비될 때까지 기다린다.
  const ready=()=>until(()=>!pane(1).querySelector('.explorer-footer .spin')&&!pane(1).querySelector('.file-action-bar [title="붙여넣기 · Ctrl/⌘ V"]')?.disabled,'파일 작업 준비');
  const focused=()=>document.activeElement?.classList?.contains('file-row')?nameOf(document.activeElement):undefined;
  try{
    await until(()=>row('가 폴더'),'앱 초기화');
    const root=(await invoke('ed_request',{kind:'init',payload:{}}))[0];

    // 1. 폴더 진입·상위 이동·뒤로 가기 후에도 키보드 커서가 목록에 남는다.
    const folder=row('가 폴더');folder.click();folder.focus();key(folder,'Enter');
    await until(()=>crumbs().endsWith('가 폴더')&&focused()==='하위','폴더 진입 후 첫 항목 초점');
    verify('Enter로 폴더에 들어가면 첫 항목에 선택과 키보드 초점',document.activeElement.classList.contains('selected'));
    verify('파일 목록의 Tab 정지점은 하나',pane(1).querySelectorAll('.file-row[tabindex="0"]').length===1);
    key(document.activeElement,'Backspace');
    await until(()=>!crumbs().endsWith('가 폴더')&&focused()==='가 폴더','상위 이동 후 원래 폴더 초점');
    verify('Backspace로 상위로 오면 방금 나온 폴더를 선택하고 초점 유지',row('가 폴더').classList.contains('selected'));
    key(document.activeElement,'ArrowLeft',{altKey:true});
    await until(()=>crumbs().endsWith('가 폴더')&&focused()==='하위','Alt+← 뒤로 이동 후 초점');
    verify('Alt+← 뒤로 이동 후에도 목록 초점 유지',true);
    key(document.activeElement,'ArrowUp',{altKey:true});
    await until(()=>focused()==='가 폴더','Alt+↑ 상위 이동 후 초점');
    verify('Alt+↑ 상위 이동 후 방금 나온 폴더 선택',row('가 폴더').classList.contains('selected'));
    row('가 폴더').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    await until(()=>crumbs().endsWith('가 폴더')&&focused()==='하위','더블클릭 진입 후 초점');
    verify('더블클릭으로 들어가도 첫 항목에 초점',true);
    key(document.activeElement,'Backspace');await until(()=>focused()==='가 폴더','상위 복귀');
    key(document.activeElement,'ArrowDown');await until(()=>focused()==='나 폴더','방향키 이동');
    const filter=pane(1).querySelector('.folder-filter input');
    verify('현재 폴더 검색 상자는 주소줄 오른쪽에 위치',!!filter.closest('.explorer-navigation'));
    filter.focus();key(filter,'ArrowDown');await until(()=>focused(),'검색 상자에서 ↓');
    verify('현재 폴더 검색 상자에서 ↓로 목록 진입',pane(1).querySelector('.file-scroll').contains(document.activeElement));

    // 2. 삭제·이름 바꾸기 뒤 선택이 사라지지 않는다.
    await ready();const victim=row('사 삭제용.txt');victim.click();victim.focus();key(victim,'Delete');
    const trash=await until(()=>document.querySelector('dialog[open] .button.danger'),'삭제 확인');trash.click();
    await until(()=>!row('사 삭제용.txt')&&focused()==='아 이름변경.txt','삭제 후 다음 항목 초점',20000);
    verify('삭제하면 같은 자리의 다음 항목을 선택하고 초점 유지',row('아 이름변경.txt').classList.contains('selected'));
    await ready();const renameTarget=row('아 이름변경.txt');renameTarget.focus();key(renameTarget,'F2');
    const name=await until(()=>document.querySelector('dialog[open] [aria-label="작업 이름"]'),'이름 바꾸기 대화상자');
    set(name,'아 바뀐 이름.txt');document.querySelector('dialog[open] .button.primary').click();
    await until(()=>focused()==='아 바뀐 이름.txt','이름 변경 후 초점',20000);
    verify('이름을 바꾸면 새 이름 항목을 선택하고 초점 유지',row('아 바뀐 이름.txt').classList.contains('selected'));

    await ready();key(row('아 바뀐 이름.txt'),'n',{ctrlKey:true,metaKey:true,shiftKey:true});
    const folderName=await until(()=>document.querySelector('dialog[open] [aria-label="작업 이름"]'),'새 폴더 대화상자');
    set(folderName,'차 새 폴더');document.querySelector('dialog[open] .button.primary').click();
    await until(()=>focused()==='차 새 폴더','새 폴더 선택',20000);
    verify('새 폴더를 만들면 목록에서 새 폴더를 선택하고 초점',row('차 새 폴더').classList.contains('selected'));

    // 3. 검색창 ↓로 결과 목록에 들어간다.
    const search=document.querySelector('[aria-label="파일 검색"]');search.focus();set(search,'마 보고서');
    await until(()=>{const found=[...document.querySelectorAll('.search-table .file-row')];return found.length===1&&nameOf(found[0])?.includes('마 보고서');},'검색 결과');
    key(search,'ArrowDown');await until(()=>document.activeElement?.closest?.('.search-table'),'검색 결과 초점');
    verify('검색창에서 ↓로 첫 검색 결과에 선택과 초점',document.activeElement.classList.contains('selected')&&nameOf(document.activeElement)==='마 보고서.pdf');
    await until(()=>!crumbs().endsWith('가 폴더')&&row('가 폴더'),'검색 결과 위치 표시');
    set(search,'');

    // 4. 운영체제 탐색기와 같은 파일 아이콘을 불러온다.
    report.icons=()=>[...pane(1).querySelectorAll('.file-icon')].slice(0,6).map(icon=>({cls:icon.className,img:icon.querySelector('img')?.src,complete:icon.querySelector('img')?.complete,width:icon.querySelector('img')?.naturalWidth}));
    await until(()=>pane(1).querySelectorAll('.file-icon.native img').length>=4,'OS 아이콘 표시');
    const images=[...pane(1).querySelectorAll('.file-icon.native img')];
    verify('목록 아이콘은 운영체제 아이콘(edicon)을 실제로 불러옴',images.every(img=>img.complete&&img.naturalWidth>=16&&img.src.includes('edicon')));
    const iconOf=text=>row(text)?.querySelector('.file-icon img')?.src;
    verify('폴더·텍스트·엑셀은 형식별 OS 아이콘을 각각 요청',new Set([iconOf('가 폴더'),iconOf('다 문서.txt'),iconOf('라 계산.xlsx')]).size===3);
    verify('같은 형식의 파일은 하나의 공용 아이콘 주소를 공유',iconOf('다 문서.txt')===iconOf('자 마지막.txt'));

    // 5. 정렬·보기 메뉴(Windows 11 명령 막대)
    const [sortButton,viewButton]=pane(1).querySelectorAll('.flyout-trigger');
    verify('명령 막대에 정렬·보기 메뉴 단추',sortButton?.textContent.includes('정렬')&&viewButton?.textContent.includes('보기'));
    verify('자세히·아이콘 보기 전환은 상태 표시줄 오른쪽',!!pane(1).querySelector('.explorer-footer [aria-label="목록 보기"]')&&!!pane(1).querySelector('.explorer-footer [aria-label="격자 보기"]'));
    const current=pane(1).querySelector('.breadcrumbs > span:last-child button')??pane(1).querySelector('.breadcrumbs > button');const crumbBox=pane(1).querySelector('.breadcrumbs').getBoundingClientRect(),currentBox=current.getBoundingClientRect();
    verify('주소줄은 현재 폴더 이름을 잘리지 않는 위치에 표시',currentBox.right<=crumbBox.right+1&&currentBox.width>0);
    viewButton.click();await pause();
    verify('보기 단추는 메뉴 패널을 연다',viewButton.getAttribute('aria-expanded')==='true'&&!viewButton.nextElementSibling.hidden);
    const view=pane(1).querySelector('[aria-label="탐색창 1 보기 종류"]');set(view,'icons-large');
    await until(()=>pane(1).querySelector('.file-table').dataset.view==='icons-large','큰 아이콘 보기');
    const thumbnail=await until(()=>row('바 그림.png')?.querySelector('.file-icon.thumbnail img'),'이미지 미리보기 그림');
    verify('큰 아이콘 보기의 이미지 파일은 원본 파일 미리보기 그림을 사용',/edfile/.test(thumbnail.src)&&thumbnail.loading==='lazy');
    // 숨긴 검증 창은 화면을 그리지 않아 지연 로딩이 시작되지 않으므로, 즉시 로딩으로 바꿔 주소가 실제 그림을 주는지 확인한다.
    thumbnail.loading='eager';await until(()=>thumbnail.complete&&thumbnail.naturalWidth>0,'미리보기 그림 불러오기');
    verify('미리보기 주소(edfile·수정 시각)가 실제 그림을 제공',thumbnail.naturalWidth===96);
    set(view,'list');view.focus();key(view,'Escape');await pause();
    verify('Esc로 보기 메뉴를 닫고 단추로 초점 복귀',viewButton.nextElementSibling.hidden&&document.activeElement===viewButton);
    sortButton.click();await pause();document.activeElement?.blur?.();key(document.body,'Escape');await pause();
    verify('마우스로 연 메뉴도 Esc로 닫기',sortButton.nextElementSibling.hidden);
    sortButton.click();await pause();const sort=pane(1).querySelector('[aria-label="탐색창 1 정렬 기준"]');set(sort,'size');await pause();
    verify('정렬 메뉴에서 크기순 정렬 적용',pane(1).querySelector('[role="columnheader"][data-column="size"]').getAttribute('aria-sort')!=='none');
    set(sort,'name');document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));await pause();
    verify('메뉴 바깥을 누르면 정렬 메뉴 닫기',sortButton.nextElementSibling.hidden);

    // 6. 클립보드 이력의 종류 탭(전체·텍스트·이미지·파일·즐겨찾기)
    await clip('clear');
    for(const text of ['ux clipboard alpha','ux clipboard beta']){await invoke('plugin:clipboard-manager|write_text',{text});await clip('capture');}
    await invoke('copy_files',{locations:[{rootId:root.id,path:'다 문서.txt'}],cut:false});await clip('capture');
    document.querySelector('[aria-label="도구 열기"]').click();
    const tab=await until(()=>[...document.querySelectorAll('.tools-tabs [role="tab"]')].find(item=>item.textContent==='클립보드'),'도구 탭');tab.click();
    await until(()=>document.querySelectorAll('.clipboard-list [role="option"]').length===3,'클립보드 목록');
    const count=id=>document.querySelector(`.clipboard-types [data-type="${id}"] .clipboard-count`)?.textContent;
    verify('종류 탭에 전체·텍스트·이미지·파일 개수 표시',count('all')==='3'&&count('text')==='2'&&count('image')==='0'&&count('files')==='1');
    document.querySelector('.clipboard-types [data-type="text"]').click();
    await until(()=>document.querySelectorAll('.clipboard-list [role="option"]').length===2,'텍스트 탭');
    verify('텍스트 탭은 텍스트 이력만 표시',[...document.querySelectorAll('.clipboard-list [role="option"]')].every(item=>item.dataset.kind==='text'));
    const history=document.querySelector('.clipboard-history');
    key(history,'4',{ctrlKey:true,metaKey:true});await until(()=>document.querySelectorAll('.clipboard-list [role="option"]').length===1,'파일 탭 단축키');
    verify('Ctrl/⌘+4로 파일 이력만 표시',document.querySelector('.clipboard-list [role="option"]').dataset.kind==='files');
    key(history,'3',{ctrlKey:true,metaKey:true});await until(()=>document.querySelector('.clipboard-list .empty-state'),'이미지 탭');
    verify('비어 있는 종류는 안내 문구 표시',document.querySelector('.clipboard-list .empty-state').textContent.includes('이미지'));
    key(history,'1',{ctrlKey:true,metaKey:true});await until(()=>document.querySelectorAll('.clipboard-list [role="option"]').length===3,'전체 탭');
    verify('클립보드 목록은 여러 항목이 한 번에 보이는 높이',document.querySelector('.clipboard-list').clientHeight>=46*5);
    [...document.querySelectorAll('.clipboard-actions button')].find(item=>item.textContent==='즐겨찾기').click();
    await until(()=>count('favorite')==='1','즐겨찾기 개수');
    verify('즐겨찾기 탭 개수 갱신',true);
    document.querySelector('dialog[open] [aria-label="닫기"]').click();await pause();

    // 7. 빠른 검색의 클립보드 보기는 창을 키우고, 파일 검색으로 돌아오면 원래 크기로 줄인다.
    const size=async()=>{const value=await invoke('plugin:window|inner_size',{label:'quick-search'});const scale=await invoke('plugin:window|scale_factor',{label:'quick-search'});return {width:value.width/scale,height:value.height/scale};};
    await invoke('quick_control',{action:'restore',location:null});await pause(300);const small=await size();
    await invoke('quick_control',{action:'expand',location:null});await pause(300);const large=await size();
    report.quickSizes={small,large};
    verify('클립보드 보기용 빠른 검색 창은 더 넓고 높게 확대',large.width>=small.width+150&&large.height>=small.height+100);
    await invoke('quick_control',{action:'restore',location:null});await pause(300);const restored=await size();
    verify('파일 검색으로 돌아오면 원래 크기로 복원',Math.abs(restored.width-small.width)<2&&Math.abs(restored.height-small.height)<2);
    await clip('clear');
    report.passed=true;
  }catch(error){report.errors.push(String(error));report.debug={active:(document.activeElement?.className||document.activeElement?.tagName)+' | '+(document.activeElement?.textContent||'').slice(0,40),selected:[...(pane(1)?.querySelectorAll('.file-row.selected')??[])].map(nameOf),dialog:!!document.querySelector('dialog[open]')};report.screen=document.body.innerText.slice(-1500);if(report.icons)report.icons=report.icons();}
  if(typeof report.icons==='function')delete report.icons;
  report.finished=new Date().toISOString();await invoke('ed_request',{kind:'smokeReport',payload:report});
})();

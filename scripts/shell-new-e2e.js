(async()=>{
 const invoke=window.__TAURI_INTERNALS__.invoke,report={suite:'shell-new',tests:[],errors:[],passed:false};
 const until=async(check,label)=>{const end=Date.now()+12000;while(Date.now()<end){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,40));}throw new Error(`시간 초과: ${label}`);};
 const pause=()=>new Promise(r=>setTimeout(r,100));
 const verify=(name,value)=>{if(!value)throw new Error(name);report.tests.push({name,passed:true});};
 const pane=n=>document.querySelectorAll('.explorer-pane')[n-1];
 try{
  await until(()=>pane(1)?.querySelector('.file-row'),'앱 준비');
  const root=(await invoke('ed_request',{kind:'init',payload:{}}))[0],location={rootId:root.id,path:''};
  const list=path=>invoke('ed_request',{kind:'list',payload:{rootId:root.id,path}});
  const items=await invoke('ed_request',{kind:'smokeShellNew',payload:{action:'items',location}});
  report.registeredTypes=items.map(item=>({label:item[1],verb:item[2]}));
  verify('파일 형식은 Windows Shell에서 동적으로 조회',items.length>=2&&items.some(item=>item[2]==='NewFolder'));
  async function choose(n,verb){
   await invoke('ed_request',{kind:'smokeShellNew',payload:{action:'next',verb}});
   const files=pane(n).querySelector('.explorer-files'),rect=files.getBoundingClientRect();files.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left+40,clientY:rect.top+30}));
   const menu=await until(()=>document.querySelector('.file-context-menu [data-group="create"]'),'새로 만들기 메뉴');menu.click();await pause();
  }
  const original=await list('');await choose(1,'__popup_cancel');
  await until(async()=> (await invoke('ed_request',{kind:'smokeShellNew',payload:{action:'status'}})).tracked,'실제 네이티브 팝업 표시');
  verify('새로 만들기 클릭은 실제 Windows 팝업을 표시',true);
  await pause();verify('네이티브 메뉴 취소는 파일을 만들지 않음',(await list('')).length===original.length);
  verify('표시된 시스템 목록에 텍스트 형식 제공',items.some(item=>item[2]==='.txt'));
  await choose(1,'.txt');
  let created=await until(async()=>{const entries=await list('');return entries.find(entry=>!original.some(old=>old.id===entry.id));},'Windows 텍스트 파일 생성');
  verify('Windows 핸들러가 현재 폴더에 텍스트 파일 생성',created.extension==='txt'&&created.kind==='file');
  await until(()=>[...pane(1).querySelectorAll('.file-row.selected')].some(row=>row.title.endsWith('\\'+created.name)),'생성 파일 선택');
  verify('생성한 파일 자동 선택과 목록 갱신',true);
  pane(1).querySelector('.file-row.selected').focus();pane(1).querySelector('.file-row.selected').dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true,cancelable:true}));
  await until(()=>document.querySelector('dialog[open] [aria-label="작업 이름"]'),'이름 변경');verify('생성 파일은 F2로 이름 변경 가능',document.querySelector('[aria-label="작업 이름"]').value===created.name);document.querySelector('dialog[open] [aria-label="닫기"]').click();await pause();
  const afterFirst=await list('');await choose(1,'.txt');await until(async()=> (await list('')).length===afterFirst.length+1,'번호 사본');
  verify('동일 형식 반복 생성은 Windows 번호 이름과 기존 파일 보존',(await list('')).some(entry=>entry.id===created.id));
  const beforeFolder=await list('');await choose(1,'NewFolder');await until(async()=> (await list('')).some(entry=>entry.kind==='directory'&&!beforeFolder.some(old=>old.id===entry.id)),'Windows 폴더 생성');verify('네이티브 새 폴더 생성',true);
  if(items.some(item=>item[2]==='.xlsx')){
   const beforeExcel=await list('');await choose(1,'.xlsx');const excel=await until(async()=> (await list('')).find(entry=>entry.extension==='xlsx'&&!beforeExcel.some(old=>old.id===entry.id)),'설치된 Excel 형식 생성');
   verify('설치된 Office 형식은 시스템 서식으로 생성',excel.size>0);
  }
  const destination=[...pane(2).querySelectorAll('.file-row')].find(row=>row.title.endsWith('\\대상'));destination.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));await until(()=>pane(2).querySelector('.breadcrumbs').textContent.includes('대상'),'두 번째 창 위치');
  await choose(2,'.txt');await until(async()=> (await list('대상')).some(entry=>entry.extension==='txt'),'다른 창에서 새 파일');verify('실행한 탐색창의 현재 폴더가 생성 대상',true);
  const beforeError=(await list('')).length;
  let invalid=false;try{await invoke('shell_new_menu',{location:{rootId:root.id,path:'업무 보고서.txt'},point:null});}catch{invalid=true;}verify('파일 경로는 생성 대상 폴더로 허용하지 않음',invalid);
  invalid=false;try{await invoke('shell_new_menu',{location:{rootId:root.id,path:'../outside'},point:null});}catch{invalid=true;}verify('연결 범위를 벗어나는 생성 대상 차단',invalid);
  invalid=false;try{await invoke('shell_new_menu',{location,point:{x:-2147483648,y:0}});}catch{invalid=true;}verify('잘못된 메뉴 좌표를 안전하게 거부',invalid);
  verify('잘못된 요청은 기존 파일에 영향을 주지 않음',(await list('')).length===beforeError);
  report.passed=true;
 }catch(error){report.errors.push(String(error));report.screen=document.body.innerText.slice(-4000);}
 report.finished=new Date().toISOString();await invoke('ed_request',{kind:'smokeReport',payload:report});
})();

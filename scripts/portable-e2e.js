// 포터블 실행에서 사용자 설정이 실행 파일 옆 portable-data에 저장되고, 재실행 후 설정 창에 그대로 보이는지 실제 화면으로 검증한다.
(async()=>{
 const invoke=window.__TAURI_INTERNALS__.invoke,report={suite:"portable",tests:[],errors:[],passed:false};
 const wait=async(check,label)=>{const end=Date.now()+14000;while(Date.now()<end){const r=await check();if(r)return r;await new Promise(r=>setTimeout(r,60));}throw new Error(`시간 초과: ${label}`);};
 const verify=(name,value)=>{if(!value)throw new Error(name);report.tests.push({name,passed:true});};
 const prefs=()=>invoke("preferences_control",{next:null});
 const status=()=>invoke("desktop_control",{action:"status",value:null,shortcut:null,mode:null});
 const dialog=()=>document.querySelector("dialog[open]");
 const control=label=>dialog()?.querySelector(`[aria-label="${label}"]`);
 const follow="검색 결과 선택 시 탐색창 따라가기",hidden="숨김 파일 표시";
 // 도구 막대의 설정 단추로 프로그램 설정 창을 연다.
 const openSettings=async()=>{document.querySelector('button[aria-label="설정"]').click();return wait(()=>control(follow),"설정 창 열기");};
 // 설정 창의 닫기 단추를 누른다. 저장하지 않은 변경이 있으면 창은 닫히지 않고 저장 여부를 묻는다.
 const pressClose=()=>dialog().querySelector('[aria-label="닫기"]').click();
 const closeSettings=async()=>{pressClose();await wait(()=>!dialog(),"설정 창 닫기");};
 const footerButton=text=>[...(dialog()?.querySelectorAll(".preference-actions button")??[])].find(button=>button.textContent.trim()===text);
 // 고정한 저장 영역이 설정 창 화면 안(아래쪽)에 보이는지 확인한다.
 const footerVisible=()=>{const box=dialog().getBoundingClientRect(),bar=dialog().querySelector(".preference-actions").getBoundingClientRect();return bar.height>0&&bar.top>=box.top&&bar.bottom<=box.bottom+1&&box.bottom-bar.bottom<4;};
 try{
  await wait(()=>document.querySelector('.explorer-pane .file-row'),"포터블 앱 준비");
  const p=await prefs();
  const desktop=await status();
  verify("포터블 실행은 로그인 자동 시작을 기본 등록하지 않음",desktop.autoStart===false);
  if(window.__portableRestart){
   verify("포터블 실행 파일 옆의 설정을 종료 후 재실행해 복원",p.clipboardDays===23&&p.clipboardKeyword==="portableclip"&&p.fontScale===115);
   verify("포터블 창에 저장된 글자 크기 적용",document.documentElement.style.getPropertyValue("--user-font-scale")==="1.15");
   verify("설정 창에서 저장한 사용자 설정을 재실행 후 복원",p.followSearchSelection===true&&p.showHidden===true);
   verify("설정 창에서 바꾼 기본 검색 방식을 재실행 후 복원",desktop.defaultSearchMode==="normal");
   await openSettings();
   verify("재실행 후 설정 창에 저장한 사용자 설정이 켜져 표시",control(follow).checked&&control(hidden).checked);
   verify("재실행 후 설정 창에 저장한 기본 검색 방식이 표시",control("기본 검색 방식").value==="normal");
   await closeSettings();
  }else{
   await invoke("preferences_control",{next:{...p,clipboardDays:23,clipboardKeyword:"portableclip",fontScale:115,clipboardEnabled:false}});
   verify("포터블 사용자 설정 저장",(await prefs()).clipboardKeyword==="portableclip");
   // 저장 단추는 스크롤 위치와 관계없이 설정 창 아래에 고정되어 보인다.
   await openSettings();
   verify("설정 창을 열면 아래에 사용자 설정 저장 단추가 보임",footerVisible()&&footerButton("사용자 설정 저장"));
   dialog().scrollTop=dialog().scrollHeight;await new Promise(r=>setTimeout(r,120));
   verify("설정 창을 끝까지 내려도 저장 단추가 아래에 고정",footerVisible());
   dialog().scrollTop=0;
   // 저장하지 않고 닫으려 하면 창을 닫지 않고 저장 여부를 묻는다.
   control(follow).click();
   verify("설정 창에서 사용자 설정을 바꾸면 화면에 바로 표시",control(follow).checked);
   pressClose();
   await wait(()=>footerButton("저장하고 닫기"),"저장 여부 확인");
   verify("저장하지 않은 변경이 있으면 닫기 전에 저장 여부를 물음",!!dialog()&&footerButton("저장하지 않고 닫기")&&footerButton("계속 편집")&&footerVisible());
   footerButton("저장하지 않고 닫기").click();await wait(()=>!dialog(),"저장하지 않고 닫기");
   verify("‘저장하지 않고 닫기’는 바꾼 값을 저장하지 않음",(await prefs()).followSearchSelection===false);
   await openSettings();
   verify("저장하지 않고 닫은 값은 다시 열면 이전 값으로 표시",!control(follow).checked);
   // Esc로 닫을 때도 같은 확인을 거치고, ‘저장하고 닫기’로 저장한다.
   control(follow).click();control(hidden).click();
   dialog().dispatchEvent(new Event("cancel",{cancelable:true}));
   await wait(()=>footerButton("저장하고 닫기"),"Esc 저장 여부 확인");
   footerButton("저장하고 닫기").click();await wait(()=>!dialog(),"저장하고 닫기");
   const saved=await prefs();
   verify("Esc로 닫을 때 ‘저장하고 닫기’로 포터블 사용자 설정 저장",saved.followSearchSelection===true&&saved.showHidden===true&&saved.clipboardDays===23);
   // 저장 단추로 저장하면 상태 문구를 표시하고, 변경이 없으면 확인 없이 닫힌다.
   await openSettings();control(hidden).click();control(hidden).click();
   footerButton("사용자 설정 저장").click();
   await wait(()=>dialog()?.querySelector('.preference-actions [role="status"]')?.textContent.includes("저장했습니다"),"사용자 설정 저장 완료");
   verify("고정한 ‘사용자 설정 저장’ 단추로 저장",(await prefs()).showHidden===true);
   // 기본 검색 방식은 고르는 즉시 저장된다.
   const mode=control("기본 검색 방식");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(mode,"normal");mode.dispatchEvent(new Event("change",{bubbles:true}));
   await wait(async()=>(await status()).defaultSearchMode==="normal","기본 검색 방식 저장");
   verify("기본 검색 방식은 고르는 즉시 포터블 설정에 저장",true);
   await closeSettings();
   report.restart=true;
  }
  report.passed=true;
 }catch(e){report.errors.push(String(e));}
 report.finished=new Date().toISOString();await invoke("ed_request",{kind:"smokeReport",payload:report});
})();

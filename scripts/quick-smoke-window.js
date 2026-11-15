// 실제 WebView와 IPC를 통해 검색·즐겨찾기·안전한 복사 흐름을 검증한다.
(async () => {
  if (window.__quickSmokeWindow) return;
  window.__quickSmokeWindow = true;
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const tests = [];
  // 비동기 화면의 조건이 충족될 때까지 제한된 시간 동안 확인한다.
  async function until(check, label) {
    for (let n = 0; n < 200; n++) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`시간 초과: ${label}`);
  }
  // 통과 조건과 이름을 보고서에 기록한다.
  function verify(name, condition) {
    if (!condition) throw new Error(name);
    tests.push(name);
  }
  // React 검색 입력을 실제 입력 이벤트와 함께 변경한다.
  function search(value) {
    const input = document.querySelector('[aria-label="파일·폴더 빠른 검색"]');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }
  try {
    await until(
      () => document.querySelector('[role="option"]'),
      "즐겨찾기 표시",
    );
    verify(
      "실제 검색창 즐겨찾기 복원",
      document.body.innerText.includes("업무 보고서.txt"),
    );
    search("ㅇㅁ ㅂㄱㅅ");
    await until(
      () =>
        document
          .querySelector('[role="option"]')
          ?.textContent.includes("업무 보고서.txt") &&
        document.body.innerText.includes("초성 + 일반 검색") &&
        document.querySelector('[aria-label="검색어 지우기"]') &&
        !document.querySelector(".quick-input-row .spin"),
      "초성 검색",
    );
    verify("한글 초성 검색과 IPC 권한", true);
    for (const [query, expected] of [
      ["ㅂㄱㅅ", "업무 보고서.txt"],
      ["ㅆㄹㅁㅇㄷ", "쏠리마인드.txt"],
      ["ᄇᄀᄉ", "업무 보고서.txt"],
      ["ﾲﾡﾵ", "업무 보고서.txt"],
    ]) {
      search(query);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await until(
        () =>
          !document.querySelector(".quick-input-row .spin") &&
          [...document.querySelectorAll('[role="option"]')].some((row) =>
            row.textContent.includes(expected),
          ),
        `빠른 검색 ${query}`,
      );
      verify(`빠른 검색: ${query}`, true);
    }
    // 영문·숫자 여러 단어 검색은 기본 설정(경로까지 검색)에서도 파일명 일치를 찾는다.
    search("yk5 xlsx");
    await until(
      () =>
        !document.querySelector(".quick-input-row .spin") &&
        document.querySelector('[role="option"]')?.textContent.includes("YK5 정산표.xlsx"),
      "빠른 검색 yk5 xlsx",
    );
    verify("빠른 검색: 영문·숫자 여러 단어(yk5 xlsx)", true);
    const resultRow = document.querySelector(".quick-result");
    const resultList = document.querySelector("#quick-results");
    const rowHeight = resultRow.getBoundingClientRect().height;
    verify("빠른 검색 결과 행은 낮게 배치", rowHeight <= 44);
    verify("빠른 검색 창에 결과 10개 이상이 한 번에 보임", resultList.clientHeight / rowHeight >= 10);
    const imeInput = document.querySelector(
      '[aria-label="파일·폴더 빠른 검색"]',
    );
    imeInput.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    search("ㅂㄳ");
    await new Promise((resolve) => setTimeout(resolve, 80));
    verify("빠른 검색 IME 입력 중 원본 조합 보존", imeInput.value === "ㅂㄳ");
    verify("빠른 검색 조합 중에도 개별 초성으로 표시",imeInput.parentElement.querySelector('.ime-preview')?.textContent==="ㅂㄱㅅ");
    imeInput.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "ㅂㄳ" }),
    );
    search("ㅂㄳ"); // Late IME commit must not duplicate a consonant.
    await until(
      () =>
        imeInput.value === "ㅂㄱㅅ" &&
        !document.querySelector(".quick-input-row .spin") &&
        document
          .querySelector('[role="option"]')
          ?.textContent.includes("업무 보고서.txt"),
      "빠른 검색 IME 확정",
    );
    // 처음 표시 이벤트와 비동기 검색이 끝난 상태에서 작업 키를 전달한다.
    await until(() => {
      if (document.querySelector('[role="menu"]')) return true;
      if (
        document.querySelector('[role="option"]') &&
        !document.querySelector(".quick-input-row .spin")
      ) {
        document.querySelector("input").dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Tab",
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      return false;
    }, "작업 메뉴");
    verify("키보드 작업 메뉴", true);
    [...document.querySelectorAll('[role="menuitem"]')]
      .find((item) => item.textContent.includes("다른 폴더로 복사"))
      .click();
    await until(
      () => document.querySelector(".quick-destinations button"),
      "복사 대상",
    );
    document.querySelector(".quick-destinations button").click();
    await until(
      () =>
        [...document.querySelectorAll(".quick-destinations button")].some(
          (button) => button.textContent.includes("대상"),
        ),
      "대상 폴더 목록",
    );
    [...document.querySelectorAll(".quick-destinations button")]
      .find((button) => button.textContent.includes("대상"))
      .click();
    await until(
      () =>
        document
          .querySelector(".quick-destination-path")
          ?.textContent.includes("대상"),
      "대상 폴더 진입",
    );
    document.querySelector(".quick-copy-confirm button").click();
    await until(
      () =>
        document
          .querySelector('[role="status"]')
          ?.textContent.includes("복사했습니다"),
      "실제 사본 생성",
    );
    verify("연결 폴더로 실제 파일 복사", true);
    // 학습형 순위: 같은 검색어로 두 번 고른 사본(대상/업무 보고서.txt)이 다음 검색에서 1위로 올라온다.
    const learnRoots = await invoke("ed_request", { kind: "init", payload: {} });
    const copied = { rootId: learnRoots[0].id, path: "대상/업무 보고서.txt" };
    const firstRow = () => document.querySelector("#quick-result-0")?.textContent ?? "";
    search("업무 보고");
    await until(() => !document.querySelector(".quick-input-row .spin") && document.querySelectorAll('[role="option"]').length >= 2, "같은 이름 두 결과");
    verify("학습 전에는 최근 연 원본이 앞", !firstRow().includes("대상"));
    for (let n = 0; n < 2; n++)
      await invoke("ed_request", { kind: "quickAccess", payload: { action: "opened", location: copied, query: "업무 보고", learn: true } });
    search("업무 보");
    await new Promise((resolve) => setTimeout(resolve, 150));
    search("업무 보고");
    await until(() => !document.querySelector(".quick-input-row .spin") && firstRow().includes("대상"), "학습한 항목 1위");
    verify("같은 검색어로 두 번 고른 파일이 세 번째 검색에서 1위", true);
    // 한/영 자판 보정과 되돌리기
    search("qhrhtj");
    await until(() => document.querySelector(".quick-corrected")?.textContent.includes("‘보고서’") && firstRow().includes("업무 보고서.txt"), "빠른 검색 자판 보정");
    verify("빠른 검색: qhrhtj → 보고서로 바꿔 찾음", true);
    document.querySelector(".quick-corrected button").click();
    await until(() => !document.querySelector(".quick-corrected") && !document.querySelector(".quick-input-row .spin") && !document.querySelector('[role="option"]'), "빠른 검색 원래 검색어로 찾기");
    verify("빠른 검색: 원래 검색어 그대로 찾기", true);
    search("mbr");
    await until(() => !document.querySelector(".quick-input-row .spin") && firstRow().includes("MyBigReport.pdf"), "빠른 검색 영문 약어");
    verify("빠른 검색: 영문 약어 mbr → MyBigReport.pdf", true);
    verify(
      "검색창과 하단 안내가 창 안에 표시됨",
      document.querySelector(".quick-footer").getBoundingClientRect().bottom <=
        innerHeight,
    );
    const roots = await invoke("ed_request", { kind: "init", payload: {} });
    let rejected = false;
    try {
      await invoke("ed_request", {
        kind: "operation",
        payload: {
          action: "trash",
          entries: [{ rootId: roots[0].id, path: "업무 보고서.txt" }],
        },
      });
    } catch {
      rejected = true;
    }
    verify("검색창의 삭제 작업 차단", rejected);
    rejected = false;
    try {
      await invoke("copy_files", {
        locations: [{ rootId: roots[0].id, path: "../outside" }],
      });
    } catch {
      rejected = true;
    }
    verify("파일 클립보드의 범위 이탈 차단", rejected);
    await invoke("plugin:clipboard-manager|write_text",{text:"quick clipboard history entry"});
    await invoke("clipboard_control",{action:"capture",id:null,destination:null,query:null});
    search("cliptest");
    await until(()=>document.querySelector("#quick-clipboard-trigger"),"사용자 키워드 클립보드 항목");
    verify("빠른 검색에서 사용자 키워드의 클립보드 보기 항목을 최상단 표시",document.querySelector("#quick-results").firstElementChild?.id==="quick-clipboard-trigger");
    document.querySelector('[aria-label="파일·폴더 빠른 검색"]').dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
    await until(()=>document.querySelector('.clipboard-list [role="option"]'),"Enter로 클립보드 이력 열기");
    verify("빠른 검색 Enter는 최신 클립보드 목록을 표시",document.querySelector('.clipboard-list [role="option"]').textContent.includes("quick clipboard history entry"));
    await until(()=>document.querySelector('.clipboard-preview pre')?.textContent.includes("quick clipboard history entry"),"내용 미리보기");
    verify("빠른 검색에서 클립보드 내용 미리보기와 복사·저장 작업 제공",[...document.querySelectorAll('.clipboard-actions button')].some(b=>b.textContent==="사본 저장"));
    verify("빠른 검색 클립보드 작업 버튼과 상태가 창 안에 표시",document.querySelector('.clipboard-actions').getBoundingClientRect().bottom<=innerHeight&&document.querySelector('.clipboard-history>p[role="status"]').getBoundingClientRect().bottom<=innerHeight);
    document.querySelector('[aria-label="클립보드 이력 검색"]').dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));
    await until(()=>document.querySelector("#quick-clipboard-trigger"),"Esc로 파일 검색 복귀");
    verify("클립보드 화면 Esc는 파일 검색으로 복귀",true);
    // 설정 키워드 말고도 clip·클립·클립보드로 클립보드를 연다.
    for(const word of ["clip","클립","클립보드"]){
      search(word);
      await until(()=>document.querySelector("#quick-results")?.firstElementChild?.id==="quick-clipboard-trigger","클립보드 키워드 "+word);
    }
    verify("빠른 검색에서 clip·클립·클립보드 모두 클립보드 보기를 최상단 표시",true);
    // 클립보드 창의 이미지·파일 이력을 실제 화면에서 고르고 복사한다. 복사 결과는 시스템 클립보드를 다시 기록해 확인한다.
    const clip=(action,id)=>invoke("clipboard_control",{action,id:id??null,destination:null,query:null});
    await clip("testImage");await clip("capture");
    await invoke("copy_files",{locations:[{rootId:roots[0].id,path:"업무 보고서.txt"}],cut:false});await clip("capture");
    await invoke("plugin:clipboard-manager|write_text",{text:"quick clipboard reset"});await clip("capture");
    document.querySelector('[aria-label="파일·폴더 빠른 검색"]').dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
    await until(()=>document.querySelector('.clipboard-types [data-type="image"]'),"클립보드 종류 탭");
    const tab=type=>document.querySelector(`.clipboard-types [data-type="${type}"]`);
    const copyButton=()=>[...document.querySelectorAll('.clipboard-actions button')].find(b=>b.textContent.includes("클립보드로 복사"));
    const plainButton=()=>[...document.querySelectorAll('.clipboard-actions button')].find(b=>b.textContent.includes("텍스트로 복사"));
    const top=async()=>{await clip("capture");return (await clip("list")).items[0];};
    tab("image").click();
    await until(()=>document.querySelector('.clipboard-preview img')?.naturalWidth>0&&document.querySelector('.clipboard-list [role="option"][data-kind="image"]'),"이미지 탭 미리보기");
    verify("클립보드 창 이미지 탭은 이미지 이력만 보이고 그림을 미리보기",[...document.querySelectorAll('.clipboard-list [role="option"]')].every(o=>o.dataset.kind==="image")&&document.querySelector('.clipboard-preview img').naturalWidth>0);
    verify("이미지는 텍스트로 복사를 막음",plainButton().disabled);
    copyButton().click();
    await until(()=>document.querySelector('.clipboard-history>p[role="status"]')?.textContent.includes("복사했습니다"),"이미지 복사 안내");
    verify("클립보드 창에서 이미지 이력을 시스템 클립보드에 이미지로 복사",(await top()).kind==="image");
    tab("files").click();
    await until(()=>document.querySelector('.clipboard-preview pre')?.textContent.includes("업무 보고서.txt")&&document.querySelector('.clipboard-list [role="option"][data-kind="files"]'),"파일 탭 미리보기");
    verify("클립보드 창 파일 탭은 파일 이력만 보이고 원본 경로를 미리보기",[...document.querySelectorAll('.clipboard-list [role="option"]')].every(o=>o.dataset.kind==="files"));
    await until(()=>!copyButton().disabled,"파일 복사 준비");
    copyButton().click();
    await new Promise(r=>setTimeout(r,300));
    const copiedFiles=await top();
    verify("클립보드 창에서 파일 이력을 시스템 파일 클립보드로 복사(붙여넣기 가능)",copiedFiles.kind==="files"&&(await clip("read",copiedFiles.id)).paths[0].endsWith("업무 보고서.txt"));
    plainButton().click();await new Promise(r=>setTimeout(r,300));
    const copiedText=await top();
    verify("파일 이력의 텍스트로 복사는 경로 글자를 복사",copiedText.kind==="text"&&copiedText.preview.endsWith("업무 보고서.txt"));
    tab("all").click();
    document.querySelector('[aria-label="클립보드 이력 검색"]').dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));
    await until(()=>document.querySelector("#quick-clipboard-trigger"),"Esc로 파일 검색 복귀");
    // 절대 경로·연결 폴더 이름으로 시작하는 경로를 입력하면 그 위치를 경로 일치 항목으로 맨 위에 보여 준다.
    const base=roots[0].absolutePath.replace(/^\\\\\?\\(UNC\\)?/,(_,unc)=>unc?"\\\\":""),separator=/^[a-z]:\\|^\\\\/i.test(base)?"\\":"/";
    search(base+separator+"대상"+separator);
    await until(()=>document.querySelector("#quick-result-0 .path-match"),"절대 경로 위치 일치");
    verify("빠른 검색에 연결 폴더 안의 절대 경로를 입력하면 그 폴더를 맨 위에 경로 일치로 표시",document.querySelector("#quick-result-0 strong").textContent==="대상");
    verify("경로 일치 항목은 Enter가 위치로 이동",document.querySelector(".quick-footer").textContent.includes("위치로 이동"));
    search(roots[0].name+"/대상");
    await until(()=>document.querySelector("#quick-result-0 .path-match")&&document.querySelector("#quick-result-0 strong").textContent==="대상","연결 폴더 이름 경로 일치");
    verify("연결 폴더 이름으로 시작하는 일부 경로도 위치로 해석",true);
    // ── 2단계: 작업 메뉴 확장(미리보기·경로 형식·압축해서 보내기·다른 앱·이름 바꾸기·사용자 동작·나란히 열기)
    const mac2 = /Mac/.test(navigator.platform);
    const spin = () => document.querySelector(".quick-input-row .spin");
    const row0 = () => document.querySelector("#quick-result-0")?.textContent ?? "";
    const quickInput = () => document.querySelector('[aria-label="파일·폴더 빠른 검색"]');
    const key = (k, extra = {}) => quickInput().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra }));
    const status = () => document.querySelector('.quick-message[role="status"]')?.textContent ?? "";
    // 검색해서 첫 결과가 name이 될 때까지 기다리고 작업 메뉴를 연다.
    async function menuFor(query, name) {
      search(query);
      await until(() => !spin() && row0().includes(name), `검색 ${query}`);
      await until(() => { if (document.querySelector('[role="menu"]')) return true; key("Tab"); return false; }, `작업 메뉴 ${name}`);
    }
    const pick = (text) => [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes(text)).click();
    const roots2 = await invoke("ed_request", { kind: "init", payload: {} });
    // 미리보기(⌘/Ctrl+Y)
    search("업무 보고서");
    await until(() => !spin() && row0().includes("업무 보고서.txt"), "미리보기 대상 검색");
    key("y", mac2 ? { metaKey: true } : { ctrlKey: true });
    await until(() => document.querySelector(".quick-preview pre")?.textContent.includes("한글 원본 내용"), "텍스트 미리보기");
    verify("빠른 검색 미리보기(⌘/Ctrl+Y)로 텍스트 앞부분 표시", true);
    key("y", mac2 ? { metaKey: true } : { ctrlKey: true });
    await until(() => !document.querySelector(".quick-preview") && document.querySelector("#quick-results"), "미리보기 닫기");
    // ── 4단계: 계산 결과와 앱 실행(설정에서 켠 상태)
    search("12*3+4");
    await until(() => document.querySelector(".quick-special.calc.active")?.textContent.includes("40"), "계산 결과 줄");
    key("Enter");
    await until(() => status().includes("계산 결과 40"), "계산 결과 복사");
    verify("빠른 검색 계산: 12*3+4 = 40을 맨 위에 보이고 Enter로 복사", true);
    search("2026-03");
    await new Promise((resolve) => setTimeout(resolve, 400));
    verify("날짜·번호 같은 검색어(2026-03)는 계산하지 않음", !document.querySelector(".quick-special.calc"));
    search("ㄱㅅ ㅅㅎ");
    await until(() => document.querySelector(".quick-special.app.active")?.textContent.includes("계산 시험 앱"), "앱 줄");
    verify("빠른 검색 앱: 초성(ㄱㅅ ㅅㅎ)으로 앱을 찾아 맨 위에 표시", true);
    key("Enter");
    await until(async () => (await invoke("ed_request", { kind: "smokeOpens", payload: null })).some((item) => item.launch && String(item.path).includes("계산 시험 앱")), "앱 실행 요청");
    verify("앱 줄에서 Enter로 앱 실행 요청", true);
    await invoke("quick_control", { action: "show" });
    let launchRejected = false;
    try { await invoke("ed_request", { kind: "launchApp", payload: { path: "/bin/sh" } }); } catch { launchRejected = true; }
    verify("앱 목록에 없는 경로는 실행하지 않음", launchRejected);
    // 작업 메뉴에 새 동작이 모두 보인다.
    await menuFor("메모", "메모.txt");
    const titles = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    for (const title of ["미리보기", mac2 ? "다른 앱으로 열기" : "연결 프로그램 선택", "경로 형식 복사", "압축해서 보내기", "탐색창 두 곳에 나란히 열기", "이름 바꾸기", "검증 동작"])
      if (!titles.some((text) => text.includes(title))) throw new Error(`작업 메뉴에 ${title} 없음: ${titles.join(" | ")}`);
    verify("작업 메뉴에 미리보기·다른 앱·경로 형식·압축·나란히 열기·이름 바꾸기·사용자 동작 표시", true);
    // 경로 형식 복사
    pick("경로 형식 복사");
    await until(() => [...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent.includes("file:// 주소")), "경로 형식 목록");
    const urlItem = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.includes("file:// 주소"));
    verify("경로 형식: file:// 주소는 인코딩된 file:/// 경로", /^file:\/\/\/?.*%EB%A9%94%EB%AA%A8\.txt$/.test(urlItem.querySelector(".quick-choice-detail").textContent));
    verify("경로 형식: 따옴표 경로·연결 폴더 기준 경로 제공", [...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent.includes("따옴표로 감싼 경로")) && [...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent.includes("문서/메모.txt")));
    urlItem.click();
    await until(() => status().includes("file:// 주소을(를) 복사했습니다"), "경로 형식 복사 안내");
    verify("경로 형식 복사 실행", true);
    // 압축해서 보내기: ZIP을 만들어 파일 클립보드에 올린다.
    await menuFor("메모", "메모.txt");
    pick("압축해서 보내기");
    await until(() => status().includes("메모.zip"), "압축해서 보내기 안내");
    await invoke("clipboard_control", { action: "capture", id: null, destination: null, query: null });
    const zipped = (await invoke("clipboard_control", { action: "list", id: null, destination: null, query: null })).items[0];
    const zipPaths = zipped?.kind === "files" ? (await invoke("clipboard_control", { action: "read", id: zipped.id, destination: null, query: null })).paths : [];
    verify("압축해서 보내기: 메모.zip이 파일 클립보드에 올라감", zipPaths.length === 1 && zipPaths[0].endsWith("메모.zip"));
    // 다른 앱으로 열기(검증 중에는 앱을 띄우지 않고 요청만 기록)
    await menuFor("메모", "메모.txt");
    pick(mac2 ? "다른 앱으로 열기" : "연결 프로그램 선택");
    if (mac2) {
      await until(() => document.querySelector(".quick-choice-detail")?.textContent.endsWith(".app"), "열 앱 목록");
      verify("다른 앱으로 열기: 이 파일을 열 수 있는 앱 목록(기본 앱 먼저)", [...document.querySelectorAll('[role="menuitem"]')][0].textContent.includes("기본 앱"));
      document.querySelector('[role="menuitem"]').click();
    }
    let opened;
    await until(async () => { opened = (await invoke("ed_request", { kind: "smokeOpens", payload: null })).find((item) => String(item.path).endsWith("메모.txt") && "app" in item); return !!opened; }, "다른 앱으로 열기 요청");
    verify("다른 앱으로 열기 요청 전달(macOS는 고른 앱, Windows는 연결 프로그램 창)", mac2 ? String(opened.app).endsWith(".app") : opened.app === null);
    await invoke("quick_control", { action: "show" });
    // 사용자 동작: 위험한 이름도 인자 하나로 넘어가고 셸 명령은 실행되지 않는다.
    const hostile = "주입 시험; touch hacked && echo $(id).txt";
    await menuFor("주입 시험", hostile);
    pick("검증 동작");
    const confirmBox = await until(() => document.querySelector('[aria-label="사용자 동작 실행 확인"]'), "처음 실행 확인");
    verify("사용자 동작은 처음 실행할 때 실제 명령을 보여 주고 확인을 받음", confirmBox.textContent.includes(`ran-${hostile}.flag`));
    [...confirmBox.querySelectorAll("button")].find((button) => button.textContent === "실행").click();
    await until(() => status().includes("검증 동작"), "사용자 동작 실행 안내");
    let listing = [];
    await until(async () => { listing = (await invoke("ed_request", { kind: "list", payload: { rootId: roots2[0].id, path: "" } })).map((item) => item.name); return listing.includes(`ran-${hostile}.flag`); }, "사용자 동작 결과 파일");
    verify("사용자 동작: 파일 이름의 ; && $( )가 셸 명령으로 실행되지 않고 인자 하나로 전달", !listing.includes("hacked"));
    // 두 번째부터는 확인 없이 실행한다.
    await menuFor("주입 시험", hostile);
    pick("검증 동작");
    await until(() => status().includes("검증 동작") && !document.querySelector('[aria-label="사용자 동작 실행 확인"]'), "두 번째 실행");
    verify("한 번 확인한 사용자 동작은 다시 묻지 않음", true);
    // 이름 바꾸기
    await menuFor("메모", "메모.txt");
    pick("이름 바꾸기");
    const renameInput = await until(() => document.querySelector('[aria-label="새 이름"]'), "이름 입력");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(renameInput, "메모 수정.txt");
    renameInput.dispatchEvent(new Event("input", { bubbles: true }));
    renameInput.form.requestSubmit();
    await until(() => status().includes("이름을 바꿨습니다"), "이름 바꾸기 안내");
    await until(async () => (await invoke("ed_request", { kind: "list", payload: { rootId: roots2[0].id, path: "문서" } })).some((item) => item.name === "메모 수정.txt"), "디스크 이름 변경");
    verify("빠른 검색에서 이름 바꾸기(디스크에 반영)", true);
    // 나란히 열기: 메인 창이 결과를 확인한다(quick-smoke-main.js).
    await menuFor("메모 수정", "메모 수정.txt");
    pick("탐색창 두 곳에 나란히 열기");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await invoke("quick_control", { action: "show" });
    await invoke("ed_request", {
      kind: "smokeReport",
      payload: {
        stage: "quick-complete",
        tests,
        width: innerWidth,
        height: innerHeight,
        text: document.body.innerText,
      },
    });
    await invoke("quick_control", {
      action: "reveal",
      location: { rootId: roots[0].id, path: "대상/업무 보고서.txt" },
    });
  } catch (error) {
    await invoke("ed_request", {
      kind: "smokeReport",
      payload: {
        stage: "quick-failed",
        tests,
        error: String(error),
        text: document.body.innerText,
      },
    });
  }
})();

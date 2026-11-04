(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const report = { suite: "clipboard", tests: [], errors: [], passed: false };
  async function until(check, label) {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      const v = await check();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`시간 초과: ${label}`);
  }
  const pane = (n) =>
    document.querySelector(`.explorer-pane[aria-label="탐색창 ${n}"]`);
  function clickRow(p, name, double = false) {
    const row = [...p.querySelectorAll(".file-row")].find((row) =>
      row.title.split(/[\\/]/).pop()===name,
    );
    if (!row) throw new Error(`파일 없음 ${name}`);
    row.click();
    row.focus();
    if (double)
      row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }
  function key(target, key, extra = {}) {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra }));
  }
  async function ready(p) {
    await until(() => !p.querySelector('[title="붙여넣기 · Ctrl/⌘ V"]')?.disabled, "파일 작업 준비");
    await new Promise(r => setTimeout(r, 80));
  }
  function verify(name, condition) {
    if (!condition) throw new Error(name);
    report.tests.push({ name, passed: true });
  }
  try {
    await until(() => pane(1)?.querySelector(".file-row"), "초기화");
    const root = (await invoke("ed_request", { kind: "init", payload: {} }))[0];
    const list = (path) =>
      invoke("ed_request", {
        kind: "list",
        payload: { rootId: root.id, path },
      });
    clickRow(pane(1), "업무 보고서.txt");
    await until(() => pane(1).querySelector(".file-row.selected"), "원본 선택");
    key(pane(1).querySelector(".file-row.selected"), "c");
    await until(
      () => document.querySelector(".toast")?.textContent.includes("복사"),
      "OS 파일 복사",
    );
    clickRow(pane(2), "대상", true);
    await until(
      () => pane(2).querySelector(".breadcrumbs")?.textContent.includes("대상"),
      "붙여넣을 위치",
    );
    await ready(pane(2));
    pane(2).querySelector('[role="tab"]').focus();
    key(pane(2).querySelector('[role="tab"]'), "v");
    await until(
      async () =>
        (await list("대상")).some((x) => x.name === "업무 보고서.txt"),
      "붙여넣기",
    );
    for (let n = 1; n <= 2; n++) {
      await ready(pane(2));
      key(pane(2).querySelector('[role="tab"]'), "v");
      await until(async () => (await list("대상")).some(x => x.name === `업무 보고서 (${n}).txt`), "번호 사본 붙여넣기");
      verify(`Ctrl+V 중복 사본 (${n}) 생성`, true);
    }
    verify(
      "Ctrl+C → Windows CF_HDROP → Ctrl+V 다른 탐색창 붙여넣기",
      (await list("")).some((x) => x.name === "업무 보고서.txt"),
    );
    clickRow(pane(2), "업무 보고서.txt");
    await until(
      () => pane(2).querySelector(".file-row.selected"),
      "이동 파일 선택",
    );
    await ready(pane(2));
    key(pane(2).querySelector(".file-row.selected"), "x");
    await until(
      () => document.querySelector(".toast")?.textContent.includes("잘라"),
      "OS 잘라내기",
    );
    clickRow(pane(1), "문서", true);
    await until(
      () => pane(1).querySelector(".breadcrumbs")?.textContent.includes("문서"),
      "이동 대상",
    );
    await ready(pane(1));
    pane(1).querySelector('[role="tab"]').focus();
    key(pane(1).querySelector('[role="tab"]'), "v");
    await until(
      async () =>
        (await list("문서")).some((x) => x.name === "업무 보고서.txt"),
      "이동 완료",
    );
    verify(
      "Windows 잘라내기 일치 확인과 실제 이동",
      !(await list("대상")).some((x) => x.name === "업무 보고서.txt"),
    );
    await until(() => [...pane(1).querySelectorAll(".file-row")].some(x => x.title.split(/[\\/]/).pop()==="업무 보고서.txt"), "이동 목록 반영");
    clickRow(pane(1), "업무 보고서.txt");
    await ready(pane(1));
    key(document.activeElement, "Enter", { ctrlKey: false, altKey: true });
    await until(() => document.querySelector("dialog[open]")?.textContent.includes("파일 속성"), "Alt+Enter 속성");
    verify("Alt+Enter는 파일을 열지 않고 속성 표시", true);
    document.querySelector('dialog[open] [aria-label="닫기"]').click();
    await until(() => !document.querySelector("dialog[open]"), "속성 닫기");
    clickRow(pane(1), "업무 보고서.txt");
    await ready(pane(1));
    // 목록을 다시 읽는 중에도 F2가 먹어야 한다. 예전에는 무시되어 이어 누른 Ctrl+V가 파일 붙여넣기로 갔다.
    const beforeRows = pane(1).querySelectorAll(".file-row").length;
    // Ctrl+R로 목록을 다시 읽게 하고, 파일 작업이 잠긴 순간에 F2를 누른다(빨리 끝나면 다시 시도).
    let pressedWhileLoading = false;
    const rowBeforeRefresh = document.activeElement;
    for (let attempt = 0; attempt < 8 && !pressedWhileLoading; attempt++) {
      key(rowBeforeRefresh, "r");
      const end = performance.now() + 500;
      while (performance.now() < end) {
        if (pane(1).querySelector('[title="붙여넣기 · Ctrl/⌘ V"]')?.disabled) {
          key(document.activeElement, "F2", { ctrlKey: false });
          pressedWhileLoading = true;
          break;
        }
        await new Promise(r => setTimeout(r, 0));
      }
      await ready(pane(1));
    }
    if (!pressedWhileLoading) throw new Error("목록 새로 고침 중 상태를 만들지 못함");
    const nameInput = await until(() => pane(1).querySelector(".rename-field input"), "새로 고침 중 F2 이름 변경");
    verify("F2는 대화상자 없이 목록 안에서 이름 입력(새로 고침 중에도)", !document.querySelector("dialog[open]") && document.activeElement === nameInput);
    verify("F2는 확장자 앞까지만 선택", nameInput.value.slice(nameInput.selectionStart, nameInput.selectionEnd) === "업무 보고서");
    key(nameInput, "v");
    await new Promise(r => setTimeout(r, 400));
    verify("이름 입력 중 Ctrl+V는 파일을 붙여넣지 않음", pane(1).querySelectorAll(".file-row").length === beforeRows && !(await list("문서")).some(x => x.name.startsWith("업무 보고서 (")) && !!pane(1).querySelector(".rename-field input"));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(nameInput, "취소될 이름.txt");
    nameInput.dispatchEvent(new Event("input", {bubbles:true}));
    key(nameInput, "Escape", { ctrlKey: false });
    await until(() => !pane(1).querySelector(".rename-field"), "Esc 이름 변경 취소");
    verify("Esc는 이름을 바꾸지 않고 행으로 초점 복귀", (await list("문서")).some(x => x.name === "업무 보고서.txt") && document.activeElement?.classList.contains("file-row"));
    key(document.activeElement, "F2", { ctrlKey: false });
    const renameInput = await until(() => pane(1).querySelector(".rename-field input"), "F2 이름 변경");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(renameInput, "단축키 변경.txt");
    renameInput.dispatchEvent(new Event("input", {bubbles:true}));
    await new Promise(r => setTimeout(r, 80));
    key(renameInput, "Enter", { ctrlKey: false });
    await until(async () => (await list("문서")).some(x => x.name === "단축키 변경.txt"), "이름 변경 실제 반영");
    await until(() => !pane(1).querySelector(".rename-field"), "이름 입력 닫기");
    verify("F2 이름 변경", true);
    await until(() => [...pane(1).querySelectorAll(".file-row")].some(x => x.title.split(/[\\/]/).pop()==="단축키 변경.txt"), "변경 목록");
    clickRow(pane(1), "단축키 변경.txt");
    await ready(pane(1));
    key(document.activeElement, "Delete", {ctrlKey:false});
    await until(() => document.querySelector("dialog[open]")?.textContent.includes("휴지통으로 이동"), "Delete 확인창");
    document.querySelector("dialog[open] .button.danger").click();
    await until(async () => !(await list("문서")).some(x => x.name === "단축키 변경.txt"), "삭제 실제 반영");
    verify("Delete는 확인 후 복원 가능한 앱 휴지통으로 이동", true);
    await until(() => !document.querySelector("dialog[open]"), "삭제 닫기");
    await ready(pane(1));
    pane(1).querySelector('[role="tab"]').focus();
    key(document.activeElement, "n", { shiftKey:true });
    const folderInput = await until(() => pane(1).querySelector(".rename-field input"), "Ctrl+Shift+N");
    verify("Ctrl+Shift+N은 '새 폴더'를 바로 만들고 이름 입력", !document.querySelector("dialog[open]") && folderInput.value.startsWith("새 폴더") && (await list("문서")).some(x => x.name === folderInput.value));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(folderInput, "단축키 새 폴더");
    folderInput.dispatchEvent(new Event("input", { bubbles:true }));
    await new Promise(r => setTimeout(r, 80));
    key(folderInput, "Enter", { ctrlKey: false });
    await until(async () => (await list("문서")).some(x => x.name === "단축키 새 폴더"), "새 폴더 실제 반영");
    verify("Ctrl+Shift+N 새 폴더", true);
    await until(()=>!pane(1).querySelector('.rename-field'),"새 폴더 이름 입력 닫기");
    const searchInput=document.querySelector('[aria-label="파일 검색"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(searchInput,"쏠리 | README");
    searchInput.dispatchEvent(new Event("input",{bubbles:true}));
    await until(()=>document.querySelectorAll('.search-table .file-row').length===2&&!document.querySelector('.result-summary .spin'),"검색 파일 두 개");
    const searchRows=[...document.querySelectorAll('.search-table .file-row')];
    searchRows[0].click();await new Promise(r=>setTimeout(r,80));searchRows[1].dispatchEvent(new MouseEvent('click',{bubbles:true,ctrlKey:true}));await new Promise(r=>setTimeout(r,80));
    await invoke("ed_request",{kind:"operation",payload:{action:"mkdir",destination:{rootId:root.id,path:""},name:"선택 유지 검증"}});
    await until(()=>!document.querySelector('.result-summary .spin')&&document.querySelector('.search-selection')?.textContent.includes("2개 선택"),"인덱스 갱신 후 선택 유지");
    await new Promise(r=>setTimeout(r,350));
    verify("인덱스 자동 갱신은 검색 다중 선택을 보존",document.querySelector('.search-selection')?.textContent.includes("2개 선택"));
    document.querySelectorAll('.search-table .file-row')[1].focus();key(document.activeElement,"Insert");
    await until(()=>document.querySelector('.toast')?.textContent.includes("2개 항목 복사"),"검색 Ctrl+Insert 다중 복사");
    verify("검색 Ctrl+Insert는 선택 그룹만 Windows 클립보드로 복사",true);
    // Shift+Insert 붙여넣기는 Insert 키가 있는 Windows 키보드용 보조 단축키라 Windows에서만 검사한다.
    if(!/Mac/.test(navigator.platform)){
    clickRow(pane(1),"문서",true);
    await until(()=>pane(1).querySelector('.breadcrumbs')?.textContent.includes("문서"),"검색 사본 붙여넣을 폴더");
    pane(1).querySelector('[role="tab"]').focus();await ready(pane(1));key(document.activeElement,"Insert",{ctrlKey:false,shiftKey:true});
    await until(async()=>{const entries=await list("문서");return entries.some(x=>x.name==="쏠리마인드.txt")&&entries.some(x=>x.name==="README.md");},"검색 그룹 Shift+Insert 붙여넣기");
    verify("검색 다중 복사 → 탐색창 Shift+Insert 실제 붙여넣기",true);
    }
    report.passed = true;
  } catch (e) {
    report.errors.push(String(e));
    report.screen = document.body.innerText.slice(-3000);
  }
  report.finished = new Date().toISOString();
  await invoke("ed_request", { kind: "smokeReport", payload: report });
})();

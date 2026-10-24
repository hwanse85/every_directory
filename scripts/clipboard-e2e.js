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
      row.title.endsWith(`\\${name}`),
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
    await until(() => [...pane(1).querySelectorAll(".file-row")].some(x => x.title.endsWith("\\업무 보고서.txt")), "이동 목록 반영");
    clickRow(pane(1), "업무 보고서.txt");
    await ready(pane(1));
    key(document.activeElement, "Enter", { ctrlKey: false, altKey: true });
    await until(() => document.querySelector("dialog[open]")?.textContent.includes("파일 속성"), "Alt+Enter 속성");
    verify("Alt+Enter는 파일을 열지 않고 속성 표시", true);
    document.querySelector('dialog[open] [aria-label="닫기"]').click();
    await until(() => !document.querySelector("dialog[open]"), "속성 닫기");
    clickRow(pane(1), "업무 보고서.txt");
    key(document.activeElement, "F2", { ctrlKey: false });
    const nameInput = await until(() => document.querySelector('[aria-label="작업 이름"]'), "F2 이름 변경");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(nameInput, "단축키 변경.txt");
    nameInput.dispatchEvent(new Event("input", {bubbles:true}));
    await new Promise(r => setTimeout(r, 80));
    document.querySelector("dialog[open] .button.primary").click();
    await until(async () => (await list("문서")).some(x => x.name === "단축키 변경.txt"), "이름 변경 실제 반영");
    await until(() => !document.querySelector("dialog[open]"), "이름 변경 닫기");
    verify("F2 이름 변경", true);
    await until(() => [...pane(1).querySelectorAll(".file-row")].some(x => x.title.endsWith("\\단축키 변경.txt")), "변경 목록");
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
    const folderInput = await until(() => document.querySelector('[aria-label="작업 이름"]'), "Ctrl+Shift+N");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(folderInput, "단축키 새 폴더");
    folderInput.dispatchEvent(new Event("input", { bubbles:true }));
    await new Promise(r => setTimeout(r, 80));
    document.querySelector("dialog[open] .button.primary").click();
    await until(async () => (await list("문서")).some(x => x.name === "단축키 새 폴더"), "새 폴더 실제 반영");
    verify("Ctrl+Shift+N 새 폴더", true);
    report.passed = true;
  } catch (e) {
    report.errors.push(String(e));
    report.screen = document.body.innerText.slice(-3000);
  }
  report.finished = new Date().toISOString();
  await invoke("ed_request", { kind: "smokeReport", payload: report });
})();

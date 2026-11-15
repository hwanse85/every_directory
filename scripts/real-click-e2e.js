// Windows 진단: 탐색창 명령 막대(정렬·보기·트리·도구)와 열 머리글을 운영체제 실제 마우스 클릭(SendInput)으로 누르고,
// 어느 요소가 포인터·클릭 이벤트를 받았는지와 메뉴가 열렸는지를 기록한다. 스크립트 click()은 가림·포인터 문제를 지나친다.
(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const report = { suite: "realclick", tests: [], errors: [], diagnostics: [], passed: false };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // 요소를 사람이 읽을 수 있게 줄여 쓴다.
  const describe = (element) => {
    if (!element || !element.tagName) return String(element);
    const label = element.getAttribute?.("aria-label") || element.getAttribute?.("title") || element.textContent?.trim().slice(0, 16) || "";
    return `${element.tagName.toLowerCase()}${element.className && typeof element.className === "string" ? "." + element.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}[${label}]`;
  };
  // 포인터·마우스·클릭 이벤트가 어디로 갔는지 모은다(가장 먼저 받는 캡처 단계).
  let events = [];
  for (const type of ["pointermove", "pointerdown", "mousedown", "pointerup", "mouseup", "click", "lostpointercapture", "pointercancel"])
    window.addEventListener(type, (event) => events.push(`${type}→${describe(event.target)}${event.isTrusted ? "" : "(합성)"}`), true);
  const pane = (n) => document.querySelectorAll(".explorer-pane")[n - 1];
  // 열린 메뉴를 모두 닫는다.
  async function closeAll() {
    for (let n = 0; n < 2; n++) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await wait(80);
    }
  }
  // 요소 가운데를 실제 마우스로 누르고, 누르기 전후 상태를 기록한다.
  async function realClick(element, name) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    events = [];
    const native = await invoke("ed_request", { kind: "smokeClick", payload: { x, y } });
    await wait(500);
    const moves = events.filter((item) => item.startsWith("pointermove")).length;
    events = events.filter((item) => !item.startsWith("pointermove"));
    const entry = { name, moves, focus: document.hasFocus(), rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)], hit: describe(hit), hitInside: element.contains(hit), native, events: events.slice(0, 14), active: describe(document.activeElement) };
    report.diagnostics.push(entry);
    return entry;
  }
  function record(name, passed, detail) {
    report.tests.push({ name, passed, ...(passed ? {} : { error: detail }) });
  }
  try {
    for (let n = 0; n < 150 && !pane(1)?.querySelector(".file-row"); n++) await wait(100);
    report.window = { innerWidth, innerHeight, devicePixelRatio, screenX, screenY };
    // 비교: 사이드바의 ‘인덱스 관리’를 실제 클릭하면 대화상자가 열리는지(입력이 창에 닿는지) 확인한다.
    const sidebar = [...document.querySelectorAll("button, a")].find((element) => element.textContent.trim().startsWith("인덱스 관리"));
    if (sidebar) {
      const control = await realClick(sidebar, "사이드바 인덱스 관리(비교)");
      control.after = { dialog: !!document.querySelector("dialog[open]") };
      record("실제 클릭: 사이드바 단추(비교용)", control.after.dialog, JSON.stringify(control));
      document.querySelector('dialog[open] [aria-label="닫기"]')?.click();
      await wait(200);
    }
    for (const number of [1, 2]) {
      const root = pane(number);
      for (const [kind, title] of [["sort", "정렬 기준과 분류"], ["view", "보기 방식·표시 항목"]]) {
        await closeAll();
        const trigger = [...root.querySelectorAll(".flyout-trigger")].find((button) => button.title === title);
        const entry = await realClick(trigger, `탐색창 ${number} ${kind}`);
        const panel = trigger.parentElement.querySelector(".flyout-panel");
        const box = panel.getBoundingClientRect();
        const center = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(40, box.height / 2));
        entry.after = { expanded: trigger.getAttribute("aria-expanded"), hidden: panel.hidden, panel: [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)], panelOnTop: panel.contains(center), style: panel.getAttribute("style") };
        record(`실제 클릭: 탐색창 ${number} ${kind === "sort" ? "정렬" : "보기"} 메뉴 열림`, trigger.getAttribute("aria-expanded") === "true" && !panel.hidden && panel.contains(center), JSON.stringify(entry));
        if (kind === "sort" && trigger.getAttribute("aria-expanded") === "true") {
          // 메뉴 안의 정렬 기준(크기)도 실제 클릭으로 고른다.
          const select = panel.querySelector("select");
          const option = [...select.options].find((item) => item.value === "size");
          const optionEntry = await realClick(option, `탐색창 ${number} 정렬 기준 크기`);
          optionEntry.after = { value: select.value, sort: root.querySelector('[role="columnheader"][data-column="size"]')?.getAttribute("aria-sort") };
          record(`실제 클릭: 탐색창 ${number} 정렬 기준 고르기`, select.value === "size", JSON.stringify(optionEntry));
        }
      }
      await closeAll();
      const tree = root.querySelector('[aria-label="폴더 트리 표시"]');
      const before = tree.getAttribute("aria-pressed");
      const treeEntry = await realClick(tree, `탐색창 ${number} 트리`);
      record(`실제 클릭: 탐색창 ${number} 트리 단추`, tree.getAttribute("aria-pressed") !== before, JSON.stringify(treeEntry));
      await closeAll();
      const more = root.querySelector('[aria-label="추가 파일 도구"]');
      const moreEntry = await realClick(more, `탐색창 ${number} 도구`);
      moreEntry.after = { disabled: more.disabled, menu: !!document.querySelector('.context-menu, [role="menu"]') };
      record(`실제 클릭: 탐색창 ${number} 도구 메뉴 열림`, moreEntry.after.menu, JSON.stringify(moreEntry));
      await closeAll();
      const header = root.querySelector('[role="columnheader"][data-column="name"] button');
      const sortBefore = header.parentElement.getAttribute("aria-sort");
      const headerEntry = await realClick(header, `탐색창 ${number} 이름 머리글`);
      record(`실제 클릭: 탐색창 ${number} 이름 머리글 정렬`, header.parentElement.getAttribute("aria-sort") !== sortBefore, JSON.stringify(headerEntry));
    }
  } catch (error) {
    report.errors.push(String(error?.stack || error));
  }
  report.passed = report.errors.length === 0 && report.tests.length > 0 && report.tests.every((test) => test.passed);
  report.finished = new Date().toISOString();
  await invoke("ed_request", { kind: "smokeReport", payload: report });
})();

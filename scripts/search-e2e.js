(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const report = { suite: "search", tests: [], errors: [], passed: false };
  const errors = [];
  window.addEventListener("error", (e) => errors.push(e.message));
  window.addEventListener("unhandledrejection", (e) =>
    errors.push(String(e.reason)),
  );
  async function until(check, name) {
    const end = Date.now() + 7000;
    while (Date.now() < end) {
      const v = await check();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`시간 초과: ${name}`);
  }
  function value(input, value) {
    const proto =
      input.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(
      new Event(input.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  }
  async function test(name, action) {
    try {
      await action();
      report.tests.push({ name, passed: true });
    } catch (e) {
      report.tests.push({ name, passed: false, error: String(e) });
    }
  }
  async function search(
    query,
    mode = "initials",
    expected = "업무 보고서.txt",
  ) {
    value(document.querySelector('[aria-label="검색 방식"]'), mode);
    const input = document.querySelector('[aria-label="파일 검색"]');
    value(input, "");
    await new Promise((r) => setTimeout(r, 90));
    value(input, query);
    await new Promise((r) => setTimeout(r, 150));
    return until(
      () =>
        !document.querySelector(".result-summary .spin") &&
        [...document.querySelectorAll(".search-table .file-row")].some((row) =>
          row.textContent.includes(expected),
        ),
      `${mode}: ${query} → ${expected}`,
    );
  }
  try {
    await until(
      () => document.querySelector(".explorer-pane .file-row"),
      "초기화",
    );
    for (const query of [
      "ㅇㅁ ㅂㄱㅅ",
      "ㅇㅁㅂㄱㅅ",
      "ㅂㄳ",
      "보고ㅅ",
      "ᄋᄆ ᄇᄀᄉ",
      "ﾷﾱ ﾲﾡﾵ",
    ]) {
      await test(`메인 초성 검색 ${query}`, () => search(query));
    }
    await test("된소리 초성 ㅆㄹㅁㅇㄷ", () =>
      search("ㅆㄹㅁㅇㄷ", "initials", "쏠리마인드.txt"));
    await test("탐색창 현재 폴더 필터의 초성 검색", async () => {
      const pane = document.querySelector(".explorer-pane.active");
      value(pane.querySelector(".folder-filter input"), "ㅇㅁㅂㄱㅅ");
      await until(
        () =>
          [...pane.querySelectorAll(".file-row")].some((row) =>
            row.textContent.includes("업무 보고서.txt"),
          ),
        "초성 필터",
      );
      value(pane.querySelector(".folder-filter input"), "");
    });
    await test("Windows IME 조합 범위·초점 보존 후 확정된 겹받침 분리", async () => {
      value(document.querySelector('[aria-label="검색 방식"]'), "initials");
      const input = document.querySelector('[aria-label="파일 검색"]');
      input.focus();
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      value(input, "ㅂㄳ");
      await new Promise((r) => setTimeout(r, 100));
      if(input.value !== "ㅂㄳ" || document.activeElement !== input) throw new Error("활성 IME 조합 또는 초점을 변경함");
      if(input.parentElement.querySelector('.ime-preview')?.textContent!=="ㅂㄱㅅ")throw new Error("입력 도중 개별 초성 표시가 없음");
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "ㅂㄳ" }),
      );
      // Windows 10 IMEs may send the final input after compositionend.
      value(input,"ㅂㄳ");
      await until(
        () =>
          input.value === "ㅂㄱㅅ" &&
          [...document.querySelectorAll(".search-table .file-row")].some(
            (row) => row.textContent.includes("업무 보고서.txt"),
          ),
        "IME 확정",
      );
      value(input, "ㅂㄱㅅㅇ");
      await until(() => input.value === "ㅂㄱㅅㅇ", "분리 후 다음 초성 입력");
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      value(input, "보고ㅅ");
      await new Promise((r) => setTimeout(r, 80));
      if (input.value !== "보고ㅅ") throw new Error("일반 한글 음절 조합이 변경됨");
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    for (const selector of ['[aria-label="파일 검색"]','.explorer-pane.active .folder-filter input']) {
      await test(`IME 마지막 input 순서·연속 조합·커서 편집 ${selector}`, async () => {
        const input=document.querySelector(selector);
        input.focus();
        let blurred=0;const blur=()=>blurred++;input.addEventListener("blur",blur);
        try {
          for(const late of [true,false]){
            value(input,"");
            input.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));
            value(input,"ㅂㄱ");value(input,"ㅂㄳ");
            if(!late)value(input,"ㅂㄳ");
            input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"ㄳ"}));
            if(late)value(input,"ㅂㄳ");
            await until(()=>input.value==="ㅂㄱㅅ","중복 없는 확정");
            if(blurred||document.activeElement!==input)throw new Error("초점을 강제로 변경함");
          }
          input.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));
          value(input,"ㅆㄹㅁㅇㄷ");
          input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"ㄷ"}));
          input.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));
          value(input,"ㅆㄹㅁㅇㄷㅂㄳ");
          input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"ㄳ"}));
          await until(()=>input.value==="ㅆㄹㅁㅇㄷㅂㄱㅅ","연속 입력");
          value(input,"앞 ㅂㄳ 뒤");
          await until(()=>input.value==="앞 ㅂㄱㅅ 뒤","붙여넣기");
          input.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));
          value(input,"앞 ㄳ 뒤");input.setSelectionRange(3,3);
          input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"ㄳ"}));
          await until(()=>input.value==="앞 ㄱㅅ 뒤"&&input.selectionStart===4,"가운데 조합 후 커서 복원");
          value(input,"ㄱㄱ ㅆㅆ");
          if(input.value!=="ㄱㄱ ㅆㅆ")throw new Error("의도적으로 반복한 자음을 제거함");
          input.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));value(input,"보고서 값");
          input.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"값"}));
          await until(()=>input.value==="보고서 값","일반 한글 음절 보존");
        }finally{input.removeEventListener("blur",blur);value(input,"");}
      });
    }
    for (const [query, mode, expected] of [
      ["README", "normal", "README.md"],
      ["*.md", "wildcard", "README.md"],
      ["^README\\.md$", "regex", "README.md"],
      ["raedme", "fuzzy", "README.md"],
    ]) {
      await test(`${mode} 검색`, () => search(query, mode, expected));
    }
    // 검색 엔진에 직접 물어 결과가 정확히 맞는지(빠져야 할 항목이 없는지) 확인한다.
    const root = (await invoke("ed_request", { kind: "init", payload: {} }))[0];
    const engine = async (query, mode, caseSensitive = false) => (await invoke("ed_request", { kind: "search", payload: { query, mode, caseSensitive, rootId: root.id, category: "all", fullPath: false } })).entries.map((entry) => entry.name);
    const cases = [
      // [이름, 검색어, 방식, 들어가야 할 이름, 빠져야 할 이름, 대소문자]
      ["일반: 공백은 AND", "업무 보고서", "normal", ["업무 보고서.txt"], ["업무 계획.txt"]],
      ["일반: | 는 OR", "보고서 | 계획서", "normal", ["업무 보고서.txt", "프로젝트 계획서.hwp"], ["업무 계획.txt"]],
      ["일반: ! 는 제외", "업무 !보고서", "normal", ["업무 계획.txt"], ["업무 보고서.txt"]],
      ["일반: ext: 확장자", "ext:jpg", "normal", ["IMG_0042.jpg", "IMG_12.jpg"], ["README.md"]],
      ["일반: 따옴표 구문", "\"업무 계획\"", "normal", ["업무 계획.txt"], ["업무 보고서.txt"]],
      ["와일드카드: * 여러 글자", "*보고서*", "wildcard", ["업무 보고서.txt"], ["업무 계획.txt"]],
      ["와일드카드: ? 는 정확히 한 글자", "IMG_????.jpg", "wildcard", ["IMG_0042.jpg"], ["IMG_12.jpg"]],
      ["와일드카드: 전체 이름과 비교", "보고서", "wildcard", [], ["업무 보고서.txt"]],
      ["와일드카드: 대소문자 무시", "*.pdf", "wildcard", ["Invoice_2025.PDF"], []],
      ["와일드카드: 대소문자 구분", "*.pdf", "wildcard", [], ["Invoice_2025.PDF"], true],
      ["정규식: 시작·끝 고정", "^IMG_\\d{4}\\.jpg$", "regex", ["IMG_0042.jpg"], ["IMG_12.jpg"]],
      ["정규식: 묶음과 OR", "(보고서|계획서)\\.", "regex", ["업무 보고서.txt", "프로젝트 계획서.hwp"], ["업무 계획.txt"]],
      ["정규식: 날짜 형식", "\\d{4}-\\d{2}", "regex", ["회의록_2026-03.docx"], ["Invoice_2025.PDF"]],
      ["정규식: 대소문자 무시", "invoice", "regex", ["Invoice_2025.PDF"], []],
      ["정규식: 대소문자 구분", "invoice", "regex", [], ["Invoice_2025.PDF"], true],
      ["퍼지: 3~5글자는 오타 1자 허용", "redme", "fuzzy", ["README.md"], []],
      ["퍼지: 6글자 이상 오타 2자", "configuratoin", "fuzzy", ["configuration.json"], []],
      ["퍼지: 3~5글자는 오타 2자 불허", "rdme", "fuzzy", [], ["README.md"]],
      ["퍼지: 한글 오타", "회의룩", "fuzzy", ["회의록_2026-03.docx"], []],
      ["퍼지: 2글자 이하는 정확히 포함할 때만", "계휙", "fuzzy", [], ["업무 계획.txt"]],
    ];
    for (const [label, query, mode, include, exclude, sensitive] of cases) {
      await test(`검색 방식 ${label}`, async () => {
        const names = await engine(query, mode, !!sensitive);
        const missing = include.filter((name) => !names.includes(name));
        const extra = exclude.filter((name) => names.includes(name));
        if (missing.length || extra.length) throw new Error(`${query}(${mode}) 누락 ${missing.join(",")} · 잘못 포함 ${extra.join(",")} · 결과 ${names.join(",")}`);
      });
    }
    await test("정규식 전후방 탐색은 지원하지 않음을 안내", async () => {
      let message = "";
      try { await engine("보고(?=서)", "regex"); } catch (cause) { message = String(cause); }
      if (!message.includes("전후방 탐색")) throw new Error(`안내 없음: ${message}`);
    });
    await test("검색 방식 도움말 툴팁은 현재 방식의 사용법을 표시", async () => {
      for (const [mode, text] of [["regex", "^"], ["wildcard", "?"], ["fuzzy", "오타"], ["normal", "|"], ["initials", "ㅂㄱㅅ"]]) {
        value(document.querySelector('[aria-label="검색 방식"]'), mode);
        await until(() => document.querySelector(".search-mode-help [role=tooltip]")?.textContent.includes(text), `${mode} 툴팁`);
      }
      if (!document.querySelector('[aria-label="검색 방식"]').title) throw new Error("검색 방식 선택에 title 없음");
      document.querySelector(".search-mode-help button").click();
      await until(() => document.querySelector('dialog[open] .help-document #help-search-modes'), "도움말 검색 방식 절로 이동");
      document.querySelector('dialog[open] [aria-label="닫기"]').click();
      await until(() => !document.querySelector("dialog[open]"), "도움말 닫기");
    });
    await test("화면에서도 정규식·와일드카드·퍼지 결과 표시", async () => {
      await search("^IMG_\\d{4}\\.jpg$", "regex", "IMG_0042.jpg");
      await search("IMG_????.jpg", "wildcard", "IMG_0042.jpg");
      await search("configuratoin", "fuzzy", "configuration.json");
    });
    await test("잘못된 정규식 오류 후 복구", async () => {
      value(document.querySelector('[aria-label="검색 방식"]'), "regex");
      value(document.querySelector('[aria-label="파일 검색"]'), "[");
      await until(() => document.querySelector(".search-error"), "정규식 오류");
      await search("README", "normal", "README.md");
    });
  } catch (e) {
    report.errors.push(String(e));
  }
  report.errors.push(...errors);
  report.passed =
    report.errors.length === 0 && report.tests.every((test) => test.passed);
  report.finished = new Date().toISOString();
  await invoke("ed_request", { kind: "smokeReport", payload: report });
})();

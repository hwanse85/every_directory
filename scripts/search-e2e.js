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
    await test("Windows IME 겹받침을 입력 도중 분리하고 계속 입력", async () => {
      value(document.querySelector('[aria-label="검색 방식"]'), "initials");
      const input = document.querySelector('[aria-label="파일 검색"]');
      input.focus();
      input.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      value(input, "ㅂㄳ");
      await new Promise((r) => setTimeout(r, 100));
      const separated = input.value === "ㅂㄱㅅ";
      input.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data: "ㅂㄳ" }),
      );
      if (!separated) throw new Error("입력 도중 겹받침이 분리되지 않음");
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
    for (const [query, mode, expected] of [
      ["README", "normal", "README.md"],
      ["*.md", "wildcard", "README.md"],
      ["^README\\.md$", "regex", "README.md"],
      ["raedme", "fuzzy", "README.md"],
    ]) {
      await test(`${mode} 검색`, () => search(query, mode, expected));
    }
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

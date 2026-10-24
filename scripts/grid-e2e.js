(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const report = { suite: "grid", tests: [], errors: [], passed: false };
  async function until(check, label) {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(label);
  }
  function verify(name, v) {
    if (!v) throw new Error(name);
    report.tests.push({ name, passed: true });
  }
  try {
    await until(
      () => document.querySelector(".explorer-pane.active .file-row"),
      "초기 목록",
    );
    const pane = document.querySelector(".explorer-pane.active");
    const root = (await invoke("ed_request", { kind: "init", payload: {} }))[0];
    const total = (
      await invoke("ed_request", {
        kind: "list",
        payload: { rootId: root.id, path: "" },
      })
    ).length;
    pane.querySelector('[aria-label="격자 보기"]').click();
    await until(
      () => pane.querySelectorAll(".file-grid .file-row").length === 300,
      "초기 격자",
    );
    pane.querySelector('[aria-label="격자 파일 더 보기"]').click();
    await until(
      () => pane.querySelectorAll(".file-grid .file-row").length === total,
      "300개 이후 격자",
    );
    verify(
      "격자에서 300개를 넘는 파일까지 추가 표시",
      !![...pane.querySelectorAll(".file-row")].find((x) =>
        x.title.endsWith("zzgrid_0309.txt"),
      ),
    );
    const rows = pane.querySelectorAll(".file-row");
    rows[3].click();
    await until(() => pane.querySelectorAll(".file-row.selected").length === 1, "첫 선택 반영");
    rows[4].dispatchEvent(
      new MouseEvent("click", { ctrlKey: true, bubbles: true }),
    );
    await until(
      () => pane.querySelectorAll(".file-row.selected").length === 2,
      "Ctrl 다중 선택",
    );
    verify(
      "격자 Ctrl 다중 선택과 선택 개수",
      pane.querySelector(".selection-count").textContent.includes("2개"),
    );
    pane.querySelector('[aria-label="목록 보기"]').click();
    await until(() => !pane.querySelector(".file-grid") && pane.querySelector(".selection-count")?.textContent.includes("2개"), "목록 복원과 선택 상태 반영");
    verify(
      "목록 전환 후 선택 유지",
      pane.querySelector(".selection-count").textContent.includes("2개"),
    );
    report.passed = true;
  } catch (e) {
    report.errors.push(String(e));
  }
  report.finished = new Date().toISOString();
  await invoke("ed_request", { kind: "smokeReport", payload: report });
})();

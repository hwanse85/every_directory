// 실제 Windows WebView2에서 경로·탭·탐색 단축키를 확인한다. OS 클립보드는 사용하지 않는다.
(async () => {
  if (window.__edWindowsUIRunning) return;
  window.__edWindowsUIRunning = true;
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const report = { tests: [], errors: [], passed: false };
  window.addEventListener("error", (event) =>
    report.errors.push(event.message),
  );
  window.addEventListener("unhandledrejection", (event) =>
    report.errors.push(String(event.reason)),
  );
  async function until(check, label) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const result = await check();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`시간 초과: ${label}`);
  }
  function verify(name, condition) {
    if (!condition) throw new Error(`검증 실패: ${name}`);
    report.tests.push(name);
  }
  function setValue(input, value) {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(
      new Event(input.type === "color" ? "change" : "input", { bubbles: true }),
    );
  }
  function key(key, extra = {}) {
    (document.activeElement || document.body).dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    );
  }
  try {
    const pane = await until(
      () =>
        document
          .querySelector(".explorer-pane.active .file-row")
          ?.closest(".explorer-pane"),
      "초기 목록",
    );
    const root = (await invoke("ed_request", { kind: "init", payload: {} }))[0];
    pane.querySelector('[role="tab"]').focus();
    await until(() => pane.querySelector(".hidden-status"), "숨김 파일 감추기");
    verify(
      "숨김 파일 필터가 목록에 반영",
      ![...pane.querySelectorAll(".file-row")].some((row) =>
        row.title.endsWith("\\.hidden.txt"),
      ),
    );
    key(".", { ctrlKey: true, shiftKey: true, code: "Period" });
    await until(
      () => !pane.querySelector(".hidden-status"),
      "숨김 파일 표시 복원",
    );
    const initial = pane.querySelector(".explorer-tab.current");
    verify(
      "첫 탭은 사용자 지정 색상과 색상 띠가 없음",
      !initial.style.borderTopColor &&
        getComputedStyle(initial).borderTopColor === "rgba(0, 0, 0, 0)" &&
        initial.querySelector(".tab-color-control.no-color"),
    );
    verify(
      "Windows 경로 tooltip에 확장 접두사·혼합 구분자가 없음",
      [...pane.querySelectorAll(".file-row")].every(
        (row) =>
          row.title.startsWith(root.absolutePath) &&
          !row.title.includes("/") &&
          !row.title.includes("\\\\?\\"),
      ),
    );
    pane.querySelector('[role="tab"]').focus();
    key("l", { ctrlKey: true });
    let address = await until(
      () => pane.querySelector('[aria-label="폴더 경로"]'),
      "Ctrl+L",
    );
    verify(
      "주소 입력은 실제 절대 경로를 전체 선택",
      address.value === root.absolutePath &&
        address.selectionEnd === address.value.length &&
        address.selectionStart === 0,
    );
    setValue(address, `${root.absolutePath}\\reports\\하위`);
    address.form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await until(
      () =>
        !pane.querySelector(".address-form") &&
        pane.querySelector(".breadcrumbs").textContent.includes("하위"),
      "대소문자 다른 경로 이동",
    );
    pane.querySelector('[role="tab"]').focus();
    key("ArrowUp", { altKey: true });
    await until(
      () => !pane.querySelector(".breadcrumbs").textContent.includes("하위"),
      "Alt+상위",
    );
    key("ArrowLeft", { altKey: true });
    await until(
      () => pane.querySelector(".breadcrumbs").textContent.includes("하위"),
      "Alt+뒤로",
    );
    key("ArrowRight", { altKey: true });
    await until(
      () => !pane.querySelector(".breadcrumbs").textContent.includes("하위"),
      "Alt+앞으로",
    );
    verify("Windows 주소 대소문자·상위·뒤로·앞으로 이동", true);
    const row = await until(
      () =>
        [...pane.querySelectorAll(".file-row")].find((row) =>
          row.title.endsWith("\\원본.txt"),
        ),
      "새로고침 대상 선택",
    );
    row.click();
    row.focus();
    key("F5");
    await new Promise((resolve) => setTimeout(resolve, 150));
    verify(
      "Windows F5는 다른 창 복사 대화상자를 열지 않고 새로고침",
      !document.querySelector("dialog[open]") &&
        pane.querySelector(".selection-count"),
    );
    const picker = pane.querySelector(".tab-color-picker");
    setValue(picker, "#e06030");
    await until(
      () =>
        pane.querySelector(".explorer-tab.current").style.borderTopColor ===
        "rgb(224, 96, 48)",
      "색상 설정",
    );
    pane.querySelector('[role="tab"]').focus();
    key("t", { ctrlKey: true });
    await until(
      () => pane.querySelectorAll(".explorer-tab").length === 2,
      "새 탭",
    );
    verify(
      "새 탭은 기존 탭의 색상을 상속하지 않음",
      !pane.querySelector(".explorer-tab.current").style.borderTopColor,
    );
    key("w", { ctrlKey: true });
    await until(
      () => pane.querySelectorAll(".explorer-tab").length === 1,
      "탭 닫기",
    );
    pane.querySelector('[aria-label$="탭 색상 해제"]').click();
    await until(
      () => !pane.querySelector(".explorer-tab.current").style.borderTopColor,
      "색상 해제",
    );
    verify("색상 지정·새 탭·닫기·색상 해제", true);
    pane.querySelector('[role="tab"]').focus();
    key("d", { altKey: true });
    address = await until(
      () => pane.querySelector(".address-form input"),
      "Alt+D",
    );
    setValue(address, "Reports-other");
    address.form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await until(
      () => document.querySelector(".toast.error"),
      "잘못된 경로 안내",
    );
    verify(
      "잘못된 주소는 현재 위치를 유지하고 오류 표시",
      pane.querySelector(".breadcrumbs") === null &&
        address.value === "Reports-other",
    );
    key("Escape");
    await until(() => !pane.querySelector(".address-form"), "주소 입력 닫기");
    pane.querySelector('[role="tab"]').focus();
    key("F4");
    await until(() => pane.querySelector(".address-form input"), "F4 주소 입력");
    key("Escape");
    await until(() => !pane.querySelector(".address-form"), "주소 복귀");
    pane.querySelector('[role="tab"]').focus();
    key("f", {ctrlKey:true});
    await until(() => document.activeElement === pane.querySelector(".folder-filter input"), "Ctrl+F 필터 초점");
    setValue(document.activeElement, "ㅇㅂ");
    await until(() => pane.querySelectorAll(".file-row").length === 1, "필터 적용");
    key("Escape");
    await until(() => pane.querySelectorAll(".file-row").length > 1, "Esc 필터 해제");
    verify("F4 주소 입력 · Ctrl+F 초성 필터 · Esc 해제", true);
    key("F6");
    await until(() => document.activeElement?.closest(".explorer-pane")?.getAttribute("aria-label") === "탐색창 2", "F6 초점 전환");
    key("F6", {shiftKey:true});
    await until(() => document.activeElement?.closest(".explorer-pane") === pane, "Shift+F6 역순 초점");
    verify("F6와 Shift+F6는 활성 창과 키보드 초점을 함께 전환", true);
    key("t", {ctrlKey:true});
    await until(() => pane.querySelectorAll(".explorer-tab").length === 2, "탭 순환 준비");
    key("Tab", {ctrlKey:true});
    await until(() => pane.querySelectorAll(".explorer-tab")[0].classList.contains("current"), "Ctrl+Tab");
    key("Tab", {ctrlKey:true,shiftKey:true});
    await until(() => pane.querySelectorAll(".explorer-tab")[1].classList.contains("current"), "Ctrl+Shift+Tab");
    key("w", {ctrlKey:true});
    await until(() => pane.querySelectorAll(".explorer-tab").length === 1, "순환 탭 닫기");
    verify("Ctrl+Tab와 Ctrl+Shift+Tab 탭 순환", true);
    const file = await until(() => [...pane.querySelectorAll(".file-row")].find(x=>x.title.endsWith("\\원본.txt")), "키보드 선택 준비");
    file.click(); file.focus();
    await until(() => pane.querySelector(".file-row.selected"), "기준 선택");
    key("Home",{shiftKey:true});
    await until(() => pane.querySelectorAll(".file-row.selected").length > 1, "Shift+Home 범위 선택");
    key("End");
    await until(() => pane.querySelectorAll(".file-row.selected").length === 1, "End 단일 선택");
    key("a", {ctrlKey:true});
    await until(() => pane.querySelectorAll(".file-row.selected").length === pane.querySelectorAll(".file-row").length, "Ctrl+A 전체 선택");
    verify("Home·End·Shift 범위 선택·Ctrl+A 전체 선택", true);
    verify("실행 중 JavaScript 오류 없음", report.errors.length === 0);
    report.passed = true;
  } catch (error) {
    report.errors.push(String(error));
  } finally {
    report.finished = new Date().toISOString();
    await invoke("ed_request", { kind: "smokeReport", payload: report });
  }
})();

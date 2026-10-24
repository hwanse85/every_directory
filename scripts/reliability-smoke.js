// 격리된 실제 WebView에서 사용자 오류와 설정 변경을 재현한다.
(async () => {
  if (window.__edReliabilityRunning) return;
  window.__edReliabilityRunning = true;
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const report = {
    started: new Date().toISOString(),
    tests: [],
    errors: [],
    timings: {},
  };
  window.addEventListener("error", (event) =>
    report.errors.push(event.message),
  );
  window.addEventListener("unhandledrejection", (event) =>
    report.errors.push(String(event.reason)),
  );
  // 관찰 가능한 화면 상태가 준비될 때까지 제한된 시간만 기다린다.
  async function until(check, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = await check();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    throw new Error(`시간 초과: ${label}`);
  }
  // 조건을 확인한 항목만 통과로 기록한다.
  function verify(name, condition) {
    if (!condition) throw new Error(`검증 실패: ${name}`);
    report.tests.push({ name, passed: true });
  }
  // React 입력과 같은 이벤트로 검색·색상·설정 값을 변경한다.
  function setValue(element, value) {
    const prototype =
      element.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(
      element,
      value,
    );
    element.dispatchEvent(
      new Event(
        element.tagName === "SELECT" || element.type === "color"
          ? "change"
          : "input",
        { bubbles: true },
      ),
    );
  }
  // 활성 탐색창의 일반 파일 작업 단축키를 실행한다.
  function shortcut(key) {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true }),
    );
  }
  // 현재 대화상자를 닫고 다음 동작이 가능한 상태를 기다린다.
  async function closeDialog() {
    document.querySelector('dialog[open] [aria-label="닫기"]').click();
    await until(() => !document.querySelector("dialog[open]"), "대화상자 닫기");
  }
  try {
    const initialRoots = await invoke("ed_request", {
      kind: "init",
      payload: {},
    });
    if (!initialRoots.length) {
      await until(
        () => document.querySelector(".onboarding-note"),
        "첫 실행 인덱스 관리 안내",
      );
      verify(
        "연결 폴더가 없으면 인덱스 관리와 안내를 자동 표시",
        document.querySelector("dialog[open] h2").textContent === "인덱스 관리",
      );
      await invoke("ed_request", {
        kind: "smokeReport",
        payload: { ...report, stage: "choose-native-fixture" },
      });
      const connect = [
        ...document.querySelectorAll("dialog[open] button"),
      ].find((button) => button.textContent.includes("폴더 연결"));
      connect.click();
    }
    await until(
      () =>
        document.querySelectorAll(".explorer-pane .file-row").length > 10 &&
        !document.querySelector(".index-banner"),
      "실제 폴더 연결과 인덱싱",
      120000,
    );
    const roots = await invoke("ed_request", { kind: "init", payload: {} });
    const root = roots[0];
    verify(
      "연결한 실제 파일이 두 탐색창에 표시",
      document.querySelectorAll(".explorer-pane").length === 2,
    );
    verify(
      "기본 검색은 초성과 일반 검색 통합",
      document.querySelector('[aria-label="검색 방식"]').value === "initials",
    );
    const input = document.querySelector('[aria-label="파일 검색"]');
    input.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    setValue(input, "ㅂㄳ");
    input.dispatchEvent(
      new CompositionEvent("compositionend", { data: "ㅂㄳ", bubbles: true }),
    );
    await until(
      () =>
        input.value === "ㅂㄱㅅ" &&
        document.querySelector(".search-table .file-row"),
      "초성 겹받침 정규화와 검색",
    );
    verify("IME의 ㅂㄳ을 ㅂㄱㅅ으로 분리 표시", input.value === "ㅂㄱㅅ");
    const query = await invoke("ed_request", {
      kind: "search",
      payload: { query: "보고서", rootId: root.id },
    });
    const initial = await invoke("ed_request", {
      kind: "search",
      payload: { query: "ㅂㄳ", rootId: root.id },
    });
    verify(
      "일반 검색과 초성 검색 모두 실제 파일을 반환",
      query.total > 200 && initial.total === query.total,
    );
    setValue(input, "");
    const pane = document.querySelector(
      '.explorer-pane[aria-label="탐색창 1"]',
    );
    const first = await until(
      () =>
        [...pane.querySelectorAll(".file-row")].find((row) =>
          row.title.endsWith("/업무 보고서 0000.txt"),
        ),
      "원본 파일 선택",
    );
    first.click();
    await until(() => pane.querySelector(".selection-count"), "선택 상태");
    const scroll = pane.querySelector(".file-scroll");
    scroll.scrollTop = 1800;
    scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const before = scroll.scrollTop;
    await invoke("ed_request", {
      kind: "operation",
      payload: {
        action: "mkfile",
        name: "새 갱신 파일.txt",
        destination: { rootId: root.id, path: "" },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 1600));
    verify(
      "인덱스 갱신과 선택 유지 중 목록 스크롤 보존",
      before > 1000 && Math.abs(scroll.scrollTop - before) < 2,
    );
    pane.querySelector('[title="복사 · Ctrl/⌘ C"]').click();
    await until(
      () => document.querySelector(".toast")?.textContent.includes("복사"),
      "실제 파일 클립보드 복사",
    );
    const destinationPane = document.querySelector(
      '.explorer-pane[aria-label="탐색창 2"]',
    );
    const destinationRow = [
      ...destinationPane.querySelectorAll(".file-row"),
    ].find((row) => row.title.endsWith("/대상"));
    destinationRow.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    destinationRow.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await until(
      () =>
        destinationPane
          .querySelector(".breadcrumbs")
          ?.textContent.includes("대상") &&
        !destinationPane.querySelector(
          '.file-action-bar [title="붙여넣기 · Ctrl/⌘ V"]',
        ).disabled,
      "붙여넣을 탐색창 이동",
    );
    destinationPane
      .querySelector('.file-action-bar [title="붙여넣기 · Ctrl/⌘ V"]')
      .click();
    await until(
      () =>
        [...destinationPane.querySelectorAll(".file-row")].some((row) =>
          row.title.endsWith("/대상/업무 보고서 0000.txt"),
        ),
      "화면 붙여넣기 완료",
    );
    const pasted = await invoke("ed_request", {
      kind: "list",
      payload: { rootId: root.id, path: "대상" },
    });
    verify(
      "화면 복사 → OS 파일 클립보드 → 실제 폴더 붙여넣기",
      pasted.some((entry) => entry.name === "업무 보고서 0000.txt"),
    );
    await invoke("copy_files", {
      locations: [{ rootId: root.id, path: "대상/업무 보고서 0000.txt" }],
      cut: true,
    });
    await invoke("paste_files", {
      destination: { rootId: root.id, path: "이동" },
      clipboard: {
        entries: [{ rootId: root.id, path: "대상/업무 보고서 0000.txt" }],
        cut: true,
      },
    });
    const moved = await invoke("ed_request", {
      kind: "list",
      payload: { rootId: root.id, path: "이동" },
    });
    const afterMove = await invoke("ed_request", {
      kind: "list",
      payload: { rootId: root.id, path: "대상" },
    });
    verify(
      "OS 클립보드와 일치하는 앱 잘라내기 이동",
      moved.length === 1 && afterMove.length === 0,
    );
    const started = performance.now();
    const properties = await invoke("ed_request", {
      kind: "operation",
      payload: {
        action: "properties",
        entries: [{ rootId: root.id, path: "" }],
      },
    });
    report.timings.folderPropertiesMs = performance.now() - started;
    verify(
      "폴더 속성을 전체 디스크 재탐색 없이 조회",
      properties.cached &&
        properties.files > 200 &&
        report.timings.folderPropertiesMs < 1000,
    );
    const color = pane.querySelector(".tab-color-picker");
    setValue(color, "#e06030");
    await until(
      () =>
        color.value === "#e06030" &&
        color.closest(".explorer-tab").style.borderTopColor ===
          "rgb(224, 96, 48)",
      "탭 색상 반영",
    );
    const savedPanes = JSON.parse(sessionStorage.getItem("ed:panes"));
    verify(
      "탭별 사용자 색상과 작업 공간 저장",
      savedPanes.some((pane) =>
        pane.tabs.some((tab) => tab.color === "#e06030"),
      ),
    );
    document.querySelector('[aria-label="설정"]').click();
    await until(
      () => document.querySelector('[aria-label="기본 검색 방식"]'),
      "프로그램 설정",
    );
    verify(
      "자동 시작 기본 체크와 트레이·단축키 설정",
      document.querySelector('[aria-label="컴퓨터 로그인 시 자동 시작"]')
        .checked &&
        document.querySelector('[aria-label="프로그램을 트레이에서 시작"]') &&
        document.querySelector('[aria-label="전역 검색 단축키"]'),
    );
    verify(
      "개발자 정보와 오픈소스 라이선스 표시",
      document
        .querySelector(".about-panel")
        ?.textContent.includes("오픈소스 구성요소"),
    );
    setValue(document.querySelector('[aria-label="기본 검색 방식"]'), "normal");
    await until(
      async () =>
        (await invoke("desktop_control", { action: "status" }))
          .defaultSearchMode === "normal",
      "기본 검색 방식 저장",
    );
    setValue(
      document.querySelector('[aria-label="기본 검색 방식"]'),
      "initials",
    );
    await until(
      async () =>
        (await invoke("desktop_control", { action: "status" }))
          .defaultSearchMode === "initials",
      "통합 검색 기본값 복원",
    );
    verify("기본 검색 방식의 네이티브 설정 저장", true);
    await closeDialog();
    verify("실행 중 JavaScript 오류 없음", report.errors.length === 0);
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.errors.push(String(error));
  } finally {
    report.finished = new Date().toISOString();
    await invoke("ed_request", { kind: "smokeReport", payload: report });
  }
})();

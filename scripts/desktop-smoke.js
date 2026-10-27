// 선택 기능으로 빌드한 실제 WebView에서 파일 연결과 화면 동작을 검증한다.
(async () => {
  if (window.__edSmokeRunning) return;
  window.__edSmokeRunning = true;
  const report = { started: new Date().toISOString(), tests: [], errors: [] };
  if (window.__edE2E)
    report.manual = [
      "기본 앱 실제 실행 및 외부 브라우저 링크 열기",
      "네이티브 저장·폴더 선택 대화상자의 물리 입력",
    ];
  await window.__TAURI_INTERNALS__.invoke("ed_request", {
    kind: "smokeReport",
    payload: { stage: "started", ...report },
  });
  // 비동기 화면 오류를 검증 기록에 남긴다.
  window.addEventListener("error", (event) =>
    report.errors.push(event.message),
  );
  window.addEventListener("unhandledrejection", (event) =>
    report.errors.push(String(event.reason)),
  );
  // 화면 상태가 준비될 때까지 짧은 간격으로 확인한다.
  async function until(check, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = check();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`시간 초과: ${label}`);
  }
  // 관찰한 조건이 맞을 때만 통과로 기록한다.
  function verify(name, condition) {
    if (!condition) throw new Error(`검증 실패: ${name}`);
    report.tests.push({ name, passed: true });
  }
  // React 입력 요소를 실제 입력 이벤트로 변경한다.
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
      new Event(element.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  }
  // 검색 결과가 하나로 좁혀진 후 선택해 탐색창에 반영한다.
  async function selectFile(query, filename) {
    setValue(document.querySelector('[aria-label="파일 검색"]'), query);
    // 입력 직후 남아 있는 이전 검색 결과를 선택하지 않도록 기다린다.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const row = await until(
      () =>
        !document.querySelector(".result-summary .spin") &&
        [...document.querySelectorAll(".search-table .file-row")].find((item) =>
          item.title.replaceAll("\\", "/").endsWith(`/${filename}`),
        ),
      filename,
    );
    row.click();
    await until(() => {
      const selection = document
        .querySelector(".search-selection")
        ?.textContent.includes(filename.split("/").pop());
      if (selection) return true;
      // 파일 감시 갱신으로 행이 교체되면 검색 완료 후 새 행을 다시 선택한다.
      if (!document.querySelector(".result-summary .spin"))
        [...document.querySelectorAll(".search-table .file-row")]
          .find((item) =>
            item.title.replaceAll("\\", "/").endsWith(`/${filename}`),
          )
          ?.click();
      return false;
    }, "파일 선택");
    return row;
  }
  // 현재 선택한 파일의 미리보기 대화상자를 연다.
  async function preview() {
    [...document.querySelectorAll(".search-selection button")]
      .find((item) => item.textContent.includes("미리보기"))
      .click();
    return until(
      () => document.querySelector("dialog[open]"),
      "미리보기 대화상자",
    );
  }
  // 열린 미리보기를 닫고 다음 동작을 준비한다.
  async function closePreview() {
    document.querySelector('dialog[open] [aria-label="닫기"]').click();
    await until(() => !document.querySelector("dialog[open]"), "미리보기 닫기");
  }
  // 현재 선택 파일의 작업 메뉴를 열어 아이콘과 단축키를 확인한다.
  async function openMenu() {
    document
      .querySelector('.explorer-pane.active [aria-label="추가 파일 도구"]')
      .click();
    return until(
      () => document.querySelector('[aria-label="파일 메뉴"]'),
      "파일 도구 메뉴",
    );
  }
  // 관찰 가능한 메뉴 이름으로 작업이나 하위 메뉴를 선택한다.
  async function menuItem(label) {
    const button = await until(
      () =>
        [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
          item.textContent.includes(label),
        ),
      label,
    );
    if (button.disabled) throw new Error(`메뉴 비활성: ${label}`);
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const originalInvoke = window.__TAURI_INTERNALS__.invoke;
  // Rust가 운영체제에 파일을 전달한 완료 기록을 기다린다.
  async function waitNativeOpens(count) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const records = await originalInvoke("ed_request", {
        kind: "smokeOpens",
        payload: {},
      });
      if (records.length === count) return records;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`파일 실행 완료 기록 ${count}개를 확인하지 못했습니다.`);
  }
  try {
    if (window.__edSmokeEmpty) {
      await until(
        () =>
          document
            .querySelector(".demo-banner")
            ?.textContent.includes("검색할 폴더를 연결하세요"),
        "빈 인덱스 안내",
      );
      verify(
        "빈 인덱스에 샘플 파일을 표시하지 않음",
        !document.querySelector(".file-row"),
      );
      verify(
        "폴더 연결 전에도 기본 두 탐색창 표시",
        document.querySelectorAll(".explorer-pane").length === 2,
      );
      verify(
        "실행 가능한 실제 파일과 폴더 연결 안내",
        document.body.textContent.includes("실제 파일을 검색하고 기본 앱으로"),
      );
      report.passed = report.errors.length === 0;
      report.finished = new Date().toISOString();
      await originalInvoke("ed_request", {
        kind: "smokeReport",
        payload: report,
      });
      return;
    }
    await until(
      () =>
        document.querySelector('[aria-label="파일 검색"]') &&
        document.querySelectorAll(".explorer-pane").length === 2 &&
        document.querySelector(".search-table .file-row") &&
        !document.querySelector(".demo-banner"),
      "실제 폴더 초기화",
    );
    verify(
      "Tauri IPC 초기화",
      Boolean(window.__TAURI_INTERNALS__) &&
        (await originalInvoke("ed_request", {kind:"status",payload:{}})).runtime === "tauri",
    );
    verify(
      "기본 두 탐색창과 첫 번째 활성 상태",
      document.querySelectorAll(".explorer-pane").length === 2 &&
        document
          .querySelector('.explorer-pane[aria-label="탐색창 1"]')
          .classList.contains("active"),
    );
    const defaultColumns = ["name", "location", "size", "modified"];
    // 검색 열 설정과 실제 표의 열 구성이 함께 바뀌는지 확인한다.
    function columnIds() {
      return [
        ...document.querySelectorAll(".search-column-headings [data-column]"),
      ].map((column) => column.dataset.column);
    }
    verify(
      "검색 기본 속성에 크기·수정일 표시",
      JSON.stringify(columnIds()) === JSON.stringify(defaultColumns),
    );
    document.querySelector('button[aria-label="검색 결과 표시 항목"]').click();
    let picker = await until(
      () => document.querySelector(".search-columns-picker"),
      "검색 표시 항목 설정",
    );
    verify(
      "이름 열은 항상 표시",
      picker.querySelector("input:disabled")?.checked,
    );
    for (const checkbox of picker.querySelectorAll("input:not(:disabled)")) {
      if (!checkbox.checked) {
        checkbox.click();
        await until(() => checkbox.checked, "표시 항목 선택");
      }
    }
    await until(() => columnIds().length === picker.querySelectorAll('label').length, "전체 검색 속성 표시");
    verify(
      "사용자 선택 속성과 실제 파일 메타데이터",
      document
        .querySelector(".search-table .file-row")
        .querySelectorAll('[role="gridcell"]').length === columnIds().length &&
        /\d{4}/.test(
          document.querySelector(
            '.search-table .file-row [data-column="modified"]',
          ).textContent,
        ) &&
        document
          .querySelector('.search-table .file-row [data-column="fullPath"]')
          .textContent.match(/^(?:\/|[A-Za-z]:\\|\\\\)/),
    );
    await until(() => {
      const stored = sessionStorage.getItem("ed:searchColumns");
      return stored && JSON.parse(stored).length === columnIds().length;
    }, "검색 열 설정 저장");
    verify("검색 표시 항목 설정 자동 저장", true);
    picker.querySelector('[aria-label="표시 항목 닫기"]').click();
    const searchScroll = document.querySelector(".search-table .file-scroll");
    searchScroll.scrollLeft = searchScroll.scrollWidth;
    await until(
      () =>
        searchScroll.scrollLeft > 0 &&
        document.querySelector(".search-column-headings").style.transform !==
          "translateX(0px)",
      "검색 가로 스크롤",
    );
    const lastHeading = document
      .querySelector('.search-column-headings [data-column="fullPath"]')
      .getBoundingClientRect();
    const lastCell = document
      .querySelector('.search-table .file-row [data-column="fullPath"]')
      .getBoundingClientRect();
    verify(
      "선택한 열을 숨기지 않고 가로 스크롤·머리글 정렬 유지",
      Math.abs(lastHeading.left - lastCell.left) < 2,
    );
    searchScroll.scrollLeft = 0;
    document
      .querySelector('.search-column-headings [data-column="size"] button')
      .click();
    await until(
      () =>
        document
          .querySelector('.search-column-headings [data-column="size"]')
            .getAttribute("aria-sort") === "ascending" && !document.querySelector('.result-summary .spin'),
      "검색 크기 오름차순",
    );
    const sortedRows = [
      ...document.querySelectorAll(".search-table .file-row"),
    ];
    const sizes = sortedRows
      .filter((row) => !row.querySelector(".file-icon.folder"))
      .map((row) => {
        const [amount, unit] = row
          .querySelector('[data-column="size"]')
          .textContent.split(" ");
        return Number(amount) * 1024 ** ["B", "KB", "MB", "GB"].indexOf(unit);
      });
    verify(
      "검색 속성 열 정렬",
      sizes.length > 1 &&
        sizes.every((size, index) => index === 0 || size >= sizes[index - 1]),
    );
    document.querySelector('button[aria-label="검색 결과 표시 항목"]').click();
    picker = await until(
      () => document.querySelector(".search-columns-picker"),
      "표시 설정 다시 열기",
    );
    [...picker.querySelectorAll("button")]
      .find((button) => button.textContent.includes("기본값"))
      .click();
    await until(
      () => JSON.stringify(columnIds()) === JSON.stringify(defaultColumns),
      "검색 기본 열 복원",
    );
    picker.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await until(
      () => !document.querySelector(".search-columns-picker"),
      "표시 항목 닫기",
    );
    verify(
      "표시 항목 기본값·Esc 초점 복원",
      document.activeElement?.getAttribute("aria-label") ===
        "검색 결과 표시 항목",
    );
    await selectFile("업무 보고서", "문서/업무 보고서 2026.txt");
    await until(
      () =>
        document
          .querySelector(".explorer-pane.active .file-row.selected")
          ?.textContent.includes("업무 보고서"),
      "검색 클릭 위치 표시",
    );
    verify("검색 클릭으로 활성 탐색창 위치·파일 선택", true);
    document.querySelector('[aria-label="탐색창 2 활성화"]').click();
    await until(
      () =>
        document
          .querySelector('.explorer-pane[aria-label="탐색창 2"]')
          .classList.contains("active"),
      "두 번째 창 활성화",
    );
    document.querySelector(".search-table .file-row").click();
    await until(
      () =>
        document
          .querySelector(
            '.explorer-pane[aria-label="탐색창 2"] .file-row.selected',
          )
          ?.textContent.includes("업무 보고서"),
      "두 번째 창 위치 표시",
    );
    verify("활성 창 변경과 검색 결과 연결", true);
    await preview();
    await until(
      () =>
        document
          .querySelector(".preview-body pre")
          ?.textContent.includes("한글 검색과 미리보기"),
      "네이티브 파일 텍스트 읽기",
    );
    verify("edfile 범위 응답과 한글 텍스트 미리보기", true);
    await closePreview();
    await selectFile("개발 계획", "문서/개발 계획.pdf");
    await preview();
    await until(
      () =>
        document.querySelector(".pdf-preview canvas")?.width > 0 &&
        document
          .querySelector(".pdf-toolbar")
          ?.textContent.includes("/ 3 페이지"),
      "PDF 워커 렌더링",
      30000,
    );
    verify("PDF 워커·CSP·네이티브 파일 렌더링", true);
    await closePreview();
    if (!window.__edE2E) {
      let pdfRow = await selectFile("개발 계획", "문서/개발 계획.pdf");
      pdfRow.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
      );
      await until(
        () =>
          document
            .querySelector(".toast")
            ?.textContent.includes("기본 앱으로 열었습니다"),
        "검색 PDF 기본 앱 실행",
      );
      verify(
        "검색 PDF 더블클릭 → 실제 OS 실행 명령 완료",
        !document.querySelector("dialog[open]") &&
          (await waitNativeOpens(1)).length === 1,
      );
      await until(
        () =>
          document
            .querySelector(".explorer-pane.active .file-row.selected")
            ?.textContent.includes("개발 계획"),
        "탐색창 PDF 선택",
      );
      document
        .querySelector(".explorer-pane.active .file-row.selected")
        .dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
        );
      await until(
        () =>
          document
            .querySelector(".toast")
            ?.textContent.includes("기본 앱으로 열었습니다"),
        "탐색창 PDF 실행 완료",
      );
      report.nativeOpens = await waitNativeOpens(2);
      verify(
        "탐색창 PDF 더블클릭 → 실제 OS 실행 명령 완료",
        !document.querySelector("dialog[open]") &&
          report.nativeOpens.length === 2,
      );
    }
    const pane = document.querySelector(".explorer-pane.active");
    setValue(pane.querySelector(".folder-filter input"), "회의록");
    await until(
      () =>
        pane.querySelectorAll(".file-row").length === 1 &&
        pane.querySelector(".file-row").textContent.includes("회의록"),
      "폴더 필터",
    );
    verify("탐색창별 파일 필터", true);
    setValue(pane.querySelector(".folder-filter input"), "");
    await until(
      () => pane.querySelectorAll(".file-row").length === 3,
      "폴더 필터 해제",
    );
    pane.querySelector('[aria-label="크기로 정렬"]').click();
    await until(
      () => pane.querySelector(".file-row").textContent.includes("회의록"),
      "크기 정렬",
    );
    verify("파일 크기 정렬", true);
    pane.querySelector('[aria-label="폴더 트리 표시"]').click();
    await until(() => pane.querySelector(".folder-tree"), "폴더 트리");
    await until(
      () => pane.querySelectorAll(".tree-folder").length > 1,
      "폴더 트리 펼치기",
    );
    verify("연결 폴더 트리와 하위 폴더", true);
    pane.querySelector('[aria-label="폴더 트리 표시"]').click();
    pane.querySelector(".file-row").dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 800,
        clientY: 400,
      }),
    );
    await until(
      () => document.querySelector('[aria-label="파일 메뉴"]'),
      "우클릭 메뉴",
    );
    verify(
      "파일 우클릭 작업 메뉴",
      document
        .querySelector('[aria-label="파일 메뉴"]')
        .textContent.includes("기본 앱으로 열기"),
    );
    const mainMenu = document.querySelector('[aria-label="파일 메뉴"]');
    const toolGroup = mainMenu.querySelector('[data-group="tools"]');
    toolGroup.dispatchEvent(
      new PointerEvent("pointerover", {
        bubbles: true,
        pointerType: "mouse",
      }),
    );
    let sub = await until(
      () => document.querySelector(".context-submenu"),
      "클릭 없는 하위 메뉴",
    );
    verify(
      "마우스 호버만으로 하위 메뉴 즉시 표시·주 메뉴 유지",
      sub.textContent.includes("SHA-256") &&
        mainMenu.isConnected &&
        toolGroup.getAttribute("aria-expanded") === "true",
    );
    const subBounds = sub.getBoundingClientRect();
    verify(
      "화면 경계에서 하위 메뉴 위치 보정",
      subBounds.left >= 7 &&
        subBounds.right <= innerWidth - 7 &&
        subBounds.top >= 7 &&
        subBounds.bottom <= innerHeight - 7,
    );
    const createGroup = mainMenu.querySelector('[data-group="create"]');
    toolGroup.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget: createGroup,
      }),
    );
    await until(
      () =>
        document
          .querySelector(".context-submenu")
          ?.textContent.includes("새 텍스트 파일"),
      "다른 하위 메뉴로 호버 이동",
    );
    verify(
      "호버 이동으로 하위 메뉴 전환",
      toolGroup.getAttribute("aria-expanded") === "false",
    );
    createGroup.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget: document.querySelector(".context-submenu"),
      }),
    );
    verify(
      "하위 메뉴로 포인터 이동 시 유지",
      Boolean(document.querySelector(".context-submenu")),
    );
    createGroup.focus();
    createGroup.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(
      () =>
        document
          .querySelector(".context-submenu")
          ?.contains(document.activeElement),
      "하위 메뉴 키보드 진입",
    );
    document.activeElement.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(
      () => !document.querySelector(".context-submenu"),
      "상위 메뉴 키보드 복귀",
    );
    verify(
      "좌우 방향키 하위 메뉴 진입·복귀",
      document.activeElement === createGroup,
    );
    document
      .querySelector('[aria-label="파일 메뉴"]')
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    await until(
      () => !document.querySelector('[aria-label="파일 메뉴"]'),
      "파일 메뉴 닫기",
    );
    setValue(
      document.querySelector('[aria-label="파일 검색"]'),
      "개발|회의록 !업무 ext:pdf,md size:>0b dm:today",
    );
    await until(
      () =>
        document.querySelectorAll(".search-table .file-row").length === 2 &&
        !document.querySelector(".search-error"),
      "고급 검색 결합",
    );
    verify("OR·제외·확장자·크기·수정일 검색 결합", true);
    document.querySelector('[aria-label="검색 조건 저장"]').click();
    let presetInput = await until(
      () => document.querySelector('[aria-label="저장할 이름"]'),
      "검색 저장",
    );
    setValue(presetInput, "검증 검색");
    document.querySelector("dialog[open] form").requestSubmit();
    await until(
      () =>
        document
          .querySelector(".saved-preset")
          ?.textContent.includes("검증 검색"),
      "저장된 검색 표시",
    );
    setValue(document.querySelector('[aria-label="파일 검색"]'), "없는파일");
    [...document.querySelectorAll(".saved-preset .sidebar-folder")]
      .find((button) => button.textContent.includes("검증 검색"))
      .click();
    await until(
      () =>
        document
          .querySelector('[aria-label="파일 검색"]')
          .value.includes("개발|회의록"),
      "검색 조건 복원",
    );
    verify("검색 조건 북마크 저장·복원", true);
    document.querySelector('[aria-label="현재 작업 공간 저장"]').click();
    presetInput = await until(
      () => document.querySelector('[aria-label="저장할 이름"]'),
      "작업 공간 저장",
    );
    setValue(presetInput, "검증 작업 공간");
    document.querySelector("dialog[open] form").requestSubmit();
    await until(
      () =>
        [...document.querySelectorAll(".saved-preset")].some((item) =>
          item.textContent.includes("검증 작업 공간"),
        ),
      "작업 공간 목록",
    );
    verify("탐색창·탭 작업 공간 저장", true);
    await selectFile("folder:정리함", "정리함");
    await until(
      () =>
        document
          .querySelector(".explorer-pane.active .explorer-tab.current")
          ?.textContent.includes("정리함"),
      "드롭 대상 폴더",
    );
    const roots = await originalInvoke("ed_request", {
      kind: "init",
      payload: {},
    });
    const dragData = new DataTransfer();
    dragData.setData(
      "application/x-ed-files",
      JSON.stringify([{ rootId: roots[0].id, path: "문서/개발 계획.pdf" }]),
    );
    document.querySelector(".explorer-pane.active").dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dragData,
      }),
    );
    await until(
      () =>
        document
          .querySelector("dialog[open]")
          ?.textContent.includes("파일 가져오기"),
      "드래그 복사 선택",
    );
    [...document.querySelectorAll("dialog[open] .modal-footer button")]
      .find((button) => button.textContent === "복사")
      .click();
    await until(
      () =>
        !document.querySelector("dialog[open]") &&
        [...document.querySelectorAll(".explorer-pane.active .file-row")].some(
          (row) => row.textContent.includes("개발 계획.pdf"),
        ),
      "드래그 파일 복사 반영",
    );
    verify("창 사이 드래그 복사와 실제 파일 갱신", true);
    document.querySelector(".explorer-pane.active").dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: dragData,
      }),
    );
    await until(
      () =>
        document
          .querySelector("dialog[open]")
          ?.textContent.includes("파일 가져오기"),
      "충돌 복사 확인창",
    );
    [...document.querySelectorAll("dialog[open] .modal-footer button")]
      .find((button) => button.textContent === "복사")
      .click();
    await until(
      () =>
        !document.querySelector('dialog[open]') && [...document.querySelectorAll(".explorer-pane.active .file-row")].some((row) => row.textContent.includes("개발 계획 (1).pdf")),
      "중복 파일 번호 복사",
    );
    verify(
      "복사 충돌 시 번호 사본 생성과 기존 파일 보존",
      [...document.querySelectorAll(".explorer-pane.active .file-row")].filter(
        (row) => row.textContent.includes("개발 계획.pdf"),
      ).length === 1,
    );
    await selectFile("작업 화면", "이미지/작업 화면.png");
    await preview();
    await until(
      () => document.querySelector(".preview-body img")?.naturalWidth > 0,
      "네이티브 이미지 읽기",
    );
    verify("네이티브 이미지 미리보기", true);
    await closePreview();
    document.querySelector('[aria-label="탐색창 1에 새 탭"]').click();
    await until(
      () =>
        document.querySelectorAll('[aria-label="탐색창 1 탭"] [role="tab"]')
          .length === 2,
      "새 탭 추가",
    );
    verify(
      "탐색창별 독립 탭",
      document.querySelectorAll('[aria-label="탐색창 2 탭"] [role="tab"]')
        .length === 1,
    );
    for (const count of [1, 3, 4, 2]) {
      setValue(
        document.querySelector('[aria-label="탐색창 개수"]'),
        String(count),
      );
      await until(
        () => document.querySelectorAll(".explorer-pane").length === count,
        `탐색창 ${count}개`,
      );
    }
    verify("탐색창 1~4개 전환", true);
    await selectFile("업무 보고서", "문서/업무 보고서 2026.txt");
    await until(
      () =>
        document
          .querySelector(".explorer-pane.active .file-row.selected")
          ?.textContent.includes("업무 보고서"),
      "도구 대상 선택",
    );
    let menu = await openMenu();
    verify(
      "우클릭 메뉴 전체 아이콘·단축키·하위 그룹",
      menu.querySelectorAll('[role="menuitem"] svg').length >= 17 &&
        menu.querySelectorAll("kbd").length >= 8 &&
        menu.querySelectorAll('[aria-haspopup="menu"]').length === 5,
    );
    document.querySelector('.file-context-menu [data-group="create"]').dispatchEvent(new PointerEvent("pointerover",{bubbles:true,pointerType:"mouse"}));
    await until(()=>document.querySelector('.context-submenu'),"간단한 새로 만들기 하위 메뉴");
    await menuItem("새 텍스트 파일");
    let input = await until(
      () => document.querySelector('[aria-label="작업 이름"]'),
      "새 파일 이름",
    );
    setValue(input, "메뉴 검증.txt");
    document.querySelector("dialog[open] form").requestSubmit();
    await until(
      () =>
        !document.querySelector("dialog[open]") &&
        [...document.querySelectorAll(".explorer-pane.active .file-row")].some(
          (row) => row.textContent.includes("메뉴 검증.txt"),
        ),
      "새 파일 생성 반영",
    );
    verify("새 텍스트 파일 메뉴 → 실제 파일 생성", true);
    await selectFile("업무 보고서", "문서/업무 보고서 2026.txt");
    await until(
      () =>
        document
          .querySelector(".explorer-pane.active .file-row.selected")
          ?.textContent.includes("업무 보고서"),
      "복제 대상 선택",
    );
    await openMenu();
    document.querySelector('[role="menuitem"]').dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "d",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(
      () =>
        [...document.querySelectorAll(".explorer-pane.active .file-row")].some(
          (row) => row.textContent.includes("업무 보고서 2026 사본.txt"),
        ),
      "단축키 복제",
    );
    verify(
      "메뉴에서 ⌘D 단축키 → 원본 보존 사본 생성",
      !document.querySelector('[role="menu"]'),
    );
    await openMenu();
    await menuItem("파일 도구");
    verify(
      "고급 파일 도구와 비활성 조건",
      document.querySelectorAll('[role="menuitem"]').length >= 9 &&
        [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
          item.textContent.includes("이미지 크기"),
        ).disabled,
    );
    await menuItem("SHA-256");
    await until(
      () =>
        document
          .querySelector("dialog[open]")
          ?.textContent.match(/[a-f0-9]{64}/),
      "파일 체크섬",
    );
    verify("메뉴 SHA-256 무결성 검사", true);
    await closePreview();
    for (const [label, expected] of [
      ["현재 폴더 용량 분석", "분석 완료"],
      ["현재 폴더 중복 파일 찾기", "그룹 1"],
      ["다른 창 폴더와 비교", "분석 완료"],
    ]) {
      await openMenu();
      await menuItem("파일 도구");
      await menuItem(label);
      await until(
        () =>
          document
            .querySelector("dialog[open]")
            ?.textContent.includes(expected),
        label,
      );
      verify(
        `${label} → 실제 분석 결과 표시`,
        !document.querySelector(".analysis-content .error-text"),
      );
      await closePreview();
    }
    if (!window.__edE2E) {
      await openMenu();
      await menuItem("이름·경로 복사");
      await menuItem("전체 경로");
      await until(
        () =>
          document
            .querySelector(".toast")
            ?.textContent.includes("텍스트로 복사"),
        "경로 복사",
      );
      verify("전체 경로를 운영체제 클립보드에 복사", true);
    }
    document.querySelector('[aria-label="설정"]').click();
    await until(
      () => document.querySelector('[aria-label="화면 테마"]'),
      "화면 설정",
    );
    setValue(document.querySelector('[aria-label="화면 테마"]'), "dark");
    setValue(
      document.querySelector('[aria-label="파일 목록 밀도"]'),
      "compact",
    );
    await until(
      () =>
        document.documentElement.dataset.theme === "dark" &&
        document.documentElement.dataset.density === "compact",
      "테마·밀도 적용",
    );
    verify("라이트·다크 테마와 목록 밀도 설정", true);
    setValue(document.querySelector('[aria-label="화면 테마"]'), "light");
    setValue(
      document.querySelector('[aria-label="파일 목록 밀도"]'),
      "comfortable",
    );
    await closePreview();
    document.querySelectorAll(".sidebar-nav")[2].click();
    await until(
      () => document.querySelector(".toolbox-grid"),
      "파일 도구 모음",
    );
    verify(
      "12개 기능 카드와 실제 작업 연결",
      document.querySelectorAll(".toolbox-card").length === 12,
    );
    await closePreview();
    await originalInvoke("ed_request", {
      kind: "operation",
      payload: {
        action: "mkfile",
        destination: { rootId: roots[0].id, path: "문서" },
        name: "데이터분석 발굴.pdf",
      },
    });
    setValue(document.querySelector('[aria-label="검색 방식"]'), "initials");
    for (const query of [
      "ㄷㅇㅌㅂㅅ ㅂㄱ",
      "ㄷㅇㅌㅂㅅㅂㄱ",
      "ㄷㅇ ㅌㅂㅅㅂ ㄱ",
    ]) {
      await selectFile(`${query} ext:pdf`, "문서/데이터분석 발굴.pdf");
      verify(
        `초성 띄어쓰기 무시: ${query}`,
        document.querySelectorAll(".search-table .file-row").length === 1 &&
          document
            .querySelector(".search-selection")
            ?.textContent.includes("데이터분석 발굴.pdf"),
      );
    }
    let desktop = await originalInvoke("desktop_control", { action: "status" });
    verify(
      "네이티브 트레이 생성·백그라운드 기본값",
      desktop.tray && desktop.keepRunning,
    );
    await originalInvoke("desktop_control", { action: "hide" });
    desktop = await originalInvoke("desktop_control", { action: "status" });
    verify("트레이로 숨겨도 프로세스와 IPC 유지", !desktop.visible);
    await originalInvoke("desktop_control", { action: "show" });
    desktop = await originalInvoke("desktop_control", { action: "status" });
    verify("트레이 창 다시 표시", desktop.visible);
    report.passed = report.errors.length === 0;
  } catch (error) {
    report.passed = false;
    report.errors.push(String(error));
    report.screen = document.body.innerText.slice(-10000);
  }
  report.finished = new Date().toISOString();
  await window.__TAURI_INTERNALS__.invoke("ed_request", {
    kind: "smokeReport",
    payload: report,
  });
})();

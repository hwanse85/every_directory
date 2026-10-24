(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const report = { suite: "actions", tests: [], errors: [], passed: false };
  window.addEventListener("error", (e) => report.errors.push(e.message));
  window.addEventListener("unhandledrejection", (e) =>
    report.errors.push(String(e.reason)),
  );
  async function until(check, label) {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      const v = await check();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`시간 초과: ${label}`);
  }
  function value(input, text) {
    if (!input) throw new Error("입력란 없음");
    Object.getOwnPropertyDescriptor(
      input.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value",
    ).set.call(input, text);
    input.dispatchEvent(
      new Event(input.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
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
  function verify(name, condition) {
    if (!condition) throw new Error(`검증 실패: ${name}`);
    report.tests.push({ name, passed: true });
  }
  async function close() {
    document.querySelector('dialog[open] [aria-label="닫기"]')?.click();
    await until(() => !document.querySelector("dialog[open]"), "대화상자 닫기");
  }
  const pane = () => document.querySelector(".explorer-pane.active");
  let root;
  const list = (path) =>
    invoke("ed_request", { kind: "list", payload: { rootId: root.id, path } });
  async function select(name) {
    value(document.querySelector('[aria-label="파일 검색"]'), name);
    await new Promise((r) => setTimeout(r, 160));
    const row = await until(
      () =>
        [...document.querySelectorAll(".search-table .file-row")].find((row) =>
          row.title.endsWith(`\\${name}`),
        ),
      `검색 ${name}`,
    );
    row.click();
    await until(
      () =>
        pane().querySelector(".file-row.selected")?.title.endsWith(`\\${name}`),
      `선택 ${name}`,
    );
  }
  async function menu(...labels) {
    const toolbarButton = await until(() => {
      const button = pane().querySelector('[aria-label="추가 파일 도구"]');
      return button && !button.disabled ? button : undefined;
    }, "목록 갱신 후 도구 활성화");
    toolbarButton.click();
    await until(
      () => document.querySelector('[aria-label="파일 메뉴"]'),
      "파일 메뉴",
    );
    for (const label of labels) {
      const item = await until(
        () =>
          [...document.querySelectorAll('[role="menuitem"]')].find((item) =>
            item.textContent.includes(label),
          ),
        label,
      );
      if (item.disabled) throw new Error(`메뉴 비활성: ${label}`);
      item.click();
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  async function applyName(name) {
    const input = await until(
      () => document.querySelector('[aria-label="작업 이름"]'),
      "작업 이름",
    );
    value(input, name);
    await new Promise(requestAnimationFrame);
    const submit = await until(() => {
      const button = document.querySelector("dialog[open] .button.primary");
      return button && !button.disabled ? button : undefined;
    }, "이름 입력과 작업 준비");
    submit.click();
    await until(() => !document.querySelector("dialog[open]"), `작업 ${name}`);
  }
  try {
    await until(() => pane()?.querySelector(".file-row"), "초기 목록");
    root = (await invoke("ed_request", { kind: "init", payload: {} }))[0];
    await select("업무 보고서.txt");
    await menu("새로 만들기", "새 폴더");
    await applyName("E2E 새 폴더");
    verify(
      "새 폴더 UI와 실제 디렉터리 생성",
      (await list("")).some((x) => x.name === "E2E 새 폴더"),
    );
    await menu("새로 만들기", "새 텍스트 파일");
    await applyName("E2E 새 파일.txt");
    await select("E2E 새 파일.txt");
    await menu("이름 변경");
    await applyName("E2E 이름 변경.txt");
    verify(
      "파일 생성·단일 이름 변경",
      (await list("")).some((x) => x.name === "E2E 이름 변경.txt"),
    );
    await select("E2E 이름 변경.txt");
    await menu("이름 변경");
    value(document.querySelector('[aria-label="작업 이름"]'), "CON.txt");
    document.querySelector("dialog[open] .button.primary").click();
    await until(
      () => document.querySelector('dialog[open] [role="alert"]'),
      "예약 이름 오류",
    );
    verify(
      "잘못된 이름은 안내하고 원본 보존",
      (await list("")).some((x) => x.name === "E2E 이름 변경.txt"),
    );
    await close();
    await select("E2E 이름 변경.txt");
    await menu("파일 도구", "일괄 이름 변경");
    value(document.querySelector('[aria-label="이름 접두사"]'), "일괄_");
    await until(
      () =>
        document
          .querySelector(".rename-preview")
          ?.textContent.includes("일괄_E2E"),
      "일괄 변경 미리보기",
    );
    document.querySelector("dialog[open] .button.primary").click();
    await until(() => !document.querySelector("dialog[open]"), "일괄 변경");
    const renamed = (await list("")).find((x) => x.name.startsWith("일괄_E2E"));
    verify("일괄 이름 미리보기와 실제 적용", !!renamed);
    await select("업무 보고서.txt");
    await menu("파일 도구", "ZIP 압축…");
    await applyName("E2E 압축.zip");
    await select("E2E 압축.zip");
    await menu("파일 도구", "ZIP 압축 풀기");
    await applyName("E2E 압축 해제");
    verify(
      "ZIP 압축·해제 UI와 한글 파일",
      (await list("E2E 압축 해제")).some((x) => x.name === "업무 보고서.txt"),
    );
    await select(renamed.name);
    await menu("앱 휴지통으로");
    document.querySelector("dialog[open] .button.danger").click();
    await until(() => !document.querySelector("dialog[open]"), "삭제 완료");
    verify(
      "삭제는 앱 휴지통으로 이동",
      !(await list("")).some((x) => x.name === renamed.name),
    );
    await menu("파일 도구", "앱 휴지통·복원");
    const trashRow = await until(
      () =>
        [...document.querySelectorAll(".trash-list > div")].find((x) =>
          x.textContent.includes(renamed.name),
        ),
      "휴지통 파일",
    );
    trashRow.querySelector("button").click();
    await until(
      async () => (await list("")).some((x) => x.name === renamed.name),
      "휴지통 복원",
    );
    verify("휴지통 목록과 원래 위치 복원", true);
    await close();
    await select("이미지.png");
    await menu("파일 도구", "이미지 크기");
    value(document.querySelector('[aria-label="이미지 가로"]'), "100");
    value(document.querySelector('[aria-label="이미지 세로"]'), "100");
    value(
      document.querySelector('[aria-label="이미지 결과 폴더"]'),
      "E2E 이미지 변환",
    );
    document.querySelector("dialog[open] .button.primary").click();
    await until(() => !document.querySelector("dialog[open]"), "이미지 변환");
    verify(
      "이미지 변환 UI와 원본 보존",
      (await list("E2E 이미지 변환")).some((x) => x.name === "이미지.png") &&
        (await list("")).some((x) => x.name === "이미지.png"),
    );
    document.querySelector('[aria-label="설정"]').click();
    await until(
      () => document.querySelector('[aria-label="기본 검색 방식"]'),
      "설정",
    );
    verify(
      "앱 정보에 버전·프로젝트 관리자·문의 경로",
      document
        .querySelector('[aria-label="앱 정보"]')
        ?.textContent.includes("hwanse85") &&
        /^v\d+\.\d+\.\d+/.test(
          document.querySelector('[data-testid="app-version"]')?.textContent,
        ) &&
        document.querySelector('[aria-label="앱 정보"] a[href$="/issues"]'),
    );
    const components = [
      ...document.querySelectorAll(".about-panel details"),
    ].find((x) => x.textContent.includes("오픈소스 구성요소"));
    components.open = true;
    const licenseSearch = await until(
      () => document.querySelector('[aria-label="라이선스 구성요소 검색"]'),
      "라이선스 검색",
    );
    value(licenseSearch, "react-dom");
    await until(
      () => document.querySelectorAll(".license-list > p").length === 1,
      "라이선스 필터",
    );
    verify(
      "라이선스 목록 검색과 버전별 원본 링크",
      document
        .querySelector(".license-list a")
        ?.href.includes("registry.npmjs.org/react-dom"),
    );
    const notices = [...document.querySelectorAll(".about-panel details")].find(
      (x) =>
        x.querySelector("summary").textContent.includes("THIRD_PARTY_NOTICES"),
    );
    notices.open = true;
    await until(
      () =>
        document
          .querySelector(".license-notices")
          ?.textContent.includes("Permission"),
      "오프라인 고지 전문",
    );
    verify("THIRD_PARTY 고지 전문 IPC 로딩", true);
    for (const mode of ["normal", "initials"]) {
      value(document.querySelector('[aria-label="기본 검색 방식"]'), mode);
      await until(
        async () =>
          (await invoke("desktop_control", { action: "status" }))
            .defaultSearchMode === mode,
        "기본 검색 저장",
      );
    }
    verify("기본 검색 설정 네이티브 저장과 복원", true);
    await close();
    pane().querySelector('[role="tab"]').focus();
    key("p", { ctrlKey: true, shiftKey: true });
    const command = await until(
      () => document.querySelector('[aria-label="빠른 명령 검색"]'),
      "명령 검색",
    );
    value(command, "ㄱㅅ ㅅㅈ");
    await until(
      () =>
        document.querySelectorAll('.command-list [role="option"]').length === 1,
      "명령 필터",
    );
    command.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    command.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 60));
    verify(
      "명령 창에서 IME 확정 Enter는 실행하지 않음",
      !!document.querySelector('[aria-label="빠른 명령 검색"]'),
    );
    command.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    command.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await until(
      () => document.querySelector('[aria-label="기본 검색 방식"]'),
      "명령 실행",
    );
    verify("명령 검색·키보드 실행", true);
    await close();
    report.passed = report.errors.length === 0;
  } catch (e) {
    report.errors.push(String(e));
    report.screen = document.body.innerText.slice(-5000);
  }
  report.finished = new Date().toISOString();
  await invoke("ed_request", { kind: "smokeReport", payload: report });
})();

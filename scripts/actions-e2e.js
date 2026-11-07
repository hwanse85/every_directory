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
  async function clickReady(selector,label="작업 버튼 준비") {
    const button=await until(() => {
      const value=document.querySelector(selector);
      return value && !value.disabled ? value : undefined;
    },label);
    button.click();
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
          row.title.split(/[\\/]/).pop()===name,
        ),
      `검색 ${name}`,
    );
    row.click();
    await until(
      () =>
        pane().querySelector(".file-row.selected")?.title.split(/[\\/]/).pop()===name,
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
      if (label === "새로 만들기" && labels.length > 1) {
        item.dispatchEvent(new PointerEvent("pointerover", {bubbles: true, pointerType: "mouse"}));
      } else item.click();
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  // 대화상자 없이 목록 행 안에 뜬 이름 입력칸에 이름을 넣고 Enter로 적용한다.
  async function inlineName(name, label = "목록 안 이름 입력칸") {
    const input = await until(() => pane().querySelector(".rename-field input"), label);
    if (document.querySelector("dialog[open]")) throw new Error("이름 입력이 대화상자로 열림");
    const initial = input.value;
    value(input, name);
    await new Promise(requestAnimationFrame);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await until(() => !pane().querySelector(".rename-field"), `이름 적용 ${name}`);
    return initial;
  }
  try {
    await until(() => pane()?.querySelector(".file-row"), "초기 목록");
    root = (await invoke("ed_request", { kind: "init", payload: {} }))[0];
    await select("업무 보고서.txt");
    await menu("새로 만들기", "새 폴더");
    const folderDefault = await inlineName("E2E 새 폴더", "새 폴더 이름 입력칸");
    verify(
      "새 폴더는 기본 이름으로 바로 만들고 목록 안에서 이름 입력",
      folderDefault.startsWith("새 폴더") && (await list("")).some((x) => x.name === "E2E 새 폴더") && !(await list("")).some((x) => x.name === folderDefault),
    );
    await menu("새로 만들기", "새 텍스트 파일");
    const fileDefault = await inlineName("E2E 새 파일.txt", "새 파일 이름 입력칸");
    verify("새 텍스트 파일도 목록 안에서 이름 입력", fileDefault.startsWith("새 파일") && fileDefault.endsWith(".txt"));
    await select("E2E 새 파일.txt");
    await menu("이름 변경");
    await inlineName("E2E 이름 변경.txt");
    verify(
      "파일 생성·단일 이름 변경",
      (await list("")).some((x) => x.name === "E2E 이름 변경.txt"),
    );
    await select("E2E 이름 변경.txt");
    await menu("이름 변경");
    const invalid = await until(() => pane().querySelector(".rename-field input"), "예약 이름 입력칸");
    value(invalid, "CON.txt");
    await new Promise(requestAnimationFrame);
    invalid.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await until(() => pane().querySelector(".rename-error"), "예약 이름 오류");
    verify(
      "잘못된 이름은 입력칸에 남아 안내하고 원본 보존",
      pane().querySelector(".rename-error")?.textContent.includes("예약") && pane().querySelector(".rename-field input")?.getAttribute("aria-invalid") === "true" && (await list("")).some((x) => x.name === "E2E 이름 변경.txt"),
    );
    pane().querySelector(".rename-field input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await until(() => !pane().querySelector(".rename-field"), "이름 입력 취소");
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
    await clickReady("dialog[open] .button.primary");
    await until(() => !document.querySelector("dialog[open]"), "일괄 변경");
    const renamed = (await list("")).find((x) => x.name.startsWith("일괄_E2E"));
    verify("일괄 이름 미리보기와 실제 적용", !!renamed);
    await select("업무 보고서.txt");
    await menu("파일 도구", "ZIP 압축…");
    const zipDefault = await inlineName("E2E 압축.zip", "ZIP 이름 입력칸");
    verify("ZIP 압축은 원본 이름으로 바로 만들고 목록 안에서 이름 입력", zipDefault === "업무 보고서.zip");
    await select("E2E 압축.zip");
    await menu("파일 도구", "ZIP 압축 풀기");
    const unzipDefault = await inlineName("E2E 압축 해제", "압축 해제 폴더 이름 입력칸");
    verify("압축 풀기는 ZIP 이름 폴더에 바로 풀고 목록 안에서 이름 입력", unzipDefault === "E2E 압축");
    verify(
      "ZIP 압축·해제 UI와 한글 파일",
      (await list("E2E 압축 해제")).some((x) => x.name === "업무 보고서.txt"),
    );
    // UU 인코딩·디코딩: 만들 파일 이름을 받고 백그라운드에서 실행하며, 창 아래 상태 막대에 진행·완료를 보여 준다.
    async function codec(label, name, state = "done") {
      await menu("파일 도구", label);
      const input = await until(() => document.querySelector('dialog[open] [aria-label="작업 이름"]'), `${label} 이름 입력`);
      const initial = input.value;
      value(input, name);
      await new Promise(requestAnimationFrame);
      await clickReady("dialog[open] .button.primary", `${label} 시작 단추`);
      await until(() => !document.querySelector("dialog[open]"), `${label} 창 닫힘`);
      await until(() => [...document.querySelectorAll(`.job-item.job-${state}`)].some((item) => item.textContent.includes(name)), `${label} 상태 막대 ${state}`);
      return initial;
    }
    const sha = async (path) => (await invoke("ed_request", { kind: "operation", payload: { action: "hash", entries: [{ rootId: root.id, path }] } })).sha256;
    await select("이미지.png");
    verify("UU 인코딩 기본 이름은 원본 이름.uue", (await codec("UU 인코딩", "이미지.png.uue")) === "이미지.png.uue");
    const files = await list("");
    verify("UU 인코딩 결과는 원본보다 큰 텍스트 파일", files.find((x) => x.name === "이미지.png.uue")?.size > files.find((x) => x.name === "이미지.png").size * 1.3);
    await select("이미지.png.uue");
    verify("UU 디코딩 기본 이름은 .uue를 뗀 이름", (await codec("UU 디코딩", "이미지 복원.png")) === "이미지.png");
    verify("UU 디코딩 결과가 원본과 바이트 단위로 같음(SHA-256)", (await sha("이미지 복원.png")) === (await sha("이미지.png")));
    // 폴더는 검색 결과를 누르면 그 안으로 들어가므로 탐색창 목록에서 직접 고른다.
    const folderRow = await until(() => [...pane().querySelectorAll(".file-row")].find((row) => row.title.split(/[\\/]/).pop() === "문서"), "탐색창의 문서 폴더");
    folderRow.click();
    await until(() => pane().querySelector(".file-row.selected")?.title.split(/[\\/]/).pop() === "문서", "문서 폴더 선택");
    verify("폴더 UU 인코딩 기본 이름은 폴더.zip.uue", (await codec("UU 인코딩", "문서.zip.uue")) === "문서.zip.uue");
    await select("문서.zip.uue");
    await codec("UU 디코딩", "문서 복원.zip");
    await invoke("ed_request", { kind: "operation", payload: { action: "unzip", entries: [{ rootId: root.id, path: "문서 복원.zip" }], destination: { rootId: root.id, path: "" }, name: "문서 복원" } });
    verify("폴더는 ZIP으로 묶여 인코딩되고 디코딩한 ZIP에 원래 파일이 들어 있음", (await list("문서 복원/문서")).some((x) => x.name === "메모.txt"));
    await select("README.md");
    await codec("UU 디코딩", "잘못된 결과.bin", "error");
    verify("uuencode가 아닌 파일 디코딩은 상태 막대에 이유를 표시하고 파일을 만들지 않음", [...document.querySelectorAll(".job-item.job-error")].some((item) => item.textContent.includes("begin")) && !(await list("")).some((x) => x.name === "잘못된 결과.bin" || x.name.startsWith(".ed-work-")));
    document.querySelectorAll(".job-item .job-close").forEach((button) => button.click());
    await select(renamed.name);
    await menu("앱 휴지통으로");
    await clickReady("dialog[open] .button.danger");
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
    await until(() => !trashRow.querySelector("button").disabled,"휴지통 복원 준비");
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
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await clickReady("dialog[open] .button.primary");
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

// 실제 WebView와 IPC를 통해 검색·즐겨찾기·안전한 복사 흐름을 검증한다.
(async () => {
  if (window.__quickSmokeWindow) return;
  window.__quickSmokeWindow = true;
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const tests = [];
  // 비동기 화면의 조건이 충족될 때까지 제한된 시간 동안 확인한다.
  async function until(check, label) {
    for (let n = 0; n < 200; n++) {
      if (check()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`시간 초과: ${label}`);
  }
  // 통과 조건과 이름을 보고서에 기록한다.
  function verify(name, condition) {
    if (!condition) throw new Error(name);
    tests.push(name);
  }
  // React 검색 입력을 실제 입력 이벤트와 함께 변경한다.
  function search(value) {
    const input = document.querySelector('[aria-label="파일·폴더 빠른 검색"]');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }
  try {
    await until(
      () => document.querySelector('[role="option"]'),
      "즐겨찾기 표시",
    );
    verify(
      "실제 검색창 즐겨찾기 복원",
      document.body.innerText.includes("업무 보고서.txt"),
    );
    search("ㅇㅁ ㅂㄱㅅ");
    await until(
      () =>
        document
          .querySelector('[role="option"]')
          ?.textContent.includes("업무 보고서.txt") &&
        document.body.innerText.includes("초성 + 일반 검색") &&
        document.querySelector('[aria-label="검색어 지우기"]') &&
        !document.querySelector(".quick-input-row .spin"),
      "초성 검색",
    );
    verify("한글 초성 검색과 IPC 권한", true);
    for (const [query, expected] of [
      ["ㅂㄱㅅ", "업무 보고서.txt"],
      ["ㅆㄹㅁㅇㄷ", "쏠리마인드.txt"],
      ["ᄇᄀᄉ", "업무 보고서.txt"],
      ["ﾲﾡﾵ", "업무 보고서.txt"],
    ]) {
      search(query);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await until(
        () =>
          !document.querySelector(".quick-input-row .spin") &&
          [...document.querySelectorAll('[role="option"]')].some((row) =>
            row.textContent.includes(expected),
          ),
        `빠른 검색 ${query}`,
      );
      verify(`빠른 검색: ${query}`, true);
    }
    const imeInput = document.querySelector(
      '[aria-label="파일·폴더 빠른 검색"]',
    );
    imeInput.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    search("ㅂㄳ");
    await new Promise((resolve) => setTimeout(resolve, 80));
    verify("빠른 검색 IME 입력 도중 초성 분리", imeInput.value === "ㅂㄱㅅ");
    imeInput.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "ㅂㄳ" }),
    );
    await until(
      () =>
        imeInput.value === "ㅂㄱㅅ" &&
        !document.querySelector(".quick-input-row .spin") &&
        document
          .querySelector('[role="option"]')
          ?.textContent.includes("업무 보고서.txt"),
      "빠른 검색 IME 확정",
    );
    // 처음 표시 이벤트와 비동기 검색이 끝난 상태에서 작업 키를 전달한다.
    await until(() => {
      if (document.querySelector('[role="menu"]')) return true;
      if (
        document.querySelector('[role="option"]') &&
        !document.querySelector(".quick-input-row .spin")
      ) {
        document.querySelector("input").dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Tab",
            bubbles: true,
            cancelable: true,
          }),
        );
      }
      return false;
    }, "작업 메뉴");
    verify("키보드 작업 메뉴", true);
    [...document.querySelectorAll('[role="menuitem"]')]
      .find((item) => item.textContent.includes("다른 폴더로 복사"))
      .click();
    await until(
      () => document.querySelector(".quick-destinations button"),
      "복사 대상",
    );
    document.querySelector(".quick-destinations button").click();
    await until(
      () =>
        [...document.querySelectorAll(".quick-destinations button")].some(
          (button) => button.textContent.includes("대상"),
        ),
      "대상 폴더 목록",
    );
    [...document.querySelectorAll(".quick-destinations button")]
      .find((button) => button.textContent.includes("대상"))
      .click();
    await until(
      () =>
        document
          .querySelector(".quick-destination-path")
          ?.textContent.includes("대상"),
      "대상 폴더 진입",
    );
    document.querySelector(".quick-copy-confirm button").click();
    await until(
      () =>
        document
          .querySelector('[role="status"]')
          ?.textContent.includes("복사했습니다"),
      "실제 사본 생성",
    );
    verify("연결 폴더로 실제 파일 복사", true);
    verify(
      "검색창과 하단 안내가 창 안에 표시됨",
      document.querySelector(".quick-footer").getBoundingClientRect().bottom <=
        innerHeight,
    );
    const roots = await invoke("ed_request", { kind: "init", payload: {} });
    let rejected = false;
    try {
      await invoke("ed_request", {
        kind: "operation",
        payload: {
          action: "trash",
          entries: [{ rootId: roots[0].id, path: "업무 보고서.txt" }],
        },
      });
    } catch {
      rejected = true;
    }
    verify("검색창의 삭제 작업 차단", rejected);
    rejected = false;
    try {
      await invoke("copy_files", {
        locations: [{ rootId: roots[0].id, path: "../outside" }],
      });
    } catch {
      rejected = true;
    }
    verify("파일 클립보드의 범위 이탈 차단", rejected);
    await invoke("ed_request", {
      kind: "smokeReport",
      payload: {
        stage: "quick-complete",
        tests,
        width: innerWidth,
        height: innerHeight,
        text: document.body.innerText,
      },
    });
    await invoke("quick_control", {
      action: "reveal",
      location: { rootId: roots[0].id, path: "대상/업무 보고서.txt" },
    });
  } catch (error) {
    await invoke("ed_request", {
      kind: "smokeReport",
      payload: {
        stage: "quick-failed",
        tests,
        error: String(error),
        text: document.body.innerText,
      },
    });
  }
})();

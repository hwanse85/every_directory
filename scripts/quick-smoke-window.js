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
    // 영문·숫자 여러 단어 검색은 기본 설정(경로까지 검색)에서도 파일명 일치를 찾는다.
    search("yk5 xlsx");
    await until(
      () =>
        !document.querySelector(".quick-input-row .spin") &&
        document.querySelector('[role="option"]')?.textContent.includes("YK5 정산표.xlsx"),
      "빠른 검색 yk5 xlsx",
    );
    verify("빠른 검색: 영문·숫자 여러 단어(yk5 xlsx)", true);
    const resultRow = document.querySelector(".quick-result");
    const resultList = document.querySelector("#quick-results");
    const rowHeight = resultRow.getBoundingClientRect().height;
    verify("빠른 검색 결과 행은 낮게 배치", rowHeight <= 44);
    verify("빠른 검색 창에 결과 10개 이상이 한 번에 보임", resultList.clientHeight / rowHeight >= 10);
    const imeInput = document.querySelector(
      '[aria-label="파일·폴더 빠른 검색"]',
    );
    imeInput.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    search("ㅂㄳ");
    await new Promise((resolve) => setTimeout(resolve, 80));
    verify("빠른 검색 IME 입력 중 원본 조합 보존", imeInput.value === "ㅂㄳ");
    verify("빠른 검색 조합 중에도 개별 초성으로 표시",imeInput.parentElement.querySelector('.ime-preview')?.textContent==="ㅂㄱㅅ");
    imeInput.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "ㅂㄳ" }),
    );
    search("ㅂㄳ"); // Late IME commit must not duplicate a consonant.
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
    await invoke("plugin:clipboard-manager|write_text",{text:"quick clipboard history entry"});
    await invoke("clipboard_control",{action:"capture",id:null,destination:null,query:null});
    search("cliptest");
    await until(()=>document.querySelector("#quick-clipboard-trigger"),"사용자 키워드 클립보드 항목");
    verify("빠른 검색에서 사용자 키워드의 클립보드 보기 항목을 최상단 표시",document.querySelector("#quick-results").firstElementChild?.id==="quick-clipboard-trigger");
    document.querySelector('[aria-label="파일·폴더 빠른 검색"]').dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
    await until(()=>document.querySelector('.clipboard-list [role="option"]'),"Enter로 클립보드 이력 열기");
    verify("빠른 검색 Enter는 최신 클립보드 목록을 표시",document.querySelector('.clipboard-list [role="option"]').textContent.includes("quick clipboard history entry"));
    await until(()=>document.querySelector('.clipboard-preview pre')?.textContent.includes("quick clipboard history entry"),"내용 미리보기");
    verify("빠른 검색에서 클립보드 내용 미리보기와 복사·저장 작업 제공",[...document.querySelectorAll('.clipboard-actions button')].some(b=>b.textContent==="사본 저장"));
    verify("빠른 검색 클립보드 작업 버튼과 상태가 창 안에 표시",document.querySelector('.clipboard-actions').getBoundingClientRect().bottom<=innerHeight&&document.querySelector('.clipboard-history>p[role="status"]').getBoundingClientRect().bottom<=innerHeight);
    document.querySelector('[aria-label="클립보드 이력 검색"]').dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));
    await until(()=>document.querySelector("#quick-clipboard-trigger"),"Esc로 파일 검색 복귀");
    verify("클립보드 화면 Esc는 파일 검색으로 복귀",true);
    // 절대 경로·연결 폴더 이름으로 시작하는 경로를 입력하면 그 위치를 경로 일치 항목으로 맨 위에 보여 준다.
    const base=roots[0].absolutePath.replace(/^\\\\\?\\(UNC\\)?/,(_,unc)=>unc?"\\\\":""),separator=/^[a-z]:\\|^\\\\/i.test(base)?"\\":"/";
    search(base+separator+"대상"+separator);
    await until(()=>document.querySelector("#quick-result-0 .path-match"),"절대 경로 위치 일치");
    verify("빠른 검색에 연결 폴더 안의 절대 경로를 입력하면 그 폴더를 맨 위에 경로 일치로 표시",document.querySelector("#quick-result-0 strong").textContent==="대상");
    verify("경로 일치 항목은 Enter가 위치로 이동",document.querySelector(".quick-footer").textContent.includes("위치로 이동"));
    search(roots[0].name+"/대상");
    await until(()=>document.querySelector("#quick-result-0 .path-match")&&document.querySelector("#quick-result-0 strong").textContent==="대상","연결 폴더 이름 경로 일치");
    verify("연결 폴더 이름으로 시작하는 일부 경로도 위치로 해석",true);
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

// 격리된 검증 앱에서 즐겨찾기를 준비하고 실제 검색창을 호출한다.
(async () => {
  if (window.__quickSmokeMain) return;
  window.__quickSmokeMain = true;
  const invoke = window.__TAURI_INTERNALS__.invoke;
  try {
    // 메인 화면의 마이그레이션과 이벤트 등록이 끝날 때까지 확인한다.
    for (
      let n = 0;
      n < 150 && !document.querySelector('[aria-label="빠른 파일 검색 열기"]');
      n++
    )
      await new Promise((resolve) => setTimeout(resolve, 100));
    const roots = await invoke("ed_request", { kind: "init", payload: {} });
    const preferences=await invoke("preferences_control",{next:null});
    // 사용자 동작: 셸 없이 실행되는지 확인하도록 파일 옆에 표시 파일을 만든다.
    const mac=/Mac/.test(navigator.platform);
    const userActions=[{name:"검증 동작",program:mac?"/usr/bin/touch":"C:\\Windows\\System32\\fsutil.exe",args:mac?["{dir}/ran-{name}.flag"]:["file","createnew","{dir}\\ran-{name}.flag","0"]}];
    await invoke("preferences_control",{next:{...preferences,clipboardKeyword:"cliptest",userActions,quickApps:true,quickCalculator:true}});
    const access = await invoke("ed_request", {
      kind: "quickAccess",
      payload: { action: "snapshot" },
    });
    if (!access.favorites.length)
      await invoke("ed_request", {
        kind: "quickAccess",
        payload: {
          action: "favorite",
          location: { rootId: roots[0].id, path: "업무 보고서.txt" },
        },
      });
    // 검색창에서 보낸 실제 위치가 메인 탐색창에 적용되는지 확인한다.
    const handler = window.__TAURI_INTERNALS__.transformCallback(async () => {
      for (let n = 0; n < 150; n++) {
        if (
          [...document.querySelectorAll(".breadcrumbs")].some((element) =>
            element.textContent.includes("대상"),
          )
        ) {
          const report = await invoke("ed_request", {
            kind: "smokeReport",
            payload: null,
          });
          const extra = window.__splitVerified ? ["빠른 검색 ‘나란히 열기’로 메인 탐색창이 둘로 나뉘고 옆 창에 위치 표시"] : [];
          await invoke("ed_request", {
            kind: "smokeReport",
            payload: {
              ...report,
              tests: [...(report.tests ?? []), ...extra, "메인 탐색창 위치 전환"],
              stage: window.__splitVerified ? "complete" : "split-failed",
            },
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await invoke("ed_request", {
        kind: "smokeReport",
        payload: { stage: "main-reveal-failed" },
      });
    });
    await invoke("plugin:event|listen", {
      event: "ed-quick-reveal",
      target: { kind: "Any" },
      handler,
    });
    // 나란히 열기: 탐색창이 둘 이상이 되고 새 탐색창에 문서 폴더가 열리는지 확인한다.
    const splitHandler = window.__TAURI_INTERNALS__.transformCallback(async () => {
      for (let n = 0; n < 100; n++) {
        const panes = [...document.querySelectorAll(".explorer-pane")];
        if (panes.length >= 2 && panes.some((pane) => pane.querySelector(".breadcrumbs")?.textContent.includes("문서"))) {
          window.__splitVerified = true;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    });
    await invoke("plugin:event|listen", { event: "ed-quick-reveal-split", target: { kind: "Any" }, handler: splitHandler });
    // The main WebView can finish before setup has constructed the quick window.
    let ready = false;
    for (let n=0;n<150;n++) {
      const status = await invoke("desktop_control", {action:"status"});
      if (status.tray) { ready=true; break; }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if (!ready) throw new Error("빠른 검색 네이티브 창 초기화 시간 초과");
    await invoke("quick_control", { action: "show" });
  } catch (error) {
    await invoke("ed_request", {
      kind: "smokeReport",
      payload: { stage: "main-failed", error: String(error) },
    });
  }
})();

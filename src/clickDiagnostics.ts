// 클릭 진단(진단용 빌드에서만 켬): 화면 왼쪽 아래에 포인터·클릭 이벤트, 메뉴 열림·닫힘, 창 크기·초점 변화,
// 자바스크립트 오류를 시간순으로 보여 주고 ‘기록 복사’로 클립보드에 담는다. Windows에서만 생기는 클릭 문제를 사용자 PC에서 확인한다.

// 요소를 짧은 글로 줄여 쓴다(태그·클래스·이름표).
function describe(target: EventTarget | null): string {
  const element = target as Element | null;
  if (!element || !(element instanceof Element)) return String(target);
  const label = element.getAttribute("aria-label") || element.getAttribute("title") || (element.textContent ?? "").trim().slice(0, 14);
  const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".") : "";
  return `${element.tagName.toLowerCase()}${classes ? "." + classes : ""}${label ? `[${label}]` : ""}`;
}

// 진단 창을 만들고 이벤트 기록을 시작한다.
export function startClickDiagnostics() {
  const lines: string[] = [];
  const started = performance.now();
  const panel = document.createElement("div");
  panel.setAttribute("style", "position:fixed;left:8px;bottom:8px;z-index:2147483647;width:520px;max-height:42vh;overflow:auto;background:rgba(20,20,20,.92);color:#e8e8e8;font:11px/1.45 Consolas,monospace;padding:6px 8px;border-radius:6px;pointer-events:auto");
  const header = document.createElement("div");
  header.setAttribute("style", "display:flex;gap:8px;align-items:center;margin-bottom:4px");
  header.innerHTML = "<strong style='flex:1'>클릭 진단 기록</strong>";
  const copy = document.createElement("button");
  copy.textContent = "기록 복사";
  const clear = document.createElement("button");
  clear.textContent = "지우기";
  header.append(copy, clear);
  const body = document.createElement("pre");
  body.setAttribute("style", "margin:0;white-space:pre-wrap;word-break:break-all");
  panel.append(header, body);
  // 한 줄을 기록하고 화면을 갱신한다(최근 300줄).
  const log = (text: string) => {
    lines.push(`${((performance.now() - started) / 1000).toFixed(2)}s ${text}`);
    if (lines.length > 300) lines.shift();
    body.textContent = lines.slice(-40).join("\n");
    panel.scrollTop = panel.scrollHeight;
  };
  copy.addEventListener("click", (event) => {
    event.stopPropagation();
    const text = `화면 ${innerWidth}x${innerHeight} 배율 ${devicePixelRatio} ${navigator.userAgent}\n${lines.join("\n")}`;
    void navigator.clipboard.writeText(text).then(() => log("(기록을 클립보드에 복사했습니다)")).catch((error) => log(`복사 실패: ${error}`));
  });
  clear.addEventListener("click", (event) => {
    event.stopPropagation();
    lines.length = 0;
    body.textContent = "";
  });
  document.body.append(panel);
  log(`시작: 화면 ${innerWidth}x${innerHeight}, 배율 ${devicePixelRatio}`);
  // 포인터·마우스·클릭: 받은 요소, 그 지점의 맨 위 요소, 처리 뒤 기본 동작 취소 여부
  for (const type of ["pointerdown", "pointerup", "click", "pointercancel", "lostpointercapture", "contextmenu"]) {
    window.addEventListener(type, (event) => {
      if (panel.contains(event.target as Node)) return;
      const pointer = event as PointerEvent;
      const top = "clientX" in event ? document.elementFromPoint(pointer.clientX, pointer.clientY) : null;
      const same = top === event.target || (top && (event.target as Element)?.contains?.(top));
      log(`${type} ${describe(event.target)}${same ? "" : ` | 맨 위: ${describe(top)}`}${"clientX" in event ? ` @${Math.round(pointer.clientX)},${Math.round(pointer.clientY)}` : ""}${event.isTrusted ? "" : " (합성)"}`);
    }, true);
    // 모든 처리가 끝난 뒤(버블 단계) 기본 동작이 취소됐는지 본다.
    window.addEventListener(type, (event) => {
      if (event.defaultPrevented && !panel.contains(event.target as Node)) log(`  └ ${type} 기본 동작 취소됨`);
    });
  }
  // 창 크기·초점·화면 숨김 변화
  window.addEventListener("resize", () => log(`resize ${innerWidth}x${innerHeight}`));
  window.addEventListener("blur", () => log("창 초점 잃음(blur)"));
  window.addEventListener("focus", () => log("창 초점 받음(focus)"));
  document.addEventListener("visibilitychange", () => log(`visibility ${document.visibilityState}`));
  // 자바스크립트 오류
  window.addEventListener("error", (event) => log(`오류: ${event.message} @${event.filename?.split("/").pop()}:${event.lineno}`));
  window.addEventListener("unhandledrejection", (event) => log(`처리 안 된 오류: ${String(event.reason).slice(0, 200)}`));
  // 메뉴 열림·닫힘(aria-expanded, hidden)과 명령 막대 모양(compact·dense) 변화
  new MutationObserver((records) => {
    for (const record of records) {
      const element = record.target as Element;
      if (panel.contains(element)) continue;
      if (record.attributeName === "aria-expanded" && element.classList.contains("flyout-trigger"))
        log(`메뉴 ${describe(element)} aria-expanded=${element.getAttribute("aria-expanded")}`);
      else if (record.attributeName === "hidden" && element.classList.contains("flyout-panel"))
        log(`메뉴 패널 ${element.getAttribute("aria-label")} ${element.hasAttribute("hidden") ? "숨김" : "보임"}`);
      else if (record.attributeName === "class" && element.classList.contains("file-action-bar"))
        log(`명령 막대 class=${element.className.trim()}`);
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-expanded", "hidden", "class"] });
}

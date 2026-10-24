// 실제 포인터 이벤트 → React 목적지 판정 → IPC → 디스크를 검증한다.
// 외부 드롭은 Tauri 이벤트 경계를 재현하며 Explorer의 물리 OLE 제스처는 별도 수동 확인 대상이다.
(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const report = {suite:"drag", tests:[], errors:[], passed:false};
  async function until(check, label) {
    const end = Date.now() + 10000;
    while (Date.now() < end) { const result = await check(); if (result) return result; await new Promise(r => setTimeout(r, 50)); }
    throw new Error(`시간 초과: ${label}`);
  }
  function verify(name, condition) { if (!condition) throw new Error(name); report.tests.push({name, passed:true}); }
  const pane = n => document.querySelector(`.explorer-pane[aria-label="탐색창 ${n}"]`);
  const row = (p, name) => [...p.querySelectorAll(".file-row")].find(x => x.title.endsWith(`\\${name}`));
  const point = el => { const r = el.getBoundingClientRect(); return {clientX:r.left+r.width/2, clientY:r.top+r.height/2}; };
  function pointer(source, destination, cancel = false) {
    const a = point(source), b = point(destination);
    source.dispatchEvent(new PointerEvent("pointerdown", {bubbles:true, button:0, pointerId:1, ...a}));
    window.dispatchEvent(new PointerEvent("pointermove", {bubbles:true, cancelable:true, buttons:1, pointerId:1, ...b}));
    if (cancel) window.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true}));
    else window.dispatchEvent(new PointerEvent("pointerup", {bubbles:true, cancelable:true, button:0, pointerId:1, ...b}));
  }
  async function confirm() {
    await until(() => document.querySelector("dialog[open]")?.textContent.includes("파일 가져오기"), "드롭 확인창");
    [...document.querySelectorAll("dialog[open] .modal-footer button")].find(x => x.textContent === "복사").click();
    await until(() => !document.querySelector("dialog[open]"), "복사 완료");
  }
  try {
    await until(() => pane(2)?.querySelector(".file-row"), "목록 초기화");
    const root = (await invoke("ed_request", {kind:"init",payload:{}}))[0];
    const list = path => invoke("ed_request", {kind:"list",payload:{rootId:root.id,path}});
    pointer(row(pane(1), "업무 보고서.txt"), row(pane(2), "대상"), true);
    await new Promise(r => setTimeout(r, 80));
    verify("Escape로 드래그 취소", !document.querySelector("dialog[open]") && !document.querySelector(".file-drag-ghost"));
    pointer(row(pane(1), "업무 보고서.txt"), row(pane(2), "대상"));
    await confirm();
    verify("포인터 드래그로 폴더 행에 복사", (await list("대상")).some(x => x.name === "업무 보고서.txt"));
    pointer(row(pane(1), "업무 보고서.txt"), row(pane(2), "대상"));
    await confirm();
    verify("드래그 중복 이름은 번호 사본 생성", (await list("대상")).some(x => x.name === "업무 보고서 (1).txt"));
    // 외부 OS 파일 경로를 Tauri가 전달하는 이벤트와 같은 대상으로 보낸다.
    const destination = row(pane(2), "문서");
    const p = point(destination);
    const paths = [root.absolutePath.replace(/[\\/][^\\/]+$/, "") + "\\외부 드롭.txt"];
    await invoke("plugin:event|emit_to", {target:{kind:"Webview",label:"main"},event:"tauri://drag-drop",payload:{paths,position:{x:p.clientX*devicePixelRatio,y:p.clientY*devicePixelRatio}}});
    await confirm();
    verify("외부 파일 드롭 → 네이티브 가져오기 → 폴더 목적지", (await list("문서")).some(x => x.name === "외부 드롭.txt"));
    // 실패한 외부 경로도 기존 파일에 영향을 주지 않는다.
    let rejected = false;
    try { await invoke("import_files",{paths:[paths[0]+".missing"],destination:{rootId:root.id,path:"문서"}}); } catch { rejected=true; }
    verify("없는 외부 경로 거부와 기존 결과 보존", rejected && (await list("문서")).some(x=>x.name==="외부 드롭.txt"));
    report.passed = true;
  } catch(e) { report.errors.push(String(e)); report.screen=document.body.innerText.slice(-2500); }
  report.finished=new Date().toISOString();
  await invoke("ed_request", {kind:"smokeReport",payload:report});
})();

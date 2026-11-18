// 창 크기가 실제로 바뀌었을 때만 callback을 부른다(떠 있는 메뉴를 닫을 때 쓴다).
// Windows WebView2는 창이 초점을 받거나 화면 배율(125%·150% 등)에 따라 크기가 그대로인데도 resize를 보내,
// 클릭으로 연 정렬·보기·도구 메뉴가 바로 닫혀 "아무 반응 없음"처럼 보였다.
export function onViewportResize(callback: () => void): () => void {
  let width = window.innerWidth;
  let height = window.innerHeight;
  // 반올림으로 생기는 1px 차이는 무시한다.
  const handler = () => {
    if (Math.abs(window.innerWidth - width) < 2 && Math.abs(window.innerHeight - height) < 2) return;
    width = window.innerWidth;
    height = window.innerHeight;
    callback();
  };
  window.addEventListener("resize", handler);
  return () => window.removeEventListener("resize", handler);
}

import { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import "./workbench.css";
import "./quick-search.css";

// 검색 전용 창에서는 메인 탐색기 코드를 불러오지 않는다.
const Screen = lazy(() =>
  window.location.hash === "#quick-search"
    ? import("./components/QuickSearch")
    : import("./App"),
);
const root = ReactDOM.createRoot(document.getElementById("root")!);
// 개발 중 진입점이 갱신되면 이전 React 트리를 정리한다.
import.meta.hot?.dispose(() => root.unmount());
root.render(
  <Suspense
    fallback={
      <div role="status" style={{ padding: 20 }}>
        준비 중…
      </div>
    }
  >
    <Screen />
  </Suspense>,
);

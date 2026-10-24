import { useState } from "react";
import { version } from "../../package.json";
import licenses from "../third-party-licenses.json";
import { isDesktop } from "../client";

// 개발자 등록 상태와 앱·오픈소스의 라이선스 정보를 설정 안에 표시한다.
export function AboutPanel() {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [notices, setNotices] = useState("");
  const items = licenses.filter((item) =>
    `${item.name} ${item.license}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="about-panel" aria-label="개발자 정보와 라이선스">
      <h3>개발자 정보 · 라이선스</h3>
      <p>
        <strong>Every Directory v{version}</strong> · 로컬 파일 검색과 탐색
      </p>
      {isDesktop && (
        <details
          onToggle={(event) => {
            if (event.currentTarget.open && !notices) {
              void import("@tauri-apps/api/core")
                .then(({ invoke }) =>
                  invoke<string>("ed_request", {
                    kind: "licenseNotices",
                    payload: {},
                  }),
                )
                .then(setNotices)
                .catch((cause) =>
                  setNotices(
                    `라이선스 전문을 읽지 못했습니다: ${String(cause)}`,
                  ),
                );
            }
          }}
        >
          <summary>오픈소스 라이선스 전문 보기</summary>
          <pre className="license-notices">
            {notices || "라이선스를 읽는 중…"}
          </pre>
        </details>
      )}
      <p>개발자명·연락처: 이 배포본에는 별도 등록되지 않았습니다.</p>
      <p>
        앱 라이선스: 미지정. 프로젝트에 앱 자체 이용 허락 문서가 등록되지
        않았습니다.
      </p>
      <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>오픈소스 구성요소 라이선스 {licenses.length}개</summary>
        {expanded && (
          <>
            <input
              aria-label="라이선스 구성요소 검색"
              placeholder="구성요소 또는 라이선스 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="license-list">
              {items.map((item) => (
                <p key={`${item.ecosystem}:${item.name}:${item.version}`}>
                  <strong>
                    {item.name} {item.version}
                  </strong>
                  <span>{item.license || "라이선스 정보 없음"}</span>
                </p>
              ))}
              {!items.length && <p>일치하는 구성요소가 없습니다.</p>}
            </div>
          </>
        )}
      </details>
    </section>
  );
}

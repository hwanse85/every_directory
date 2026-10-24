import { useState, type MouseEvent } from "react";
import { version } from "../../package.json";
import licenses from "../third-party-licenses.json";
import { isDesktop, openExternalLink } from "../client";
import { componentSource, project } from "../about";

// 앱 자체의 정보·이용조건과 제3자 구성요소의 고지를 구분한다.
export function AboutPanel() {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [notices, setNotices] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const items = licenses.filter((item) =>
    `${item.ecosystem} ${item.name} ${item.version} ${item.license}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  async function loadNotices() {
    if (loading || notices) return;
    setLoading(true);
    setError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      setNotices(
        await invoke<string>("ed_request", {
          kind: "licenseNotices",
          payload: {},
        }),
      );
    } catch (cause) {
      setError(`고지 전문을 읽지 못했습니다: ${String(cause)}`);
    } finally {
      setLoading(false);
    }
  }
  function link(event: MouseEvent<HTMLAnchorElement>, url: string) {
    if (!isDesktop) return;
    event.preventDefault();
    void openExternalLink(url).catch((cause) => setError(String(cause)));
  }
  return (
    <section className="about-panel" aria-label="개발자 정보와 라이선스">
      <section aria-label="앱 정보">
        <h3>앱 정보</h3>
        <p>
          <strong>{project.name}</strong> · 로컬 파일 검색과 탐색
        </p>
        <dl className="app-info">
          <dt>버전</dt>
          <dd data-testid="app-version">v{version}</dd>
          <dt>프로젝트 관리자</dt>
          <dd>{project.maintainer}</dd>
          <dt>프로젝트</dt>
          <dd>
            <a
              href={project.repository}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => link(e, project.repository)}
            >
              GitHub 저장소
            </a>
          </dd>
          <dt>문의·오류 제보</dt>
          <dd>
            <a
              href={project.issues}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => link(e, project.issues)}
            >
              GitHub Issues
            </a>
          </dd>
        </dl>
        <p>
          앱 자체 라이선스: 미지정. 아래 타사 라이선스가 이 앱 전체의 이용
          허락을 의미하지는 않습니다.
        </p>
      </section>
      <section aria-label="오픈소스와 타사 소프트웨어 고지">
        <h3>오픈소스·타사 소프트웨어 고지</h3>
        <p>
          사용한 구성요소의 라이선스와 저작권 고지입니다. 목록에는
          플랫폼별·빌드용 의존성도 포함됩니다.
        </p>
        <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary>
            오픈소스 구성요소 {licenses.length}개 · 라이선스와 원본 소스
          </summary>
          {expanded && (
            <>
              <input
                aria-label="라이선스 구성요소 검색"
                placeholder="구성요소·버전·라이선스 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <small role="status">{items.length}개 구성요소</small>
              <div className="license-list">
                {items.map((item) => (
                  <p key={`${item.ecosystem}:${item.name}:${item.version}`}>
                    <strong>
                      {item.name} {item.version}
                    </strong>
                    <span>{item.license || "라이선스 정보 없음"}</span>
                    <a
                      href={componentSource(item)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => link(e, componentSource(item))}
                    >
                      원본 소스
                    </a>
                  </p>
                ))}
                {!items.length && <p>일치하는 구성요소가 없습니다.</p>}
              </div>
            </>
          )}
        </details>
        {isDesktop && (
          <details
            onToggle={(event) => {
              if (event.currentTarget.open) void loadNotices();
            }}
          >
            <summary>
              라이선스·저작권 고지 전문 (THIRD_PARTY_NOTICES.txt)
            </summary>
            <p>
              Third-party notices는 타사 구성요소의 라이선스·저작권 고지 전문을
              모은 문서입니다.
            </p>
            <pre className="license-notices" aria-busy={loading}>
              {notices ||
                (loading
                  ? "고지를 읽는 중…"
                  : "고지 전문을 불러오지 못했습니다.")}
            </pre>
            {!loading && !notices && (
              <button
                className="button secondary"
                onClick={() => void loadNotices()}
              >
                다시 읽기
              </button>
            )}
          </details>
        )}
      </section>
      {error && (
        <p className="operation-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

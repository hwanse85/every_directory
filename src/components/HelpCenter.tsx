import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import helpHtml from "../help/help.html?raw";
import { Modal } from "./Modal";

// 도움말 문서의 절 목록. 문서의 <section id data-title>에서 읽는다.
const sections = [...helpHtml.matchAll(/<section id="([^"]+)" data-title="([^"]+)"/g)].map(([, id, title]) => ({ id, title }));

// 검색어 비교를 위해 한글 조합형·소문자로 맞춘다.
const plain = (text: string) => text.normalize("NFC").toLocaleLowerCase();

// 프로그램에 내장된 HTML 사용 설명서를 목차·찾기와 함께 보여 준다.
export function HelpCenter({ section, onClose }: { section?: string; onClose: () => void }) {
  const body = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(section ?? sections[0]?.id);
  // 찾기 결과: 검색어가 들어 있는 절만 남긴다.
  const matched = useMemo(() => {
    const word = plain(query.trim());
    if (!word || !body.current) return undefined;
    return new Set([...body.current.querySelectorAll<HTMLElement>("section[id]")].filter((node) => plain(node.textContent ?? "").includes(word)).map((node) => node.id));
  }, [query]);
  // 문서 안의 한 절로 이동하고 목차의 현재 위치를 바꾼다.
  function show(id: string, smooth = true) {
    const target = body.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
    setCurrent(target.closest("section")?.id ?? id);
  }
  useEffect(() => {
    // 대화상자가 열린 뒤에 해당 절로 옮긴다.
    if (!section) return;
    const frame = requestAnimationFrame(() => show(section, false));
    return () => cancelAnimationFrame(frame);
  }, [section]);
  useEffect(() => {
    const node = body.current;
    if (!node) return;
    node.querySelectorAll<HTMLElement>("section[id]").forEach((item) => { item.hidden = !!matched && !matched.has(item.id); });
    // 스크롤 위치에 맞춰 목차의 현재 절을 표시한다.
    const observer = new IntersectionObserver((records) => {
      const visible = records.filter((record) => record.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setCurrent(visible.target.id);
    }, { root: node, rootMargin: "0px 0px -70% 0px" });
    node.querySelectorAll("section[id]").forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [matched]);
  return (
    <Modal title="Every Directory 도움말" subtitle="검색·탐색·파일 작업 사용 설명서" onClose={onClose} wide className="help-center">
      <div className="help-layout">
        <nav className="help-toc" aria-label="도움말 목차">
          <label className="help-find">
            <Search size={14} aria-hidden="true" />
            <input type="search" aria-label="도움말에서 찾기" placeholder="도움말에서 찾기" value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && matched?.size) { event.preventDefault(); show([...matched][0]); } }} />
          </label>
          <ol>
            {sections.map((item) => (
              <li key={item.id} hidden={!!matched && !matched.has(item.id)}>
                <a href={`#${item.id}`} aria-current={current === item.id ? "true" : undefined}
                  onClick={(event) => { event.preventDefault(); show(item.id); }}>{item.title}</a>
              </li>
            ))}
          </ol>
          {matched && <p className="help-find-status" role="status">{matched.size ? `${matched.size}개 절에서 찾음` : "찾는 내용이 없습니다."}</p>}
        </nav>
        <div ref={body} className="help-document" tabIndex={0}
          onClick={(event) => {
            // 문서 안 링크는 앱 주소를 바꾸지 않고 해당 절로 스크롤한다.
            const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
            if (!link) return;
            event.preventDefault();
            show(link.getAttribute("href")!.slice(1));
          }}
          dangerouslySetInnerHTML={{ __html: helpHtml }} />
      </div>
    </Modal>
  );
}

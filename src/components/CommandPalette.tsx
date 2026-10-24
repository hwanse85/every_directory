import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowUpRight, Search } from "lucide-react";
import { Modal } from "./Modal";
import { isComposingKey } from "../quickSearch";
import { filenameFilter } from "../search";

export interface QuickCommand {
  id: string;
  title: string;
  detail: string;
  keywords?: string;
  run: () => void;
}

// 명령 이름과 키워드를 검색하고 키보드로 실행한다.
export function CommandPalette({
  commands,
  onClose,
}: {
  commands: QuickCommand[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const composing = useRef(false);
  const matches = filenameFilter(query);
  const filtered = commands.filter((command) =>
    matches(`${command.title} ${command.detail} ${command.keywords ?? ""}`),
  );
  const index = Math.min(cursor, Math.max(0, filtered.length - 1));

  // 명령 창을 닫은 뒤 선택한 작업을 실행한다.
  function execute(command: QuickCommand): void {
    // 대화상자의 정리와 초점 복원을 끝낸 뒤 명령의 대상과 초점을 변경한다.
    flushSync(onClose);
    command.run();
  }

  return (
    <Modal
      title="빠른 명령"
      subtitle="명령을 검색하고 Enter로 실행하세요. Ctrl/⌘ + Shift + P"
      onClose={onClose}
    >
      <div className="modal-content command-palette">
        <div className="command-search">
          <Search size={18} />
          <input
            autoFocus
            aria-label="빠른 명령 검색"
            role="combobox"
            aria-expanded="true"
            aria-controls="quick-command-list"
            aria-activedescendant={
              filtered[index] ? `command-${filtered[index].id}` : undefined
            }
            placeholder="이름 변경, 이미지 크기, 탐색창…"
            value={query}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (isComposingKey(event.nativeEvent, composing.current)) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const next =
                  (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    filtered.length) %
                  Math.max(1, filtered.length);
                setCursor(next);
                document
                  .getElementById(`command-${filtered[next]?.id}`)
                  ?.scrollIntoView({ block: "nearest" });
              } else if (event.key === "Enter" && filtered[index]) {
                event.preventDefault();
                execute(filtered[index]);
              }
            }}
          />
        </div>
        <div
          id="quick-command-list"
          className="command-list"
          role="listbox"
          aria-label="빠른 명령 목록"
        >
          {filtered.map((command, position) => (
            <button
              id={`command-${command.id}`}
              key={command.id}
              role="option"
              aria-selected={position === index}
              onClick={() => execute(command)}
            >
              <span>
                <strong>{command.title}</strong>
                <small>{command.detail}</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
          {!filtered.length && <p>일치하는 명령이 없습니다.</p>}
        </div>
        <p className="modal-footnote">↑ ↓ 이동 · Enter 실행 · Esc 닫기</p>
      </div>
    </Modal>
  );
}

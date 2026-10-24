import type { SearchMode } from "./types";

// 한글 초성 및 와일드카드 입력을 기존 검색 방식으로 연결한다.
export function quickSearchMode(
  query: string,
  defaultMode: SearchMode = "initials",
): SearchMode {
  if (defaultMode !== "normal") return defaultMode;
  if (/[ㄱ-ㅎ]/.test(query) && !/[가-힣]/.test(query)) return "initials";
  return /[*?]/.test(query) ? "wildcard" : "normal";
}

// Windows IME가 합친 자음 겹받침을 개별 초성으로 표시하고 완성형 단어는 보존한다.
export function normalizeSearchInput(value: string, mode: SearchMode): string {
  if (mode !== "initials") return value;
  const combined: Record<string, string> = {
    ㄳ: "ㄱㅅ",
    ㄵ: "ㄴㅈ",
    ㄶ: "ㄴㅎ",
    ㄺ: "ㄹㄱ",
    ㄻ: "ㄹㅁ",
    ㄼ: "ㄹㅂ",
    ㄽ: "ㄹㅅ",
    ㄾ: "ㄹㅌ",
    ㄿ: "ㄹㅍ",
    ㅀ: "ㄹㅎ",
    ㅄ: "ㅂㅅ",
  };
  return value.replace(
    /[ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ]/g,
    (letter) => combined[letter],
  );
}

// 한글 조합 중의 Enter와 탐색 키가 파일 작업으로 이어지지 않도록 한다.
export function isComposingKey(
  event: { isComposing?: boolean; keyCode?: number },
  composing: boolean,
): boolean {
  return composing || event.isComposing === true || event.keyCode === 229;
}

// 플랫폼에 맞는 읽기 쉬운 수정 키 이름을 표시한다.
export function shortcutLabel(shortcut: string, mac: boolean): string {
  return shortcut
    .replace(/CommandOrControl|CmdOrCtrl/gi, mac ? "⌘" : "Ctrl")
    .replace(/Command|Meta|Super/gi, mac ? "⌘" : "Win")
    .replace(/Control/gi, "Ctrl")
    .replace(/Shift/gi, mac ? "⇧" : "Shift")
    .replace(/Alt/gi, mac ? "⌥" : "Alt");
}

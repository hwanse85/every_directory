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
  const leading = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  const trailing = "ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";
  // 완성된 NFD 음절은 먼저 재조합하고 남은 독립 자모·반각 자모만 통일한다.
  value = Array.from(value.normalize("NFC"), (original) => {
    const char = /[\uFFA1-\uFFBE]/.test(original)
      ? original.normalize("NFKC")
      : original;
    const code = char.codePointAt(0)!;
    if (code >= 0x1100 && code <= 0x1112) return leading[code - 0x1100];
    if (code >= 0x11a8 && code <= 0x11c2) return trailing[code - 0x11a8];
    if (char === "ᄚ") return "ㅀ";
    if (char === "ᄡ") return "ㅄ";
    return char;
  }).join("");
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

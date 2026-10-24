import type { SearchMode } from "./types";

// 겹받침이 생긴 순간에만 IME 조합을 끝낸다. 일반 한글 음절·된소리 조합은 유지한다.
// 활성 조합 문자열을 직접 덮어쓰면 다음 키가 이전 자음에 다시 합쳐지므로 먼저 blur한다.
export function searchInputValue(
  input: HTMLInputElement,
  mode: SearchMode,
  composing: { current: boolean },
): string {
  const raw = input.value;
  const normalized = normalizeSearchInput(raw, mode);
  if (composing.current && mode === "initials" && /[ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄᆪᆬᆭᆰ-ᆶᆹ]/.test(raw)) {
    const caret = normalizeSearchInput(raw.slice(0, input.selectionEnd ?? raw.length), mode).length;
    const focused = document.activeElement === input;
    if (focused) input.blur();
    composing.current = false;
    if (focused) {
      // 같은 이벤트 안에서 다시 초점을 주면 WebView2가 이전 조합 범위를 재사용한다.
      // 한 프레임 동안 조합 종료를 처리한 뒤 새 입력 문맥으로 돌아온다.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body || document.activeElement === input)
          input.focus({ preventScroll: true });
        if (document.activeElement === input && input.value === normalized)
          input.setSelectionRange(caret, caret);
      });
    }
    return normalized;
  }
  return composing.current ? raw : normalized;
}

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

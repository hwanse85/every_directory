import type { ConnectedRoot, Location, SearchMode } from "./types";
import { addressLocation, displayPath, isWindowsPath } from "./paths";

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

// 경로 구분자·드라이브 문자·UNC로 시작하는 입력은 위치 이동용 경로로 본다.
export function isPathQuery(query: string): boolean {
  const value = query.trim().replace(/^"(.*)"$/, "$1");
  return /[\\/]/.test(value) || /^[a-z]:$/i.test(value);
}

// 경로 입력을 연결 폴더 안의 후보 위치로 바꾼다. 절대 경로·연결 폴더 이름으로 시작하는 경로·상대 경로 순으로 시도한다.
export function pathCandidates(query: string, roots: ConnectedRoot[], scope = ""): Location[] {
  let value = query.trim().replace(/^"(.*)"$/, "$1");
  // 드라이브 루트(C:\)를 제외하고 끝의 구분자는 떼어 폴더 이름과 맞춘다.
  if (!/^[a-z]:[\\/]?$/i.test(value)) value = value.replace(/[\\/]+$/, "");
  if (/^[a-z]:$/i.test(value)) value += "\\";
  if (!value || !roots.length) return [];
  const normalized = displayPath(value).replaceAll("\\", "/");
  const absolute = isWindowsPath(normalized) || normalized.startsWith("/") || /^[a-z]:/i.test(normalized);
  const candidates: Location[] = [];
  const add = (location?: Location) => {
    if (location && !candidates.some((item) => item.rootId === location.rootId && item.path === location.path)) candidates.push(location);
  };
  if (absolute) {
    try {
      add(addressLocation(value, roots, scope || roots[0].id));
    } catch {
      // 연결 폴더 밖의 절대 경로는 이동할 수 없다.
    }
    return candidates;
  }
  const parts = normalized.split("/").filter(Boolean);
  const same = (a: string, b: string, root: ConnectedRoot) => (isWindowsPath(root.absolutePath ?? "") ? a.toLowerCase() === b.toLowerCase() : a === b);
  for (const root of roots) {
    if (scope && root.id !== scope) continue;
    if (parts.length && same(parts[0], root.name, root)) add({ rootId: root.id, path: parts.slice(1).join("/") });
  }
  for (const root of roots) {
    if (scope && root.id !== scope) continue;
    add({ rootId: root.id, path: parts.join("/") });
  }
  return candidates;
}

// 경로 입력에서 연결 폴더 이름·절대 경로 앞부분을 떼고 색인 경로 검색어로 만든다.
export function pathSearchText(query: string, roots: ConnectedRoot[], scope = ""): string {
  const [first] = pathCandidates(query, roots, scope);
  const text = first ? first.path : query.trim().replace(/^"(.*)"$/, "$1").replaceAll("\\", "/");
  return text.replace(/^[a-z]:/i, "").replace(/^\/+|\/+$/g, "");
}

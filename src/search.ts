import { RE2JS } from "re2js";
import { normalizeSearchInput } from "./quickSearch";
import type {
  FileCategory,
  FileEntry,
  SearchOptions,
  SearchResult,
} from "./types";

export const fileCollator = new Intl.Collator("ko", { numeric: true });

const extensions: Record<Exclude<FileCategory, "all" | "folder">, string[]> = {
  document: [
    "pdf",
    "doc",
    "docx",
    "hwp",
    "hwpx",
    "txt",
    "md",
    "xlsx",
    "xls",
    "ppt",
    "pptx",
    "csv",
  ],
  image: [
    "png",
    "jpg",
    "jpeg",
    "gif",
    "svg",
    "webp",
    "avif",
    "heic",
    "fig",
    "psd",
    "ai",
  ],
  code: [
    "js",
    "jsx",
    "ts",
    "tsx",
    "py",
    "json",
    "html",
    "css",
    "scss",
    "go",
    "rs",
    "java",
    "yml",
    "yaml",
    "sh",
  ],
  audio: ["mp3", "wav", "flac", "m4a", "ogg", "mp4", "mov", "webm"],
  archive: ["zip", "7z", "rar", "tar", "gz"],
};

// 한글 조합과 대소문자 차이를 정규화한다.
export function normalize(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase();
}

// 파일 확장자와 폴더 여부로 표시 유형을 구한다.
export function categoryOf(entry: FileEntry): FileCategory {
  if (entry.kind === "directory") return "folder";
  return (
    (Object.keys(extensions) as (keyof typeof extensions)[]).find((key) =>
      extensions[key].includes(entry.extension),
    ) ?? "all"
  );
}

// 문자열을 중복 없는 3글자 검색 키로 분해한다.
function trigrams(value: string): string[] {
  const keys = new Set<string>();
  for (let i = 0; i <= value.length - 3; i++) keys.add(value.slice(i, i + 3));
  return [...keys];
}

const initials = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

// 공백을 제외하고 한글 음절을 초성으로 바꿔 띄어쓰기 차이를 무시한다.
export function choseong(value: string): string {
  return Array.from(normalize(value).replace(/\s/gu, ""), (char) => {
    const offset = char.charCodeAt(0) - 0xac00;
    return offset >= 0 && offset <= 11171
      ? initials[Math.floor(offset / 588)]
      : char;
  }).join("");
}

// 리터럴 문자를 정규식 메타문자로 해석하지 않도록 보호한다.
function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 입력한 초성만 한글 음절 범위로 펼쳐 일반 검색과 함께 적용한다.
function initialPattern(value: string): RE2JS | undefined {
  const text = normalizeSearchInput(value, "initials");
  const hasInitial = Array.from(text).some((letter) =>
    initials.includes(letter),
  );
  const wildcard = /[*?]/.test(text);
  const ignoreSpaces = hasInitial || /[가-힣]/.test(text);
  if (!ignoreSpaces && !wildcard) return undefined;
  const parts = Array.from(
    ignoreSpaces ? text.replace(/\s/gu, "") : text,
    (letter) => {
      const index = initials.indexOf(letter);
      if (index >= 0) {
        const start = 0xac00 + index * 588;
        return `[${letter}${String.fromCharCode(start)}-${String.fromCharCode(start + 587)}]`;
      }
      return letter === "*"
        ? ".*"
        : letter === "?"
          ? "."
          : escapePattern(letter);
    },
  );
  const pattern = parts.join(ignoreSpaces ? "[\\s\\p{Z}]*" : "");
  return RE2JS.compile(
    wildcard ? `^${pattern}$` : pattern,
    RE2JS.CASE_INSENSITIVE | RE2JS.DOTALL,
  );
}

// 폴더 필터도 메인 검색과 같은 초성·혼합 검색 규칙을 사용한다.
export function filenameFilter(query: string): (name: string) => boolean {
  const words = normalizeSearchInput(normalize(query), "initials")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const patterns = words.map(initialPattern);
  return (name) => {
    const value = normalize(name);
    return words.every(
      (word, index) => patterns[index]?.test(value) ?? value.includes(word),
    );
  };
}

function initialGrams(value: string): string[] {
  const chars = Array.from(value);
  const keys = new Set<string>();
  for (const width of [2, 3])
    for (let index = 0; index <= chars.length - width; index++)
      keys.add(chars.slice(index, index + width).join(""));
  return [...keys].filter((key) => /[ㄱ-ㅎ]/.test(key));
}

// 길이 차이와 편집 거리로 오타와 인접 글자 바뀜의 유사도를 계산한다.
function editDistance(left: string, right: string, maximum: number): number {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  let before = previous;
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    let minimum = i;
    for (let j = 1; j <= right.length; j++) {
      let value = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + Number(left[i - 1] !== right[j - 1]),
      );
      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      )
        value = Math.min(value, before[j - 2] + 1);
      current[j] = value;
      minimum = Math.min(minimum, value);
    }
    if (minimum > maximum) return maximum + 1;
    before = previous;
    previous = current;
  }
  return previous[right.length];
}

// 정확한 부분 일치를 우선하고 단어 단위의 제한된 오타를 허용한다.
function fuzzyScore(word: string, value: string): number {
  if (value.includes(word)) return 0;
  if (word.length < 3 || word.length > 64) return Infinity;
  const maximum = word.length >= 6 ? 2 : 1;
  let best = maximum + 1;
  for (const part of value.split(/[\s._/\\()\[\]{}-]+/u)) {
    best = Math.min(best, editDistance(word, part, maximum));
    if (best === 1) break;
  }
  return best <= maximum ? best : Infinity;
}

// 파일명 역색인과 폴더별 목록을 메모리에서 관리한다.
export class FileIndex {
  entries: FileEntry[] = [];
  private names: string[] = [];
  private paths: string[] = [];
  private grams = new Map<string, number[]>();
  private initialGrams = new Map<string, number[]>();
  private children = new Map<string, FileEntry[]>();

  // 완료된 스냅샷으로 검색 키와 탐색 목록을 교체한다.
  replace(entries: FileEntry[]): void {
    this.entries = entries;
    this.names = entries.map((entry) => normalize(entry.name));
    this.paths = entries.map((entry) => normalize(entry.path));
    this.grams.clear();
    this.initialGrams.clear();
    this.children.clear();
    entries.forEach((entry, i) => {
      for (const gram of initialGrams(choseong(entry.path))) {
        const list = this.initialGrams.get(gram);
        if (list) list.push(i);
        else this.initialGrams.set(gram, [i]);
      }
      for (const gram of trigrams(this.names[i])) {
        const list = this.grams.get(gram);
        if (list) list.push(i);
        else this.grams.set(gram, [i]);
      }
      const key = `${entry.rootId}\0${entry.parent}`;
      const siblings = this.children.get(key);
      if (siblings) siblings.push(entry);
      else this.children.set(key, [entry]);
    });
  }

  // 검색 방식을 적용하고 시간 한도를 넘기면 부분 결과임을 명시한다.
  search(options: SearchOptions): SearchResult {
    const started = performance.now();
    const mode = options.mode ?? "initials";
    if (options.query.length > 512)
      throw new Error("검색어는 512자까지 입력할 수 있습니다.");
    const sensitive = options.caseSensitive && mode !== "initials";
    const query = options.query.normalize("NFC");
    const rawTokens = query.match(/"[^"]*"|\S+/g) ?? [];
    const exts =
      mode === "regex"
        ? []
        : rawTokens
            .filter((t) => /^ext:/i.test(t))
            .flatMap((t) => normalize(t.slice(4)).split(/[;,]/))
            .map((t) => t.replace(/^\./, ""));
    const words =
      mode === "regex"
        ? [query]
        : rawTokens
            .filter((t) => !/^ext:/i.test(t))
            .map((t) => t.replace(/^"|"$/g, ""))
            .map((t) =>
              sensitive ? t : normalizeSearchInput(normalize(t), mode),
            );
    let regex: RE2JS | undefined;
    let wildcards: RE2JS[] = [];
    const initialPatterns =
      mode === "initials" ? words.map(initialPattern) : [];
    try {
      if (mode === "regex")
        regex = RE2JS.compile(query, sensitive ? 0 : RE2JS.CASE_INSENSITIVE);
      if (mode === "wildcard")
        wildcards = words.map((word) =>
          RE2JS.compile(
            "^" +
              word
                .split("*")
                .map((part) => part.split("?").map(escapePattern).join("."))
                .join(".*") +
              "$",
            (sensitive ? 0 : RE2JS.CASE_INSENSITIVE) | RE2JS.DOTALL,
          ),
        );
    } catch (cause) {
      throw new Error(
        `정규식 오류: ${cause instanceof Error ? cause.message : String(cause)}. RE2 문법을 사용하며 전후방 탐색과 역참조는 지원하지 않습니다.`,
      );
    }
    let candidates: number[] | undefined;
    if (mode === "initials") {
      for (const word of words)
        for (const literal of word.split(/[*?]/)) {
          const korean = /[ㄱ-ㅎ가-힣]/.test(literal);
          const keys = korean
            ? initialGrams(choseong(literal))
            : !options.fullPath
              ? trigrams(literal)
              : [];
          for (const gram of keys) {
            const list =
              (korean ? this.initialGrams : this.grams).get(gram) ?? [];
            if (!candidates || list.length < candidates.length)
              candidates = list;
          }
        }
    }
    if (!options.fullPath && (mode === "normal" || mode === "wildcard")) {
      const literals =
        mode === "normal" ? words : words.flatMap((word) => word.split(/[*?]/));
      for (const word of literals) {
        for (const gram of trigrams(normalize(word))) {
          const list = this.grams.get(gram) ?? [];
          if (!candidates || list.length < candidates.length) candidates = list;
        }
      }
    }
    const matches: { entry: FileEntry; score: number; order: number }[] = [];
    let total = 0;
    let scanned = 0;
    let partial = false;
    const count = candidates?.length ?? this.entries.length;
    const limit = Math.max(1, Math.min(1000, options.limit ?? 500));
    for (let n = 0; n < count; n++) {
      if (n % 128 === 0 && performance.now() - started > 650) {
        partial = true;
        break;
      }
      scanned++;
      const i = candidates ? candidates[n] : n;
      const entry = this.entries[i];
      if (options.rootId && entry.rootId !== options.rootId) continue;
      if (options.category !== "all" && categoryOf(entry) !== options.category)
        continue;
      if (
        exts.length &&
        (entry.kind !== "file" || !exts.includes(entry.extension))
      )
        continue;
      const value =
        sensitive || mode === "regex"
          ? (options.fullPath ? entry.path : entry.name).normalize("NFC")
          : options.fullPath
            ? this.paths[i]
            : this.names[i];
      let score = 0;
      const matched =
        mode === "regex"
          ? regex!.test(value)
          : mode === "wildcard"
            ? wildcards.every((pattern) => pattern.test(value))
            : mode === "fuzzy"
              ? words.every((word) => {
                  const next = fuzzyScore(word, value);
                  score += next;
                  return Number.isFinite(next);
                })
              : words.every(
                  (word, index) =>
                    initialPatterns[index]?.test(value) ?? value.includes(word),
                );
      if (!matched) continue;
      total++;
      if (mode === "fuzzy" || matches.length < limit)
        matches.push({ entry, score, order: i });
    }
    if (mode === "fuzzy")
      matches.sort((a, b) => a.score - b.score || a.order - b.order);
    return {
      entries: matches.slice(0, limit).map((match) => match.entry),
      total,
      elapsed: performance.now() - started,
      partial,
      scanned,
    };
  }

  // 지정한 폴더의 바로 아래 항목만 정렬해 반환한다.
  list(rootId: string, path: string): FileEntry[] {
    return [...(this.children.get(`${rootId}\0${path}`) ?? [])].sort(
      (a, b) =>
        Number(b.kind === "directory") - Number(a.kind === "directory") ||
        fileCollator.compare(a.name, b.name),
    );
  }
}

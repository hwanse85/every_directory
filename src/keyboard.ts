// 한/영 자판을 잘못 두고 친 검색어를 두벌식 배열 기준으로 바꾼다(데스크톱 엔진 keyboard.rs와 같은 규칙).
// 예: "qhrhtj" → "보고서", "메ㅡ" → "apm"

const choseong = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const jungseong = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const jongseong = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ";
const keyJamo: Record<string, string> = {
  q: "ㅂ", w: "ㅈ", e: "ㄷ", r: "ㄱ", t: "ㅅ", y: "ㅛ", u: "ㅕ", i: "ㅑ", o: "ㅐ", p: "ㅔ",
  a: "ㅁ", s: "ㄴ", d: "ㅇ", f: "ㄹ", g: "ㅎ", h: "ㅗ", j: "ㅓ", k: "ㅏ", l: "ㅣ",
  z: "ㅋ", x: "ㅌ", c: "ㅊ", v: "ㅍ", b: "ㅠ", n: "ㅜ", m: "ㅡ",
  Q: "ㅃ", W: "ㅉ", E: "ㄸ", R: "ㄲ", T: "ㅆ", O: "ㅒ", P: "ㅖ",
};
const jamoKey = Object.fromEntries(Object.entries(keyJamo).map(([key, jamo]) => [jamo, key]));
// 두 자모가 합쳐진 모음·받침
const pairs: [string, string, string][] = [
  ["ㅗ", "ㅏ", "ㅘ"], ["ㅗ", "ㅐ", "ㅙ"], ["ㅗ", "ㅣ", "ㅚ"], ["ㅜ", "ㅓ", "ㅝ"], ["ㅜ", "ㅔ", "ㅞ"],
  ["ㅜ", "ㅣ", "ㅟ"], ["ㅡ", "ㅣ", "ㅢ"], ["ㄱ", "ㅅ", "ㄳ"], ["ㄴ", "ㅈ", "ㄵ"], ["ㄴ", "ㅎ", "ㄶ"],
  ["ㄹ", "ㄱ", "ㄺ"], ["ㄹ", "ㅁ", "ㄻ"], ["ㄹ", "ㅂ", "ㄼ"], ["ㄹ", "ㅅ", "ㄽ"], ["ㄹ", "ㅌ", "ㄾ"],
  ["ㄹ", "ㅍ", "ㄿ"], ["ㄹ", "ㅎ", "ㅀ"], ["ㅂ", "ㅅ", "ㅄ"],
];
const syllable = (c: string) => c >= "가" && c <= "힣";
const hangul = (c: string) => syllable(c) || (c >= "ㄱ" && c <= "ㅣ");

// 두 자모를 합친 모음·받침을 찾는다.
const join = (first: string, second: string) => pairs.find(([a, b]) => a === first && b === second)?.[2];
// 합쳐진 자모를 두 자모로 나눈다.
const split = (joined: string) => pairs.find(([, , c]) => c === joined);

// 자모 하나를 영문 키로 바꾼다. 합쳐진 자모는 두 키가 된다.
function keys(jamo: string): string {
  const parts = split(jamo);
  if (parts) return keys(parts[0]) + keys(parts[1]);
  return jamoKey[jamo] ?? jamo;
}

// 자모 나열을 한글 입력기처럼 음절로 조합한다.
function compose(text: string): string {
  let cho = "", jung = "", jong = "", out = "";
  // 입력 중인 음절을 글자로 내보낸다.
  const flush = () => {
    if (cho && jung)
      out += String.fromCharCode(0xac00 + (choseong.indexOf(cho) * 21 + jungseong.indexOf(jung)) * 28 + (jong ? jongseong.indexOf(jong) : 0));
    else out += cho + jung + jong;
    cho = jung = jong = "";
  };
  for (const c of text) {
    if (choseong.includes(c) || (c !== " " && jongseong.includes(c))) {
      const joined = jong ? join(jong, c) : undefined;
      if (cho && jung && !jong && jongseong.includes(c)) jong = c;
      else if (joined) jong = joined;
      else {
        flush();
        if (choseong.includes(c)) cho = c;
        else out += c;
      }
    } else if (jungseong.includes(c)) {
      const joined = jung && !jong ? join(jung, c) : undefined;
      if (cho && !jung) jung = c;
      else if (joined) jung = joined;
      else if (jong) {
        // 받침이 다음 음절의 첫소리로 넘어간다. 겹받침은 뒤 자음만 넘긴다.
        const parts = split(jong);
        const moved = parts ? parts[1] : jong;
        jong = parts ? parts[0] : "";
        flush();
        cho = moved;
        jung = c;
      } else {
        flush();
        jung = c;
      }
    } else {
      flush();
      out += c;
    }
  }
  flush();
  return out;
}

// 검색 연산자(ext:, size: 등)가 붙은 낱말은 바꾸지 않는다.
const eachWord = (text: string, convert: (word: string) => string) =>
  text.split(" ").map((word) => (word.includes(":") ? word : convert(word))).join(" ");

// 영문 자판으로 친 한글을 되살린다. 완성된 음절이 없거나 홀로 남은 모음이 있으면 오타가 아니라고 본다.
export function englishToHangul(text: string): string | undefined {
  if (!/[a-z]/i.test(text) || /[^\x00-\x7f]/.test(text)) return;
  const converted = eachWord(text, (word) => compose([...word].map((c) => keyJamo[c] ?? keyJamo[c.toLowerCase()] ?? c).join("")));
  if (![...converted].some(syllable) || [...converted].some((c) => jungseong.includes(c))) return;
  return converted;
}

// 한글 자판으로 친 영문을 되살린다. 바뀐 글자가 두 개 미만이면 쓰지 않는다.
export function hangulToEnglish(text: string): string | undefined {
  if (![...text].some(hangul)) return;
  const converted = eachWord(text, (word) =>
    [...word]
      .map((c) => {
        if (!syllable(c)) return keys(c);
        const code = c.charCodeAt(0) - 0xac00;
        return keys(choseong[Math.floor(code / 588)]) + keys(jungseong[Math.floor((code % 588) / 28)]) + (code % 28 ? keys(jongseong[code % 28]) : "");
      })
      .join(""),
  );
  if ((converted.match(/[a-z]/gi)?.length ?? 0) < 2 || [...converted].some(hangul)) return;
  return converted;
}

// 결과가 없을 때 다시 찾아볼 반대 자판 검색어를 고른다.
export function correctedQuery(text: string): string | undefined {
  const value = text.trim();
  if (!value || [...value].length > 128) return;
  const converted = hangulToEnglish(value) ?? englishToHangul(value);
  return converted !== value ? converted : undefined;
}

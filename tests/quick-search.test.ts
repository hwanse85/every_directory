import test from "node:test";
import assert from "node:assert/strict";
import {
  isComposingKey,
  quickSearchMode,
  shortcutLabel,
  normalizeSearchInput,
} from "../src/quickSearch";

// 업무 문서의 한글 초성과 와일드카드를 자동 구분한다.
test("quick search recognizes Korean initials and filename patterns", () => {
  assert.equal(quickSearchMode("ㅇㅁ ㅂㄱㅅ"), "initials");
  assert.equal(quickSearchMode("보고서"), "initials");
  assert.equal(quickSearchMode("*.pdf"), "initials");
  assert.equal(quickSearchMode("invoice-??.xlsx", "normal"), "wildcard");
});

// 조합 시작과 확정 직전의 브라우저별 입력 이벤트를 보호한다.
test("IME confirmation never triggers a file action", () => {
  assert.equal(isComposingKey({ isComposing: true }, false), true);
  assert.equal(isComposingKey({ keyCode: 229 }, false), true);
  assert.equal(isComposingKey({}, true), true);
  assert.equal(
    isComposingKey({ isComposing: false, keyCode: 13 }, false),
    false,
  );
});

// 같은 기본 설정을 운영체제에 맞는 키 이름으로 안내한다.
test("shortcut labels use macOS and Windows modifiers", () => {
  assert.equal(
    shortcutLabel("CommandOrControl+Shift+Space", true),
    "⌘+⇧+Space",
  );
  assert.equal(
    shortcutLabel("CommandOrControl+Shift+Space", false),
    "Ctrl+Shift+Space",
  );
});

// 연속 자음의 겹받침만 풀고 정상적인 한글·정규식 입력은 보존한다.
test("IME consonant clusters display as separate initials", () => {
  assert.equal(normalizeSearchInput("ㅂㄳ", "initials"), "ㅂㄱㅅ");
  assert.equal(normalizeSearchInput("ㄺㅄ ㄲㅆ", "initials"), "ㄹㄱㅂㅅ ㄲㅆ");
  assert.equal(
    normalizeSearchInput("업무 보고서 값", "initials"),
    "업무 보고서 값",
  );
  assert.equal(normalizeSearchInput("ㅂㄳ", "regex"), "ㅂㄳ");
});

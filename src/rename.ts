import { RE2JS } from "re2js";
import type { RenameRule } from "./types";

// 두 운영체제에서 사용할 수 있는 단일 파일명을 검증한다.
export function validateName(name: string): void {
  if (
    typeof name !== "string" ||
    !name ||
    name.length > 240 ||
    new TextEncoder().encode(name).length > 240 ||
    /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
    /[. ]$/.test(name) ||
    name === "." ||
    name === ".." ||
    /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name) ||
    name === ".every-directory-trash" ||
    name.startsWith(".ed-work-")
  )
    throw new Error("파일명에 사용할 수 없는 문자 또는 예약 이름이 있습니다.");
}

// 정규식 치환·접두사·접미사·번호로 일괄 이름 변경 결과를 계산한다.
export function renamePreview(
  entries: { name: string; kind: "file" | "directory" }[],
  rule: RenameRule,
): string[] {
  if (
    !rule ||
    typeof rule.find !== "string" ||
    typeof rule.replace !== "string" ||
    typeof rule.prefix !== "string" ||
    typeof rule.suffix !== "string" ||
    rule.find.length > 512 ||
    rule.replace.length > 240 ||
    !Number.isInteger(rule.start) ||
    rule.start < 0 ||
    rule.start > 1000000 ||
    !Number.isInteger(rule.padding) ||
    rule.padding < 1 ||
    rule.padding > 8
  )
    throw new Error("이름 변경 규칙이 올바르지 않습니다.");
  const pattern = rule.find
    ? RE2JS.compile(
        rule.regex
          ? rule.find
          : rule.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        rule.caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE,
      )
    : undefined;
  const names = entries.map((entry, index) => {
    const dot =
      entry.kind === "file" && rule.preserveExtension
        ? entry.name.lastIndexOf(".")
        : -1;
    const stem = dot > 0 ? entry.name.slice(0, dot) : entry.name;
    const extension = dot > 0 ? entry.name.slice(dot) : "";
    const replaced = pattern
      ? pattern
          .matcher(stem)
          .replaceAll(rule.regex ? rule.replace : () => rule.replace)
      : stem;
    const sequence = rule.number
      ? String(rule.start + index).padStart(rule.padding, "0")
      : "";
    const name = rule.prefix + replaced + rule.suffix + sequence + extension;
    validateName(name);
    return name;
  });
  if (
    new Set(names.map((name) => name.normalize("NFC").toLowerCase())).size !==
    names.length
  )
    throw new Error(
      "변경 후 이름이 중복됩니다. 번호 또는 다른 규칙을 지정해 주세요.",
    );
  return names;
}

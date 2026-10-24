import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "./client";
import type { ConnectedRoot, FileEntry } from "./types";
import { locationPath } from "./paths";

// CSV 셀의 따옴표를 이스케이프하고 수식으로 실행될 수 있는 값은 텍스트로 만든다.
function cell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

// 화면에 표시된 결과의 실제 경로와 메타데이터를 CSV로 만든다.
export function entriesCsv(
  entries: FileEntry[],
  roots: ConnectedRoot[],
): string {
  const rows: unknown[][] = [
    ["이름", "전체 경로", "종류", "확장자", "크기(바이트)", "수정일"],
  ];
  for (const entry of entries) {
    const root = roots.find((item) => item.id === entry.rootId);
    const path = locationPath(root, entry.path);
    rows.push([
      entry.name,
      path,
      entry.kind === "file" ? "파일" : "폴더",
      entry.extension,
      entry.size,
      entry.modified ? new Date(entry.modified).toISOString() : "",
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

// 데스크톱은 저장 대화상자, 브라우저는 다운로드로 결과를 저장한다.
export async function exportEntries(
  entries: FileEntry[],
  roots: ConnectedRoot[],
): Promise<boolean> {
  const content = entriesCsv(entries, roots);
  const filename = `검색 결과_${new Date().toISOString().slice(0, 10)}.csv`;
  if (isDesktop) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const destination = await save({
      title: "검색 결과 내보내기",
      defaultPath: filename,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!destination) return false;
    await invoke("ed_request", {
      kind: "saveExport",
      payload: { destination, content },
    });
  } else {
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}

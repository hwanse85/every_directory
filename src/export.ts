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

export type ExportFormat="csv"|"txt"|"tsv"|"html";
const exportHeadings=["이름","전체 경로","종류","확장자","크기(바이트)","수정일"];
function rows(entries:FileEntry[],roots:ConnectedRoot[]):unknown[][] {
  return entries.map(entry=>[entry.name,locationPath(roots.find(root=>root.id===entry.rootId),entry.path),entry.kind==="directory"?"폴더":"파일",entry.extension,entry.size??"",entry.modified?new Date(entry.modified).toISOString():""]);
}
export function entriesText(entries:FileEntry[],roots:ConnectedRoot[],tsv=false):string {
  const encode=(value:unknown)=>tsv?cell(value):String(value??"").replace(/[\t\r\n]/g," ");
  return '\uFEFF'+[exportHeadings,...rows(entries,roots)].map(row=>row.map(encode).join('\t')).join('\r\n')+'\r\n';
}
export function entriesHtml(entries:FileEntry[],roots:ConnectedRoot[]):string {
  const escape=(value:unknown)=>String(value??"").replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Every Directory 파일 목록</title><style>body{font:13px system-ui,sans-serif;padding:20px;color:#16283d}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd5df;padding:7px;text-align:left;overflow-wrap:anywhere}th{background:#eef3f8}thead{display:table-header-group}tr{break-inside:avoid}@media print{body{padding:0;font-size:10px}@page{size:landscape;margin:12mm}}</style></head><body><h1>파일 목록</h1><p>${entries.length.toLocaleString()}개 항목 · Every Directory</p><table><thead><tr>${exportHeadings.map(title=>`<th>${escape(title)}</th>`).join('')}</tr></thead><tbody>${rows(entries,roots).map(row=>`<tr>${row.map(value=>`<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}
export function entriesExport(entries:FileEntry[],roots:ConnectedRoot[],format:ExportFormat):string {
  return format==="csv"?entriesCsv(entries,roots):format==="html"?entriesHtml(entries,roots):entriesText(entries,roots,format==="tsv");
}

// 데스크톱은 저장 대화상자, 브라우저는 다운로드로 결과를 저장한다.
export async function exportEntries(
  entries: FileEntry[],
  roots: ConnectedRoot[],
  format:ExportFormat="csv",
): Promise<boolean> {
  const filename = `파일 목록_${new Date().toISOString().slice(0, 10)}.${format}`;
  if (isDesktop) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const destination = await save({
      title: `불러온 ${entries.length.toLocaleString()}개 항목 내보내기`,
      defaultPath: filename,
      filters: [{name:"Excel에서 여는 CSV",extensions:["csv"]},{name:"텍스트",extensions:["txt"]},{name:"인쇄용 HTML",extensions:["html"]},{name:"탭 구분 표",extensions:["tsv"]}],
    });
    if (!destination) return false;
    const extension=destination.split('.').at(-1)?.toLowerCase();
    if(!["csv","txt","tsv","html"].includes(extension??""))throw new Error("CSV·TXT·TSV·HTML 중 파일 형식을 선택해 주세요.");
    await invoke("ed_request", {
      kind: "saveExport",
      payload: { destination, content:entriesExport(entries,roots,extension as ExportFormat) },
    });
  } else {
    const url = URL.createObjectURL(
      new Blob([entriesExport(entries,roots,format)], { type: `${format==="html"?"text/html":format==="csv"?"text/csv":"text/plain"};charset=utf-8` }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return true;
}

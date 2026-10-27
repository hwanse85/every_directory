import test from "node:test";
import assert from "node:assert/strict";
import { entriesCsv, entriesHtml, entriesText, entriesExport } from "../src/export";
import type {FileEntry} from "../src/types";

// 한글·쉼표·따옴표와 스프레드시트 수식이 들어간 이름을 안전하게 내보낸다.
test("CSV export preserves paths and escapes formulas", () => {
  const csv = entriesCsv(
    [
      {
        id: "1",
        rootId: "root",
        name: '=sum(1,2)".txt',
        path: '문서/=sum(1,2)".txt',
        parent: "문서",
        kind: "file",
        extension: "txt",
        size: 7,
        modified: 1,
      },
      {
        id: "2",
        rootId: "root",
        name: "폴더",
        path: "폴더",
        parent: "",
        kind: "directory",
        extension: "",
      },
    ],
    [
      {
        id: "root",
        name: "자료",
        absolutePath: "C:\\자료",
        count: 2,
        lastIndexed: 0,
        skipped: 0,
      },
    ],
  );
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"\'=sum(1,2)"".txt"'));
  assert.ok(csv.includes('C:\\자료\\문서\\=sum(1,2)"".txt'));
  assert.ok(csv.includes('"7","1970-01-01T00:00:00.001Z"'));
  assert.equal(csv.split("\r\n").length, 4);
});

const hostile:FileEntry={id:"x",rootId:"r",name:'<img src=x onerror="alert(1)">\t=cmd\n.txt',path:"a.txt",parent:"",kind:"file",extension:"txt",size:4};
test("printable HTML escapes file names and prevents active content",()=>{
  const html=entriesHtml([hostile],[]);
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"));
  assert.ok(!html.includes("<img"));assert.ok(html.includes("default-src 'none'"));assert.ok(html.includes("@media print"));
  assert.equal((html.match(/<tr>/g)??[]).length,2);
});
test("TXT keeps one row per file and TSV neutralizes spreadsheet formulas",()=>{
  const txt=entriesText([hostile],[]);assert.equal(txt.split("\r\n").length,3);
  assert.equal(txt.split("\r\n")[1].split("\t").length,6);
  const formula={...hostile,name:"=1+1"};
  assert.ok(entriesText([formula],[],true).includes('"\'=1+1"'));
  assert.equal(entriesExport([formula],[],"html"),entriesHtml([formula],[]));
});

import test from "node:test";
import assert from "node:assert/strict";
import {explorerViews,normalizeExplorerView,groupedEntries,sortEntries} from "../src/explorerView";
import {normalizeExclusions,isIndexExcluded} from "../src/indexExclusions";
import {restorePaneState,createPane} from "../src/tabs";
import {treeWidth} from "../src/components/TreeWidthHandle";
import type {FileEntry} from "../src/types";
const entry=(name:string,size=1,extension="txt"):FileEntry=>({id:name,rootId:"r",path:name,parent:"",name,kind:"file",extension,size,modified:1});
test("all eight views and independent pane display preferences survive recovery",()=>{
  assert.equal(explorerViews.length,8);assert.equal(new Set(explorerViews.map(view=>view.id)).size,8);
  for(const view of explorerViews){const pane={...createPane({rootId:"r",path:""}),view:view.id,columns:["name","created","size"] as const,sort:{key:"created" as const,descending:true},group:"extension"};const saved=restorePaneState([pane],[])[0];assert.equal(saved.view,view.id);assert.equal(saved.sort?.key,"created");assert.equal(saved.group,"extension");assert.deepEqual(saved.columns,["name","size","created"]);}
  assert.equal(normalizeExplorerView("broken"),"list");
});
test("grouping preserves every file and stable selection indices",()=>{
  const entries=[entry("보고서2.txt"),entry("a.pdf",2048,"pdf"),entry("보고서1.txt")];
  const grouped=groupedEntries(entries,"extension");
  assert.deepEqual(grouped.entries.map(entry=>entry.name),["a.pdf","보고서2.txt","보고서1.txt"]);
  assert.deepEqual(grouped.rows.filter(row=>row.kind==="group").map(row=>[row.label,row.count]),[["PDF",1],["TXT",2]]);
  const positions=grouped.rows.filter(row=>row.kind==="entry");for(const row of positions)assert.equal(grouped.entries[row.index],row.entry);
  assert.equal(groupedEntries(entries,"none").entries,entries);
});
test("date grouping uses local calendar days and unknown metadata is explicit",()=>{
  const now=new Date(2026,9,26,11).getTime();
  const result=groupedEntries([{...entry("today"),created:new Date(2026,9,26,3).getTime()},{...entry("yesterday"),created:new Date(2026,9,25,23).getTime()},entry("unknown")],"created",[],now);
  assert.deepEqual(result.rows.filter(row=>row.kind==="group").map(row=>row.label),["오늘","어제","알 수 없음"]);
});
test("index exclusions normalize paths and use complete folder boundaries",()=>{
  assert.deepEqual(normalizeExclusions([" 자료\\개인/ ","자료/개인"]),["자료/개인"]);
  for(const value of [null,[""],["../private"],["C:\\private"],["/private"],["a//b"],["a/../b"],Array(129).fill("a")])assert.throws(()=>normalizeExclusions(value));
  assert.equal(isIndexExcluded(["자료"],"자료/한글.txt"),true);assert.equal(isIndexExcluded(["자료"],"자료함/한글.txt"),false);
  assert.equal(isIndexExcluded(["BACKUP"],"backup/a.txt",true),true);assert.equal(isIndexExcluded(["BACKUP"],"backup/a.txt"),false);
});
test("tree width rejects damaged preferences and keeps a useful range",()=>{
  for(const value of [null,"300",NaN,Infinity])assert.equal(treeWidth(value),165);
  assert.equal(treeWidth(700),600);assert.equal(treeWidth(2),80);assert.equal(treeWidth(257.6),258);
});

// 탐색창 정렬: 폴더 먼저, 숫자 → 영문 → 한글(검색 결과·Windows 탐색기와 같은 순서), 숫자는 자연 순서,
// 크기·날짜가 같으면 이름순으로 둔다.
test("explorer sort keeps folders first, Latin before Hangul, natural numbers and name ties", () => {
  const file = (name: string, size: number, modified = 1): FileEntry => ({ id: `r:${name}`, rootId: "r", path: name, parent: "", name, kind: "file", extension: name.split(".").pop() ?? "", size, modified });
  const folder = (name: string): FileEntry => ({ id: `r:${name}`, rootId: "r", path: name, parent: "", name, kind: "directory", extension: "", modified: 1 });
  const entries = [file("가나.txt", 5), file("c10.txt", 5), folder("폴더A"), file("B.txt", 1), file("c2.txt", 5), folder("Docs"), file("a.txt", 9), file("1.txt", 3)];
  const names = (list: FileEntry[]) => list.map((entry) => entry.name);
  assert.deepEqual(names(sortEntries(entries, [], "name")), ["Docs", "폴더A", "1.txt", "a.txt", "B.txt", "c2.txt", "c10.txt", "가나.txt"]);
  assert.deepEqual(names(sortEntries(entries, [], "name", true)), ["폴더A", "Docs", "가나.txt", "c10.txt", "c2.txt", "B.txt", "a.txt", "1.txt"]);
  // 크기가 같은 c2·c10·가나는 이름순(자연 순서)으로 둔다. 내림차순이어도 같은 크기끼리는 이름 오름차순이다.
  assert.deepEqual(names(sortEntries(entries, [], "size")), ["Docs", "폴더A", "B.txt", "1.txt", "c2.txt", "c10.txt", "가나.txt", "a.txt"]);
  assert.deepEqual(names(sortEntries(entries, [], "size", true)), ["Docs", "폴더A", "a.txt", "c2.txt", "c10.txt", "가나.txt", "1.txt", "B.txt"]);
});

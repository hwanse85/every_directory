import test from "node:test";
import assert from "node:assert/strict";
import {explorerViews,normalizeExplorerView,groupedEntries} from "../src/explorerView";
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

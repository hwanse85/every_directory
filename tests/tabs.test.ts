import test from "node:test";
import assert from "node:assert/strict";
import { createPane, createTab, tabColor, duplicateTab, closedTabSnapshot, moveTab, restoreClosedTabs, restorePaneState } from "../src/tabs";

test("the first tab and every new tab have no assigned color or shared history", () => {
  const location = { rootId: "root", path: "문서" };
  const pane = createPane(location);
  pane.tabs[0].color = "#6389c6";
  const next = createTab(pane.tabs[0].history[0]);
  assert.equal(next.color, undefined);
  assert.equal(tabColor(createPane(location).tabs[0].color), undefined);
  assert.notEqual(next.id, pane.tabs[0].id);
  location.path = "변경";
  assert.equal(next.history[0].path, "문서");
  assert.equal(pane.tabs[0].history[0].path, "문서");
  for (const value of [null, "", "red", "#123", "#6389c622", undefined])
    assert.equal(tabColor(value), undefined);
  assert.equal(tabColor("#6389c6"), "#6389c6");
});

test("duplicate tabs have independent history and start without color or pin",()=>{
  const original={...createTab({rootId:"r",path:"문서"}),title:"업무",color:"#123456",locked:true};
  original.history.push({rootId:"r",path:"문서/보고서"});original.cursor=1;
  const duplicate=duplicateTab(original),closed=closedTabSnapshot(original);
  assert.notEqual(duplicate.id,original.id);assert.equal(duplicate.title,"업무");
  assert.equal(duplicate.color,undefined);assert.equal(duplicate.locked,undefined);assert.equal(duplicate.cursor,1);
  assert.equal(closed.id,original.id);assert.equal(closed.color,original.color);assert.equal(closed.locked,false);
  original.history[1].path="변경";
  assert.equal(duplicate.history[1].path,"문서/보고서");assert.equal(closed.history[1].path,"문서/보고서");
});

test("tab reordering works before and after in both directions without mutating state",()=>{
  const tabs=["a","b","c","d"].map(id=>({...createTab({rootId:"r",path:id}),id}));
  assert.deepEqual(moveTab(tabs,"a","c",true).map(tab=>tab.id),["b","c","a","d"]);
  assert.deepEqual(moveTab(tabs,"d","b").map(tab=>tab.id),["a","d","b","c"]);
  assert.deepEqual(tabs.map(tab=>tab.id),["a","b","c","d"]);
  assert.equal(moveTab(tabs,"missing","a"),tabs);assert.equal(moveTab(tabs,"a","a"),tabs);
});

test("closed tab restoration rejects malformed history and bounds the list",()=>{
  const tab=createTab({rootId:"r",path:""});
  assert.deepEqual(restoreClosedTabs([null,{...tab,cursor:1},{...tab,cursor:0.5},{...tab,history:[null]}]),[]);
  const saved=restoreClosedTabs(Array.from({length:25},(_,n)=>({...tab,id:String(n),title:" x ",color:"red",locked:true})));
  assert.equal(saved.length,20);assert.equal(saved[0].id,"5");assert.equal(saved[0].title,"x");
  assert.equal(saved[0].color,undefined);assert.equal(saved[0].locked,false);assert.notEqual(saved[0].history,tab.history);
});

test("workspace recovery handles corrupt storage and sanitizes active tab and optional fields",()=>{
  const fallback=[createPane({rootId:"r",path:""})];
  for(const value of [null,[null],[{id:"pane",tabs:[null]}],[{...fallback[0],tabs:[{...fallback[0].tabs[0],cursor:0.2}]}],[fallback[0],fallback[0]]])assert.equal(restorePaneState(value,fallback),fallback);
  const saved=restorePaneState([{...fallback[0],activeTab:"missing",view:"invalid",tabs:[{...fallback[0].tabs[0],color:"red",title:3,locked:"yes"}]}],fallback);
  assert.equal(saved[0].activeTab,saved[0].tabs[0].id);assert.equal(saved[0].view,"list");
  assert.equal(saved[0].tabs[0].color,undefined);assert.equal(saved[0].tabs[0].title,undefined);assert.equal(saved[0].tabs[0].locked,false);
});

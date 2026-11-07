import test from "node:test";
import assert from "node:assert/strict";
import {onTreePath,restoreTreeExpansion,treeAncestors,treeIndent,treeKey} from "../src/treePaths";

test("tree follows only whole path segments inside the current root",()=>{
  assert.equal(onTreePath({rootId:"a",path:"문서"},{rootId:"a",path:"문서/2026/분기"}),true);
  assert.equal(onTreePath({rootId:"a",path:"문서"},{rootId:"a",path:"문서함"}),false);
  assert.equal(onTreePath({rootId:"b",path:""},{rootId:"a",path:"문서"}),false);
});
test("tree reveals every ancestor including the current folder",()=>{
  assert.deepEqual(treeAncestors({rootId:"a",path:"문서/2026"}),[treeKey({rootId:"a",path:""}),treeKey({rootId:"a",path:"문서"}),treeKey({rootId:"a",path:"문서/2026"})]);
  assert.deepEqual(treeAncestors({rootId:"",path:""}),[]);
});
test("tab expansion restores valid saved branches and always reveals its current path",()=>{
  const other=treeKey({rootId:"a",path:"보관"});
  const restored=restoreTreeExpansion([other,"invalid",null,'[1,2]'],{rootId:"a",path:"문서"});
  assert.deepEqual([...restored],[other,treeKey({rootId:"a",path:""}),treeKey({rootId:"a",path:"문서"})]);
  assert.notEqual(treeKey({rootId:"a:b",path:"c"}),treeKey({rootId:"a",path:"b:c"}));
});
test("tree indent narrows at deep levels and always leaves room for the name",()=>{
  assert.deepEqual([0,1,2,3,5,6,8].map(depth=>treeIndent(depth,400)),[0,12,24,32,48,52,60]);
  for(let depth=0;depth<30;depth++)assert.ok(treeIndent(depth,165)<=165-96);
  assert.equal(treeIndent(4,60),0);
  // Windows 스크롤 막대(12px)를 뺀 폭에서도 이름 자리(110px)를 남긴다.
  assert.ok(treeIndent(7,165-4-12)<=165-4-12-110);
});

import test from "node:test";
import assert from "node:assert/strict";
import {onTreePath,restoreTreeExpansion,treeAncestors,treeKey} from "../src/treePaths";

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

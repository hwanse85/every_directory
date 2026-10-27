import test from "node:test";
import assert from "node:assert/strict";
import { normalizeColumnWidths, resolveColumnWidths } from "../src/columnWidths";

test("saved column widths reject corrupt storage and clamp extreme sizes",()=>{
  assert.deepEqual(normalizeColumnWidths(null),{});
  assert.deepEqual(normalizeColumnWidths([]),{});
  assert.deepEqual(normalizeColumnWidths({name:-1,size:Infinity,location:9000,unknown:200}),{name:100,location:2000});
});
test("initial column widths fill the pane while user pixel widths remain stable",()=>{
  const columns=[{id:"name",label:"Name",width:170},{id:"size",label:"Size",width:85}] as const;
  assert.deepEqual(resolveColumnWidths(columns,{},500),[367,85]);
  assert.deepEqual(resolveColumnWidths(columns,{name:250,size:100},900),[250,100]);
  assert.deepEqual(resolveColumnWidths(columns,{name:250,size:100},200),[250,100]);
});
test("hidden column widths survive without affecting visible track positions",()=>{
  const columns=[{id:"name",label:"Name",width:170},{id:"location",label:"Location",width:150}] as const;
  assert.deepEqual(resolveColumnWidths(columns,{name:200,fullPath:1200},548),[200,300]);
});

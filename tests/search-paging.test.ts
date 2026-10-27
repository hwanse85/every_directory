import test from "node:test";
import assert from "node:assert/strict";
import {FileIndex} from "../src/search";
import type {FileEntry} from "../src/types";

const entries:FileEntry[]=Array.from({length:1205},(_,n)=>({id:`entry-${String(n).padStart(4,"0")}`,rootId:"root",path:`보고서 ${n}.txt`,parent:"",name:`보고서 ${n}.txt`,kind:"file",extension:"txt",size:n,modified:n+1}));
test("search pages expose matches beyond 1000 without overlap",()=>{
  const index=new FileIndex();index.replace(entries);
  const options={query:"ㅂㄱㅅ",mode:"initials" as const,category:"all" as const,rootId:"",fullPath:false,limit:1000};
  const first=index.search(options),second=index.search({...options,offset:1000});
  assert.equal(first.total,1205);assert.equal(second.entries.length,205);
  assert.equal(new Set([...first.entries,...second.entries].map(entry=>entry.id)).size,1205);
});
test("global size/date ordering applies before the page window",()=>{
  const index=new FileIndex();index.replace(entries);
  const options={query:"",category:"all" as const,rootId:"",fullPath:false,limit:3,sortBy:"size" as const,descending:true};
  assert.deepEqual(index.search(options).entries.map(entry=>entry.size),[1204,1203,1202]);
  assert.deepEqual(index.search({...options,offset:3}).entries.map(entry=>entry.size),[1201,1200,1199]);
  assert.equal(index.search({...options,sortBy:"modified"}).entries[0].modified,1205);
});
test("name sort is numeric and root sort uses visible names",()=>{
  const index=new FileIndex();index.replace([{...entries[10],rootId:"b"},{...entries[2],rootId:"a"}]);
  index.setRoots([{id:"a",name:"Zulu",absolutePath:"C:/z",count:1,lastIndexed:0,skipped:0},{id:"b",name:"Alpha",absolutePath:"D:/a",count:1,lastIndexed:0,skipped:0}]);
  const options={query:"",category:"all" as const,rootId:"",fullPath:false};
  assert.equal(index.search({...options,sortBy:"name"}).entries[0].name,"보고서 2.txt");
  assert.equal(index.search({...options,sortBy:"root"}).entries[0].rootId,"b");
});

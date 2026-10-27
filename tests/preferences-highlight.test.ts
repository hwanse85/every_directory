import test from "node:test";
import assert from "node:assert/strict";
import {highlightRanges} from "../src/highlight";
import {defaultPreferences,normalizePreferences,visibleFile} from "../src/preferences";
import type {FileEntry} from "../src/types";
test("initials and mixed words highlight every matching syllable and occurrence",()=>{
 assert.deepEqual(highlightRanges("업무 보고서 보고서.txt","ㅂㄱㅅ"),[[3,6],[7,10]]);
 assert.deepEqual(highlightRanges("쏠리마인드.txt","ㅆㄹㅁㅇㄷ"),[[0,5]]);
 assert.deepEqual(highlightRanges("보고서.txt","보고ㅅ"),[[0,3]]);
 assert.deepEqual(highlightRanges("보고 서.txt","ㅂㄱㅅ"),[[0,4]]);
 assert.deepEqual(highlightRanges("Report report.txt","report","normal"),[[0,6],[7,13]]);
 assert.deepEqual(highlightRanges("<img>.txt",'"<img>"',"normal"),[[0,5]]);
});
test("property and negative terms are scoped and malformed patterns do not break rendering",()=>{
 assert.deepEqual(highlightRanges("C:\\업무\\보고서","path:ㅂㄱㅅ","initials","path"),[[6,9]]);
 assert.deepEqual(highlightRanges("보고서.txt","path:ㅂㄱㅅ","initials","name"),[]);
 assert.deepEqual(highlightRanges("txt","ext:txt","initials","extension"),[[0,3]]);
 assert.deepEqual(highlightRanges("보고서.txt","!보고서"),[]);
 assert.deepEqual(highlightRanges("보고서.txt","[","regex"),[]);
 assert.deepEqual(highlightRanges("Report.txt","report","normal","name",true),[]);
});
test("default visibility excludes hidden temporary and recycle files without excluding every dollar name",()=>{
 const entry=(name:string,path=name,hidden=false):FileEntry=>({id:path,rootId:"r",name,path,parent:"",extension:"txt",kind:"file",hidden});
 for(const file of [entry("~$report.docx"),entry("cache.tmp"),entry("secret.txt","private/secret.txt",true),entry("old.txt","$RECYCLE.BIN/a/old.txt"),entry("secret.txt",".private/secret.txt")])assert.equal(visibleFile(file,defaultPreferences),false,file.path);
 assert.equal(visibleFile(entry("$budget.txt"),defaultPreferences),true);
 assert.equal(visibleFile(entry("Cargo.lock"),defaultPreferences),true);
 assert.equal(visibleFile(entry("~$report.docx"),{showHidden:true,showTemporary:true,showRecycleBin:true}),true);
 const prefs=normalizePreferences({clipboardDays:100,fontScale:1,clipboardKeyword:"invalid keyword",showHidden:"yes"});assert.equal(prefs.clipboardDays,60);assert.equal(prefs.fontScale,90);assert.equal(prefs.clipboardKeyword,"clip");assert.equal(prefs.showHidden,false);
});

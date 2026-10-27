import {RE2JS} from "re2js";
import {initialPattern} from "./search";
import type {SearchMode} from "./types";
export type MatchRange=[number,number];
const cache=new Map<string,RE2JS[]>();
export function highlightRanges(text:string,query:string,mode:SearchMode="initials",field="name",caseSensitive=false):MatchRange[]{
 const ranges:MatchRange[]=[];if(!query||query.length>512)return ranges;
 const key=JSON.stringify([query,mode,field,caseSensitive]);
 const compiled=cache.get(key)??[];
 if(!cache.has(key)){
 const tokens=mode==="regex"?[query]:query.match(/(?:[\w]+:)?"[^"]*"|[|<>]|[^\s|<>]+/g)??[];
 let negative=false;
 for(let token of tokens){
  if(mode!=="regex"){
   if(token==="NOT"){negative=true;continue;}if(["AND","OR","|","<",">"].includes(token))continue;
   if(negative||/^[!-]/.test(token)){negative=false;continue;}
   token=token.replace(/^[()]+|[()]+$/g,"");
   const filter=/^(name|path|ext|type|size|modified|created|accessed|root):(.+)$/i.exec(token);
   if(filter){const id=filter[1].toLowerCase();if(id==="path"&&!["path","location","fullPath"].includes(field)||id==="name"&&field!=="name"||id==="ext"&&!["extension","type"].includes(field)||!["path","name","ext"].includes(id)&&id!==field)continue;token=filter[2];}
   token=token.replace(/^"|"$/g,"");
  }
  if(!token)continue;
  const pathField=["path","location","fullPath"].includes(field);
  if(pathField&&mode!=="regex")token=token.replaceAll("\\","/");
  try{
   const escaped=token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
   const pattern=mode==="initials"?initialPattern(token):undefined;
   const regex=pattern??RE2JS.compile(mode==="regex"?token:mode==="wildcard"?`^${escaped.replace(/\\\*/g,".*").replace(/\\\?/g,".")}$`:escaped,caseSensitive&&mode!=="initials"?0:RE2JS.CASE_INSENSITIVE);
   compiled.push(regex);
  }catch{/* Invalid/incomplete expressions must not interrupt rendering. */}
 }
 if(cache.size>=128)cache.delete(cache.keys().next().value!);
 cache.set(key,compiled);
 }
 for(const regex of compiled){
  const matcher=regex.matcher(["path","location","fullPath"].includes(field)?text.replaceAll("\\","/"):text);let count=0;
  while(matcher.find()&&count++<200){if(matcher.end()>matcher.start())ranges.push([matcher.start(),matcher.end()]);}
 }
 ranges.sort((a,b)=>a[0]-b[0]);return ranges.reduce<MatchRange[]>((out,next)=>{const last=out.at(-1);if(last&&next[0]<=last[1])last[1]=Math.max(last[1],next[1]);else out.push([...next]);return out;},[]);
}

import {highlightRanges} from "../highlight";
import type {SearchMode} from "../types";
export function Highlight({text,query="",mode="initials",field="name",caseSensitive=false}:{text:string;query?:string;mode?:SearchMode;field?:string;caseSensitive?:boolean}){
 const value=text.normalize("NFC"),ranges=highlightRanges(value,query,mode,field,caseSensitive);if(!ranges.length)return <>{value}</>;
 const parts:React.ReactNode[]=[];let offset=0;for(const [start,end]of ranges){parts.push(value.slice(offset,start),<mark key={`${start}:${end}`}>{value.slice(start,end)}</mark>);offset=end;}parts.push(value.slice(offset));return <>{parts}</>;
}

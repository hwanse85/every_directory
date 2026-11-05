import type { Location } from "./types";

export const treeKey = (location: Location): string => JSON.stringify([location.rootId, location.path]);
export function onTreePath(folder: Location, current: Location): boolean {
  return folder.rootId === current.rootId && (!folder.path || folder.path === current.path || current.path.startsWith(`${folder.path}/`));
}
export function treeAncestors(current: Location): string[] {
  if (!current.rootId) return [];
  const parts=current.path.split("/").filter(Boolean);
  return Array.from({length:parts.length+1},(_,index)=>treeKey({rootId:current.rootId,path:parts.slice(0,index).join("/")}));
}
export function restoreTreeExpansion(value: unknown, current: Location): Set<string> {
  const saved=Array.isArray(value)?value.filter((key):key is string=>{
    if(typeof key!=="string")return false;
    try {const pair=JSON.parse(key);return Array.isArray(pair)&&pair.length===2&&pair.every(part=>typeof part==="string"&&!part.includes("\0"));}catch{return false;}
  }).slice(-512):[];
  return new Set([...saved,...treeAncestors(current)]);
}

// 트리 들여쓰기(px). 얕은 단계는 넉넉히, 깊어질수록 간격을 줄이고, 이름이 보일 자리(약 90px)는 늘 남긴다.
export function treeIndent(depth: number, width: number): number {
  let offset = 0;
  for (let level = 0; level < depth; level++) offset += level < 2 ? 12 : level < 5 ? 8 : 4;
  return Math.max(0, Math.min(offset, width - 96));
}

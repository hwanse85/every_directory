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

import {useEffect,useState} from "react";
import {invoke,isTauri} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
import {readPreference,savePreference} from "./storage";
import type {ExplorerView,FileEntry} from "./types";

export interface Preferences {
 showHidden:boolean;showTemporary:boolean;showRecycleBin:boolean;highlightMatches:boolean;fontScale:number;
 activePaneAccent:"blue"|"violet"|"orange"|"green";defaultExplorerView:ExplorerView;searchDelay:number;searchPageSize:number;quickFullPath:boolean;
 clipboardEnabled:boolean;clipboardDays:number;clipboardKeyword:string;clipboardText:boolean;clipboardImages:boolean;clipboardFiles:boolean;clipboardMaxMb:number;clipboardExcludedApps:string;
}
export const defaultPreferences:Preferences={showHidden:false,showTemporary:false,showRecycleBin:false,highlightMatches:true,fontScale:100,activePaneAccent:"blue",defaultExplorerView:"list",searchDelay:80,searchPageSize:1000,quickFullPath:true,clipboardEnabled:true,clipboardDays:10,clipboardKeyword:"clip",clipboardText:true,clipboardImages:true,clipboardFiles:true,clipboardMaxMb:16,clipboardExcludedApps:"1password.exe;bitwarden.exe;keepass.exe;keepassxc.exe"};
export function normalizePreferences(input:unknown):Preferences{
 const value={...defaultPreferences,...(input&&typeof input==="object"?input:{})} as Preferences;
 for(const key of Object.keys(defaultPreferences) as (keyof Preferences)[])if(typeof value[key]!==typeof defaultPreferences[key])Object.assign(value,{[key]:defaultPreferences[key]});
 const bounds={fontScale:[90,140],searchDelay:[40,500],searchPageSize:[100,1000],clipboardDays:[1,60],clipboardMaxMb:[1,64]};
 for(const [key,[min,max]]of Object.entries(bounds)){const k=key as keyof typeof bounds;value[k]=Math.max(min,Math.min(max,Math.round(Number(value[k]))||defaultPreferences[k]));}
 if(!/^[\p{L}\p{N}_-]{1,32}$/u.test(value.clipboardKeyword))value.clipboardKeyword="clip";
 if(!["blue","violet","orange","green"].includes(value.activePaneAccent))value.activePaneAccent="blue";
 if(!["list","grid","compact","content","icons-small","icons-medium","icons-large","icons-extra"].includes(value.defaultExplorerView))value.defaultExplorerView="list";
 return value;
}
let cached=normalizePreferences(readPreference("preferences",defaultPreferences));
let loaded:Promise<Preferences>|undefined;
const subscribers=new Set<(p:Preferences)=>void>();
function publish(p:Preferences){cached=p;savePreference("preferences",p);document.documentElement.style.setProperty("--user-font-scale",String(p.fontScale/100));document.documentElement.dataset.paneAccent=p.activePaneAccent;subscribers.forEach(fn=>fn(p));}
let bridge:Promise<()=>void>|undefined;
let warning="";
export function loadPreferences():Promise<Preferences>{
 if(isTauri()&&!bridge)bridge=listen<Preferences>("ed-preferences",e=>publish(normalizePreferences(e.payload)));
 if(!loaded)loaded=(isTauri()?invoke<Preferences&{preferencesWarning?:string}>("preferences_control",{next:null}):Promise.resolve(cached)).then(p=>{warning=(p as Preferences&{preferencesWarning?:string}).preferencesWarning??"";publish(normalizePreferences(p));return cached;}).catch(error=>{loaded=undefined;throw error;});
 return loaded.then(()=>cached);
}
export async function updatePreferences(p:Preferences){const next=isTauri()?await invoke<Preferences>("preferences_control",{next:p}):normalizePreferences(p);warning="";publish(next);return next;}
export function usePreferences(){const [p,set]=useState(cached);const [error,setError]=useState("");useEffect(()=>{subscribers.add(set);let active=true;void loadPreferences().then(()=>{if(active)setError(warning);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;subscribers.delete(set);};},[]);return {preferences:p,preferencesError:error};}
import.meta.hot?.dispose(()=>{void bridge?.then(remove=>remove());});
export function temporaryFile(name:string){return /^(~\$|\.~lock\.|\.#)|\.(tmp|temp|swp|swo)$/i.test(name);}
export function recyclePath(path:string){return path.split(/[\\/]/).some(part=>["$recycle.bin","recycler",".trash",".trashes",".every-directory-trash"].includes(part.toLowerCase()));}
export function visibleFile(entry:FileEntry,p:Pick<Preferences,"showHidden"|"showTemporary"|"showRecycleBin">){
 if(recyclePath(entry.path))return p.showRecycleBin;
 if(temporaryFile(entry.name))return p.showTemporary;
 return p.showHidden||!(entry.hidden||entry.path.split(/[\\/]/).some(part=>part.startsWith('.')));
}

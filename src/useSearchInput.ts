import { useEffect, useRef, useState } from "react";
import { normalizeSearchInput } from "./quickSearch";
import type { SearchMode } from "./types";

// Never blur or rewrite an active IME range. Windows IMEs can deliver the final input
// on either side of compositionend; normalize once after that event batch has settled.
export function useSearchInput(mode: SearchMode | ((text: string) => SearchMode), onValue: (value: string) => void) {
  const composing = useRef(false);
  const frame = useRef<number | undefined>(undefined);
  const [preview, setPreview] = useState<{raw:string; text:string; caret:number} | undefined>();
  const latest = useRef({mode, onValue});
  latest.current = {mode, onValue};
  useEffect(() => () => {if(frame.current!==undefined)cancelAnimationFrame(frame.current);}, []);
  const normalized = (value: string) => normalizeSearchInput(value, typeof latest.current.mode === "function" ? latest.current.mode(value) : latest.current.mode);
  return {
    composing,
    preview,
    onCompositionStart: () => {
      if(frame.current!==undefined)cancelAnimationFrame(frame.current);
      frame.current=undefined;composing.current=true;
    },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement>) => {
      const input=event.currentTarget;
      // Keep the raw controlled value through a possible late insertFromComposition.
      latest.current.onValue(input.value);
      if(frame.current!==undefined)cancelAnimationFrame(frame.current);
      frame.current=requestAnimationFrame(() => {
        frame.current=undefined;composing.current=false;
        if(!input.isConnected)return;
        const raw=input.value;
        const start=normalized(raw.slice(0,input.selectionStart??raw.length)).length;
        const end=normalized(raw.slice(0,input.selectionEnd??raw.length)).length;
        const value=normalized(raw);
        setPreview(undefined);
        latest.current.onValue(value);
        if(raw!==value){
          frame.current=requestAnimationFrame(()=>{
            frame.current=undefined;
            if(!composing.current&&document.activeElement===input&&input.value===value)input.setSelectionRange(start,end);
          });
        }
      });
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw=event.currentTarget.value;
      const text=normalized(raw);
      setPreview(composing.current&&text!==raw ? {raw,text,caret:normalized(raw.slice(0,event.currentTarget.selectionEnd??raw.length)).length}:undefined);
      latest.current.onValue(composing.current||(event.nativeEvent as InputEvent).isComposing ? raw : normalized(raw));
    },
  };
}

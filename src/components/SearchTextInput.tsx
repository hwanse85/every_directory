import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";

interface Preview { raw:string; text:string; caret:number }
// Display separated initials without editing the text range owned by the native IME.
// This is only a visual mirror; all focus, selection and composition stay on the input.
export const SearchTextInput=forwardRef<HTMLInputElement,InputHTMLAttributes<HTMLInputElement>&{preview?:Preview}>(function SearchTextInput({preview,...props},ref){
  const input=useRef<HTMLInputElement>(null);
  const [mirror,setMirror]=useState<{style:CSSProperties;offset:number}>({style:{},offset:0});
  useImperativeHandle(ref,()=>input.current!,[]);
  useLayoutEffect(()=>{
    if(!preview||!input.current)return;
    const element=input.current,style=getComputedStyle(element);
    const context=document.createElement("canvas").getContext("2d");
    if(context)context.font=style.font;
    const prefix=context?.measureText(preview.text.slice(0,preview.caret)).width??0;
    const rawPrefix=context?.measureText(preview.raw.slice(0,element.selectionEnd??preview.raw.length)).width??0;
    const available=element.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    const offset=element.scrollLeft>0?element.scrollLeft+prefix-rawPrefix:Math.max(0,prefix-available+2);
    setMirror({style:{font:style.font,letterSpacing:style.letterSpacing,paddingLeft:style.paddingLeft,paddingRight:style.paddingRight},offset});
  },[preview]);
  return <span className={`ime-input ${preview?"ime-input-previewing":""}`}>
    <input {...props} ref={input}/>
    {preview&&<span className="ime-preview" aria-hidden="true" style={mirror.style}><span style={{transform:`translateX(${-mirror.offset}px)`}}>{preview.text.slice(0,preview.caret)}<i/>{preview.text.slice(preview.caret)}</span></span>}
  </span>;
});

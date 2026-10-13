import {useEffect,useRef,useState} from 'react';

export function InlineName({name,save,cancel}:{name:string;save:(name:string)=>void;cancel:()=>void}){
 const [value,setValue]=useState(name),input=useRef<HTMLInputElement>(null),finished=useRef(false);
 useEffect(()=>{input.current?.focus();input.current?.select();},[]);
 const finish=(commit:boolean)=>{if(finished.current)return;finished.current=true;commit&&value.trim()?save(value.trim()):cancel();};
 return <input ref={input} className="tab-name-input" aria-label="Rename animation" maxLength={100} value={value} onChange={e=>setValue(e.target.value)} onBlur={()=>finish(true)} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();finish(e.key==='Enter');}}} onPointerDown={e=>e.stopPropagation()}/>;
}

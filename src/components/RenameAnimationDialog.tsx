import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
export function RenameAnimationDialog({name,save,cancel}:{name:string;save:(name:string)=>void;cancel:()=>void}){
 const [value,setValue]=useState(name),input=useRef<HTMLInputElement>(null),form=useRef<HTMLFormElement>(null),backdrop=useRef<HTMLDivElement>(null),initialFocus=useRef(document.activeElement as HTMLElement|null);
 useEffect(()=>{
  input.current?.focus({preventScroll:true});input.current?.select();
  const viewport=window.visualViewport,fit=()=>{if(backdrop.current){backdrop.current.style.top=(viewport?.offsetTop??0)+'px';backdrop.current.style.height=(viewport?.height??innerHeight)+'px';}};fit();viewport?.addEventListener('resize',fit);viewport?.addEventListener('scroll',fit);
  const dismiss=(e:Event)=>{e.preventDefault();e.stopImmediatePropagation();cancel();};window.addEventListener('pose-dismiss-overlay',dismiss,true);
  return()=>{viewport?.removeEventListener('resize',fit);viewport?.removeEventListener('scroll',fit);window.removeEventListener('pose-dismiss-overlay',dismiss,true);initialFocus.current?.focus({preventScroll:true});};
 },[cancel]);
 return createPortal(<div ref={backdrop} className="modal-backdrop rename-backdrop" data-editor-overlay><form ref={form} className="modal compact-modal rename-animation-modal" role="dialog" aria-modal="true" aria-labelledby="rename-animation-title" onSubmit={e=>{e.preventDefault();if(value.trim())save(value.trim());}} onKeyDown={e=>{e.stopPropagation();if(e.nativeEvent.isComposing)return;if(e.key==='Escape'){e.preventDefault();cancel();}if(e.key==='Tab'){const items=[...form.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input')],at=items.indexOf(document.activeElement as HTMLElement);if(e.shiftKey&&at===0){e.preventDefault();items.at(-1)?.focus();}else if(!e.shiftKey&&at===items.length-1){e.preventDefault();items[0]?.focus();}}}}>
  <header><h2 id="rename-animation-title">Rename animation</h2><button type="button" aria-label="Cancel rename" onClick={cancel}><X size={18}/></button></header>
  <label className="action-field">Animation name<input ref={input} aria-label="Animation name" value={value} maxLength={100} enterKeyHint="done" autoComplete="off" onChange={e=>setValue(e.target.value)}/></label>
  <footer><button type="button" onClick={cancel}>Cancel</button><button className="primary" type="submit" disabled={!value.trim()}>Rename</button></footer>
 </form></div>,document.body);
}

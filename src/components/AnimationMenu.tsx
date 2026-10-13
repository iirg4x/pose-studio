import {createPortal} from 'react-dom';
import {useEffect,useRef} from 'react';
import {Pencil,Copy,X,PanelTopClose,Trash2} from 'lucide-react';

export function AnimationMenu({tabs=true,x,y,rename,duplicate,remove,closeTab,closeOthers,dismiss}:{tabs?:boolean;x:number;y:number;rename:()=>void;duplicate:()=>void;remove:()=>void;closeTab:()=>void;closeOthers:()=>void;dismiss:()=>void}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const el=ref.current!;const r=el.getBoundingClientRect();el.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))+'px';el.style.top=Math.max(8,Math.min(y,innerHeight-r.height-8))+'px';el.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});},[x,y]);
 return createPortal(<div ref={ref} className="animation-context-menu" role="menu" aria-label="Animation tab menu" data-editor-overlay style={{left:Math.max(4,Math.min(x,innerWidth-216)),top:Math.max(40,Math.min(y,innerHeight-156))}} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{
  e.stopPropagation();const items=[...ref.current!.querySelectorAll<HTMLButtonElement>('button')],at=items.indexOf(document.activeElement as HTMLButtonElement);
  if(e.key==='Escape'){e.preventDefault();dismiss();}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(at+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}
 }}>
  <button role="menuitem" onClick={rename}><Pencil size={14}/><span>Rename</span><kbd>F2</kbd></button>
  <button role="menuitem" onClick={duplicate}><Copy size={14}/><span>Duplicate</span></button>
   {tabs&&<><hr/>
   <button role="menuitem" onClick={closeTab}><X size={14}/><span>Close tab</span></button>
  <button role="menuitem" onClick={closeOthers}><PanelTopClose size={14}/><span>Close other tabs</span></button></>}
   <hr/>
   <button role="menuitem" className="danger" onClick={remove}><Trash2 size={14}/><span>Delete animation…</span></button>
 </div>,document.body);
}

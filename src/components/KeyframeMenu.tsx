import {MotionPresence} from './Motion';
import {useEffect,useRef} from 'react';
import {Diamond} from 'lucide-react';
import {KEYING_SETS} from '../core/keying';
import {studio} from '../core/store';
import {useStudioChrome} from '../hooks';
export function KeyframeMenu(){
 const s=useStudioChrome({frame:'none'}),menu=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!s.keyframeMenu)return;menu.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();const close=(e:PointerEvent)=>{if(!menu.current?.contains(e.target as Node))studio.patch({keyframeMenu:null});};window.addEventListener('pointerdown',close,true);return()=>window.removeEventListener('pointerdown',close,true);},[!!s.keyframeMenu]);
 return <MotionPresence show={!!s.keyframeMenu}><div ref={menu} className="keyframe-menu" role="menu" aria-label="Insert Keyframe" style={{left:Math.max(8,Math.min(innerWidth-262,s.keyframeMenu?.x??8)),top:Math.max(8,Math.min(innerHeight-330,s.keyframeMenu?.y??8))}} onKeyDown={e=>{
  e.stopPropagation();if(e.key==='Escape'){e.preventDefault();studio.patch({keyframeMenu:null});return;}
  const items=Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('[role=menuitem]')),index=items.indexOf(document.activeElement as HTMLButtonElement);
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();return;}
  const set=KEYING_SETS.find(k=>k.key.toLowerCase()===e.key.toLowerCase());if(set){e.preventDefault();studio.insertKeyingSet(set.id);}
 }}><header><Diamond size={14}/><strong>Insert Keyframe</strong></header><p>Frame {s.frame} · {studio.selectedControls().length} selected</p>{KEYING_SETS.map((set,i)=><button className={i===5?'keying-divider':''} role="menuitem" key={set.id} onClick={()=>studio.insertKeyingSet(set.id)}><span>{set.label}</span><kbd>{set.key}</kbd></button>)}</div></MotionPresence>;
}

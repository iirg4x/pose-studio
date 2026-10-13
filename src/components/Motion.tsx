import {cloneElement,useLayoutEffect,useRef} from 'react';
import type {ReactElement,ReactNode} from 'react';
import {usePresence} from '../hooks';

/** Retain the last visible content while closing. CSS transitions can reverse
 * in place when a tool is reopened; hidden controls cannot receive input. */
export function MotionPresence({show,children,kind='popover'}:{show:boolean;children:ReactElement;kind?:'popover'|'context'|'collapse'|'inline'|'overlay'}){
 const presence=usePresence(show?true:null,220),last=useRef(children);
 if(show)last.current=children;
 if(!presence.value)return null;
 return cloneElement(last.current as ReactElement<Record<string,unknown>>,{
  'data-motion':kind,'data-state':presence.exiting?'closing':'open',
  inert:presence.exiting||undefined,'aria-hidden':presence.exiting||undefined,
 });
}

export function MotionOverlay({show,children}:{show:boolean;children:ReactNode}){
 return <MotionPresence show={show} kind="overlay"><div className="motion-overlay">{children}</div></MotionPresence>;
}

export function Collapse({open,children}:{open:boolean;children:ReactNode}){
 return <MotionPresence show={open} kind="collapse"><div className="motion-collapse"><div className="motion-collapse-inner">{children}</div></div></MotionPresence>;
}

/** Collapse the occupied inline space along with opacity. The inner content
 * keeps its natural width so adjacent tools slide instead of jumping. */
export function InlineCollapse({open,children}:{open:boolean;children:ReactNode}){
 return <MotionPresence show={open} kind="inline"><div className="motion-inline"><div className="motion-inline-inner">{children}</div></div></MotionPresence>;
}

/** Observe only the intrinsic content of a small drawer, never the scene or
 * timeline. Rapid changes start from the current rendered size, not an old end. */
export function MotionSize({children,className='',contentKey}:{children:ReactNode;className?:string;contentKey?:string}){
 const outer=useRef<HTMLDivElement>(null),inner=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const shell=outer.current!,content=inner.current!;let height:number|undefined,resize:Animation|undefined;
  const observer=new ResizeObserver(()=>{
   const next=content.getBoundingClientRect().height;
   if(height===next)return;
   const previous=shell.getBoundingClientRect().height;resize?.cancel();shell.style.height=next+'px';
   const unfolding=content.getAnimations({subtree:true}).some(a=>a instanceof CSSTransition&&a.transitionProperty==='grid-template-rows'&&a.playState==='running');
   if(height!==undefined&&!unfolding&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
    const target=shell.getBoundingClientRect().height;
    if(Math.abs(previous-target)>.5)resize=shell.animate([{height:previous+'px'},{height:target+'px'}],{duration:200,easing:'cubic-bezier(.2,.8,.2,1)'});
   }
   height=next;
  });
  observer.observe(content);return()=>{observer.disconnect();resize?.cancel();};
 },[]);
 useLayoutEffect(()=>{
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const animation=inner.current!.animate([{opacity:.25},{opacity:1}],{duration:150,easing:'ease-out'});
  return()=>animation.cancel();
 },[contentKey]);
 return <div ref={outer} className={className+' motion-size'}><div ref={inner} className="motion-size-content">{children}</div></div>;
}

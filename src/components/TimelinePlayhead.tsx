import type {CSSProperties,PointerEvent} from 'react';
import {memo,useLayoutEffect,useRef,useState} from 'react';
import {useStudioSelector,useDisplayFrame} from '../hooks';
import {studio} from '../core/store';
import {ScrubNumber} from './ScrubNumber';

// Only these small leaves subscribe to the clock. Moving the playhead must not
// reconcile the key buttons, graph paths, or offscreen tracks.
export const TimelinePlayhead=memo(function TimelinePlayhead({end,cap=false}:{end:number;cap?:boolean}){
 const frame=useDisplayFrame(),position=frame/end,ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(0);
 useLayoutEffect(()=>{const parent=ref.current?.parentElement;if(!parent)return;const measure=()=>setWidth(parent.clientWidth);measure();const observer=new ResizeObserver(measure);observer.observe(parent);return()=>observer.disconnect();},[]);
 const style:CSSProperties={left:0,transform:'translateX('+position*width+'px)',willChange:'transform'};
 return cap?<div ref={ref} className="playhead-cap" data-edge={position<.04?'start':position>.96?'end':undefined} style={style}><output aria-label="Playhead frame">{Math.floor(frame)}</output></div>:<div ref={ref} className="playhead" style={style}/>;
});
export const TimelineFrame=memo(function TimelineFrame({end}:{end:number}){
 const frame=useStudioSelector(s=>s.frame);
 return <ScrubNumber aria-label="Current frame" type="number" step="any" min={0} max={end} value={frame} onChange={e=>studio.setFrame(Number(e.target.value))}/>;
});
export const CurvePlayhead=memo(function CurvePlayhead({from,to,left,width,top,bottom,onScrubStart}:{from:number;to:number;left:number;width:number;top:number;bottom:number;onScrubStart:(event:PointerEvent<SVGGElement>)=>void}){
 const frame=useDisplayFrame(),end=useStudioSelector(s=>s.project?.end??0),x=left+(frame-from)/(to-from)*width;
 if(frame<from||frame>to)return null;
 return <g className="curve-playhead-control" role="slider" aria-label="Curve playhead" aria-valuemin={0} aria-valuemax={end} aria-valuenow={frame} tabIndex={0} onPointerDown={onScrubStart} onDoubleClick={e=>e.stopPropagation()} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();e.stopPropagation();studio.setFrame(e.key==='Home'?0:e.key==='End'?end:frame+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?10:1));}}>
  <line x1={x} x2={x} y1={top} y2={bottom} className="curve-playhead-hit"/>
  <line x1={x} x2={x} y1={top} y2={bottom} className="curve-playhead"/>
  <g transform={'translate('+Math.max(left,Math.min(left+width-36,x-18))+','+(bottom+2)+')'} className="curve-playhead-grip"><rect width={36} height={22} rx={5}/><text x={18} y={15} textAnchor="middle">{Number(frame.toFixed(1))}</text></g>
 </g>;
});

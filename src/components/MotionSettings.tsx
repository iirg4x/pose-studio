import {ScrubNumber} from './ScrubNumber';
import {DEFAULT_SPRING,DEFAULT_BOUNCE,motionProgress} from '../core/interpolation';
import type {MotionMode,MotionOptions,EaseDirection} from '../core/interpolation';
import {studio} from '../core/store';

export function MotionSettings({mode,options,change}:{mode:MotionMode;options:MotionOptions;change:(options:MotionOptions)=>void}){
 const spring=options.spring??DEFAULT_SPRING,bounce=options.bounce??DEFAULT_BOUNCE,title=mode==='spring'?'Spring':'Bounce';
 const values=Array.from({length:161},(_,i)=>motionProgress(mode,i/160,options)),lo=Math.min(0,...values)-.08,hi=Math.max(1,...values)+.08;
 const x=(i:number)=>8+i/160*204,y=(value:number)=>8+(hi-value)/(hi-lo)*48;
 const path=values.map((v,i)=>(i?'L':'M')+x(i).toFixed(2)+','+y(v).toFixed(2)).join(' ');
 const field=(key:string,label:string,value:number,min:number,max:number,step:number,scale=1)=>{
  const update=(n:number)=>change(mode==='spring'?{spring:{...spring,[key]:n/scale}}:{bounce:{...bounce,[key]:n/scale}});
  const changeNumber=(raw:string)=>{if(raw!==''&&Number.isFinite(Number(raw))){const value=Math.max(min,Math.min(max,Number(raw)));update(step===1?Math.round(value):value);}};
  return <label className="motion-parameter" key={key}><span>{label}</span>
   <input type="range" aria-label={title+' '+label} value={value*scale} min={min} max={max} step={step}
    onPointerDown={()=>studio.beginGesture()} onPointerUp={()=>studio.endGesture()} onPointerCancel={()=>studio.endGesture()} onKeyDown={()=>studio.beginGesture()} onKeyUp={()=>studio.endGesture()} onBlur={()=>studio.endGesture()} onChange={e=>update(Number(e.target.value))}/>
   <ScrubNumber type="number" aria-label={title+' '+label+' value'} value={Number((value*scale).toFixed(3))} min={min} max={max} step={step}
    onFocus={()=>studio.beginGesture()} onBlur={()=>studio.endGesture()} onChange={e=>changeNumber(e.target.value)}/>
  </label>;
 };
 return <fieldset className="motion-settings"><legend>{title} settings</legend>
  <div className="motion-direction" role="group" aria-label={title+' easing direction'}>{([['in','Ease in'],['out','Ease out'],['inOut','In / Out']] as [EaseDirection,string][]).map(([direction,label])=><button type="button" key={direction} aria-pressed={(options.easing??'out')===direction} onClick={()=>change({easing:direction})}>{label}</button>)}</div>
  <svg viewBox="0 0 220 72" className="motion-preview" role="img" aria-label={title+' response preview'}>
   <line x1="8" y1={y(0)} x2="212" y2={y(0)}/><line x1="8" y1={y(1)} x2="212" y2={y(1)}/>
   <path d={path}/><circle cx="8" cy={y(0)} r="2.5"/><circle cx="212" cy={y(1)} r="2.5"/>
   <text x="8" y="69">First key</text><text x="212" y="69" textAnchor="end">Next key</text>
  </svg>
  {mode==='spring'?<>
   {field('strength','Strength',spring.strength,0,2,.05)}
   {field('oscillations','Oscillations',spring.oscillations,.5,8,.1)}
   {field('damping','Damping',spring.damping,0,20,.5)}
  </>:<>
   {field('bounces','Bounces',bounce.bounces,1,8,1)}
   {field('height','Height',bounce.height,0,1,.05)}
   {field('decay','Decay',bounce.decay,.1,.95,.05)}
   {field('impact','Impact %',bounce.impact,10,80,1,100)}
  </>}
  <div className="motion-setting-footer"><span>{mode==='spring'?'Higher damping settles sooner.':'Impact timing is relative to the segment.'}</span><button type="button" onClick={()=>change(mode==='spring'?{spring:{...DEFAULT_SPRING},easing:'out'}:{bounce:{...DEFAULT_BOUNCE},easing:'out'})}>Reset</button></div>
 </fieldset>;
}

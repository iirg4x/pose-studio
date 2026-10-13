import {channelsFor,readCurve,closeCurveLoop,explicitLoopCurve,CHANNEL_LABELS} from './curves';
import type {CurveKey,HandleMode} from './curves';
import {clone} from './model';
import type {ControlId,Project,Track} from './model';
import type {MotionOptions} from './interpolation';
import type {TimelineKey} from './timelineKeys';

export type KeySettings=MotionOptions&{interpolation?:CurveKey['interpolation'];handle?:HandleMode;loop?:boolean};
export type SegmentKind=CurveKey['interpolation']|'hold'|'mixed';
export const INTERPOLATION_NAMES:Record<SegmentKind,string>={loop:'Loop',bezier:'Bézier / smooth',linear:'Linear',step:'Stepped',spring:'Spring',bounce:'Bounce',hold:'Hold',mixed:'Mixed channels'};
export function selectedCurveKeys(project:Project,selection:TimelineKey[]){
 return selection.flatMap(({id,frame})=>channelsFor(id,project.tracks[id]).flatMap(c=>readCurve(project.tracks[id],c).keys.filter(k=>k.frame===frame)));
}
export function applyKeySettings(project:Project,selection:TimelineKey[],settings:KeySettings){
 const next=clone(project);
 for(const id of new Set(selection.map(k=>k.id))){
  const track=next.tracks[id],frames=new Set(selection.filter(k=>k.id===id).map(k=>k.frame));
  const {handle,interpolation,loop,...motion}=settings,closing=interpolation==='loop'||loop===true;
  const {loop:_,...keySettings}=settings;
  for(const key of track.keys)if(frames.has(key.frame)){Object.assign(key,clone(motion));if(interpolation&&interpolation!=='loop')key.interpolation=interpolation==='bezier'?'smooth':interpolation;}
  for(const channel of channelsFor(id,track)){
   // Pose interpolation stays on the pose key, retaining quaternion slerp on
   // untouched segments. Only explicit tangent edits create new channel curves.
   if(!track.curves?.[channel]&&!handle&&!closing)continue;
   const curve=readCurve(track,channel);if(!curve.keys.some(k=>frames.has(k.frame)))continue;
   track.curves??={};track.curves[channel]=curve;
   if(closing){const range=project.loop??{start:0,end:project.end};closeCurveLoop(curve,range.start,range.end);}
   else{
    if(curve.loop&&(loop===false||interpolation&&(frames.has(curve.loop.start)||frames.has(curve.loop.end)))){curve.keys=explicitLoopCurve(curve).keys;delete curve.loop;}
    for(const key of curve.keys)if(frames.has(key.frame))Object.assign(key,clone(keySettings));
   }
  }
 }
 return next;
}
export function segmentInterpolation(id:ControlId,track:Track,from:number,to:number){
 const kinds=new Set<SegmentKind>(),details:string[]=[],modifiers=new Set<string>();
 for(const channel of channelsFor(id,track)){
  const curve=readCurve(track,channel);let frame=(from+to)/2;
  for(const modifier of curve.modifiers)if(modifier.enabled)modifiers.add(modifier.type);
  const first=curve.keys[0],last=curve.keys.at(-1)!;
  const cycle=curve.modifiers.find(m=>m.type==='cycles'&&m.enabled);
  if(cycle?.type==='cycles'&&last.frame>first.frame){const mode=frame<first.frame?cycle.before:frame>last.frame?cycle.after:'none';if(mode!=='none'){const span=last.frame-first.frame,n=Math.floor((frame-first.frame)/span),fraction=frame-first.frame-n*span;frame=first.frame+(mode==='mirror'&&Math.abs(n)%2===1?span-fraction:fraction);}}
  const index=curve.keys.findIndex((k,i)=>k.frame<=frame&&i<curve.keys.length-1&&curve.keys[i+1].frame>frame);
  if(index<0)continue;
  const kind=curve.keys[index].interpolation;kinds.add(kind);details.push(CHANNEL_LABELS[channel]+': '+INTERPOLATION_NAMES[kind]);
 }
 const kind:SegmentKind=kinds.size>1?'mixed':kinds.values().next().value??'hold';
 return {kind,modified:modifiers.size>0,title:`${INTERPOLATION_NAMES[kind]} · frames ${from}–${to}${details.length?'\n'+details.join('\n'):''}${modifiers.size?'\nModifiers: '+[...modifiers].join(', '):''}`};
}

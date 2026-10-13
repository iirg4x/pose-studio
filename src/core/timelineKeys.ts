import {editLayerAllowed} from './layers';
import {curveKeyLocked,canInsertCurveKey} from './curveLocks';
import {clone,activeSpace,validateProject} from './model';
import type {ControlId,Project,Track,RigLayer} from './model';
import {isBlendChannel} from './blendChannels';
import {readCurve,ensureCurve,explicitLoopCurve,channelsFor} from './curves';
import type {Channel} from './curves';
export interface TimelineKey {id:ControlId;frame:number}
export interface KeyClipboard {layer:RigLayer;origin:number;items:{id:ControlId;frames:number[];track:Track}[]}
export const keyToken=(k:TimelineKey)=>k.id+':'+k.frame;
export const trackFrames=(t:Track)=>Array.from(new Set([...t.keys.map(k=>k.frame),...Object.values(t.curves??{}).flatMap(c=>c!.keys.map(k=>k.frame)),...t.spaces.map(k=>k.frame),...(t.following??[]).map(k=>k.frame)])).sort((a,b)=>a-b);
export const uniqueKeys=(keys:TimelineKey[])=>[...new Map(keys.map(k=>[keyToken(k),k])).values()];
export function validKeys(p:Project,keys:TimelineKey[]){return uniqueKeys(keys).filter(k=>trackFrames(p.tracks[k.id]).includes(k.frame));}
export function keyDelta(p:Project,keys:TimelineKey[],delta:number){const frames=validKeys(p,keys).map(k=>k.frame);return frames.length&&Number.isFinite(delta)?Math.max(-Math.min(...frames),Math.min(p.end-Math.max(...frames),delta)):0;}
function merge<T extends {frame:number}>(old:T[],incoming:T[]){const frames=new Set(incoming.map(k=>k.frame));return old.filter(k=>!frames.has(k.frame)).concat(incoming).sort((a,b)=>a.frame-b.frame);}
function shifted<T extends {frame:number}>(keys:T[],frames:Set<number>,delta:number){return keys.filter(k=>frames.has(k.frame)).map(k=>({...clone(k),frame:k.frame+delta}));}
export function moveTimelineKeys(project:Project,selection:TimelineKey[],offset:number){
 if(selection.some(k=>!editLayerAllowed(project,k.id)))throw Error('Mirror-linked controls are driven by their source. Edit the source keys.');
 const keys=validKeys(project,selection),delta=keyDelta(project,keys,offset),p=clone(project);
 for(const id of new Set(keys.map(k=>k.id))){const t=p.tracks[id],frames=new Set(keys.filter(k=>k.id===id).map(k=>k.frame));
  const move=<T extends {frame:number}>(old:T[])=>merge(old.filter(k=>!frames.has(k.frame)),shifted(old,frames,delta));
  t.keys=move(t.keys);for(const c of Object.values(t.curves??{})){if(!c)continue;if(c.loop&&(frames.has(c.loop.start)||frames.has(c.loop.end)))Object.assign(c,explicitLoopCurve(c),{loop:undefined});c.keys=move(c.keys);}t.spaces=move(t.spaces);
  if(t.following)t.following=move(t.following);
 }
 return {project:validateProject(p),selection:keys.map(k=>({...k,frame:k.frame+delta})),delta};
}
export function copyTimelineKeys(p:Project,selection:TimelineKey[]):KeyClipboard|null{
 const keys=validKeys(p,selection);if(!keys.length)return null;
 return {layer:p.editing,origin:Math.min(...keys.map(k=>k.frame)),items:[...new Set(keys.map(k=>k.id))].map(id=>({id,frames:keys.filter(k=>k.id===id).map(k=>k.frame),track:clipboardTrack(p.tracks[id])}))};
}
function clipboardTrack(source:Track){const track=clone(source);for(const [channel,curve] of Object.entries(source.curves??{}))if(curve)track.curves![channel as Channel]=explicitLoopCurve(curve);return track;}
const spaceSignature=(t:Track)=>JSON.stringify([!!t.additive,!!t.cameraSpace,t.basis??null,t.rotationMode??'euler',t.rotationOrder??'XYZ']);
export function pasteTimelineKeys(project:Project,clipboard:KeyClipboard,frame:number){
 if(project.editing!==clipboard.layer)throw Error('Paste into a '+(clipboard.layer==='body'?'full-body':'first-person')+' animation.');
 const p=clone(project),delta=frame-clipboard.origin,selection:TimelineKey[]=[];
 if(clipboard.items.some(item=>item.frames.some(f=>f+delta<0||f+delta>p.end)))throw Error('The pasted keys exceed the animation range. Increase End frame or move the playhead earlier.');
 for(const item of clipboard.items){const {id,track:source}=item,frames=new Set(item.frames);let target=p.tracks[id];
  if(!editLayerAllowed(p,id))throw Error('Mirror-linked controls are driven by their source. Paste into the source side.');
  if(target.keyLock&&source.keys.some(k=>frames.has(k.frame)&&!target.keys.some(v=>v.frame===k.frame+delta)))throw Error('Paste would add keys to a locked control. Unlock it first.');
  for(const c of channelsFor(id,target))if(curveKeyLocked(target,c)&&readCurve(source,c).keys.some(k=>frames.has(k.frame)&&!canInsertCurveKey(target,c,k.frame+delta)))throw Error('Paste would add keys to a locked curve. Unlock it first.');
  if(!!source.additive!==!!target.additive)throw Error('Body correction keys need an animation with a first-person base.');
  if(spaceSignature(source)!==spaceSignature(target)){
   // A fresh control can adopt imported Blender authoring space. Never change
   // the interpretation of existing animation keys to make a paste fit.
   if(target.keys.length!==1||target.keys[0].frame!==0||Object.values(target.curves??{}).some(c=>c!.keys.length>1||c!.modifiers.length)||target.spaces.some(s=>s.frame!==0))throw Error('These controls use different imported rig spaces. Duplicate the source animation to keep its rig space.');
   target=p.tracks[id]={...clone(source),keys:[],curves:{},spaces:[],following:source.following?[]:undefined};
   const active=activeSpace(source,clipboard.origin);if(active)target.spaces=[{...clone(active),frame}];
  }
  if(source.layerReference&&!target.layerReference&&Object.entries(source.curves??{}).some(([c,curve])=>isBlendChannel(c)&&curve?.keys.some(k=>frames.has(k.frame))))target.layerReference=clone(source.layerReference);
  target.keys=merge(target.keys,shifted(source.keys,frames,delta));
  // A marker may contain only individual channel keys. Keep a base pose for
  // unkeyed channels without adding keys to every other channel.
  if(!target.keys.length)target.keys=[{...clone(source.keys[0]),frame}];
  const channels=new Set([...Object.keys(source.curves??{}),...Object.keys(target.curves??{})] as Channel[]);
  for(const channel of channels){const incoming=shifted(readCurve(source,channel).keys,frames,delta);if(!incoming.length)continue;const curve=ensureCurve(target,channel);curve.keys=merge(curve.keys,incoming);}
  target.spaces=merge(target.spaces,shifted(source.spaces,frames,delta));
  if(source.following)target.following=merge(target.following??[],shifted(source.following,frames,delta));
  selection.push(...item.frames.map(f=>({id,frame:f+delta})));
 }
 return {project:validateProject(p),selection};
}
export function deleteTimelineKeys(project:Project,selection:TimelineKey[]){
 if(selection.some(k=>!editLayerAllowed(project,k.id)))throw Error('Mirror-linked controls are driven by their source. Edit the source keys.');
 const p=clone(project),keys=validKeys(p,selection);let kept=0;
 for(const id of new Set(keys.map(k=>k.id))){const t=p.tracks[id],frames=new Set(keys.filter(k=>k.id===id).map(k=>k.frame));
  const remove=<T extends {frame:number}>(old:T[])=>{const remaining=old.filter(k=>!frames.has(k.frame));if(remaining.length)return remaining;kept++;return old.slice(0,1);};
  t.keys=remove(t.keys);for(const c of Object.values(t.curves??{})){if(!c)continue;if(c.loop&&(frames.has(c.loop.start)||frames.has(c.loop.end)))Object.assign(c,explicitLoopCurve(c),{loop:undefined});c.keys=remove(c.keys);}
  t.spaces=t.spaces.filter(k=>!frames.has(k.frame));
  if(t.following)t.following=t.following.filter(k=>!frames.has(k.frame));
 }
 return {project:validateProject(p),kept};
}

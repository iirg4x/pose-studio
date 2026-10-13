import {Matrix4} from 'three';
import type {ControlId,Project,Pose,RigLayer,LimbId} from './model';
import {fromMatrix,matrix,rootChild} from './model';
import {CONTROLS,isOffsetControl} from './controls';
import {mirrorControlPose,mirrorDestination} from './mirrorPose';
import type {MirrorRest} from './mirrorTimeline';
import {loopRange} from './loops';

export interface MirrorLink {
 source:ControlId;target:ControlId;phase:0|0.5;
 sourceRest:number[];targetRest:number[];sourceParent:number[];targetParent:number[];
}
export type MirrorLinks=Partial<Record<RigLayer,MirrorLink[]>>;
export const liveMirrorLinks=(p:Project)=>p.mirrorLinks?.[p.editing]??[];
export const mirrorDriver=(p:Project,id:ControlId)=>liveMirrorLinks(p).find(l=>l.target===id);
/** A half-cycle shift uses the playback loop, including subframes and odd lengths. */
export function mirrorFrame(p:Project,frame:number,phase:MirrorLink['phase']){
 if(!phase)return frame;
 const {start,end}=loopRange(p),length=end-start;
 return start+((frame-start+length*phase)%length+length)%length;
}
export function mirrorDisplayFrame(p:Project,frame:number,phase:MirrorLink['phase']){
 if(!phase)return frame;const {start,end}=loopRange(p),length=end-start;
 return start+((frame-start-length*phase)%length+length)%length;
}
export function makeMirrorLinks(p:Project,ids:ControlId[],phase:MirrorLink['phase'],rest:MirrorRest):MirrorLink[]{
 const links:MirrorLink[]=[];
 for(const source of new Set(ids)){
  const target=mirrorDestination(source);if(!target||source===target)continue;
  if(ids.includes(target))throw Error('Choose one side to drive the mirror, not both sides.');
  const a=rest(source),b=rest(target);
  links.push({source,target,phase,sourceRest:a.world.toArray(),targetRest:b.world.toArray(),sourceParent:a.parent.toArray(),targetParent:b.parent.toArray()});
 }
 if(!links.length)throw Error('Select a left or right control to mirror.');
 const existing=liveMirrorLinks(p).filter(l=>!links.some(n=>n.target===l.target));
 const combined=[...existing,...links],targets=new Set(combined.map(l=>l.target));
 if(combined.some(l=>targets.has(l.source)))throw Error('Unlink the opposite direction first. A mirrored control cannot drive another link.');
 return combined;
}
type Values=Record<ControlId,Pose>;
const matrices=new WeakMap<MirrorLink,Matrix4[]>();
export function mirrorRestMatrices(link:MirrorLink){let m=matrices.get(link);if(!m){m=[link.sourceRest,link.targetRest,link.sourceParent,link.targetParent].map(v=>new Matrix4().fromArray(v));matrices.set(link,m);}return m;}
/** Evaluate the source animation, including all layers and modifiers, before
 * reflecting it. Destination tracks remain intact and are restored on unlink. */
export function applyLiveMirrors(p:Project,frame:number,values:Values,evaluateSource:(frame:number)=>Values):Values{
 const links=liveMirrorLinks(p);if(!links.length)return values;
 const result={...values},samples=new Map<number,Values>([[frame,values]]);
 for(const link of links){const at=mirrorFrame(p,frame,link.phase);let source=samples.get(at);if(!source){source=evaluateSource(at);samples.set(at,source);}
  const [a,b,ap,bp]=mirrorRestMatrices(link),offset=isOffsetControl(link.source),sourceRoot=matrix(source.root);
  let value=mirrorControlPose(source[link.source],a,b,offset,ap,bp,sourceRoot);
  // Keep root locomotion at the current frame; only the limb cycle is shifted.
  if(rootChild(link.target))value=fromMatrix(matrix(values.root).multiply(sourceRoot.invert()).multiply(matrix(value)),value);
  result[link.target]=value;
 }
 return result;
}
export function mirroredLimb(p:Project,limb:LimbId,frame:number){
 const id=((limb.startsWith('arm')?'hand_':'foot_')+limb.at(-1)) as ControlId;
 const link=mirrorDriver(p,id)??liveMirrorLinks(p).find(l=>CONTROLS[l.target].limb===limb&&CONTROLS[l.target].only==='fk');
 return link?{limb:(limb.slice(0,-1)+link.source.at(-1)) as LimbId,frame:mirrorFrame(p,frame,link.phase)}:undefined;
}
export function validateMirrorLinks(p:Project){
 if(p.mirrorLinks===undefined)return;
 if(!p.mirrorLinks||typeof p.mirrorLinks!=='object'||Array.isArray(p.mirrorLinks))throw Error('Invalid animation mirror links.');
 for(const [layer,links] of Object.entries(p.mirrorLinks)){
  if(!['body','firstPerson'].includes(layer)||!Array.isArray(links)||links.length>200)throw Error('Invalid animation mirror links.');
  const targets=new Set<string>();
  for(const link of links){if(!link||!CONTROLS[link.source]||mirrorDestination(link.source)!==link.target||link.source===link.target||targets.has(link.target)||![0,.5].includes(link.phase))throw Error('Invalid mirror driver.');targets.add(link.target);
   for(const m of [link.sourceRest,link.targetRest,link.sourceParent,link.targetParent])if(!Array.isArray(m)||m.length!==16||!m.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<1e6)||Math.abs(new Matrix4().fromArray(m).determinant()-1)>.01)throw Error('Invalid mirror reference.');
  }
  if(links.some(l=>targets.has(l.source)))throw Error('Mirror links must have one editable source side.');
 }
}

/** Any bulk operation must also respect the driven side, including older tools
 * that write directly into tracks. Source-side edits stay ordinary undoable edits. */
export function preserveMirrorTargets(before:Project,after:Project){
 const links=liveMirrorLinks(after).filter(l=>mirrorDriver(before,l.target));if(!links.length)return;
 for(const link of links){
  if(!after.layers){after.tracks[link.target]=before.tracks[link.target];continue;}
  for(const layer of after.layers){const old=before.layers?.find(l=>l.id===layer.id);if(!old)continue;
   const oldTracks=old.id===before.activeLayerId?before.tracks:old.tracks;
   const tracks=layer.id===after.activeLayerId?after.tracks:layer.tracks;tracks[link.target]=oldTracks[link.target];
  }
 }
}

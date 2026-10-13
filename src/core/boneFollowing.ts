import {Matrix4,Quaternion,Vector3} from 'three';
import {controlEnabled} from './model';
import type {ControlId,Project,Track} from './model';
import {CONTROL_IDS} from './controls';
import {layerTracks} from './layers';
import {liveMirrorLinks,mirrorFrame,mirrorRestMatrices} from './liveMirror';
import {mirrorDestination} from './mirrorPose';
export interface BoneFollowing {target?:ControlId|'world'|'native';frame:number;position:boolean;rotation:boolean;world:number[];local:number[];parent:number[];}
export const activeBoneFollowing=(track:Track|undefined,frame:number)=>track?.following?.filter(key=>key.frame<=frame).at(-1);
function authoredFollowing(p:Project,frame:number){
 const result:Partial<Record<ControlId,BoneFollowing>>={},solo=p.layers?.some(l=>l.kind!=='base'&&l.enabled&&l.solo);
 for(const id of CONTROL_IDS){
  if(!controlEnabled(p,id,frame))continue;
  if(!p.layers){const key=activeBoneFollowing(p.tracks[id],frame);if(key)result[id]=key;continue;}
  for(const layer of p.layers){if(layer.kind!=='base'&&(!layer.enabled||layer.weight<=0||layer.excluded.includes(id)||solo&&!layer.solo))continue;const key=activeBoneFollowing(layerTracks(p,layer)[id],frame);if(key)result[id]=key;}
 }
 return result;
}
export function boneFollowing(p:Project,frame:number){
 const result=authoredFollowing(p,frame),links=liveMirrorLinks(p);if(!links.length)return result;
 const samples=new Map([[frame,{...result}]]),reflection=new Matrix4().makeScale(-1,1,1),rotation=(m:Matrix4)=>new Matrix4().extractRotation(m);
 for(const link of links){const at=mirrorFrame(p,frame,link.phase);let source=samples.get(at);if(!source){source=authoredFollowing(p,at);samples.set(at,source);}const key=source[link.source];delete result[link.target];if(!key)continue;
  const [a,b,ap,bp]=mirrorRestMatrices(link),child=rotation(a).invert().multiply(reflection).multiply(rotation(b));
  const target=key.target&&key.target!=='native'&&key.target!=='world'?mirrorDestination(key.target)??key.target:key.target;
  const parentLink=links.find(l=>l.source===key.target),parentMatrices=parentLink?mirrorRestMatrices(parentLink):undefined;
  const parent=key.target&&key.target!=='native'?(parentMatrices?rotation(parentMatrices[0]).invert().multiply(reflection).multiply(rotation(parentMatrices[1])):reflection.clone()):rotation(ap).invert().multiply(reflection).multiply(rotation(bp));
  result[link.target]={...key,frame,target,world:reflection.clone().multiply(new Matrix4().fromArray(key.world)).multiply(child).toArray(),local:parent.clone().invert().multiply(new Matrix4().fromArray(key.local)).multiply(child).toArray(),parent:reflection.clone().multiply(new Matrix4().fromArray(key.parent)).multiply(parent).toArray()};
 }
 return result;
}
function components(m:Matrix4){const p=new Vector3(),q=new Quaternion(),s=new Vector3();m.decompose(p,q,s);return {p,q,s};}
// Separate parent translation/orbit from orientation inheritance, keeping the
// captured pose continuous and the bone's own animation offsets editable.
export function followedBone(local:Matrix4,parent:Matrix4,key:BoneFollowing){
 const input=components(local),reference=components(new Matrix4().fromArray(key.local)),anchor=components(new Matrix4().fromArray(key.world)),atParent=new Matrix4().fromArray(key.parent),parentQ=components(parent).q,atParentQ=components(atParent).q;
 const p=key.position?input.p.clone().add(anchor.p.clone().applyMatrix4(atParent.clone().invert()).sub(reference.p)).applyMatrix4(parent):input.p.clone().sub(reference.p).applyQuaternion(atParentQ).add(anchor.p);
 const q=anchor.q.clone().multiply(reference.q.clone().invert()).multiply(input.q);
 if(key.rotation)q.premultiply(parentQ.multiply(atParentQ.clone().invert()));
 return new Matrix4().compose(p,q.normalize(),input.s);
}
export function unfollowedBone(world:Matrix4,parent:Matrix4,key:BoneFollowing){
 const target=components(world),reference=components(new Matrix4().fromArray(key.local)),anchor=components(new Matrix4().fromArray(key.world)),atParent=new Matrix4().fromArray(key.parent),atParentQ=components(atParent).q;
 const p=key.position?target.p.clone().applyMatrix4(parent.clone().invert()).sub(anchor.p.clone().applyMatrix4(atParent.clone().invert()).sub(reference.p)):target.p.clone().sub(anchor.p).applyQuaternion(atParentQ.clone().invert()).add(reference.p);
 const q=target.q.clone();if(key.rotation)q.premultiply(atParentQ.multiply(components(parent).q.invert()));
 q.premultiply(reference.q.clone().multiply(anchor.q.clone().invert()));return new Matrix4().compose(p,q.normalize(),target.s);
}

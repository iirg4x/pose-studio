import {Bone,Group,Matrix4,Quaternion,Vector3} from 'three';
import {MannyRig} from './rig';
import {BONE_CONTROLS,CONTROLS} from '../core/controls';
import {fromMatrix,limbMode,matrix,pose,rootChild} from '../core/model';
import {boneFollowing} from '../core/boneFollowing';
import {controllerConstraints} from '../core/controllerConstraints';
import type {ControlId,Pose,Project,Q4,V3} from '../core/model';
import type {MotionRig} from '../core/motionRig';

import {hasAxisBlend,blendLayerPoses} from '../core/layerBlend';

type Values=Record<ControlId,Pose>;
export type NativeSpace='local'|'mesh';
type BonePose={p:Vector3;q:Quaternion;world:Matrix4};
export interface NativeContext {inputs:Values;before:Map<string,BonePose>;after:Map<string,BonePose>;rig:MannyRig;values:Values;blendInputs:Partial<Values>;operations:Partial<Record<ControlId,(value:Pose,raw:Pose)=>Pose>>}
const caches=new WeakMap<MotionRig,MannyRig>();
const rotation=(m:Matrix4)=>new Quaternion().setFromRotationMatrix(m).normalize();

/** A native layer must evaluate identically without a renderer or GLB loader. */
export function nativeReferenceRig(reference:MotionRig){
 const cached=caches.get(reference);if(cached)return cached;
 if(!reference.parents||!reference.restRotations)throw Error('Native motion needs its reference hierarchy and rotations.');
 const root=new Group(),bones=new Map<string,Bone>(),worlds=new Map<string,Matrix4>(),visiting=new Set<string>();
 const add=(name:string):Bone=>{
  const found=bones.get(name);if(found)return found;if(visiting.has(name))throw Error('Reference hierarchy cycle.');visiting.add(name);
  const parentName=reference.parents![name],parent=parentName?add(parentName):root;
  const localQ=reference.restRotations![name],point=reference.positions[name];if(!localQ||!point)throw Error('Incomplete native reference skeleton.');
  const parentWorld=parentName?worlds.get(parentName)!:new Matrix4(),world=new Matrix4().compose(new Vector3(...point),rotation(parentWorld).multiply(new Quaternion(...localQ).normalize()),new Vector3(1,1,1));
  const bone=new Bone();bone.name=name;parent.add(bone);parentWorld.clone().invert().multiply(world).decompose(bone.position,bone.quaternion,bone.scale);worlds.set(name,world);bones.set(name,bone);visiting.delete(name);return bone;
 };
 for(const name of Object.keys(reference.positions))add(name);
 root.userData.canonicalSkinning=true;
 const rig=new MannyRig(root);rig.setMotionRig(reference);caches.set(reference,rig);return rig;
}
const capture=(rig:MannyRig)=>new Map([...rig.bones].map(([name,b])=>[name,{p:b.position.clone(),q:b.quaternion.clone(),world:b.matrixWorld.clone()}]));
const controlForBone=new Map(BONE_CONTROLS.map(id=>[CONTROLS[id].bone!,id]));

/** Compose native skeletal deltas, then expose the resulting IK end effectors.
 * The importer stores local translations in parent axes. Local rotations are
 * pre-multiplied control offsets; mesh rotations are world-axis offsets.
 */
export function nativeSkeletonPose(project:Project,frame:number,before:Values,deltas:Values,weight:(id:ControlId)=>number,space:NativeSpace,tracks?:Project['tracks']):NativeContext{
 const rig=nativeReferenceRig(project.motionRig!),world={...before};
 for(const id of Object.keys(before) as ControlId[])if(rootChild(id))world[id]=fromMatrix(matrix(before.root).multiply(matrix(before[id])),before[id]);
 rig.apply(world,Object.fromEntries((['arm_l','arm_r','leg_l','leg_r'] as const).map(id=>[id,limbMode(project,id,frame)])),boneFollowing(project,frame),project.ikReference==='fk',controllerConstraints(project));
 const operations:NativeContext['operations']={},blendInputs:Partial<Values>={};
 const original=capture(rig),root=before.root,rootDelta=deltas.root,rw=weight('root');
 let resultRoot=pose(root.p.map((v,i)=>v+rootDelta.p[i]*rw) as V3,new Quaternion().slerp(new Quaternion(...rootDelta.q),rw).multiply(new Quaternion(...root.q)).normalize().toArray() as Q4,root.grip,root.fov);
 blendInputs.root=root;
 if(tracks&&hasAxisBlend(tracks.root)){
  const apply=(v:Pose,d:Pose)=>pose(v.p.map((x,i)=>x+d.p[i]) as V3,new Quaternion(...d.q).multiply(new Quaternion(...v.q)).normalize().toArray() as Q4,v.grip,v.fov);
  operations.root=(v,d)=>blendLayerPoses(v,apply(v,d),apply(tracks.root.layerReference?.value??v,d),{position:new Quaternion(),rotation:new Quaternion()},tracks.root,frame,rw);
  resultRoot=operations.root(root,rootDelta);
 }
 for(const [name,bone] of rig.bones){
  const id=controlForBone.get(name),base=original.get(name)!,rest=rig.rest.get(name)!;
  if(name==='root'){bone.parent!.matrixWorld.clone().invert().multiply(matrix(resultRoot)).multiply(rest.world).decompose(bone.position,bone.quaternion,bone.scale);}
  else if(id){
   const delta=deltas[id],w=weight(id),q=new Quaternion().slerp(new Quaternion(...delta.q),w);
   if(tracks&&hasAxisBlend(tracks[id])){
    const lower=pose(base.p.clone().sub(rest.p).toArray() as V3,rest.q.clone().invert().multiply(base.q).normalize().toArray() as Q4,before[id].grip,before[id].fov);blendInputs[id]=lower;
    const originalParent=rotation(original.get(bone.parent!.name)?.world??new Matrix4()),newParent=bone.parent!.getWorldQuaternion(new Quaternion()),axis=space==='mesh'?rest.q.clone().invert().multiply(originalParent.clone().invert()):new Quaternion();
    const apply=(v:Pose,d:Pose):Pose=>{
     const orientation=space==='mesh'?rest.q.clone().invert().multiply(newParent.clone().invert()).multiply(new Quaternion(...d.q)).multiply(originalParent).multiply(rest.q).multiply(new Quaternion(...v.q)):new Quaternion(...d.q).multiply(new Quaternion(...v.q));
     return {...v,p:v.p.map((x,i)=>x+d.p[i]) as V3,q:orientation.normalize().toArray() as Q4};
    };
    operations[id]=(v,d)=>blendLayerPoses(v,apply(v,d),apply(tracks[id].layerReference?.value??v,d),{position:new Quaternion(),rotation:axis},tracks[id],frame,w);
    const result=operations[id]!(lower,delta);bone.position.copy(rest.p).add(new Vector3(...result.p));bone.quaternion.copy(rest.q).multiply(new Quaternion(...result.q));bone.updateWorldMatrix(false,false);continue;
   }
   bone.position.copy(base.p).addScaledVector(new Vector3(...delta.p),w);
   if(space==='mesh')bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert().multiply(q).multiply(rotation(base.world)));
   else bone.quaternion.copy(rest.q).multiply(q).multiply(rest.q.clone().invert()).multiply(base.q);
  }
  bone.updateWorldMatrix(false,false);
 }
 const result:Values={...before,root:resultRoot};
 for(const id of BONE_CONTROLS){const bone=rig.bodyBone(id),rest=rig.rest.get(bone.name)!;result[id]=pose(bone.position.clone().sub(rest.p).toArray() as V3,rest.q.clone().invert().multiply(bone.quaternion).normalize().toArray() as Q4,[0,0,0,0,0]);}
 const rootInv=matrix(resultRoot).invert();
 for(const side of ['l','r'])for(const [limb,upper,middle,end,target,pole] of [['arm','upperarm','lowerarm','hand','hand','elbow'],['leg','thigh','calf','foot','foot','knee']]){
  const id=(target+'_'+side) as ControlId,poleId=(pole+'_'+side) as ControlId;
  const a=rig.position(upper+'_'+side),b=rig.position(middle+'_'+side),c=rig.position(end+'_'+side),axis=c.clone().sub(a).normalize(),bend=b.clone().sub(a).addScaledVector(axis,-b.clone().sub(a).dot(axis));
  if(bend.lengthSq()<1e-12)bend.set(0,0,1);bend.normalize();
  result[id]=fromMatrix(rootInv.clone().multiply(rig.bones.get(end+'_'+side)!.matrixWorld),{...before[id],grip:[0,0,0,0,0]});
  result[poleId]={...before[poleId],p:b.addScaledVector(bend,limb==='arm'?.25:.4).applyMatrix4(rootInv).toArray() as V3};
 }
 return {inputs:before,before:original,after:capture(rig),rig,values:result,operations,blendInputs};
}

/** Undo a native stage while editing a lower layer. These rotations are
 * pre-multiplied native offsets, not ordinary parent-space layer offsets.
 * Mesh deltas also need both the lower and the blended parent's orientation.
 */
export function removeNativeBoneDelta(context:NativeContext,id:ControlId,target:Pose,delta:Pose,space:NativeSpace):Pose{
 const q=new Quaternion(...target.q),dq=new Quaternion(...delta.q).invert();
 if(id==='root'||space==='local')q.premultiply(dq);
 else{
  const name=CONTROLS[id].bone!,bone=context.rig.bones.get(name)!,rest=context.rig.rest.get(name)!;
  const parent=bone.parent!.name,before=rotation(context.before.get(parent)?.world??new Matrix4()),after=rotation(context.after.get(parent)?.world??new Matrix4());
  q.premultiply(rest.q.clone().invert().multiply(before.invert()).multiply(dq).multiply(after).multiply(rest.q));
 }
 const p=new Vector3(...target.p).sub(new Vector3(...delta.p));
 if(id!=='root'){
  // The lower rig may already include grip curl or following constraints.
  // Return its authored input, not that evaluated offset a second time.
  const name=CONTROLS[id].bone!,base=context.before.get(name)!,rest=context.rig.rest.get(name)!,input=context.inputs[id];
  q.premultiply(new Quaternion(...input.q).multiply(base.q.clone().invert()).multiply(rest.q));
  p.sub(base.p).add(rest.p).add(new Vector3(...input.p));
 }
 return {...target,p:p.toArray() as V3,q:q.normalize().toArray() as Q4};
}

/** A lower IK target changes the solved chain before native deltas are applied.
 * Invert that solve locally instead of treating the resulting effector as an
 * ordinary transform. Damping also handles a straight limb or a pole's unused
 * radial degree of freedom. Unreachable requests keep the closest solution.
 */
export function nativeTargetInput(context:NativeContext,id:ControlId,target:Pose,evaluate:(input:Pose)=>Pose):Pose{
 const rotates=/^(hand|foot)_/.test(id),size=rotates?6:3;
 const difference=(a:Pose,b:Pose)=>{
  const values=a.p.map((v,i)=>v-b.p[i]);
  if(rotates){const q=new Quaternion(...a.q).multiply(new Quaternion(...b.q).invert());if(q.w<0)q.set(-q.x,-q.y,-q.z,-q.w);const length=Math.hypot(q.x,q.y,q.z),factor=length<1e-12?.4:.4*Math.atan2(length,q.w)/length;values.push(q.x*factor,q.y*factor,q.z*factor);}
  return values;
 };
 const moved=(input:Pose,step:number[],amount=1):Pose=>{
  const q=new Quaternion(...input.q);
  if(rotates){const axis=new Vector3(...step.slice(3) as V3),angle=axis.length()*amount;if(angle>1e-12)q.premultiply(new Quaternion().setFromAxisAngle(axis.normalize(),angle));}
  return {...input,p:input.p.map((v,i)=>v+step[i]*amount) as V3,q:q.normalize().toArray() as Q4};
 };
 const norm=(v:number[])=>v.reduce((n,x)=>n+x*x,0);
 let input=context.inputs[id],output=context.values[id],error=difference(target,output),cost=norm(error);
 for(let iteration=0;iteration<12&&cost>1e-16;iteration++){
  const h=1e-4,columns=Array.from({length:size},(_,i)=>{const step=Array(size).fill(0);step[i]=h;return difference(evaluate(moved(input,step)),output).map(v=>v/h);});
  const system=columns.map((a,i)=>[...columns.map((b,j)=>a.reduce((sum,v,k)=>sum+v*b[k],0)+(i===j?1e-8:0)),a.reduce((sum,v,k)=>sum+v*error[k],0)]);
  // Small damped normal system, with pivoting; no renderer or matrix package.
  for(let i=0;i<size;i++){let pivot=i;for(let j=i+1;j<size;j++)if(Math.abs(system[j][i])>Math.abs(system[pivot][i]))pivot=j;[system[i],system[pivot]]=[system[pivot],system[i]];const scale=system[i][i];for(let k=i;k<=size;k++)system[i][k]/=scale;for(let j=0;j<size;j++)if(j!==i){const factor=system[j][i];for(let k=i;k<=size;k++)system[j][k]-=factor*system[i][k];}}
  const step=system.map(row=>row[size]),limit=Math.min(1,.15/Math.max(1e-12,Math.hypot(...step.slice(0,3))),.5/Math.max(1e-12,Math.hypot(...step.slice(3))));
  let improved=false;
  for(let amount=limit;amount>=limit/16;amount/=2){const candidate=moved(input,step,amount),value=evaluate(candidate),next=difference(target,value),nextCost=norm(next);if(nextCost<cost){input=candidate;output=value;error=next;cost=nextCost;improved=true;break;}}
  if(!improved)break;
 }
 return {...target,p:input.p,q:input.q};
}

/** Invert a keyed bone edit on the native layer, before later adjustments. */
export function nativeBoneOffset(context:NativeContext,id:ControlId,target:Pose,w:number,space:NativeSpace):Pose{
 const name=CONTROLS[id].bone!,base=context.before.get(name)!,bone=context.rig.bones.get(name)!,rest=context.rig.rest.get(name)!;
 const desiredLocal=rest.q.clone().multiply(new Quaternion(...target.q));
 const delta=space==='mesh'?rotation(context.after.get(bone.parent!.name)?.world??new Matrix4()).multiply(desiredLocal).multiply(rotation(base.world).invert()):new Quaternion(...target.q).multiply(base.q.clone().invert()).multiply(rest.q);
 return {...target,p:new Vector3(...target.p).add(rest.p).sub(base.p).multiplyScalar(1/w).toArray() as V3,q:new Quaternion().slerp(delta,1/w).normalize().toArray() as Q4};
}

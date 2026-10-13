import {Quaternion,Vector3} from 'three';
import {CONTROLS,isOffsetControl} from './controls';
import type {ControlId,Pose,Project,Q4,V3} from './model';
export type LayerSpace='local'|'parent'|'world';
export interface LayerBasis {parent:Quaternion;rest:Quaternion;local:Quaternion;parentPosition?:Vector3;restPosition?:Vector3}
type Values=Record<ControlId,Pose>;
let basisProvider:((values:Values,project:Project,frame:number)=>Partial<Record<ControlId,LayerBasis>>)|undefined;
export function setLayerBasisProvider(provider:typeof basisProvider){basisProvider=provider;}
export function layerBases(values:Values,project:Project,frame:number,needsWorld=true){
 const completeRest=Object.entries(CONTROLS).every(([id,c])=>!isOffsetControl(id as ControlId)||!!(c.bone&&project.motionRig?.restRotations?.[c.bone]));
 const bases=needsWorld||!completeRest?basisProvider?.(values,project,frame)??{}:{};
 // Imported clips retain their native local axes for headless evaluation and
 // export too. World-space edits still use the evaluated parent from the rig.
 for(const [id,control] of Object.entries(CONTROLS)){const q=control.bone&&project.motionRig?.restRotations?.[control.bone];if(q&&!bases[id as ControlId])bases[id as ControlId]={parent:new Quaternion(...values.root.q),rest:new Quaternion(...q),local:new Quaternion(...values[id as ControlId].q)};}
 return bases;
}
// Translation and rotation are composed separately: a world rotation changes
// orientation about this control, never orbits it around the scene origin.
export function layerDelta(value:Pose,delta:Pose,space:LayerSpace,basis:LayerBasis|undefined,root:Pose,parent:Pose|undefined,id:ControlId,inverse=false):Pose{
 const {position:axis,rotation:rotationAxis}=layerAxes(value,space,basis,root,parent,id),valueQ=new Quaternion(...value.q),deltaQ=new Quaternion(...delta.q);
 if(inverse){const p=new Vector3(...delta.p).sub(new Vector3(...value.p)).applyQuaternion(axis.clone().invert()),q=rotationAxis.clone().invert().multiply(deltaQ).multiply(valueQ.clone().invert()).multiply(rotationAxis);return {...delta,p:p.toArray() as V3,q:q.normalize().toArray() as Q4};}
 const p=new Vector3(...delta.p).applyQuaternion(axis).add(new Vector3(...value.p)),q=rotationAxis.clone().multiply(deltaQ).multiply(rotationAxis.clone().invert()).multiply(valueQ);
 return {...value,p:p.toArray() as V3,q:q.normalize().toArray() as Q4};
}
export function removeLayerDelta(target:Pose,delta:Pose,space:LayerSpace,basis:LayerBasis|undefined,root:Pose,parent:Pose|undefined,id:ControlId):Pose{
 const q=new Quaternion(...target.q),dq=new Quaternion(...delta.q).invert();
 if(space==='local')q.multiply(dq);
 else{const native=basis?.rest??new Quaternion(),rootQ=new Quaternion(...root.q),axis=isOffsetControl(id)?native.clone().invert().multiply(space==='world'?(basis?.parent??rootQ).clone().invert():new Quaternion()):space==='world'?rootQ.invert():new Quaternion(...(parent?.q??[0,0,0,1]));q.premultiply(axis.clone().multiply(dq).multiply(axis.invert()));}
 const base={...target,p:[0,0,0] as V3,q:q.normalize().toArray() as Q4},applied=layerDelta(base,delta,space,basis,root,parent,id);return {...base,p:target.p.map((v,i)=>v-applied.p[i]) as V3};
}

export function layerAxes(value:Pose,space:LayerSpace,basis:LayerBasis|undefined,root:Pose,parent:Pose|undefined,id:ControlId){
 const bone=isOffsetControl(id),rootQ=new Quaternion(...root.q),valueQ=new Quaternion(...value.q);
 const native=basis?.rest??new Quaternion(),parentQ=basis?.parent??rootQ;
 const axis=bone?(space==='world'?parentQ.clone().invert():space==='local'?native.clone().multiply(valueQ):new Quaternion()):(space==='world'?rootQ.clone().invert():space==='parent'?new Quaternion(...(parent?.q??[0,0,0,1])):valueQ);
 let rotationAxis:Quaternion;
 if(space==='local')rotationAxis=valueQ.clone();
 else if(bone)rotationAxis=native.clone().invert().multiply(space==='world'?parentQ.clone().invert():new Quaternion());
 else rotationAxis=axis.clone();
 return {position:axis,rotation:rotationAxis};
}

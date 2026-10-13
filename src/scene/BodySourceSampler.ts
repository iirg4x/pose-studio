import {controllerConstraints} from '../core/controllerConstraints';
import {IDS,clone,fromMatrix,limbMode} from '../core/model';
import type {ControlId,Pose,Project,Q4,V3} from '../core/model';
import {isBoneControl} from '../core/controls';
import {boneFollowing} from '../core/boneFollowing';
import {AttachmentSolver} from './attachments';
import type {MannyRig} from './rig';
// Read the solved body pose so first-person sources include IK and attachments,
// not merely the pre-constraint animation channels.
export class BodySourceSampler {
 private attachments=new AttachmentSolver();private cache=new WeakMap<Project,Map<number,Record<ControlId,Pose>>>();
 constructor(private rig:MannyRig){}
 sample=(source:Project,frame:number,input:Record<ControlId,Pose>)=>{
  let frames=this.cache.get(source);if(frames?.has(frame)&&IDS.every(id=>frames!.get(frame)![id]))return clone(frames.get(frame)!);
  const values=clone(input),modes=Object.fromEntries((['arm_l','arm_r','leg_l','leg_r'] as const).map(id=>[id,limbMode(source,id,frame)]));
  this.rig.setMotionRig(source.motionRig);this.rig.apply(values,modes,boneFollowing(source,frame),source.ikReference==='fk',controllerConstraints(source));this.attachments.apply(this.rig,values,source,frame);
  for(const id of IDS){
   if(isBoneControl(id)){
    const bone=this.rig.bodyBone(id);values[id]={...values[id],p:bone.position.clone().sub(this.rig.offsetPositionBase(id)).toArray() as V3,q:this.rig.offsetBase(id).invert().multiply(bone.quaternion).normalize().toArray() as Q4};
   }else if(/^hand_[lr]$/.test(id))values[id]=fromMatrix(this.rig.bones.get(id)!.matrixWorld,values[id]);
  }
  if(!frames){frames=new Map();this.cache.set(source,frames);}if(frames.size>=32)frames.delete(frames.keys().next().value!);frames.set(frame,clone(values));return values;
 };
}

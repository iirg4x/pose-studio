import {beforeAll,describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import {Matrix4,Quaternion,Vector3} from 'three';
import {captureControlLayerReference,addAnimationLayer,activeAnimationLayer,syncLayers,selectAnimationLayer} from '../src/core/layers';
import {createProject,evaluate,matrix,pose,putKey,rawForWorld,validateProject,clone} from '../src/core/model';
import {BONE_CONTROLS} from '../src/core/controls';
import {nativeReferenceRig} from '../src/scene/nativeSkeleton';
import type {NativeSpace} from '../src/scene/nativeSkeleton';
import type {ControlId,Pose,Project} from '../src/core/model';
import {nativeRotationResidual} from '../src/core/nativeRotationLinks';

let fixture:{motionRig:Project['motionRig'];frames:{frame:number;values:Record<ControlId,Pose>}[]};
beforeAll(async()=>{fixture=JSON.parse(await fs.readFile('tests/fixtures/holster-elbow-flip.json','utf8'));});
function motion(space:NativeSpace){
 const base=createProject({},false);base.motionRig=clone(fixture.motionRig);base.ikReference='fk';base.end=23;
 const modes={arm_l:'ik',arm_r:'ik',leg_l:'fk',leg_r:'fk'} as const;base.limbModes={firstPerson:Object.fromEntries(Object.entries(modes).map(([id,mode])=>[id,[{frame:0,mode}]]))};
 const initial=fixture.frames[0].values,full=fixture.frames.find(f=>f.frame===13)!.values;
 for(const id of Object.keys(base.tracks) as ControlId[])base.tracks[id]={keys:[{...initial[id]??pose(),frame:0}],spaces:[],interpolation:'linear'};
 const p=addAnimationLayer(base,'additive');p.layers![0].static=true;activeAnimationLayer(p)!.nativeSpace=space;activeAnimationLayer(p)!.space='parent';
 const rig=nativeReferenceRig(p.motionRig!);rig.apply(initial,modes,{},true);
 const before=new Map([...rig.bones].map(([n,b])=>[n,{p:b.position.clone(),q:b.quaternion.clone(),world:b.getWorldQuaternion(new Quaternion())}]));
 rig.apply(full,{arm_l:'fk',arm_r:'fk',leg_l:'fk',leg_r:'fk'},{},true);
 for(const id of BONE_CONTROLS){const b=rig.bodyBone(id),a=before.get(b.name)!,rest=rig.rest.get(b.name)!,q=space==='local'?rest.q.clone().invert().multiply(b.quaternion).multiply(a.q.clone().invert()).multiply(rest.q):b.getWorldQuaternion(new Quaternion()).multiply(a.world.clone().invert());putKey(p.tracks[id],13,pose(b.position.clone().sub(a.p).toArray(),q.normalize().toArray(),[0,0,0,0,0]));}
 return syncLayers(p);
}
const near=(a:Pose,b:Pose)=>matrix(a).elements.forEach((v,i)=>expect(v).toBeCloseTo(matrix(b).elements[i],6));
describe('native additive layers with editable IK',()=>{
 for(const space of ['local','mesh'] as const){
  it(space+': leaves base motion exact when muted or weighted to zero',()=>{
   const p=motion(space),base={...p,layers:undefined,activeLayerId:undefined,tracks:p.layers![0].tracks};
   activeAnimationLayer(p)!.weight=0;for(const id of ['hand_l','elbow_l','wrist_l','thumb_03_l','rifle'] as const)near(evaluate(p,13)[id],evaluate(base,0)[id]);
   activeAnimationLayer(p)!.weight=1;activeAnimationLayer(p)!.enabled=false;near(evaluate(p,13).hand_l,evaluate(base,0).hand_l);
  });
  it(space+': round-trips bone edits and IK targets above the native blend',()=>{
   const p=motion(space);activeAnimationLayer(p)!.weight=.5;
   const hand=clone(evaluate(p,13).hand_l);hand.p[1]+=.025;hand.q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.1).multiply(new Quaternion(...hand.q)).toArray();putKey(p.tracks.hand_l,13,rawForWorld(p,'hand_l',13,hand));near(evaluate(p,13).hand_l,hand);
   const shoulder=clone(evaluate(p,13).shoulder_l);shoulder.q=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.12).multiply(new Quaternion(...shoulder.q)).toArray();putKey(p.tracks.shoulder_l,13,rawForWorld(p,'shoulder_l',13,shoulder));near(evaluate(p,13).shoulder_l,shoulder);
   expect(()=>validateProject(JSON.parse(JSON.stringify(syncLayers(p))))).not.toThrow();
  });
  it(space+': keeps ordinary pose adjustments above the source editable',()=>{
   const p=addAnimationLayer(motion(space),'pose'),hand=clone(evaluate(p,13).hand_l);hand.p[1]-=.1;putKey(p.tracks.hand_l,0,rawForWorld(p,'hand_l',13,hand));near(evaluate(p,13).hand_l,hand);
  });
  it(space+': edits imported bone curves in their stored basis',()=>{
   const p=motion(space),track=p.tracks.shoulder_l;
   track.basis={pre:new Matrix4().toArray(),post:new Matrix4().makeRotationX(.2).toArray()};
   const wanted=clone(evaluate(p,13).shoulder_l);wanted.p[1]+=.012;
   wanted.q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.1).multiply(new Quaternion(...wanted.q)).toArray();
   putKey(track,13,rawForWorld(p,'shoulder_l',13,wanted));near(evaluate(p,13).shoulder_l,wanted);
  });
  it(space+': round-trips base and intermediate pose edits beneath the native animation',()=>{
   for(const intermediate of [false,true])for(const weight of [.35,1]){
    let p=motion(space);activeAnimationLayer(p)!.weight=weight;
    if(intermediate){p=addAnimationLayer(p,'pose');const layers=p.layers!;[layers[1],layers[2]]=[layers[2],layers[1]];}
    else selectAnimationLayer(p,p.layers![0].id);
    for(const id of ['root','hips','shoulder_l','head','index_01_l'] as const){
     const current=clone(evaluate(p,13)[id]);putKey(p.tracks[id],0,rawForWorld(p,id,13,current));near(evaluate(p,13)[id],current);
     const wanted=clone(current);wanted.p[1]+=.012;wanted.q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.1).multiply(new Quaternion(...wanted.q)).toArray();
     putKey(p.tracks[id],0,rawForWorld(p,id,13,wanted));near(evaluate(p,13)[id],wanted);
    }
   }
  });
  it(space+': edits a nonidentity root on the active native layer',()=>{
   const p=motion(space);activeAnimationLayer(p)!.weight=.4;
   p.layers![0].tracks.root.keys[0]={...pose([.1,.2,.3],new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.4).toArray()),frame:0};
   const wanted=pose([.2,.1,.4],new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.3).toArray());
   putKey(p.tracks.root,13,rawForWorld(p,'root',13,wanted));near(evaluate(p,13).root,wanted);
  });
  it(space+': preserves lower IK keys and solves reachable edits beneath the native animation',()=>{
   const p=motion(space);activeAnimationLayer(p)!.weight=.35;selectAnimationLayer(p,p.layers![0].id);
   for(const id of ['hand_l','hand_r','elbow_l'] as const){
    const original=clone(p.tracks[id].keys[0]),current=clone(evaluate(p,13)[id]);
    putKey(p.tracks[id],0,rawForWorld(p,id,13,current));near(p.tracks[id].keys[0],original);near(evaluate(p,13)[id],current);
    // Build a reachable request by independently moving the lower IK input.
    const reference=clone(p),changed=clone(original);changed.p[0]+=.006;changed.p[1]-=.004;
    if(id.startsWith('hand'))changed.q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.08).multiply(new Quaternion(...changed.q)).toArray();
    putKey(reference.tracks[id],0,changed);const wanted=evaluate(reference,13)[id];
    putKey(p.tracks[id],0,rawForWorld(p,id,13,wanted));near(evaluate(p,13)[id],wanted);
   }
  });
  it(space+': does not bake the lower grip curl into a finger key',()=>{
   const p=motion(space);p.layers![0].tracks.hand_l.keys[0].grip=[.2,.3,.4,.5,.6];selectAnimationLayer(p,p.layers![0].id);
   const original=clone(p.tracks.index_01_l.keys[0]),current=evaluate(p,13).index_01_l;
   putKey(p.tracks.index_01_l,0,rawForWorld(p,'index_01_l',13,current));near(p.tracks.index_01_l.keys[0],original);near(evaluate(p,13).index_01_l,current);
  });
 }
 it('rejects cyclic or incomplete native reference hierarchies',()=>{
  const p=motion('local');p.motionRig!.parents!.root='hand_l';expect(()=>validateProject(p)).toThrow(/hierarchy/);
 });
 it('preserves native mesh weighting when parent and child rotations are factored',()=>{
  for(const weight of [0,.2,.5,1]){
   const original=motion('mesh');activeAnimationLayer(original)!.weight=weight;
   const p=clone(original),layer=activeAnimationLayer(p)!;
   const raw=Object.fromEntries(Object.entries(p.tracks).map(([id,t])=>[id,t.keys.at(-1)!])) as Record<ControlId,Pose>;
   layer.nativeRotationLinks={thumb_01_l:'wrist_l',thumb_02_l:'thumb_01_l',thumb_03_l:'thumb_02_l'};
   for(const id of Object.keys(layer.nativeRotationLinks) as ControlId[])putKey(p.tracks[id],13,nativeRotationResidual(id,raw[id],raw,layer.nativeRotationLinks));
   for(const id of ['wrist_l','thumb_01_l','thumb_02_l','thumb_03_l','hand_l'] as const)near(evaluate(p,13)[id],evaluate(original,13)[id]);
   expect(()=>validateProject(JSON.parse(JSON.stringify(syncLayers(p))))).not.toThrow();
  }
 });
 it('edits linked native rotations in stored curve bases without double-applying the driver',()=>{
  const p=motion('mesh'),layer=activeAnimationLayer(p)!;layer.nativeRotationLinks={thumb_01_l:'wrist_l'};layer.weight=.6;
  p.tracks.thumb_01_l.basis={pre:new Matrix4().toArray(),post:new Matrix4().makeRotationX(.2).toArray()};
  const wanted=clone(evaluate(p,13).thumb_01_l);wanted.q=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.17).multiply(new Quaternion(...wanted.q)).toArray();
  putKey(p.tracks.thumb_01_l,13,rawForWorld(p,'thumb_01_l',13,wanted));near(evaluate(p,13).thumb_01_l,wanted);
  selectAnimationLayer(p,p.layers![0].id);const baseEdit=clone(evaluate(p,13).thumb_01_l);baseEdit.q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.09).multiply(new Quaternion(...baseEdit.q)).toArray();
  putKey(p.tracks.thumb_01_l,0,rawForWorld(p,'thumb_01_l',13,baseEdit));near(evaluate(p,13).thumb_01_l,baseEdit);
 });
 it('rejects native rotation link cycles, invalid targets, and local-layer links',()=>{
  for(const links of [{thumb_01_l:'thumb_01_l'},{thumb_01_l:'thumb_02_l',thumb_02_l:'thumb_01_l'},{thumb_01_l:'rifle'}]){
   const p=motion('mesh');activeAnimationLayer(p)!.nativeRotationLinks=links as never;expect(()=>validateProject(p)).toThrow(/rotation link/i);
  }
  const p=motion('local');activeAnimationLayer(p)!.nativeRotationLinks={thumb_01_l:'wrist_l'};expect(()=>validateProject(p)).toThrow(/rotation link/i);
 });
});

describe('independent native layer blend channels',()=>{
 for(const space of ['local','mesh'] as const)it(space+': preserves native source at default axis settings and inverts mixed weighted edits',()=>{
  const p=motion(space),original=clone(p),track=p.tracks.shoulder_l;captureControlLayerReference(p,'shoulder_l',13);
  const curve=(value:number)=>({keys:[{frame:0,value,interpolation:'linear' as const,handle:'vector' as const}],modifiers:[]});
  track.curves={blendWeight_px:curve(100)};
  for(const f of [0,6.5,13])near(evaluate(p,f).shoulder_l,evaluate(original,f).shoulder_l);
  track.curves.blendReplace_ry=curve(50);track.curves.blendWeight_rz=curve(45);
  const wanted=clone(evaluate(p,9).shoulder_l);wanted.p[1]+=.004;wanted.q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.08).multiply(new Quaternion(...wanted.q)).toArray();
  putKey(track,9,rawForWorld(p,'shoulder_l',9,wanted));near(evaluate(p,9).shoulder_l,wanted);
  expect(()=>validateProject(JSON.parse(JSON.stringify(syncLayers(p))))).not.toThrow();
 });
});

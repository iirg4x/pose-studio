import {describe,it,expect} from 'vitest';
import {Matrix4,Quaternion,Vector3} from 'three';
import {createProject,evaluate,IDS,matrix,pose,putKey,rawForWorld,validateProject} from '../src/core/model';
import {addAnimationLayer,ensureLayers,selectAnimationLayer,syncLayers,keyingFrame} from '../src/core/layers';
import {poseLayerOffsets} from '../src/core/poseDecomposition';
import {StudioStore} from '../src/core/store';
import {library} from '../src/core/library';
const near=(a:number[],b:number[])=>a.forEach((n,i)=>expect(n).toBeCloseTo(b[i],6));

describe('native reference pose reconstruction',()=>{
 it('applies and inverts a fitted adjustment track reference rotation',()=>{
  const p=addAnimationLayer(createProject({},false),'additive'),t=p.tracks.rifle;
  const reference=new Matrix4().makeRotationX(.7),delta=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.3);
  t.basis={pre:new Matrix4().toArray(),post:reference.toArray()};t.keys=[{...pose([.1,0,0],delta.toArray()),frame:0}];
  const base=evaluate({...p,layers:undefined,tracks:p.layers![0].tracks},0).rifle;
  const expected=new Quaternion(...base.q).multiply(delta).multiply(new Quaternion().setFromRotationMatrix(reference));
  expect(new Quaternion(...evaluate(p,0).rifle.q).angleTo(expected)).toBeLessThan(1e-6);
  const desired=evaluate(p,0).rifle;desired.q=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),-.4).toArray();desired.p[2]+=.1;
  putKey(t,0,rawForWorld(p,'rifle',0,desired));near(matrix(evaluate(p,0).rifle).elements,matrix(desired).elements);
 });
 it('recomposes noncommuting rotations, native bone translations and prop contacts',()=>{
  const base=createProject({},false);base.bodyBase=undefined;
  for(const id of IDS)base.tracks[id]={keys:[{...pose(),frame:0}],spaces:[],interpolation:'smooth'};
  const q=(axis:number[],angle:number)=>new Quaternion().setFromAxisAngle(new Vector3(...axis),angle).toArray();
  base.motionRig={partial:true,positions:{pelvis:[0,1,0],hand_l:[.4,1,0],hand_r:[-.4,1,0]},restRotations:{pelvis:q([0,0,1],.5)}};
  base.tracks.root.keys[0]={...pose([.3,.1,.2],q([0,1,0],.7)),frame:0};
  base.tracks.hips.keys[0]={...pose([.02,.1,0],q([1,0,0],.2)),frame:0};
  base.tracks.rifle.keys[0]={...pose([.2,1,.5],q([1,0,0],-.4)),frame:0};
  base.tracks.hand_l.keys[0]={...pose([.1,0,.2],q([0,0,1],.3)),frame:0};
  base.tracks.hand_l.spaces=[{frame:0,parent:'rifle',offset:new Matrix4().toArray(),base:new Matrix4().toArray()}];
  const target=structuredClone(base);target.tracks.rifle.keys[0]={...pose([.4,.8,.6],q([0,1,0],.6)),frame:0};
  target.tracks.hand_l.keys[0].p[2]+=.07;target.tracks.hips.keys[0].p[0]-=.1;
  target.tracks.hips.keys[0].q=q([0,0,1],-.4);target.tracks.root.keys[0].q=q([1,0,0],.3);
  const wanted=evaluate(target,0),offsets=poseLayerOffsets(base,wanted),stack=addAnimationLayer(base,'additive');
  stack.layers![0].static=true;stack.layers![1].excluded=[];
  for(const id of IDS)stack.tracks[id].keys=[{...offsets[id],frame:0}];
  for(const id of IDS)near(matrix(evaluate(stack,17)[id]).elements,matrix(wanted[id]).elements);
  stack.layers![1].enabled=false;for(const id of IDS)near(matrix(evaluate(stack,17)[id]).elements,matrix(evaluate(base,0)[id]).elements);
  const loaded=validateProject(JSON.parse(JSON.stringify(syncLayers(stack))));expect(loaded.layers![0].static).toBe(true);
 });
 it('edits a base pose once across the clip without pausing playback or adding frame keys',()=>{
  const p=ensureLayers(createProject({},false));p.layers![0].static=true;p.layers![0].name='Idle pose';
  for(const id of IDS){p.tracks[id].keys=[{...p.tracks[id].keys[0],frame:0}];p.tracks[id].spaces=[];delete p.tracks[id].curves;}
  const store=new StudioStore();store.open(library(p));store.setFrame(12);store.patch({playing:true,autoKey:true});
  const value=evaluate(store.state.project!,12).hips;value.p[1]-=.1;store.editRaw('hips',value);
  expect(store.state.playing).toBe(true);expect(store.state.project!.tracks.hips.keys.map(k=>k.frame)).toEqual([0]);
  near(evaluate(store.state.project!,0).hips.p,evaluate(store.state.project!,40).hips.p);
  expect(keyingFrame(selectAnimationLayer(store.state.project!,p.activeLayerId!),40)).toBe(0);
 });
});

import {describe,it,expect} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {createProject,createBodyAction,evaluate,putKey,rawForWorld,clone,matrix,validateProject} from '../src/core/model';
import {addAnimationLayer,selectAnimationLayer,activeAnimationLayer,syncLayers} from '../src/core/layers';
import {StudioStore} from '../src/core/store';
import {library,entry,validateLibrary,refreshBases} from '../src/core/library';
const near=(a:number[],b:number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],6));
const body=()=>createBodyAction(createProject({},false),'fp');
describe('animation layer stack',()=>{
 it('preserves existing actions and their contacts when inserting empty layers',()=>{
  const original=body();const saved=JSON.stringify(original.bodyBase!.source);const stacked=addAnimationLayer(addAnimationLayer(original,'pose'),'additive');
  for(const f of [0,12,13,40,96])for(const id of ['root','hand_l','rifle','hips','head'] as const)near(matrix(evaluate(stacked,f)[id]).elements,matrix(evaluate(original,f)[id]).elements);
  expect(JSON.stringify(stacked.bodyBase!.source)).toBe(saved);expect(()=>validateProject(stacked)).not.toThrow();
 });
 it('stacks a static body pose and keyed polish while preserving contacts and independent hand corrections',()=>{
  let p=addAnimationLayer(body(),'pose');const initial=evaluate(p,0),relative=matrix(initial.rifle).invert().multiply(matrix(initial.hand_l));
  const target=clone(initial.rifle);target.p[0]+=.3;target.q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.4).toArray();putKey(p.tracks.rifle,0,rawForWorld(p,'rifle',0,target));
  for(const f of [0,12,36])near(matrix(evaluate(p,f).rifle).invert().multiply(matrix(evaluate(p,f).hand_l)).elements,relative.elements);
  p=addAnimationLayer(p,'additive');const hand=clone(evaluate(p,12).hand_l);hand.p[1]+=.08;putKey(p.tracks.hand_l,12,rawForWorld(p,'hand_l',12,hand));near(evaluate(p,12).hand_l.p,hand.p);
  expect(p.layers![1].tracks.rifle.keys).toHaveLength(1);expect(p.tracks.hand_l.keys).toHaveLength(2);near(evaluate(p,12).rifle.p,target.p);
 });
 it('inverts edits on a lower layer through noncommuting upper rotations and contact following',()=>{
  let p=addAnimationLayer(body(),'additive');const lower=p.activeLayerId!;
  p=addAnimationLayer(p,'additive');let target=clone(evaluate(p,8).rifle);target.q=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.7).toArray();target.p[2]+=.2;putKey(p.tracks.rifle,8,rawForWorld(p,'rifle',8,target));
  selectAnimationLayer(p,lower);target=clone(evaluate(p,8).rifle);target.q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),-.6).toArray();target.p[0]+=.15;putKey(p.tracks.rifle,8,rawForWorld(p,'rifle',8,target));near(matrix(evaluate(p,8).rifle).elements,matrix(target).elements);
  const hand=clone(evaluate(p,8).hand_l);hand.p[2]-=.06;putKey(p.tracks.hand_l,8,rawForWorld(p,'hand_l',8,hand));near(evaluate(p,8).hand_l.p,hand.p);
 });
 it('respects weight, mute, solo, masks, and free contacts without changing stored offsets',()=>{
  let p=addAnimationLayer(body(),'pose');const baseline=evaluate(p,0);p.tracks.rifle.keys[0].p[0]=.2;activeAnimationLayer(p)!.weight=.5;const half=evaluate(p,0);expect(new Vector3(...half.rifle.p).distanceTo(new Vector3(...baseline.rifle.p))).toBeCloseTo(.1);
  const raw=JSON.stringify(p.tracks);activeAnimationLayer(p)!.enabled=false;near(evaluate(p,0).rifle.p,baseline.rifle.p);activeAnimationLayer(p)!.enabled=true;activeAnimationLayer(p)!.excluded.push('rifle');near(evaluate(p,0).rifle.p,baseline.rifle.p);activeAnimationLayer(p)!.excluded=[];activeAnimationLayer(p)!.contacts=false;near(evaluate(p,0).hand_l.p,baseline.hand_l.p);expect(JSON.stringify(p.tracks)).toBe(raw);
  p=addAnimationLayer(p,'additive');activeAnimationLayer(p)!.solo=true;near(evaluate(p,0).rifle.p,baseline.rifle.p);activeAnimationLayer(p)!.solo=false;
  activeAnimationLayer(p)!.weight=.25;const desired=clone(evaluate(p,0).hand_l);desired.p[1]+=.02;putKey(p.tracks.hand_l,0,rawForWorld(p,'hand_l',0,desired));near(evaluate(p,0).hand_l.p,desired.p);
 });
 it('applies root transforms once and saves all layers including the active draft of tracks',()=>{
  let p=addAnimationLayer(body(),'pose');const before=evaluate(p,0);p.tracks.root.keys[0].p[0]=.4;near(evaluate(p,0).rifle.p,[before.rifle.p[0]+.4,before.rifle.p[1],before.rifle.p[2]]);
  p=addAnimationLayer(p,'additive');const hand=clone(evaluate(p,10).hand_l);hand.p[0]+=.07;putKey(p.tracks.hand_l,10,rawForWorld(p,'hand_l',10,hand));const restored=validateProject(JSON.parse(JSON.stringify(syncLayers(p))));near(evaluate(restored,10).hand_l.p,hand.p);expect(restored.layers).toHaveLength(3);
 });
 it('keeps static edits at frame zero and supports independent undo, reorder, duplicate and delete',()=>{
  const s=new StudioStore();s.open(library(body()));s.addLayer('pose');const poseId=s.state.project!.activeLayerId!;s.setFrame(12);const hips=clone(evaluate(s.state.project!,12).hips);hips.p[1]-=.1;s.editRaw('hips',hips);expect(s.state.project!.tracks.hips.keys.map(k=>k.frame)).toEqual([0]);near(evaluate(s.state.project!,70).hips.p,hips.p);
  s.addLayer('additive');const fineId=s.state.project!.activeLayerId!;s.duplicateLayer(fineId);expect(s.state.project!.layers).toHaveLength(4);s.undo();expect(s.state.project!.layers).toHaveLength(3);s.moveLayer(fineId,-1);expect(s.state.project!.layers![1].id).toBe(fineId);s.undo();s.removeLayer(fineId);s.undo();expect(s.state.project!.layers).toHaveLength(3);s.selectLayer(poseId);near(evaluate(s.state.project!,70).hips.p,hips.p);expect(()=>validateLibrary(s.snapshot())).not.toThrow();
 });
 it('refreshes live FP sources without losing the stack or including the camera/head',()=>{
  const lib=library(createProject({},false)),source=lib.clips[0],b=entry(addAnimationLayer(createBodyAction(source.project,source.id),'pose'));lib.clips.push(b);b.project.tracks.hips.keys[0].p[1]=-.1;const before=evaluate(b.project,0);source.project.tracks.rifle.keys[0].p[0]+=.1;source.project.tracks.head.keys[0].q=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.8).toArray();refreshBases(lib);expect(evaluate(b.project,0).rifle.p[0]-before.rifle.p[0]).toBeCloseTo(.1);near(evaluate(b.project,0).head.q,[0,0,0,1]);near(evaluate(b.project,0).hips.p,[0,-.1,0]);expect(b.project.layers).toHaveLength(2);
 });
});

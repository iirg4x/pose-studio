import {describe,expect,it} from 'vitest';
import {Matrix4} from 'three';
import {blankProject} from '../src/core/assets';
import {clone} from '../src/core/model';
import {makeMirrorLinks} from '../src/core/liveMirror';
import {sharedRuntimeState,sharedRuntimeStateLayout} from '../src/core/sharedRuntimeState';
import {retargetContact} from '../src/core/retargetContact';
const identity=new Matrix4().toArray();
const following=(frame:number,target:'rifle'|'magazine'|'world',position=true)=>({frame,target,position,rotation:true,world:identity,parent:identity,local:identity});
const setup=()=>{const p=blankProject();p.end=30;p.fps=25;for(const limb of ['arm_l','arm_r'] as const)p.limbModes!.body![limb]=[{frame:0,mode:'ik'}];return p;};
const layout=sharedRuntimeStateLayout(['magazine','rifle']);
describe('shared runtime animation state',()=>{
 it('preserves fractional IK/FK switches without changing project keys',()=>{
  const p=setup();p.limbModes!.body!.arm_l=[{frame:0,mode:'ik'},{frame:4.25,mode:'fk'},{frame:8.5,mode:'ik'}];const before=clone(p);
  expect([0,4.249999,4.25,8.49,8.5].map(f=>sharedRuntimeState(p,f,layout).pose_arm_l_ik)).toEqual([1,1,0,0,1]);expect(p).toEqual(before);
 });
 it('retains anticipation and release weights and resolves the same slot in every clip',()=>{
  const p=setup();p.tracks.hand_l.following=[following(0,'world'),following(10,'rifle'),following(15,'world')];
  const samples=[6,8.5,10,14.9,15,16.5,18.01].map(f=>sharedRuntimeState(p,f,layout));
  expect(samples.map(v=>v.pose_hand_l_contact_parent)).toEqual([0,2,2,2,2,2,0]);
  expect(samples.map(v=>v.pose_hand_l_contact_weight)).toEqual([0,.5,1,1,1,.5,0]);
  const other=setup();other.tracks.hand_l.following=[following(0,'magazine')];expect(sharedRuntimeState(other,0,layout).pose_hand_l_contact_parent).toBe(1);
 });
 it('does not turn rotation-only following into a positional grip',()=>{
  const p=setup();p.tracks.hand_l.following=[following(0,'rifle',false)];expect(retargetContact(p,'hand_l',0)).toBeUndefined();expect(sharedRuntimeState(p,5,layout).pose_hand_l_contact_weight).toBe(0);
 });
 it('inherits base animation modes at the source frame rate',()=>{
  const source=setup();source.fps=60;source.limbModes!.body!.arm_r=[{frame:0,mode:'ik'},{frame:12,mode:'fk'}];
  const p=setup();p.fps=30;p.limbModes=undefined;p.bodyBase={sourceId:'base',source,enabled:true,excluded:[]};
  expect(sharedRuntimeState(p,5.999,layout).pose_arm_r_ik).toBe(1);expect(sharedRuntimeState(p,6,layout).pose_arm_r_ik).toBe(0);
 });
 it('carries the live half-cycle mirror mode and parent changes',()=>{
  const p=setup();p.loop={enabled:true,start:0,end:30};p.limbModes!.body!.arm_l=[{frame:0,mode:'ik'},{frame:15,mode:'fk'}];p.tracks.hand_l.following=[following(0,'rifle'),following(15,'magazine')];
  p.mirrorLinks={body:makeMirrorLinks(p,['hand_l'],.5,()=>({world:new Matrix4(),parent:new Matrix4()}))};
  expect(sharedRuntimeState(p,0,layout).pose_arm_r_ik).toBe(0);
  expect(sharedRuntimeState(p,15,layout).pose_arm_r_ik).toBe(1);
  p.limbModes!.body!.arm_l=[{frame:0,mode:'ik'}];
  expect(sharedRuntimeState(p,0,layout).pose_hand_r_contact_parent).toBe(1);
  expect(sharedRuntimeState(p,15,layout).pose_hand_r_contact_parent).toBe(2);
 });
 it('rejects missing prop slots and invalid sample times',()=>{
  const p=setup();p.tracks.hand_l.following=[following(0,'rifle')];expect(()=>sharedRuntimeState(p,0,sharedRuntimeStateLayout([]))).toThrow(/Missing/);
  for(const f of [-1,31,NaN,Infinity])expect(()=>sharedRuntimeState(p,f,layout)).toThrow(/frame/);
  expect(()=>sharedRuntimeStateLayout(['rifle','rifle'])).toThrow(/slots/);
 });
});

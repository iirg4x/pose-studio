import {describe,it,expect} from 'vitest';
import {createProject,pose,putKey,sample,switchParent,validateProject,clone} from '../src/core/model';
import {addAnimationLayer} from '../src/core/layers';
import {Matrix4} from 'three';
import {moveTimelineKeys,copyTimelineKeys,pasteTimelineKeys} from '../src/core/timelineKeys';
import {StudioStore} from '../src/core/store';
import {ensureCurve} from '../src/core/curves';

describe('fractional animation keys',()=>{
 it('edits a selected subframe without inserting an integer-frame key',()=>{
  const p=createProject({},false),t=p.tracks.root;ensureCurve(t,'px');
  putKey(t,12.25,pose([.1,0,0]));
  const s=new StudioStore();s.open(p);s.setFrame(12.25);s.editRaw('root',pose([.2,0,0]));
  expect(s.state.frame).toBe(12.25);
  expect(s.state.project!.tracks.root.keys.map(k=>k.frame)).toEqual([0,12.25]);
  expect(s.state.project!.tracks.root.curves!.px!.keys.map(k=>k.frame)).toEqual([0,12.25]);
  expect(sample(s.state.project!.tracks.root,12.25).p[0]).toBeCloseTo(.2);
  s.undo();expect(sample(s.state.project!.tracks.root,12.25).p[0]).toBeCloseTo(.1);
 });
 it('keeps attachment boundaries and channels together during fractional moves and paste',()=>{
  for(const layered of [false,true]){
   let p=createProject({},false);if(layered)p=addAnimationLayer(p,'additive');
   putKey(p.tracks.hand_l,12.25,pose([.1,.2,.3]));ensureCurve(p.tracks.hand_l,'px');p=switchParent(p,'hand_l','rifle',12.25);
   expect(p.tracks.hand_l.spaces.at(-1)!.frame).toBe(12.25);expect(()=>validateProject(clone(p))).not.toThrow();
   const moved=moveTimelineKeys(p,[{id:'hand_l',frame:12.25}],.125);expect(moved.delta).toBe(.125);
   const track=moved.project.tracks.hand_l;expect(track.keys.at(-1)!.frame).toBe(12.375);expect(track.curves!.px!.keys.at(-1)!.frame).toBe(12.375);expect(track.spaces.at(-1)!.frame).toBe(12.375);
   const pasted=pasteTimelineKeys(moved.project,copyTimelineKeys(moved.project,moved.selection)!,13.625).project;expect(pasted.tracks.hand_l.spaces.at(-1)!.frame).toBe(13.625);
   const store=new StudioStore();store.open(pasted);store.moveKey('hand_l',13.625,14.75);expect(store.state.project!.tracks.hand_l.spaces.at(-1)!.frame).toBe(14.75);
  }
 });
 it('accepts fractional following and IK/FK switches, but rejects nonfinite times',()=>{
  const p=createProject({},false),identity=new Matrix4().toArray();
  p.tracks.head.following=[{frame:2.25,position:true,rotation:false,world:identity,local:identity,parent:identity}];
  p.limbModes={firstPerson:{arm_l:[{frame:0,mode:'ik'},{frame:2.25,mode:'fk'}]}};expect(()=>validateProject(clone(p))).not.toThrow();
  const moved=moveTimelineKeys(p,[{id:'head',frame:2.25}],.125).project;expect(moved.tracks.head.following![0].frame).toBe(2.375);
  for(const invalid of [NaN,Infinity,-.25]){const next=clone(p);next.tracks.head.following![0].frame=invalid;expect(()=>validateProject(next)).toThrow();}
 });
});

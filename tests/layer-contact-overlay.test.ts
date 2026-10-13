import {describe,it,expect} from 'vitest';
import {StudioStore} from '../src/core/store';
import {library} from '../src/core/library';
import {createProject,createBodyAction,evaluate,switchParent,clone,putKey,rawForWorld,validateProject} from '../src/core/model';
import {addAnimationLayer,authorLayerPosition,activeAnimationLayer,syncLayers} from '../src/core/layers';
const setup=()=>{let source=createProject({},false);source=switchParent(source,'hand_l','world',0);source=switchParent(source,'hand_l','rifle',13);return createBodyAction(source,'source');};
describe('world pose overlays across contact switches',()=>{
 it('keeps unkeyed position ownership in drafts and saves it only when keyed',()=>{
  const s=new StudioStore(),p=addAnimationLayer(setup(),'pose');p.tracks.rifle.keys[0].p[1]=-.2;s.open(library(p));s.patch({autoKey:false});
  const saved=JSON.stringify(s.state.project),raw=clone(s.state.project!.tracks.hand_l.keys[0]);raw.p[1]=-.1;s.editLayerOffset('hand_l',raw);
  const zero=clone(s.state.drafts.hand_l!);zero.p[1]=0;s.editLayerOffset('hand_l',zero);
  expect(s.state.drafts.hand_l!.layerPosition).toBe(true);expect(JSON.stringify(s.state.project)).toBe(saved);
  expect(evaluate(s.state.project!,20,s.state.drafts).hand_l.p[1]).toBeCloseTo(evaluate(setup(),20).hand_l.p[1],6);
  s.addKey('hand_l');expect(s.state.project!.tracks.hand_l.keys[0].layerPosition).toBe(true);expect(s.state.drafts.hand_l).toBeUndefined();
 });
 for(const frame of [5,20])it('keeps a group move authored at frame '+frame+' across free and held states',()=>{
  const base=setup(),p=addAnimationLayer(base,'pose'),before=evaluate(base,frame);
  // The prop moves first. The selected hand must retain its own whole-action
  // displacement even when its contact has already moved it at the edit frame.
  for(const id of ['rifle','hand_l'] as const)authorLayerPosition(p,id);
  for(const id of ['rifle','hand_l'] as const){const target=clone(before[id]);target.p[1]-=.2;putKey(p.tracks[id],0,rawForWorld(p,id,frame,target));}
  expect(p.tracks.hand_l.keys[0].p[1]).toBeCloseTo(-.2,6);
  const restored=validateProject(JSON.parse(JSON.stringify(syncLayers(p))));
  for(const f of [0,5,12,12.5,13,14,20,50])for(const id of ['rifle','hand_l'] as const){const a=evaluate(base,f)[id],b=evaluate(restored,f)[id];b.p.forEach((v,i)=>expect(v-a.p[i]).toBeCloseTo(i===1?-.2:0,6));}
  activeAnimationLayer(restored)!.weight=.5;expect(evaluate(restored,20).hand_l.p[1]-evaluate(base,20).hand_l.p[1]).toBeCloseTo(-.1,6);
 });
 it('keeps unedited contacts following and supports a deliberate zero world offset',()=>{
  const base=setup(),p=addAnimationLayer(base,'pose');p.tracks.rifle.keys[0].p[1]=-.2;
  expect(evaluate(p,20).hand_l.p[1]-evaluate(base,20).hand_l.p[1]).toBeCloseTo(-.2,6);
  authorLayerPosition(p,'hand_l');expect(evaluate(p,20).hand_l.p[1]).toBeCloseTo(evaluate(base,20).hand_l.p[1],6);
  activeAnimationLayer(p)!.enabled=false;expect(evaluate(p,20).hand_l.p).toEqual(evaluate(base,20).hand_l.p);
 });
});

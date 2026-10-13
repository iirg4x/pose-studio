import {describe,it,expect} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {StudioStore} from '../src/core/store';
import {clone,createProject,sample} from '../src/core/model';
import {ensureCurve,modifier,sampleCurve} from '../src/core/curves';
describe('Insert Keyframe menu operations',()=>{
 it('keys location alone and keeps a pending rotation draft',()=>{
  const store=new StudioStore();store.open(createProject({},false));store.setFrame(12);store.patch({selected:'rifle',autoKey:false});const p=clone(store.currentPose()!);p.p[0]+=.1;p.q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.4).toArray();store.editWorld('rifle',p);const original=JSON.stringify(store.state.project!.tracks.rifle.keys);store.insertKeyingSet('location');const t=store.state.project!.tracks.rifle;
  expect(Object.keys(t.curves!)).toEqual(['px','py','pz']);expect(JSON.stringify(t.keys)).toBe(original);expect(t.curves!.px!.keys.map(k=>k.frame)).toEqual([0,12]);expect(store.state.drafts.rifle).toBeDefined();store.insertKeyingSet('rotation');expect(store.state.drafts.rifle).toBeUndefined();expect(new Quaternion(...sample(store.state.project!.tracks.rifle,12).q).angleTo(new Quaternion(...p.q))).toBeLessThan(1e-6);store.undo();expect(store.state.project!.tracks.rifle.curves!.rx).toBeUndefined();
 });
 it('Available does not create new channels, including when none exist',()=>{
  const store=new StudioStore();store.open(createProject({},false));store.patch({selected:'rifle'});store.setFrame(5);store.insertKeyingSet('available');expect(store.state.project!.tracks.rifle.curves).toBeUndefined();ensureCurve(store.state.project!.tracks.rifle,'px');store.insertKeyingSet('available');expect(Object.keys(store.state.project!.tracks.rifle.curves!)).toEqual(['px']);expect(store.state.project!.tracks.rifle.curves!.px!.keys.at(-1)!.frame).toBe(5);
 });
 it('keys quaternion rotations in their native channels',()=>{
  const p=createProject({},false);p.tracks.rifle.rotationMode='quaternion';const store=new StudioStore();store.open(p);store.patch({selected:'rifle'});store.setFrame(8);store.insertKeyingSet('rotation');expect(Object.keys(store.state.project!.tracks.rifle.curves!).sort()).toEqual(['qw','qx','qy','qz']);expect(store.state.project!.tracks.rifle.curves!.rx).toBeUndefined();
 });
 it('keys custom grip properties without adding transform channels',()=>{
  const store=new StudioStore();store.open(createProject({},false));store.patch({selected:'hand_l'});store.setFrame(8);store.insertKeyingSet('properties');expect(Object.keys(store.state.project!.tracks.hand_l.curves!).sort()).toEqual(['index','middle','pinky','ring','thumb']);
 });
 it('does not double an additive curve modifier when inserting a location key',()=>{
  const p=createProject({},false),curve=ensureCurve(p.tracks.rifle,'px'),noise=modifier('sine');curve.modifiers.push(noise);const store=new StudioStore();store.open(p);store.patch({selected:'rifle'});store.setFrame(5);const before=sampleCurve(curve,5);store.insertKeyingSet('location');expect(sampleCurve(store.state.project!.tracks.rifle.curves!.px!,5)).toBeCloseTo(before,8);
 });
});

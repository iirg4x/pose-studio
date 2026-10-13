import {describe,it,expect} from 'vitest';
import {createProject,clone,sample,visibleControls} from '../src/core/model';
import {readCurve,ensureCurve,handles,baseCurve} from '../src/core/curves';
import type {Curve} from '../src/core/curves';
import {timelineChannelRows,timelineVisibleControls,selectedControlSummary,channelPreview,translateCurveKeys,editCurveHandle} from '../src/core/timelineChannels';
import {StudioStore} from '../src/core/store';

const fixture=():Curve=>({keys:[{frame:0,value:0,interpolation:'bezier',handle:'flat'},{frame:10,value:10,interpolation:'bezier',handle:'aligned',left:[-3,-1],right:[3,1]},{frame:20,value:0,interpolation:'bezier',handle:'flat'}],modifiers:[]});
describe('timeline axis editing',()=>{
 it('groups only two or more selected controls in the dope sheet',()=>{const p=createProject({},false);for(const ids of [[],['hand_l'],['hand_l','hand_r']] as const){const rows=timelineChannelRows(p,timelineVisibleControls(p,ids),new Set(),new Set());const summary=selectedControlSummary(rows,ids);expect(summary.filter(r=>r.key==='all')).toHaveLength(ids.length>1?1:0);if(ids.length>1)expect(summary[0].ids).toEqual(ids);expect(rows.every(r=>r.key!=='all')).toBe(true);}});
 it('shows every control with no selection, otherwise only selected controls, without an aggregate row',()=>{
  const p=createProject({},false),all=visibleControls(p.editing,p);
  expect(timelineVisibleControls(p,[])).toEqual(all);
  expect(timelineVisibleControls(p,['hand_l'])).toEqual(['hand_l']);
  expect(new Set(timelineVisibleControls(p,['hand_l','hand_r']))).toEqual(new Set(['hand_l','hand_r']));
  for(const selection of [[],['hand_l'],['hand_l','hand_r']] as const){
   const ids=timelineVisibleControls(p,selection),rows=timelineChannelRows(p,ids,new Set(),new Set());
   expect(rows.every(r=>r.control!==undefined&&r.key!=='all')).toBe(true);
   expect(rows.map(r=>r.control)).toHaveLength(ids.length);
  }
 });
 it('expands a bone without unfolding its children or changing source data',()=>{
  const p=createProject({},false),before=clone(p),ids=visibleControls(p.editing,p);
  const rows=timelineChannelRows(p,ids,new Set(['hand_l']),new Set(['hand_l']));
  expect(rows.filter(r=>r.control==='hand_l'&&r.channel).map(r=>r.channel)).toEqual(['px','py','pz','rx','ry','rz','thumb','index','middle','ring','pinky']);
  expect(rows.some(r=>r.control==='index_01_l')).toBe(false);
  expect(rows.find(r=>r.key==='hand_l')!.ids).toContain('index_01_l');
  expect(p).toEqual(before);
 });
 it('finds bones inside collapsed hierarchies and exposes the actual quaternion channels',()=>{
  const p=createProject({},false);p.tracks.index_01_l.rotationMode='quaternion';
  const rows=timelineChannelRows(p,visibleControls(p.editing,p),new Set(['root','hand_l']),new Set(['index_01_l']),'Left index 1');
  expect(rows.filter(r=>!r.channel).map(r=>r.control)).toEqual(['index_01_l']);
  expect(rows.filter(r=>r.channel).map(r=>r.channel)).toEqual(['px','py','pz','qw','qx','qy','qz']);
 });
 it('previews scalar modifiers without baking, and bounds work per visible row',()=>{
  const p=createProject({},false),t=p.tracks.rifle,c=ensureCurve(t,'px');c.keys=fixture().keys;c.modifiers=[{id:'wave',enabled:true,type:'sine',amplitude:20,period:16,phase:0}];
  const before=clone(t),preview=channelPreview(t,'px',20,10000);
  expect(preview.points.length).toBe(241);expect(preview.max).toBeGreaterThan(20);
  expect(preview.points.at(-1)!.value).toBeCloseTo(sample(t,20).p[0]*100);expect(t).toEqual(before);
 });
 it('moves just the selected scalar keys, clamps the group and rejects collisions',()=>{
  const keys=fixture().keys,before=clone(keys);
  expect(translateCurveKeys(keys,[10],10,2,20)).toBe(null);
  const moved=translateCurveKeys(keys,[0,10],-4,2,20)!;
  expect(moved.frames).toEqual([0,10]);expect(moved.keys.map(k=>k.value)).toEqual([2,12,0]);
  expect(moved.keys[1].left).toEqual([-3,-1]);expect(keys).toEqual(before);
  expect(translateCurveKeys(keys,[0],NaN,1,20)).toBe(null);
 });
 it('edits aligned tangent slope while retaining the opposite handle length',()=>{
  const c=fixture(),before=clone(c);const changed=editCurveHandle(c,1,'right',[2,4]);
  expect(changed.right).toEqual([2,4]);expect(changed.left).toEqual([-3,-6]);
  expect(changed.value).toBe(10);expect(changed.frame).toBe(10);expect(c).toEqual(before);
  const next={...c,keys:c.keys.map((k,i)=>i===1?changed:k)};
  expect(baseCurve(next,14)).not.toBeCloseTo(baseCurve(c,14));
 });
 it('free handles edit independently and cannot reverse across their key',()=>{
  const c=fixture();c.keys[1].handle='free';const next=editCurveHandle(c,1,'left',[2,3]);
  expect(next.left).toEqual([-.001,3]);expect(next.right).toEqual([3,1]);
  expect(handles({...c,keys:[c.keys[0],next,c.keys[2]]},1).left[0]).toBeLessThan(0);
 });
 it('axis and tangent edits change only that position channel, undo together and survive save validation',()=>{
  const store=new StudioStore();const p=createProject({},false);p.tracks.rifle.curves={px:fixture(),py:fixture(),pz:fixture()};store.open(p);store.selectControl('rifle');
  const original=clone(store.state.project!),keys=readCurve(original.tracks.rifle,'px').keys;
  store.beginGesture();store.setCurveKeys('px',keys.map(k=>({...k,value:k.value+5})));
  const c=readCurve(store.state.project!.tracks.rifle,'px');store.setCurveKeys('px',c.keys.map((k,i)=>i===1?editCurveHandle(c,1,'right',[2,4]):k));store.endGesture();
  expect(store.state.project!.tracks.rifle.curves!.py).toEqual(original.tracks.rifle.curves!.py);
  expect(store.state.project!.tracks.rifle.curves!.pz).toEqual(original.tracks.rifle.curves!.pz);
  expect(sample(store.state.project!.tracks.rifle,10).p[0]).toBeCloseTo(.15);
  const final=clone(store.state.project!.tracks.rifle);store.undo();expect(store.state.project!.tracks.rifle).toEqual(original.tracks.rifle);store.redo();expect(store.state.project!.tracks.rifle).toEqual(final);
 });
});

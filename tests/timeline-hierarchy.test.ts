import {describe,it,expect} from 'vitest';
import {CONTROL_IDS} from '../src/core/controls';
import {createProject,putKey,pose,visibleControls} from '../src/core/model';
import {timelineHierarchy,timelineParent,DEFAULT_COLLAPSED,revealTimelineControl} from '../src/core/timelineHierarchy';
import {trackFrames,moveTimelineKeys,copyTimelineKeys,pasteTimelineKeys} from '../src/core/timelineKeys';

describe('timeline control hierarchy',()=>{
 it('reveals a selected finger through folded ancestors without opening the other hand',()=>{const ids=visibleControls('body',createProject({},false)),collapsed=new Set(['root','hips','hand_l','index_palm_l','index_01_l','index_02_l','hand_r'] as const),next=revealTimelineControl(ids,collapsed,'index_03_l');expect(next.has('hand_r')).toBe(true);const row=timelineHierarchy(ids,next).find(r=>r.control==='index_03_l');expect(row).toBeDefined();expect(collapsed.size).toBe(7);});
 it('places joints below their control parents without losing or duplicating tracks',()=>{
  const ids=visibleControls('body',createProject({},false)),rows=timelineHierarchy(ids,new Set());
  expect(new Set(rows.map(row=>row.control))).toEqual(new Set(ids));expect(rows).toHaveLength(ids.length);
  const visible=new Set(CONTROL_IDS);expect(timelineParent('index_03_l',visible)).toBe('index_02_l');expect(timelineParent('index_palm_l',visible)).toBe('hand_l');expect(timelineParent('hand_l',visible)).toBe('shoulder_l');expect(timelineParent('shin_r',visible)).toBe('thigh_r');
  for(const row of rows){const parent=timelineParent(row.control,new Set(ids));if(parent){const ancestor=rows.find(r=>r.control===parent)!;expect(row.depth).toBe(ancestor.depth+1);expect(rows.indexOf(ancestor)).toBeLessThan(rows.indexOf(row));}}
 });
 it('skips body-only parents in the floating arm rig and preserves nesting',()=>{
  const ids=visibleControls('firstPerson',createProject({},false)),rows=timelineHierarchy(ids,new Set(DEFAULT_COLLAPSED));expect(timelineParent('shoulder_l',new Set(ids))).toBe('root');
  const hand=rows.find(row=>row.control==='hand_l')!;expect(hand.collapsed).toBe(true);expect(hand.children).toContain('thumb_03_l');expect(hand.children).toContain('pinky_03_l');expect(rows.some(row=>row.control==='index_01_l')).toBe(false);expect(rows.some(row=>row.control==='elbow_l')).toBe(true);
 });
 it('keeps hidden child keys selectable, movable and copyable through a collapsed hand row',()=>{
  const p=createProject({},false);putKey(p.tracks.index_03_l,8,pose([0,0,0],[0,0,.2,.979795897]));
  const row=timelineHierarchy(visibleControls('firstPerson',p),new Set(['hand_l'])).find(row=>row.control==='hand_l')!;
  const keys=row.ids.flatMap(id=>trackFrames(p.tracks[id]).map(frame=>({id,frame}))),moved=moveTimelineKeys(p,keys,4);
  expect(moved.project.tracks.index_03_l.keys.map(k=>k.frame)).toEqual([4,12]);expect(moved.project.tracks.hand_l.keys.map(k=>k.frame)).toEqual([4]);expect(moved.project.tracks.hand_r).toEqual(p.tracks.hand_r);
  const clip=copyTimelineKeys(moved.project,moved.selection)!;const pasted=pasteTimelineKeys(createProject({},false),clip,20);
  expect(pasted.project.tracks.index_03_l.keys.some(k=>k.frame===28)).toBe(true);expect(clip.items.map(i=>i.id)).toContain('pinky_03_l');expect(clip.items.map(i=>i.id)).not.toContain('elbow_l');
 });
});

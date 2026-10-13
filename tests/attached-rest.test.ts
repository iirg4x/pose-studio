import {describe,it,expect} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {StudioStore} from '../src/core/store';
import {createProject,pose,putKey,evaluate,switchParent,sample} from '../src/core/model';
import type {ControlId,Project} from '../src/core/model';

const near=(a:number[],b:number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],6));
const sameRotation=(a:number[],b:number[])=>expect(Math.abs(a.reduce((s,v,i)=>s+v*b[i],0))).toBeCloseTo(1,6);
const twist=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.7).toArray();

function attached(id:ControlId,parent:ControlId):{project:Project;attachedWorld:ReturnType<typeof evaluate>[ControlId]}{
 let p=createProject({},false);p=switchParent(p,id,parent,0);
 return {project:p,attachedWorld:evaluate(p,0)[id]};
}

describe('rest reset for attached controls',()=>{
 for(const kind of ['all','location','rotation'] as const)it('returns an attached prop to its attachment point ('+kind+')',()=>{
  const {project,attachedWorld}=attached('magazine','hand_l');
  putKey(project.tracks.magazine,10,pose([.4,-.2,.3],twist));
  const s=new StudioStore();s.patch({project,selected:'magazine',frame:10});
  const moved=evaluate(project,10).magazine;
  s.resetSelected(kind);
  const after=evaluate(s.state.project!,10).magazine;
  if(kind!=='rotation')near(after.p,attachedWorld.p);else near(after.p,moved.p);
  if(kind!=='location')sameRotation(after.q,attachedWorld.q);else sameRotation(after.q,moved.q);
 });
 it('keeps an unattached prop resetting to its default placement',()=>{
  const p=createProject({},false),fresh=evaluate(p,0).rifle;putKey(p.tracks.rifle,5,pose([1,2,3],twist));
  const s=new StudioStore();s.patch({project:p,selected:'rifle',frame:5});s.resetSelected('all');
  const after=evaluate(s.state.project!,5).rifle;near(after.p,fresh.p);sameRotation(after.q,fresh.q);
 });
 it('returns a control attached after it moved to where it was attached',()=>{
  const p0=createProject({},false);putKey(p0.tracks.magazine,15,pose([.5,.9,-.2],twist));const p=switchParent(p0,'magazine','hand_l',15),attachedWorld=evaluate(p,15).magazine;
  putKey(p.tracks.magazine,25,pose([.1,1.4,.6]));const s=new StudioStore();s.patch({project:p,selected:'magazine',frame:25});s.resetSelected('all');
  const after=evaluate(s.state.project!,25).magazine,hand0=evaluate(p,15).hand_l,hand1=evaluate(p,25).hand_l;
  expect(hand1.p).toEqual(hand0.p);near(after.p,attachedWorld.p);sameRotation(after.q,attachedWorld.q);
 });
 it('uses the attachment active at the current frame',()=>{
  let p=createProject({},false);p=switchParent(p,'magazine','hand_l',0);putKey(p.tracks.magazine,20,pose([.3,.3,.3]));p=switchParent(p,'magazine','world',20);
  const atSwitch=evaluate(p,20).magazine;putKey(p.tracks.magazine,30,pose([.9,.1,.2],twist));
  const s=new StudioStore();s.patch({project:p,selected:'magazine',frame:30});s.resetSelected('all');
  near(evaluate(s.state.project!,30).magazine.p,atSwitch.p);
  expect(sample(s.state.project!.tracks.magazine,30).p).not.toEqual([.9,.1,.2]);
 });
});

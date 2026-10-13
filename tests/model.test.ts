import {describe,it,expect} from 'vitest';
import {Quaternion,Vector3} from 'three';
import {createProject,forLayer,evaluate,switchParent,putKey,pose,rawForWorld,sample,matrix,validateProject,clone} from '../src/core/model';
import {StudioStore} from '../src/core/store';
const near=(a:number[],b:number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],7));
describe('animation and contacts',()=>{
 it('edits floating arms without changing full-body animation and preserves shared timing',()=>{const s=new StudioStore();s.patch({project:createProject({},false),ready:true});const body=clone(forLayer(s.state.project!,'body').tracks);s.editWorld('hand_l',pose([.1,1.1,.4]));expect(forLayer(s.state.project!,'body').tracks).toEqual(body);s.setLayer('body');s.updateProject({fps:60,end:120});expect(forLayer(s.state.project!,'firstPerson').fps).toBe(60);expect(s.state.project!.end).toBe(120);s.setLayer('firstPerson');near(evaluate(s.state.project!,0).hand_l.p,[.1,1.1,.4]);});
 it('preserves position and rotation on attach, release, and reattach',()=>{
  let p=createProject({},false);putKey(p.tracks.rifle,30,pose([.2,1.2,.7],new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.7).toArray()));
  for(const [frame,parent] of [[12,'world'],[20,'magazine'],[25,'rifle']] as const){const before=evaluate(p,frame).hand_l;p=switchParent(p,'hand_l',parent,frame);near(matrix(evaluate(p,frame).hand_l).toArray(),matrix(before).toArray());}
 });
 it('keeps a held hand fixed relative to a moving prop',()=>{
  const p=createProject({},false),start=evaluate(p,0),offset=matrix(start.rifle).invert().multiply(matrix(start.hand_r));putKey(p.tracks.rifle,20,pose([.1,1.5,.6],new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.4).toArray()));const end=evaluate(p,20);near(matrix(end.rifle).invert().multiply(matrix(end.hand_r)).toArray(),offset.toArray());
 });
 it('world-space edits round trip through rotated attachment spaces',()=>{let p=createProject({},false);putKey(p.tracks.rifle,10,pose([.1,1.3,.5],new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.8).toArray()));const desired=pose([.3,1.1,.2],[0,0,0,1]);putKey(p.tracks.hand_l,10,rawForWorld(p,'hand_l',10,desired));near(matrix(evaluate(p,10).hand_l).toArray(),matrix(desired).toArray());});
 it('rejects a cycle which only becomes active in the future',()=>{let p=createProject({},false);p=switchParent(p,'hand_l','world',0);p=switchParent(p,'rifle','hand_l',40);expect(()=>switchParent(p,'hand_l','rifle',20)).toThrow(/cycle/);});
 it('interpolates quaternions through the short arc and supports stepped poses',()=>{const p=createProject({},false),t=p.tracks.camera;t.interpolation='linear';putKey(t,0,pose([0,0,0],[0,0,0,1]));putKey(t,10,pose([10,0,0],[0,0,0,-1]));near(sample(t,5).p,[5,0,0]);expect(Math.abs(sample(t,5).q[3])).toBeCloseTo(1);t.interpolation='step';near(sample(t,5).p,[0,0,0]);});
 it('round trips projects and rejects malformed poses and attachments',()=>{const p=createProject();expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);const q=clone(p);q.tracks.hand_l.keys[0].q=[0,0,0,0];expect(()=>validateProject(q)).toThrow();const r=clone(p);r.tracks.hand_l.spaces[0].offset=Array(16).fill(0);expect(()=>validateProject(r)).toThrow();});
 it('undoes grouped edits and retains a manually keyed draft',()=>{const s=new StudioStore();s.patch({project:createProject({},false),ready:true});s.beginGesture();s.editWorld('rifle',pose([0,1,1]));s.editWorld('rifle',pose([0,1,2]));s.endGesture();s.beginGesture();s.endGesture();s.undo();near(s.currentPose()!.p,evaluate(createProject({},false),0).hand_l.p);s.redo();near(evaluate(s.state.project!,0).rifle.p,[0,1,2]);s.patch({autoKey:false,selected:'rifle'});s.setFrame(10);s.editWorld('rifle',pose([0,2,3]));s.addKey();s.setFrame(11);near(evaluate(s.state.project!,10).rifle.p,[0,2,3]);});
});

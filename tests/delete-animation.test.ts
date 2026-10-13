import {describe,it,expect} from 'vitest';
import {StudioStore} from '../src/core/store';
import {createProject,createBodyAction,pose,evaluate,putKey,clone} from '../src/core/model';
import {library,entry,validateLibrary,refreshBases} from '../src/core/library';
import {ensureLayers,addAnimationLayer} from '../src/core/layers';
describe('delete animations',()=>{
 it('deletes a closed clip without losing the active edit, frame, drafts or history',()=>{
  const s=new StudioStore();s.open(createProject({},false));const a=s.state.workspace!.activeId;s.addAnimation({});const b=s.state.workspace!.activeId;s.closeAnimation(a);s.setFrame(12);s.editWorld('root',pose([.2,0,0]));s.patch({autoKey:false});s.editWorld('root',pose([.3,0,0]));s.deleteAnimation(a);
  expect(s.state.workspace!.clips.map(c=>c.id)).toEqual([b]);expect(s.state.frame).toBe(12);expect(s.state.drafts.root!.p).toEqual([.3,0,0]);expect(validateLibrary(s.snapshot()).clips).toHaveLength(1);s.undo();expect(evaluate(s.state.project!,12).root.p).toEqual([0,0,0]);
 });
 it('switches away from a deleted active clip and keeps the other clip draft',()=>{
  const s=new StudioStore();s.open(createProject({},false));const a=s.state.workspace!.activeId;s.patch({autoKey:false});s.editWorld('root',pose([.4,0,0]));s.addAnimation({});const b=s.state.workspace!.activeId;s.deleteAnimation(b);expect(s.state.workspace!.activeId).toBe(a);expect(s.state.drafts.root!.p).toEqual([.4,0,0]);expect(s.state.workspace!.openIds).toEqual([a]);
 });
 it('allows deleting the last clip while retaining project identity and saved poses',()=>{
  const s=new StudioStore();s.open(createProject({},false));s.renameWorkspace('My library');s.savePose('Keep this');const id=s.state.workspace!.activeId;s.deleteAnimation(id);expect(s.state.workspace!.name).toBe('My library');expect(s.state.workspace!.poses).toHaveLength(1);expect(s.state.workspace!.clips).toHaveLength(1);expect(s.state.workspace!.activeId).not.toBe(id);expect(s.state.project!.name).toBe('Untitled animation');expect(()=>validateLibrary(s.snapshot())).not.toThrow();
 });
 it('freezes dependent pose/source motion and clears preview links',()=>{
  const p=ensureLayers(createProject({},false));p.layers![0].static=true;putKey(p.tracks.root,0,pose([.3,0,0]));const w=library(p),source=w.clips[0];let dependent=addAnimationLayer(createProject({},false),'additive');dependent.layers![0].static=true;dependent.layers![0].poseLinks=[{clipId:source.id,frame:0}];const linked=entry(dependent),body=entry(createBodyAction(source.project,source.id));body.previewId=source.id;w.clips.push(linked,body);const s=new StudioStore();s.open(refreshBases(w));const before=s.snapshot()!,expected=before.clips.map(c=>evaluate(c.project,6));s.deleteAnimation(source.id);const after=s.snapshot()!;
  expect(after.clips.find(c=>c.id===linked.id)!.project.layers![0].poseLinks).toEqual([]);expect(after.clips.find(c=>c.id===body.id)!.previewId).toBeUndefined();after.clips.forEach(c=>expect(evaluate(c.project,6)).toEqual(expected[before.clips.findIndex(old=>old.id===c.id)]));expect(()=>validateLibrary(after)).not.toThrow();expect(before.clips[1].project.layers![0].poseLinks).toHaveLength(1);
 });
 it('ignores a stale delete action',()=>{const s=new StudioStore();s.open(createProject({},false));const before=s.state;s.deleteAnimation('missing');expect(s.state).toBe(before);});
});

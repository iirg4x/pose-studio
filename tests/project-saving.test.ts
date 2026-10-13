import {describe,it,expect} from 'vitest';
import {projectSaveSignature} from '../src/core/projectSaving';
import {library,entry} from '../src/core/library';
import {createProject,clone,pose,putKey} from '../src/core/model';
import {addAnimationLayer,selectAnimationLayer,syncLayers} from '../src/core/layers';
describe('unsaved project detection',()=>{
 it('ignores playback, selection, tabs and active-layer navigation',()=>{
  const project=addAnimationLayer(createProject({},false),'pose'),data=library(project);data.clips.push(entry(createProject({},false)));const saved=projectSaveSignature(data);data.clips[0].frame=12;data.clips[0].selected='shoulder_l';data.activeId=data.clips[1].id;data.openIds.push(data.activeId);selectAnimationLayer(data.clips[0].project,project.layers![0].id);expect(projectSaveSignature(data)).toBe(saved);
 });
 it('detects keys, masks, drafts and project names, and becomes clean after undo',()=>{
  const data=library(addAnimationLayer(createProject({},false),'pose')),saved=projectSaveSignature(data),copy=clone(data);putKey(copy.clips[0].project.tracks.shoulder_l,0,pose([.1,0,0]));syncLayers(copy.clips[0].project);expect(projectSaveSignature(copy)).not.toBe(saved);expect(projectSaveSignature(data)).toBe(saved);
  const mask=clone(data);mask.clips[0].project.layers!.at(-1)!.excluded.push('shoulder_r');expect(projectSaveSignature(mask)).not.toBe(saved);
  const draft=clone(data);draft.clips[0].drafts.shoulder_r=pose([.1,0,0]);expect(projectSaveSignature(draft)).not.toBe(saved);const at0=projectSaveSignature(draft);draft.clips[0].frame=8;expect(projectSaveSignature(draft)).not.toBe(at0);
  const named=clone(data);named.name='Changed';expect(projectSaveSignature(named)).not.toBe(saved);
 });
});

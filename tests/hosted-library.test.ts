import {describe,it,expect} from 'vitest';
import {StudioStore} from '../src/core/store';
import {createProject,clone,pose,evaluate} from '../src/core/model';
import {library,entry} from '../src/core/library';
import {extendHostedSaveBaseline,projectSaveSignature} from '../src/core/projectSaving';

describe('streamed animations in one project',()=>{
 it('keeps edits, drafts, playhead and undo when loading and revisiting a server clip',()=>{
  const s=new StudioStore(),original=library(createProject({},false));s.open(original);const first=original.activeId;
  s.setFrame(8);s.editWorld('rifle',pose([.2,1.2,.4]));s.patch({autoKey:false});s.editWorld('hand_l',pose([.3,1,.5]));const edited=clone(s.state.project),drafts=clone(s.state.drafts);
  const incoming=library(createProject({},false));incoming.clips.push(clone(original.clips[0]));s.openHostedAnimations(incoming);
  expect(s.state.workspace!.clips).toHaveLength(2);s.openHostedAnimations(original);
  expect(s.state.project).toEqual(edited);expect(s.state.drafts).toEqual(drafts);expect(s.state.frame).toBe(8);
  s.undo();expect(evaluate(s.state.project!,8).rifle.p).not.toEqual([.2,1.2,.4]);s.redo();expect(s.state.project).toEqual(edited);
  expect(s.snapshot()!.clips.find(c=>c.id===first)!.project).toEqual(edited);
 });
 it('does not mark browsing as dirty, and does not mark previous edits as saved',()=>{
  const s=new StudioStore();s.open(createProject({},false));let saved=projectSaveSignature(s.recoverySnapshot()!);
  const before=s.recoverySnapshot()!,incoming=library(createProject({},false));s.openHostedAnimations(incoming);
  saved=extendHostedSaveBaseline(saved,before,s.recoverySnapshot()!)!;expect(projectSaveSignature(s.recoverySnapshot()!)).toBe(saved);
  s.updateProject({name:'My edited pose'});const edited=s.recoverySnapshot()!,extra=library(createProject({},false));extra.clips.push(clone(incoming.clips[0]));
  s.openHostedAnimations(extra);saved=extendHostedSaveBaseline(saved,edited,s.recoverySnapshot()!)!;expect(projectSaveSignature(s.recoverySnapshot()!)).not.toBe(saved);
  s.activate(incoming.activeId);expect(s.state.project!.name).toBe('My edited pose');s.undo();expect(projectSaveSignature(s.recoverySnapshot()!)).toBe(saved);
 });
 it('loads preview dependencies without replacing existing paired clip edits',()=>{
  const s=new StudioStore(),incoming=library(createProject({},false)),paired=entry(createProject({},false));paired.project.editing='body';incoming.clips[0].previewId=paired.id;incoming.clips.push(paired);
  s.open(incoming);s.activate(paired.id);s.updateProject({name:'Edited paired animation'});s.openHostedAnimations(incoming);
  expect(s.state.workspace!.clips.find(c=>c.id===paired.id)!.project.name).toBe('Edited paired animation');expect(s.state.project!.name).toBe(incoming.clips[0].project.name);
 });
});

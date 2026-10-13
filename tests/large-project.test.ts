import {describe,it,expect} from 'vitest';
import {encodeProject,decodeProject} from '../shared/project-codec.mjs';
import {blankProject} from '../src/core/assets';
import {library,entry,validateLibrary} from '../src/core/library';
import {StudioStore} from '../src/core/store';
import {createProject,evaluate,validateProject} from '../src/core/model';
import {addAnimationLayer} from '../src/core/layers';
import {copyTimelineKeys,pasteTimelineKeys,moveTimelineKeys} from '../src/core/timelineKeys';
describe('large animation projects',()=>{
 it('isolates validated nested sources and retains the active layer alias',()=>{
  const p=addAnimationLayer(blankProject(),'pose');
  p.bodyBase={sourceId:'source',source:createProject({},false),enabled:false,excluded:[]};
  const loaded=validateProject(p);
  expect(loaded.tracks).toBe(loaded.layers!.find(l=>l.id===loaded.activeLayerId)!.tracks);
  expect(loaded.tracks).not.toBe(p.tracks);expect(loaded.bodyBase!.source.tracks).not.toBe(p.bodyBase.source.tracks);
  loaded.tracks.root.keys[0].p[0]=2;loaded.bodyBase!.source.tracks.root.keys[0].p[0]=3;
  expect(p.tracks.root.keys[0].p[0]).toBe(0);expect(p.bodyBase.source.tracks.root.keys[0].p[0]).toBe(0);
  p.bodyBase.source.tracks.root.keys[0].q=[0,0,0,0];expect(()=>validateProject(p)).toThrow('Invalid pose');
 });
 it('opens, extends, and navigates a library beyond 100 clips without cloning inactive tracks',()=>{
  const w=library(blankProject());for(let i=0;i<120;i++)w.clips.push(entry(blankProject()));const s=new StudioStore();s.open(w);const inactive=s.state.workspace!.clips.at(-1)!,tracks=inactive.project.tracks,old=s.state.workspace!;
  s.activate(w.clips[1].id);expect(s.state.workspace!.clips.at(-1)!.project.tracks).toBe(tracks);s.renameAnimation(inactive.id,'Renamed');expect(inactive.project.name).not.toBe('Renamed');expect(old.clips.at(-1)!.project.name).not.toBe('Renamed');s.addAnimation({});expect(s.state.workspace!.clips).toHaveLength(122);expect(validateLibrary(s.snapshot()).clips).toHaveLength(122);
  const exported=s.snapshot()!;exported.clips[0].project.tracks.root.keys[0].p[0]=99;expect(s.state.workspace!.clips[0].project.tracks.root.keys[0].p[0]).not.toBe(99);
 });
 it('saves with shared inactive data while later edits leave the saved view stable',()=>{
  const w=library(blankProject());w.clips.push(entry(blankProject()));const s=new StudioStore();s.open(w);
  const saved=s.documentSnapshot()!,inactive=s.state.workspace!.clips[1];
  expect(saved.clips[1].project.tracks).toBe(inactive.project.tracks);
  s.activate(inactive.id);s.editRaw('root',{...s.currentPose()!,p:[2,0,0]});
  expect(saved.clips[1].project.tracks.root.keys[0].p[0]).toBe(0);
  expect(s.state.project!.tracks.root.keys[0].p[0]).toBe(2);
 });
 it('round trips compressed documents, Unicode names, assets and legacy JSON',async()=>{
  const w={...library(blankProject()),name:'Weapons · 手',characterAssets:{['a'.repeat(64)]:'AA=='}},bytes=await encodeProject(w);expect([...bytes.slice(0,2)]).toEqual([31,139]);expect(await decodeProject(bytes)).toEqual(w);expect(await decodeProject(new TextEncoder().encode(JSON.stringify(w)))).toEqual(w);
  await expect(decodeProject(bytes.slice(0,-10))).rejects.toThrow();
 });
 it('preserves, moves and copies subframe curve keys needed by fast source motion',()=>{
  const p=blankProject();p.tracks.rifle.curves={px:{keys:[{frame:0,value:0,interpolation:'linear',handle:'vector'},{frame:.5,value:20,interpolation:'linear',handle:'vector'},{frame:1,value:0,interpolation:'linear',handle:'vector'}],modifiers:[]}};
  const loaded=validateProject(p);expect(evaluate(loaded,.5).rifle.p[0]).toBeCloseTo(.2);const moved=moveTimelineKeys(loaded,[{id:'rifle',frame:.5}],2);expect(moved.selection[0].frame).toBe(2.5);const copied=copyTimelineKeys(moved.project,moved.selection)!;const pasted=pasteTimelineKeys(moved.project,copied,4);expect(pasted.project.tracks.rifle.curves!.px!.keys.some(k=>k.frame===4)).toBe(true);
 });
});

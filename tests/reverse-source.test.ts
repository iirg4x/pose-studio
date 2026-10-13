import {describe,it,expect} from 'vitest';
import {createProject,createBodyAction,createFirstPersonAction,forLayer,evaluate,rigLocal,clone,putKey,rawForWorld,limbMode,layerFrame,validateProject,CAMERA_REFERENCE} from '../src/core/model';
import {addAnimationLayer,activeAnimationLayer} from '../src/core/layers';
import {entry,library,refreshBases,validateLibrary} from '../src/core/library';
import {StudioStore} from '../src/core/store';
import {firstPersonKeyReferences} from '../src/core/timelineReferences';
const body=()=>{const p=forLayer(createProject({},true),'body');p.actionType='body';return p;};
const near=(a:number[],b:number[])=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],6));
describe('full body to first person',()=>{
 it('keeps first-person-only, body-only and mixed projects independent through save and reopen',()=>{
  for(const first of ['firstPerson','body'] as const){
   const initial=forLayer(createProject({},false),first);initial.actionType=first;
   const s=new StudioStore();s.open(library(initial));
   s.createAction({},'Independent '+first,first);
   expect(s.state.workspace!.clips).toHaveLength(2);
   expect(s.state.workspace!.clips.every(c=>c.project.editing===first&&!c.project.bodyBase)).toBe(true);
   s.createAction({},'Other view',first==='body'?'firstPerson':'body');
   expect(s.state.workspace!.clips).toHaveLength(3);expect(s.state.project!.bodyBase).toBeUndefined();
   s.addLayer('pose');const offset=clone(s.state.project!.tracks.hand_l.keys[0]);offset.p[1]=-.1;s.editLayerOffset('hand_l',offset);
   const saved=validateLibrary(JSON.parse(JSON.stringify(s.snapshot()))),re=new StudioStore();re.open(saved);
   expect(re.state.workspace!.clips).toHaveLength(3);expect(re.state.workspace!.clips.every(c=>!c.project.bodyBase)).toBe(true);
   expect(re.state.workspace!.clips.slice(0,2).every(c=>!c.project.layers)).toBe(true);
   near(evaluate(re.state.project!,10).hand_l.p,evaluate(s.state.project!,10).hand_l.p);
  }
 });
 it('inherits body poses, contact timing and IK/FK while keeping camera and corrections independent',()=>{
  const source=body();source.limbModes={body:{arm_l:[{frame:0,mode:'fk'},{frame:20,mode:'ik'}]}};source.tracks.root.keys[0].p=[3,0,2];
  let p=createFirstPersonAction(source,'body');const saved=JSON.stringify(source);
  for(const frame of [0,12,20,40,72,96]){const a=rigLocal(evaluate(source,frame)),b=evaluate(p,frame);for(const id of ['hand_l','hand_r','rifle','hips','shoulder_l'] as const)near(b[id].p,a[id].p);near(b.root.p,[0,0,0]);near(b.camera.p,CAMERA_REFERENCE.p);expect(limbMode(p,'arm_l',frame)).toBe(limbMode(source,'arm_l',frame));}
  p=addAnimationLayer(p,'pose');p.tracks.hand_l.keys[0].p[1]=.12;for(const f of [0,40,96])expect(evaluate(p,f).hand_l.p[1]-rigLocal(evaluate(source,f)).hand_l.p[1]).toBeCloseTo(.12,6);
  expect(JSON.stringify(source)).toBe(saved);expect(()=>validateProject(p)).not.toThrow();
 });
 it('refreshes linked source edits, including a full-body action already derived from first person',()=>{
  const lib=library(createProject({},false)),original=lib.clips[0],b=entry(createBodyAction(original.project,original.id));lib.clips.push(b);const fp=entry(createFirstPersonAction(b.project,b.id));lib.clips.push(fp);refreshBases(lib);const before=evaluate(fp.project,0).rifle.p;
  original.project.tracks.rifle.keys[0].p[0]+=.1;refreshBases(lib);expect(evaluate(fp.project,0).rifle.p[0]-before[0]).toBeCloseTo(.1,6);expect(()=>validateLibrary(JSON.parse(JSON.stringify(lib)))).not.toThrow();
  original.project=createBodyAction(fp.project,fp.id);expect(()=>refreshBases(lib)).toThrow();
 });
 it('creates the reverse workflow through the store and preserves it on save/reopen',()=>{
  const s=new StudioStore();s.open(library(body()));const source=s.state.workspace!.activeId;s.createAction({},'Player reload','firstPerson',source);expect(s.state.project!.bodyBase!.sourceId).toBe(source);expect(s.state.project!.editing).toBe('firstPerson');
  s.addLayer('pose');const raw=clone(s.state.project!.tracks.hand_r.keys[0]);raw.p[2]=.15;s.editLayerOffset('hand_r',raw);const saved=validateLibrary(s.snapshot());const re=new StudioStore();re.open(saved);near(evaluate(re.state.project!,10).hand_r.p,evaluate(s.state.project!,10).hand_r.p);
 });
 it('rescales source timing and reference keys without changing source frame rate',()=>{
  const source=body();source.fps=24;const p=createFirstPersonAction(source,'b');p.fps=60;p.end=240;expect(layerFrame(p,'body',60)).toBe(24);expect(layerFrame(p,'firstPerson',60)).toBe(60);near(evaluate(p,60).rifle.p,rigLocal(evaluate(source,24)).rifle.p);expect(firstPersonKeyReferences(p).rifle).toContain(50);
 });
});

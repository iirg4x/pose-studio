import {describe,it,expect} from 'vitest';
import {Quaternion} from 'three';
import {clone,createBodyAction,createProject,evaluate,matrix,putKey,rawForWorld,switchParent,validateProject} from '../src/core/model';
import {entry,library,refreshBases,validateLibrary} from '../src/core/library';
import {StudioStore} from '../src/core/store';
import {matchLoopEnd} from '../src/core/loops';
import {rigLoader} from './rig-loader';
import {MannyRig} from '../src/scene/rig';
import {matchLimb} from '../src/core/rigMatching';
import {limbMode} from '../src/core/model';
import fs from 'node:fs/promises';
const source=()=>{const p=createProject({},false);p.actionType='firstPerson';p.name='Test FP';return p;};
const close=(a:number[],b:number[],precision=7)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],precision));
describe('separate full-body actions',()=>{
 it('inherits sparse first-person motion and stores only independent corrections',()=>{
  const fp=source(),before=JSON.stringify(fp),body=createBodyAction(fp,'source');
  const initial=evaluate(body,0).rifle;const desired=clone(initial);desired.p[0]+=.25;
  putKey(body.tracks.rifle,10,rawForWorld(body,'rifle',10,desired));
  close(evaluate(body,10).rifle.p,desired.p);expect(JSON.stringify(fp)).toBe(before);expect(body.tracks.rifle.keys).toHaveLength(2);expect(body.bodyBase!.source.tracks.rifle.keys).toHaveLength(1);
 });
 it('excludes head and neck by default but allows the body to animate them',()=>{
  const fp=source();fp.tracks.head.keys[0].q=new Quaternion().setFromAxisAngle({x:1,y:0,z:0} as any,.8).toArray();const body=createBodyAction(fp,'source');
  close(evaluate(body,0).head.q,[0,0,0,1]);const head=evaluate(body,0).head;head.q=new Quaternion().setFromAxisAngle({x:0,y:1,z:0} as any,.3).toArray();putKey(body.tracks.head,0,rawForWorld(body,'head',0,head));close(evaluate(body,0).head.q,head.q);
  body.bodyBase!.excluded=body.bodyBase!.excluded.filter(id=>id!=='head');expect(evaluate(body,0).head.q).not.toEqual(head.q);
 });
 it('excludes either shoulder independently while preserving hands, the other shoulder, and body edits',()=>{
  const fp=source();fp.tracks.shoulder_l.keys[0].p=[.12,.08,.03];fp.tracks.shoulder_r.keys[0].p=[-.1,.05,.02];
  const body=createBodyAction(fp,'source'),s=new StudioStore();s.open(library(body));const inherited=evaluate(s.state.project!,0),sourceBefore=JSON.stringify(s.state.project!.bodyBase!.source);
  const originalExcluded=[...s.state.project!.bodyBase!.excluded];s.configureBodyBase({excluded:[...originalExcluded,'shoulder_l']});let result=evaluate(s.state.project!,0);
  close(result.shoulder_l.p,[0,0,0]);close(result.shoulder_r.p,inherited.shoulder_r.p);close(result.hand_l.p,inherited.hand_l.p);close(result.hand_r.p,inherited.hand_r.p);
  expect(JSON.stringify(s.state.project!.bodyBase!.source)).toBe(sourceBefore);s.selectControl('shoulder_l');s.editLayerOffset('shoulder_l',{...s.currentTransformPose()!,p:[.04,0,0]});close(evaluate(s.state.project!,0).shoulder_l.p,[.04,0,0]);s.undo();s.undo();close(evaluate(s.state.project!,0).shoulder_l.p,inherited.shoulder_l.p);
  s.configureBodyBase({excluded:[...originalExcluded,'shoulder_r']});result=evaluate(s.state.project!,0);close(result.shoulder_r.p,[0,0,0]);close(result.shoulder_l.p,inherited.shoulder_l.p);close(result.hand_r.p,inherited.hand_r.p);
  expect(validateLibrary(s.snapshot()).clips[0].project.bodyBase!.excluded).toContain('shoulder_r');
 });
 it('keeps an inherited hand contact when the body prop is moved, and releases without a jump',()=>{
  let body=createBodyAction(source(),'source');const first=evaluate(body,0),relative=matrix(first.rifle).invert().multiply(matrix(first.hand_l));const prop=clone(first.rifle);prop.p[0]+=.3;prop.q=new Quaternion().setFromAxisAngle({x:0,y:1,z:0} as any,.4).toArray();putKey(body.tracks.rifle,0,rawForWorld(body,'rifle',0,prop));const after=evaluate(body,0);close(matrix(after.rifle).invert().multiply(matrix(after.hand_l)).elements,relative.elements);
  body=switchParent(body,'hand_l','world',0);close(evaluate(body,0).hand_l.p,after.hand_l.p);
 });
 it('applies root motion once and round-trips world edits through the base',()=>{
  const fp=source();fp.tracks.root.keys[0].p=[.2,0,0];const body=createBodyAction(fp,'source');const before=evaluate(body,0);const root=clone(before.root);root.p[0]+=.4;putKey(body.tracks.root,0,rawForWorld(body,'root',0,root));const after=evaluate(body,0);expect(after.rifle.p[0]-before.rifle.p[0]).toBeCloseTo(.4);close(after.root.p,root.p);
  const hand=clone(after.hand_l);hand.p[1]+=.12;putKey(body.tracks.hand_l,0,rawForWorld(body,'hand_l',0,hand));close(evaluate(body,0).hand_l.p,hand.p);
 });
 it('uses seconds for different FPS and holds the source end',()=>{
  const fp=source();fp.end=24;fp.tracks.rifle.interpolation='linear';const end=clone(fp.tracks.rifle.keys[0]);end.p[0]+=1;putKey(fp.tracks.rifle,24,end);const body=createBodyAction(fp,'source');body.fps=48;body.end=96;
  const a=evaluate(body,0),b=evaluate(body,24),c=evaluate(body,48),d=evaluate(body,96);expect(b.rifle.p[0]-a.rifle.p[0]).toBeCloseTo(.5);expect(c.rifle.p[0]-a.rifle.p[0]).toBeCloseTo(1);close(c.rifle.p,d.rifle.p);
 });
 it('refreshes the source without losing body edits and remaps links on import',()=>{
  const lib=library(source()),src=lib.clips[0],body=entry(createBodyAction(src.project,src.id));lib.clips.push(body);body.project.tracks.head.keys[0].p[1]=.01;
  src.project.tracks.rifle.keys[0].p[0]+=.2;refreshBases(lib);expect(body.project.bodyBase!.source.tracks.rifle.keys[0].p[0]).toBe(src.project.tracks.rifle.keys[0].p[0]);expect(body.project.tracks.head.keys[0].p[1]).toBe(.01);
  const store=new StudioStore();store.open(library(source()));store.importAnimations(lib);const imported=store.snapshot()!.clips.slice(1);expect(imported[1].project.bodyBase!.sourceId).toBe(imported[0].id);expect(imported[0].id).not.toBe(src.id);expect(()=>validateLibrary(store.snapshot())).not.toThrow();
 });
 it('keeps a portable base cache if the source is absent and rejects recursive bases',()=>{
  const body=createBodyAction(source(),'missing');const saved=validateProject(JSON.parse(JSON.stringify(body)));close(evaluate(saved,10).rifle.p,evaluate(body,10).rifle.p);body.bodyBase!.source=body;expect(()=>validateProject(body)).toThrow();
 });
 it('propagates edits to the first source pose without recalibrating them away',()=>{
  const lib=library(source()),src=lib.clips[0],body=entry(createBodyAction(src.project,src.id));lib.clips.push(body);const before=evaluate(body.project,0).rifle;src.project.tracks.rifle.keys[0].p[0]+=.2;refreshBases(lib);expect(evaluate(body.project,0).rifle.p[0]-before.p[0]).toBeCloseTo(.2);
 });
 it('supports the full -1 to 1 grip range over an opposing inherited curl',()=>{
  const fp=source();fp.tracks.hand_l.keys[0].grip.fill(-1);const body=createBodyAction(fp,'source'),hand=evaluate(body,0).hand_l;hand.grip.fill(1);putKey(body.tracks.hand_l,10,rawForWorld(body,'hand_l',10,hand));expect(evaluate(body,10).hand_l.grip).toEqual([1,1,1,1,1]);expect(()=>validateProject(body)).not.toThrow();
 });
 it('muting inheritance preserves correction keys and returns excluded head to neutral',()=>{
  const body=createBodyAction(source(),'source');body.tracks.head.keys[0].p=[0,.05,0];body.bodyBase!.enabled=false;expect(evaluate(body,0).head.p[1]).toBe(.05);expect(body.tracks.head.keys).toHaveLength(1);
 });
 it('matches the loop on the body action without changing or detaching its base',()=>{
  const body=createBodyAction(source(),'source'),saved=JSON.stringify(body.bodyBase!.source);body.tracks.head.keys[0].p[1]=.1;const next=matchLoopEnd(body);expect(next.bodyBase!.sourceId).toBe('source');expect(JSON.stringify(next.bodyBase!.source)).toBe(saved);close(evaluate(next,next.end).head.p,evaluate(next,0).head.p);
 });
 it('matches IK and FK over a non-neutral base using the real Manny skeleton',async()=>{
  const bytes=await fs.readFile('public/assets/manny.glb'),gltf=await rigLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');const rig=new MannyRig(gltf.scene);const fp=createProject(rig.restControls,false);fp.tracks.upperarm_l.keys[0].q=new Quaternion().setFromAxisAngle({x:1,y:0,z:0} as any,.2).toArray();let body=createBodyAction(fp,'source');const modes=()=>Object.fromEntries((['arm_l','arm_r','leg_l','leg_r'] as const).map(id=>[id,limbMode(body,id,0)]));rig.apply(evaluate(body,0),modes());const before=rig.deformation();body=matchLimb(body,0,'arm_l','fk',rig);rig.apply(evaluate(body,0),modes());const after=rig.deformation();for(const name of ['upperarm_l','lowerarm_l','hand_l'])close(after[name],before[name],6);body=matchLimb(body,0,'arm_l','ik',rig);rig.apply(evaluate(body,0),modes());for(const name of ['upperarm_l','lowerarm_l','hand_l'])close(rig.deformation()[name],before[name],6);
 });
});

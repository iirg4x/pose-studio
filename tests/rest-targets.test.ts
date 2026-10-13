import {beforeAll,describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import {Matrix4,Quaternion,Vector3} from 'three';
import {rigLoader} from './rig-loader';
import {MannyRig} from '../src/scene/rig';
import {RestPoseSampler} from '../src/scene/restPose';
import {StudioStore} from '../src/core/store';
import {createProject,forLayer,evaluate,pose,putKey,matrix,switchParent,clone,fromMatrix} from '../src/core/model';
import {addAnimationLayer} from '../src/core/layers';
let rig:MannyRig;
beforeAll(async()=>{const bytes=await fs.readFile('public/assets/manny.glb');rig=new MannyRig((await rigLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene);});
const near=(a:number[],b:number[])=>a.forEach((value,i)=>expect(value).toBeCloseTo(b[i],6));
const setup=(layer=false)=>{let p=forLayer(createProject(rig.restControls,false),'body');if(layer)p=addAnimationLayer(p,'pose');const store=new StudioStore();store.open(p);store.restPose=new RestPoseSampler(rig).sample;return store;};
describe('skeleton rest targets',()=>{
 for(const id of ['hand_l','hand_r','foot_l','foot_r'] as const)for(const layer of [false,true])it(`${id} resets to skeleton rest through ${layer?'pose layer':'base contacts'}`,()=>{
  const s=setup(layer);s.patch({selected:id,frame:12});s.editWorld(id,pose([.2,1,.5],new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.7).toArray()));const original=clone(s.state.project),before=evaluate(s.state.project!,12)[id],rest=rig.rest.get(id)!.world;
  s.resetSelected('location');const located=evaluate(s.state.project!,12)[id];near(located.p,new Vector3().setFromMatrixPosition(rest).toArray());expect(new Quaternion(...located.q).angleTo(new Quaternion(...before.q))).toBeLessThan(1e-6);
  s.resetSelected('rotation');const result=evaluate(s.state.project!,12)[id];near(result.p,located.p);expect(new Quaternion(...result.q).angleTo(new Quaternion(...fromMatrix(rest).q))).toBeLessThan(1e-6);
  const once=s.state.project;s.resetSelected('all');expect(s.state.project).toBe(once);s.undo();s.undo();expect(s.state.project).toEqual(original);
 });
 it('keeps root motion and authored proportions when resetting a hand',()=>{
  const s=setup();const p=clone(s.state.project!);p.motionRig={partial:false,positions:Object.fromEntries([...rig.rest].map(([name,r])=>[name,new Vector3().setFromMatrixPosition(r.world).multiplyScalar(.8).toArray()]))};putKey(p.tracks.root,0,pose([2,.4,-1],new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.5).toArray()));s.open(p);s.patch({selected:'hand_l'});s.resetSelected('all');const expected=matrix(evaluate(p,0).root).multiply(rig.rest.get('hand_l')!.world.clone().setPosition(new Vector3(...p.motionRig.positions.hand_l)));near(matrix(evaluate(s.state.project!,0).hand_l).elements,expected.elements);
 });
 it('preserves world location when a rotated basis has a translated post transform',()=>{
  const s=setup(),p=clone(s.state.project!);p.tracks.hand_l.basis={pre:new Matrix4().makeRotationY(.8).toArray(),post:new Matrix4().makeTranslation(.1,.2,0).toArray()};s.open(p);s.patch({selected:'hand_l'});const before=evaluate(s.state.project!,0).hand_l;s.resetSelected('rotation');near(evaluate(s.state.project!,0).hand_l.p,before.p);
 });
 for(const autoKey of [true,false])it('resets an attachment parent before its selected child'+(autoKey?'':' in drafts'),()=>{
  const s=setup(),moved=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),.6).toArray();s.patch({autoKey});
  s.open(switchParent(s.state.project!,'hand_l','hips',0));s.patch({selected:'hips',frame:0});s.editRaw('hips',pose([.1,-.15,.05],moved));
  s.patch({selected:'hand_l'});s.editWorld('hand_l',pose([.3,1.1,.4],moved));
  s.patch({selection:['hand_l','hips'],selected:'hips'});s.resetSelected('all');
  const values=evaluate(s.state.project!,0,s.state.drafts);near(values.hips.p,[0,0,0]);near(values.hand_l.p,new Vector3().setFromMatrixPosition(rig.rest.get('hand_l')!.world).toArray());
 });
 it('keeps rest resets in drafts when auto-key is off',()=>{const s=setup(true);s.patch({selected:'hand_l',autoKey:false,playing:true});const before=s.state.project;s.resetSelected('all');expect(s.state.project).toBe(before);expect(s.state.playing).toBe(true);near(evaluate(s.state.project!,0,s.state.drafts).hand_l.p,new Vector3().setFromMatrixPosition(rig.rest.get('hand_l')!.world).toArray());});
 it('places an elbow pole on the rest bend plane instead of the weapon pose',()=>{const s=setup();s.patch({selected:'elbow_l'});s.resetSelected('location');const result=new Vector3(...evaluate(s.state.project!,0).elbow_l.p),start=new Vector3().setFromMatrixPosition(rig.rest.get('upperarm_l')!.world),mid=new Vector3().setFromMatrixPosition(rig.rest.get('lowerarm_l')!.world),end=new Vector3().setFromMatrixPosition(rig.rest.get('hand_l')!.world),axis=end.sub(start).normalize(),bend=mid.clone().sub(start);bend.addScaledVector(axis,-bend.dot(axis)).normalize();near(result.toArray(),mid.addScaledVector(bend,.35).toArray());});
});

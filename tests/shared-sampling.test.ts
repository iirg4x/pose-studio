import {describe,expect,it} from 'vitest';
import {Bone,Group,Quaternion,Vector3} from 'three';
import {sampleSharedAnimation} from '../src/scene/sharedAnimationSampling';
import {createRequire} from 'node:module';
const {validateSampleRate}=createRequire(import.meta.url)('../electron/shared-export.cjs');
function fixture(){const scene=new Group(),root=new Bone(),tip=new Bone();root.name='root';tip.name='tip';scene.add(root);root.add(tip);tip.position.x=2;return {scene,root,tip,bones:[root,tip]};}
describe('shared animation sampling',()=>{
 it('keeps linear motion at its original rate and duration',async()=>{
  const {scene,root,bones}=fixture();const result=await sampleSharedAnimation(bones,30,2,f=>{root.position.x=f*.2;scene.updateMatrixWorld(true);},()=>{});
  expect(result.info.sampleRate).toBe(30);expect(result.frames).toHaveLength(3);expect(result.frames[2][0]).toBeCloseTo(.4);
 });
 it('finds motion hidden between identical endpoints and checks the whole hierarchy',async()=>{
  const {scene,root,bones}=fixture(),axis=new Vector3(0,0,1);
  const result=await sampleSharedAnimation(bones,30,1,f=>{root.quaternion.setFromAxisAngle(axis,.002*Math.sin(Math.PI*f*2));scene.updateMatrixWorld(true);},()=>{}, {rotationTolerance:.1});
  expect(result.info.factor).toBeGreaterThan(1);expect(result.info.positionError).toBeLessThanOrEqual(.0002);
  // The rotation is below the angular tolerance but moves the child by 4 mm.
  const at=result.frames[result.info.factor/4],q=new Quaternion().fromArray(at,3);expect(q.angleTo(new Quaternion())).toBeGreaterThan(.001);
 });
 it('raises the sample rate for fast curved motion without weakening fidelity',async()=>{
  const {scene,root,bones}=fixture();
  const sample=(f:number)=>{root.position.set(.1*Math.cos(f*Math.PI*2),.1*Math.sin(f*Math.PI*2),0);scene.updateMatrixWorld(true);};
  await expect(sampleSharedAnimation(bones,30,1,sample,()=>{},{maxFactor:32})).rejects.toThrow('no approximate animation was exported');
  const result=await sampleSharedAnimation(bones,30,1,sample,()=>{});
  expect(result.info.factor).toBe(64);expect(result.info.sampleRate).toBe(1920);
  expect(result.info.positionError).toBeLessThanOrEqual(.0002);expect(result.frames).toHaveLength(65);
 });
 it('does not silently export a discontinuity it cannot represent',async()=>{
  const {scene,root,bones}=fixture();await expect(sampleSharedAnimation(bones,30,1,f=>{root.position.x=f<.5?0:1;scene.updateMatrixWorld(true);},()=>{}, {maxFactor:4})).rejects.toThrow('no approximate animation was exported');
 });
 it('does not alias cycles that return to rest at all quarter probes',async()=>{
  const {scene,root,bones}=fixture();const result=await sampleSharedAnimation(bones,30,1,f=>{root.quaternion.setFromAxisAngle(new Vector3(0,0,1),.001*Math.sin(Math.PI*f*8));scene.updateMatrixWorld(true);},()=>{});
  expect(result.info.factor).toBeGreaterThan(1);expect(result.info.positionError).toBeLessThanOrEqual(.0002);
 });
 it('rejects non-finite motion between valid endpoint samples',async()=>{
  const {scene,root,bones}=fixture();await expect(sampleSharedAnimation(bones,30,1,f=>{root.position.x=f===.25?NaN:f;scene.updateMatrixWorld(true);},()=>{})).rejects.toThrow('Non-finite');
 });
 it('validates the runtime sample rate independently of the editable timeline rate',()=>{
  expect(validateSampleRate({fps:30},240)).toBe(240);
  expect(validateSampleRate({fps:30},1920)).toBe(1920);
  for(const rate of [0,15,31,960.5,3840,NaN])expect(()=>validateSampleRate({fps:30},rate)).toThrow();
 });
});

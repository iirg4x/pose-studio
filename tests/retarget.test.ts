import {beforeAll,describe,it,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {Matrix4,Quaternion,Vector3,SkinnedMesh} from 'three';
import {rigLoader} from './rig-loader';
import {MannyRig} from '../src/scene/rig';
import {RetargetRig} from '../src/scene/RetargetRig';
import {MannyCharacter} from '../src/scene/MannyCharacter';
import {maskedGeometry} from '../src/scene/meshMask';
import {autoMapBones,defaultHiddenMeshes,mappingIssues,validateCharacters} from '../src/core/retarget';
import type {RetargetCharacter} from '../src/core/retarget';
import {createProject,forLayer,evaluate,pose,putKey,clone,createBodyAction} from '../src/core/model';
import {library,validateLibrary} from '../src/core/library';
import {projectSaveSignature} from '../src/core/projectSaving';
const require=createRequire(import.meta.url),{createCharacters}=require('../electron/characters.cjs');
let source:MannyRig,target:RetargetRig,config:RetargetCharacter;
async function load(name:string){const b=await fs.readFile('public/assets/'+name+'.glb');return (await rigLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}
beforeAll(async()=>{source=new MannyRig(await load('manny'));target=new RetargetRig(await load('example-fantasy-male'));config={id:'male',name:'Fantasy male',asset:'example-fantasy-male',mapping:autoMapBones([...target.bones.keys()]),hiddenMeshes:defaultHiddenMeshes(target.meshes.map(m=>m.name)),scale:1,facing:0,handIK:true,footIK:true,offsets:{}};});
describe('humanoid retargeting',()=>{
 it('restores a camera-centered arms skeleton to the floor origin without changing proportions',async()=>{
  const model=await load('manny');model.traverse(o=>{if(o instanceof SkinnedMesh)o.geometry=maskedGeometry(o,/^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)/);});
  // First-person assets may be authored around a camera origin above the hips.
  model.position.y=-1.65;model.updateMatrixWorld(true);
  const arms=new RetargetRig(model),settings={...config,origin:'skeleton' as const,mapping:autoMapBones([...arms.bones.keys()]),hiddenMeshes:[]};
  const hip=arms.bones.get('pelvis')!.getWorldPosition(new Vector3()).y;
  arms.configure(source,{...settings,origin:undefined});expect(arms.bones.get('pelvis')!.getWorldPosition(new Vector3()).y).toBeCloseTo(hip,5);
  arms.configure(source,settings);expect(arms.hasLowerBodySurface()).toBe(false);expect(arms.motionScale).toBeCloseTo(1,5);
  expect(arms.bones.get('pelvis')!.getWorldPosition(new Vector3()).y).toBeCloseTo(hip+1.65,5);
  const character=new MannyCharacter(arms,source,settings);expect(character.first.motionScale).toBeCloseTo(1,5);expect(character.first.rest.get('pelvis')!.world.elements[13]).toBeCloseTo(hip+1.65,5);const camera=new Matrix4().makeTranslation(.1,1.65,.2);expect(character.first.cameraMatrix(camera).elements).toEqual(camera.elements);character.dispose();arms.dispose();
 });
 it('maps the supplied Rig skeleton and common Mixamo naming without duplicate targets',()=>{
  expect(mappingIssues(config.mapping,[...target.bones.keys()])).toMatchObject({ready:true,missing:[],duplicates:[]});expect(config.mapping).toMatchObject({pelvis:'RigPelvis',hand_l:'RigLPalm',head:'RigHead',index_01_r:'RigRFinger21'});
  const m=autoMapBones(['mixamorig:Hips','mixamorig:Spine','mixamorig:LeftArm','mixamorig:RightForeArm','mixamorig:LeftHandIndex1']);expect(m).toMatchObject({pelvis:'mixamorig:Hips',spine_01:'mixamorig:Spine',upperarm_l:'mixamorig:LeftArm',lowerarm_r:'mixamorig:RightForeArm',index_01_l:'mixamorig:LeftHandIndex1'});
  expect(mappingIssues({...config.mapping,hand_r:''},[...target.bones.keys()]).ready).toBe(false);
 });
 it('starts with one visible mesh per modular body family',()=>{target.configure(source,config);expect(target.meshes.filter(m=>m.visible).map(m=>m.name)).toEqual(['01_Head_01','02_Torso_01','03_Bottom_01','04_Feet_01','05_Hand_01','06_Belt_01']);const names=target.meshes.map(m=>m.name),hidden=defaultHiddenMeshes(names,true);expect(names.filter(n=>!hidden.includes(n))).toEqual(['01_Head_01','02_Torso_03','03_Bottom_03','04_Feet_03','05_Hand_01','06_Belt_01']);});
 it('aligns the target T pose to Manny without altering bind transforms or limb lengths',()=>{
  target.configure(source,config);target.apply(true);
  for(const [a,b] of [['upperarm_l','lowerarm_l'],['lowerarm_l','hand_l'],['thigh_r','calf_r']]){const x=target.bones.get(config.mapping[a])!,y=target.bones.get(config.mapping[b])!;const direction=y.getWorldPosition(new Vector3()).sub(x.getWorldPosition(new Vector3())).normalize(),expected=new Vector3().setFromMatrixPosition(source.rest.get(b)!.world).sub(new Vector3().setFromMatrixPosition(source.rest.get(a)!.world)).normalize();expect(direction.dot(expected)).toBeGreaterThan(.999);}
  for(const [name,b] of target.bones)expect(b.position.distanceTo(target.rest.get(name)!.p)).toBeLessThan(1e-5);
 });
 it('transfers root movement and head rotation while preserving target proportions',()=>{
  const p=forLayer(createProject(source.restControls,false),'body'),plain={...config,handIK:false,footIK:false};target.configure(source,plain);source.apply(evaluate(p,0));target.apply();const hip=target.bones.get(config.mapping.pelvis)!,before=hip.getWorldPosition(new Vector3()),head=target.bones.get(config.mapping.head)!,q0=head.getWorldQuaternion(new Quaternion());
  putKey(p.tracks.root,0,pose([.5,.2,-.3]));putKey(p.tracks.head,0,pose([0,0,0],new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.4).toArray()));source.apply(evaluate(p,0));target.apply();const delta=hip.getWorldPosition(new Vector3()).sub(before);expect(delta.distanceTo(new Vector3(.5,.2,-.3).multiplyScalar(target.motionScale))).toBeLessThan(1e-5);expect(head.getWorldQuaternion(new Quaternion()).angleTo(q0)).toBeGreaterThan(.35);
  for(const [name,b] of target.bones)if(name!==config.mapping.pelvis)expect(b.position.distanceTo(target.rest.get(name)!.p)).toBeLessThan(1e-4);
 });
 it('keeps hand targets and foot heights stable across source animation frames',()=>{
  const p=createBodyAction(createProject(source.restControls),'source');target.configure(source,config);let movement=0,previous:Vector3|undefined;
  for(let frame=0;frame<=p.end;frame+=4){source.apply(evaluate(p,frame));target.apply();for(const side of ['l','r']){const hand=target.bones.get(config.mapping['hand_'+side])!,actual=hand.getWorldPosition(new Vector3()),desired=source.position('hand_'+side).multiplyScalar(target.motionScale);expect(actual.distanceTo(desired)).toBeLessThan(.012);const foot=target.bones.get(config.mapping['foot_'+side])!.getWorldPosition(new Vector3());expect(foot.y).toBeGreaterThan(.04);expect(foot.y).toBeLessThan(.2);if(side==='l'){if(previous)movement+=actual.distanceTo(previous);previous=actual;}}for(const b of target.bones.values())expect(b.matrixWorld.elements.every(Number.isFinite)).toBe(true);}
  expect(movement).toBeGreaterThan(.15);
 });
 it('handles the female example and incomplete maps without corrupting the source',async()=>{
  const female=new RetargetRig(await load('example-fantasy-female'));const c={...config,mapping:autoMapBones([...female.bones.keys()]),hiddenMeshes:defaultHiddenMeshes(female.meshes.map(m=>m.name))};expect(mappingIssues(c.mapping,[...female.bones.keys()]).ready).toBe(true);const before=source.bones.get('head')!.matrixWorld.clone();female.configure(source,c);female.apply();delete c.mapping.hand_l;female.configure(source,c);female.apply();expect(female.ready).toBe(false);expect(source.bones.get('head')!.matrixWorld.elements).toEqual(before.elements);female.dispose();
 });
 it('persists characters, counts mapping changes as unsaved, and rejects duplicate mappings',()=>{const data=library(createProject(source.restControls));data.characters=[clone(config)];data.activeCharacterId=config.id;const restored=validateLibrary(data);expect(restored.characters).toEqual(data.characters);const signature=projectSaveSignature(data);restored.characters![0].scale=1.1;expect(projectSaveSignature(restored)).not.toBe(signature);expect(()=>validateCharacters([{...config,mapping:{...config.mapping,hand_l:config.mapping.hand_r}}])).toThrow('Invalid bone mapping');});
 it('embeds imported character assets in a project and restores their cache independently',async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'pose-character-'));try{const first=createCharacters(path.join(temp,'a'),'public/assets','backend'),bytes=await fs.readFile('public/assets/example-fantasy-male.glb'),asset=await first.cache(bytes);const data={characters:[{...config,asset}]};const saved=await first.embed(data);expect(saved.characterAssets[asset].length).toBeGreaterThan(100);const other=createCharacters(path.join(temp,'b'),'public/assets','backend');const restored=await other.restore(saved);expect(restored.characterAssets).toBeUndefined();expect(Buffer.from(await other.read(asset)).equals(bytes)).toBe(true);await expect(other.read('../outside')).rejects.toThrow('Invalid character asset');await expect(other.cache(Buffer.from('not glb'))).rejects.toThrow('valid GLB');}finally{await fs.rm(temp,{recursive:true,force:true});}
 });
});

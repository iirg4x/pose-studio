import {rigLoader} from './rig-loader';
import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Vector3} from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {MannyRig} from '../src/scene/rig';
import {createProject,evaluate,matrix,forLayer,CAMERA_REFERENCE} from '../src/core/model';
import {createRifle,createMagazine,geometryData} from '../scripts/example-props';
it('poses the real 89-bone Manny and produces finite deterministic export frames',async()=>{
 const bytes=await fs.readFile('public/assets/manny.glb');
 const gltf=await rigLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const rig=new MannyRig(gltf.scene,true),bodyRig=new MannyRig(cloneSkeleton(gltf.scene) as typeof gltf.scene),project=createProject(rig.restControls);expect(rig.bones.size).toBe(89);
 const frames=[];
 for(let f=0;f<=project.end;f++){
  const values=evaluate(project,f);rig.apply(values);const bodyValues=evaluate(forLayer(project,'body'),f);bodyRig.apply(bodyValues);const bones=rig.deformation();
  expect(Object.values(bones).flat().every(Number.isFinite)).toBe(true);
  for(const side of ['l','r'])expect(rig.position('hand_'+side).distanceTo(new Vector3(...values['hand_'+side].p)), 'frame '+f+' side '+side).toBeLessThan(.002);
  frames.push({frame:f,bones,bodyBones:bodyRig.deformation(),bodyProps:{rifle:matrix(bodyValues.rifle).toArray(),magazine:matrix(bodyValues.magazine).toArray()},props:{rifle:matrix(values.rifle).toArray(),magazine:matrix(values.magazine).toArray()},camera:{matrix:matrix(values.camera).toArray(),fov:values.camera.fov}});
 }
 const first=frames[0].bones;rig.apply(evaluate(project,0));for(const [n,m] of Object.entries(rig.deformation()))m.forEach((v,i)=>expect(v).toBeCloseTo(first[n][i],8));
 const fixture={version:2,cameraReference:matrix(CAMERA_REFERENCE).toArray(),rig:project.rig,name:project.name,fps:project.fps,end:project.end,frames,geometry:{rifle:geometryData(createRifle()),magazine:geometryData(createMagazine())},project};
 const folder=path.resolve('../../work');await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,'export-fixture.json'),JSON.stringify(fixture));
},20000);

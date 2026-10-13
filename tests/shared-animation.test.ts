import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import {Matrix4,Vector3} from 'three';
import {rigLoader} from './rig-loader';
import {MannyRig} from '../src/scene/rig';
import {MannyCharacter} from '../src/scene/MannyCharacter';
import {RetargetRig} from '../src/scene/RetargetRig';
import {autoMapBones,defaultHiddenMeshes} from '../src/core/retarget';
async function load(n:string){const b=await fs.readFile('public/assets/'+n+'.glb');return (await rigLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}
it('native bind translations retain the proportions of the shared animation axes',async()=>{
 const source=new MannyRig(await load('manny'));
 for(const sex of ['male','female']){const raw=new RetargetRig(await load('example-fantasy-'+sex));const target=new MannyCharacter(raw,source,{id:sex,name:sex,asset:'example-fantasy-'+sex,mapping:autoMapBones([...raw.bones.keys()]),hiddenMeshes:defaultHiddenMeshes(raw.meshes.map(m=>m.name),true),scale:1,facing:0,handIK:true,footIK:true,offsets:{}});
 const errors=[];
 for(const [name,b]of target.body.bones){const bind=new Matrix4().fromArray(b.userData.nativeBind),parent=target.body.bones.get(b.parent?.name??'');if(parent)bind.premultiply(new Matrix4().fromArray(parent.userData.nativeBind).invert());const error=new Vector3().setFromMatrixPosition(bind).distanceTo(target.body.rest.get(name)!.p);errors.push([name,error]);}
 expect(Math.max(...errors.map(r=>Number(r[1])))).toBeLessThan(1e-4);target.dispose();raw.dispose();
 }
});

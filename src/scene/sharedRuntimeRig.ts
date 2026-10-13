import {Bone,Matrix4,Uint16BufferAttribute} from 'three';
import type {MannyRig} from './rig';
import type {SharedExportPlan} from '../core/sharedExport';
import {sharedExportRig} from './sharedSkeletonExport';
import {skinSets} from './skinInfluences';

const deformName=(name:string)=>'pose_deform_'+name;

/** Animation drivers use the aligned control frames. Each deformation child
 * stores the mesh's native bind frame in the reference pose, then has an
 * identity local transform during playback. Unreal can therefore represent
 * both frames without changing vertices, weights or character proportions.
 *
 * This is the rig format for the generated runtime retargeter. Do not send it
 * through the legacy translation-only importer: the runtime solve is required.
 */
export function sharedRuntimeRig(source:MannyRig,slots:SharedExportPlan['sockets'],arms?:MannyRig){
 const base=sharedExportRig(source,slots,arms);
 try{
  const socketNames=new Set(slots.map(s=>s.bone));
  const drivers=[...base.bones.keys()].filter(name=>!socketNames.has(name));
  const skeletons=new Set(base.variants.map(mesh=>mesh.skeleton));
  const binds=new Map<string,Matrix4>();
  for(const name of drivers)if(base.bones.has(deformName(name)))throw Error('Conflicting shared deformation bone: '+deformName(name));
  for(const skeleton of skeletons)for(const [i,bone] of skeleton.bones.entries()){
   if(socketNames.has(bone.name))continue;
   const inverse=skeleton.boneInverses[i],known=binds.get(bone.name);
   if(!inverse||!inverse.elements.every(Number.isFinite)||Math.abs(inverse.determinant())<1e-12)throw Error('Invalid inverse bind for '+bone.name);
   const world=inverse.clone().invert();
   if(known&&known.elements.some((n,j)=>Math.abs(n-world.elements[j])>1e-6))throw Error('Meshes have different bind transforms for '+bone.name+'. They cannot share one deformation reference pose.');
   binds.set(bone.name,world);
  }
  const helpers=new Map<string,Bone>();
  for(const name of drivers){
   const driver=base.bones.get(name)!,bind=binds.get(name);
   if(!bind)throw Error('Missing inverse bind for '+name);
   const helper=new Bone();helper.name=deformName(name);driver.add(helper);
   driver.updateWorldMatrix(true,false);
   driver.matrixWorld.clone().invert().multiply(bind).decompose(helper.position,helper.quaternion,helper.scale);
   helper.updateMatrixWorld(true);helpers.set(name,helper);
  }
  for(const skeleton of skeletons){
   const original=[...skeleton.bones],offset=original.length;
   if(offset+drivers.length>65536)throw Error('The shared skin exceeds the glTF joint-index range.');
   const indices=new Map(drivers.map((name,i)=>[name,offset+i]));
   for(const mesh of base.variants.filter(m=>m.skeleton===skeleton))for(const {index,weight,indexName} of skinSets(mesh.geometry)){
    // Source skins can use byte indices. Added sockets/deformers can exceed
    // 255 even though the original skeleton did not; never truncate a remap.
    const remapped=new Uint16BufferAttribute(new Uint16Array(index.count*4),4);
    for(let vertex=0;vertex<index.count;vertex++)for(let component=0;component<4;component++){
     const old=index.getComponent(vertex,component),bone=original[old];
     if(!bone&&weight.getComponent(vertex,component)!==0)throw Error('Invalid weighted bone index in '+mesh.name);
     remapped.setComponent(vertex,component,bone?indices.get(bone.name)??old:0);
    }
    mesh.geometry.setAttribute(indexName,remapped);
   }
   skeleton.bones=[...original,...drivers.map(name=>helpers.get(name)!)];
   skeleton.boneInverses=[...original.map(b=>b.matrixWorld.clone().invert()),...drivers.map(name=>binds.get(name)!.clone().invert())];
   skeleton.init();
  }
  const bones=new Map([...base.bones,...[...helpers.values()].map(b=>[b.name,b] as const)]);
  const hierarchy=[...bones].map(([name,b])=>({name,parent:b.parent instanceof Bone?b.parent.name:null}));
  const bindings=drivers.map(driver=>({driver,deform:helpers.get(driver)!.name}));
  return {...base,bones,hierarchy,helpers,bindings,sync:((rig,props)=>{
   base.sync(rig,props);
   for(const bone of helpers.values()){
    bone.position.set(0,0,0);bone.quaternion.identity();bone.scale.set(1,1,1);bone.updateMatrixWorld(true);
   }
  }) as typeof base.sync};
 }catch(error){base.dispose();throw error;}
}

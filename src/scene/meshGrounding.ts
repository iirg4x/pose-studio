import * as T from 'three';
import {skinSets} from './skinInfluences';

// Membership is cached; positions are always skinned from the current pose.
// Evaluate only triangles in the rendered geometry, including blended edges.
export class MeshGrounding {
 private cache=new WeakMap<T.BufferGeometry,Map<string,Uint32Array>>();
 private visit(root:T.Object3D,bone:T.Bone,desired:T.Matrix4,scene:T.Matrix4,callback:(p:T.Vector3,weight:number)=>void,contact=bone){
  const delta=scene.clone().invert().multiply(desired).multiply(bone.matrixWorld.clone().invert()),branch=new Set<T.Bone>();bone.traverse(o=>{if(o instanceof T.Bone)branch.add(o);});
  const contactBranch=new Set<T.Bone>();contact.traverse(o=>{if(o instanceof T.Bone)contactBranch.add(o);});
  const point=new T.Vector3(),source=new T.Vector3(),part=new T.Vector3();
  root.traverse(o=>{
   if(!(o instanceof T.SkinnedMesh)||!o.visible)return;
   const geometry=o.geometry,position=geometry.getAttribute('position'),sets=skinSets(geometry);if(!sets.length)return;
   const indices=o.skeleton.bones.flatMap((b,i)=>branch.has(b)?[i]:[]);if(!indices.length)return;const affected=new Set(indices);
   const contactIndices=o.skeleton.bones.flatMap((b,i)=>contactBranch.has(b)?[i]:[]),members=new Set(contactIndices);
   const key=contactIndices.join(',')+':'+geometry.drawRange.start+':'+geometry.drawRange.count;
   let entries=this.cache.get(geometry);if(!entries)this.cache.set(geometry,entries=new Map());let vertices=entries.get(key);
   if(!vertices){const drawn=new Set<number>(),index=geometry.index,start=geometry.drawRange.start,end=Math.min(index?.count??position.count,start+geometry.drawRange.count);
    for(let i=start;i<end;i++)drawn.add(index?index.getX(i):i);
    vertices=Uint32Array.from([...drawn].filter(v=>{for(const {index,weight}of sets)for(let k=0;k<4;k++)if(weight.getComponent(v,k)>1e-5&&members.has(index.getComponent(v,k)))return true;return false;}));entries.set(key,vertices);
   }
   const outer=scene.clone().multiply(o.matrixWorld).multiply(o.bindMatrixInverse),transforms=o.skeleton.bones.map((b,i)=>outer.clone().multiply(affected.has(i)?delta.clone().multiply(b.matrixWorld):b.matrixWorld).multiply(o.skeleton.boneInverses[i]).multiply(o.bindMatrix));
   for(const v of vertices){T.Mesh.prototype.getVertexPosition.call(o,v,source);point.set(0,0,0);let movedWeight=0;for(const set of sets)for(let k=0;k<4;k++){const index=set.index.getComponent(v,k),w=set.weight.getComponent(v,k);if(!w)continue;point.addScaledVector(part.copy(source).applyMatrix4(transforms[index]),w);if(affected.has(index))movedWeight+=w;}callback(point,movedWeight);}
  });
 }
 points(root:T.Object3D,bone:T.Bone){const points:T.Vector3[]=[];this.visit(root,bone,bone.matrixWorld,new T.Matrix4(),p=>points.push(p.clone()));return points;}
 minimum(root:T.Object3D,bone:T.Bone,desired:T.Matrix4,scene=new T.Matrix4()){let low=Infinity;this.visit(root,bone,desired,scene,p=>{low=Math.min(low,p.y);});return Number.isFinite(low)?low:undefined;}
 lift(root:T.Object3D,bone:T.Bone,desired:T.Matrix4,clearance:number,scene=new T.Matrix4(),allowLower=false,contact=bone){let lift=allowLower?-Infinity:0;this.visit(root,bone,desired,scene,(p,w)=>{if(w>1e-5)lift=Math.max(lift,(clearance-p.y)/w);},contact);return Number.isFinite(lift)?lift:0;}
}

import {MeshStandardMaterial} from 'three';
import type {Material} from 'three';

// Filter subpixel normal detail before lighting; image antialiasing alone cannot
// prevent a tiny normal-map feature from producing a very bright specular flash.
export function prepareMannyMaterial(material:Material){
 if(!(material instanceof MeshStandardMaterial))return material;
 if(!material.userData.mannyPreviewShading){material.normalScale.multiplyScalar(.6);material.userData.mannyPreviewShading=true;}
 material.onBeforeCompile=shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
   roughnessFactor=max(roughnessFactor,0.36);
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
   vec3 normalDx=dFdx(normal),normalDy=dFdy(normal);
   float normalVariance=0.15*(dot(normalDx,normalDx)+dot(normalDy,normalDy));
   float specularKernel=min(2.0*normalVariance,0.2);
   roughnessFactor=pow(clamp(pow(roughnessFactor,4.0)+specularKernel,0.0,1.0),0.25);
  `);
 };
 material.customProgramCacheKey=()=> 'manny-filtered-specular-v1';
 return material;
}

import {Matrix4} from 'three';

export type RootMotionMode='keep'|'extract';
export function rootMotionFrame(bones:Record<string,number[]>,props:Record<string,number[]>,origin:number[],mode:RootMotionMode){
 if(mode==='keep')return {bones,props};
 const rootInverse=new Matrix4().fromArray(bones.root).invert(),originInverse=new Matrix4().fromArray(origin).invert();
 return {
  bones:Object.fromEntries(Object.entries(bones).map(([id,m])=>[id,originInverse.clone().multiply(new Matrix4().fromArray(m)).toArray()])),
  props:Object.fromEntries(Object.entries(props).map(([id,m])=>[id,rootInverse.clone().multiply(new Matrix4().fromArray(m)).toArray()]))
 };
}

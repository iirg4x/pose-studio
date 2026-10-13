import {Quaternion,Vector3} from 'three';
import {clone,evaluate,forLayer,IDS} from './model';
import type {Project,RigLayer} from './model';
import {applyPose} from './library';
export function loopRange(p:Project){return p.loop??{enabled:true,start:0,end:p.end};}
export function playbackFrame(p:Project,start:number,elapsed:number){
 const loop=loopRange(p),from=loop.enabled?loop.start:0,to=loop.enabled?loop.end:p.end;
 const initial=start<from||start>=to?from:start;
 const value=initial+elapsed;
 return {frame:loop.enabled?from+((value-from)%(to-from)+(to-from))%(to-from):Math.min(to,value),finished:!loop.enabled&&value>=to};
}
export function matchLoopEnd(p:Project):Project{
 const range=loopRange(p);let next=clone(p);
 for(const layer of (p.actionType||p.bodyBase?[p.editing]:['firstPerson','body']) as RigLayer[]){
  next=forLayer(next,layer);const values=evaluate(next,range.start);
  next=applyPose(next,range.end,{id:'loop',name:'Loop start',scope:'rig',layer,poses:values},'hand_l',{},true);
 }
 return forLayer(next,p.editing);
}
export function seamReport(p:Project){
 const range=loopRange(p),result:{layer:RigLayer;position:number;rotation:number;grip:number;fov:number;speed:number}[]=[];
 for(const layer of (p.actionType||p.bodyBase?[p.editing]:['firstPerson','body']) as RigLayer[]){
  const track=forLayer(p,layer),a=evaluate(track,range.start),b=evaluate(track,range.end),after=evaluate(track,range.start+.01),before=evaluate(track,range.end-.01);
  let position=0,rotation=0,grip=0,fov=0,speed=0;
  for(const id of IDS){
   position=Math.max(position,new Vector3(...a[id].p).distanceTo(new Vector3(...b[id].p))*100);
   rotation=Math.max(rotation,new Quaternion(...a[id].q).angleTo(new Quaternion(...b[id].q))*180/Math.PI);
   grip=Math.max(grip,...a[id].grip.map((v,i)=>Math.abs(v-b[id].grip[i])*100));fov=Math.max(fov,Math.abs(a[id].fov-b[id].fov));
   const va=new Vector3(...after[id].p).sub(new Vector3(...a[id].p)).multiplyScalar(100/.01),vb=new Vector3(...b[id].p).sub(new Vector3(...before[id].p)).multiplyScalar(100/.01);
   speed=Math.max(speed,va.distanceTo(vb));
  }
  result.push({layer,position,rotation,grip,fov,speed});
 }
 return result;
}

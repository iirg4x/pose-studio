import {Vector3} from 'three';
import type {Camera,Quaternion} from 'three';
import type {ControlId} from '../core/model';
import type {ControlVisual} from './controlVisual';
export type Axis='x'|'y'|'z';
export const unrealAxis=(axis:Axis)=>axis==='x'?new Vector3(0,0,1):axis==='y'?new Vector3(-1,0,0):new Vector3(0,1,0);
export const transformAxis=(axis:Axis,orientation?:Quaternion)=>orientation?new Vector3(axis==='x'?1:0,axis==='y'?1:0,axis==='z'?1:0).applyQuaternion(orientation):unrealAxis(axis);
export function mouseAxis(camera:Camera,pivot:Vector3,width:number,height:number,dx:number,dy:number,orientation?:Quaternion):Axis|null{
 if(Math.hypot(dx,dy)<3)return null;const start=pivot.clone().project(camera);let best:Axis|null=null,score=-1;
 for(const axis of ['x','y','z'] as const){const end=pivot.clone().addScaledVector(transformAxis(axis,orientation),.25).project(camera),x=(end.x-start.x)*width,y=-(end.y-start.y)*height,len=Math.hypot(x,y);if(len<1)continue;const fit=Math.abs(dx*x+dy*y)/len;if(fit>score){score=fit;best=axis;}}
 return best;
}
export interface ScreenRect {left:number;top:number;right:number;bottom:number}
function segmentInRect(ax:number,ay:number,bx:number,by:number,r:ScreenRect){
 let low=0,high=1;const dx=bx-ax,dy=by-ay;
 for(const [p,q] of [[-dx,ax-r.left],[dx,r.right-ax],[-dy,ay-r.top],[dy,r.bottom-ay]]){if(Math.abs(p)<1e-9){if(q<0)return false;}else{const t=q/p;if(p<0)low=Math.max(low,t);else high=Math.min(high,t);if(low>high)return false;}}
 return true;
}
export function boxControls(markers:Iterable<ControlVisual>,camera:Camera,width:number,height:number,rect:ScreenRect,enabled:(id:ControlId)=>boolean,exclude?:ScreenRect){
 const ids:ControlId[]=[];
 const covered=(x:number,y:number)=>exclude&&x>=exclude.left&&x<=exclude.right&&y>=exclude.top&&y<=exclude.bottom;
 for(const m of markers){if(!m.visible||!enabled(m.controlId))continue;const points=m.points.map(v=>v.clone().applyMatrix4(m.matrixWorld).project(camera));
  for(let i=0;i<points.length;i+=2){const a=points[i],b=points[i+1];if(a.z< -1||a.z>1||b.z< -1||b.z>1)continue;const ax=(a.x+1)*width/2,ay=(1-a.y)*height/2,bx=(b.x+1)*width/2,by=(1-b.y)*height/2;if(covered(ax,ay)&&covered(bx,by))continue;if(segmentInRect(ax,ay,bx,by,rect)){ids.push(m.controlId);break;}}
 }
 return ids;
}

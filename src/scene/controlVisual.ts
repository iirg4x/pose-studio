import * as T from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {CONTROLS} from '../core/controls';
import type {ControlId} from '../core/model';
import {controllerShape} from './controlShapes';
import type {SourceShape,ControllerShape} from './controlShapes';
export type {SourceShape} from './controlShapes';
export const controlColor=(id:ControlId)=>id.endsWith('_l')?0x63c5e9:id.endsWith('_r')?0xe98383:CONTROLS[id].group==='Props'?0x95ccb4:0xd8b879;
export class ControlVisual extends T.Group{
 points:T.Vector3[]=[];ink:LineMaterial;radius:number;family:ControllerShape['family'];detail:boolean;
 private shapePositions?:number[];private front:LineSegments2;private halo:LineSegments2;private haloInk:LineMaterial;
 constructor(public controlId:ControlId,source?:SourceShape){
  super();const id=controlId;this.userData.control=id;
  const {positions,family,detail}=controllerShape(id,source);this.family=family;this.detail=detail;
  for(let i=0;i<positions.length;i+=3)this.points.push(new T.Vector3(positions[i],positions[i+1],positions[i+2]));
  const box=new T.Box3().setFromPoints(this.points);this.radius=box.getSize(new T.Vector3()).length()/2;
  const geometry=new LineSegmentsGeometry().setPositions(positions);
  this.ink=new LineMaterial({color:controlColor(id),linewidth:1.65,depthTest:false,depthWrite:false,transparent:true,opacity:.8});
  this.haloInk=new LineMaterial({color:0x101820,linewidth:5,depthTest:false,depthWrite:false,transparent:true,opacity:.9});
  this.halo=new LineSegments2(geometry,this.haloInk);this.halo.renderOrder=20;this.halo.frustumCulled=false;this.halo.visible=false;this.add(this.halo);
  this.front=new LineSegments2(geometry,this.ink);this.front.renderOrder=21;this.front.frustumCulled=false;this.add(this.front);
 }
 setPropShape(positions:number[]){
  if(this.shapePositions===positions)return;this.shapePositions=positions;
  const geometry=new LineSegmentsGeometry().setPositions(positions);this.front.geometry.dispose();this.front.geometry=this.halo.geometry=geometry;
  this.points=[];for(let i=0;i<positions.length;i+=3)this.points.push(new T.Vector3(positions[i],positions[i+1],positions[i+2]));
  this.radius=new T.Box3().setFromPoints(this.points).getSize(new T.Vector3()).length()/2;
 }
 style(width:number,height:number,selected:boolean,hovered:boolean,enabled:boolean,pixelRadius=20){
  const active=hovered||selected;this.ink.resolution.set(width,height);this.haloInk.resolution.copy(this.ink.resolution);this.halo.visible=active;this.halo.renderOrder=active?22:20;this.front.renderOrder=active?23:21;
  this.ink.color.setHex(hovered?0xffffff:selected?0xffdf8c:controlColor(this.controlId));this.ink.linewidth=active?2.65:this.family==='finger'?1.35:this.detail?1.25:1.7;
  const density=this.family==='finger'?T.MathUtils.clamp(pixelRadius/5,.45,1):1;
  this.ink.opacity=active?1:(enabled?(this.detail?.48:.78):.18)*density;
 }
 dispose(){this.halo.geometry.dispose();this.ink.dispose();this.haloInk.dispose();}
}
export function pointSegmentDistance(x:number,y:number,a:{x:number;y:number},b:{x:number;y:number}){const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,t=d?T.MathUtils.clamp(((x-a.x)*dx+(y-a.y)*dy)/d,0,1):0;return Math.hypot(x-a.x-t*dx,y-a.y-t*dy);}
// Pixel-space picking stays forgiving when zoomed out; the model never occludes its controls.
export function pickControl(markers:Iterable<ControlVisual>,camera:T.Camera,width:number,height:number,x:number,y:number,enabled:(id:ControlId)=>boolean,tolerance=11){
 const hits:{id:ControlId;distance:number;depth:number}[]=[];
 for(const marker of markers){if(!marker.visible||!enabled(marker.controlId))continue;let nearest=Infinity,depth=Infinity;const p=marker.points.map(v=>v.clone().applyMatrix4(marker.matrixWorld).project(camera));
  for(let i=0;i<p.length;i+=2){const a=p[i],b=p[i+1];if(a.z< -1||a.z>1||b.z< -1||b.z>1)continue;const d=pointSegmentDistance(x,y,{x:(a.x+1)*width/2,y:(1-a.y)*height/2},{x:(b.x+1)*width/2,y:(1-b.y)*height/2});if(d<nearest){nearest=d;depth=(a.z+b.z)/2;}}
  if(nearest<=tolerance)hits.push({id:marker.controlId,distance:nearest,depth});
 }
 return hits.sort((a,b)=>a.distance-b.distance||a.depth-b.depth);
}

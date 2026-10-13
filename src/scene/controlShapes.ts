import {Box3,Vector3} from 'three';
import {propControlShape} from './propControlShape';
import {CONTROLS} from '../core/controls';
import type {ControlId} from '../core/model';

export interface SourceShape {source:string;shape:string;vertices:number[][];edges:number[][]}
type Point=[number,number,number];
type Plane='xy'|'xz'|'yz';
export interface ControllerShape {positions:number[];detail:boolean;family:'master'|'body'|'head'|'rotation'|'finger'|'twist'|'hand'|'foot'|'pole'|'pivot'|'prop'|'camera'}

// Geometry lives in the control's existing local frame. Source bounds supply
// placement and size only; Blender's doubled ribbon edges are not rendered.
export function controllerShape(id:ControlId,source?:SourceShape):ControllerShape{
 const positions:number[]=[],side=id.endsWith('_r')?-1:1;
 const bounds=[0,1,2].map(axis=>{const values=source?.vertices.map(p=>p[axis]);return values?.length?[Math.min(...values),Math.max(...values)]:[0,0];});
 const center=bounds.map(([a,b])=>(a+b)/2),extent=bounds.map(([a,b])=>(b-a)/2);
 const point=(u:number,v:number,plane:Plane,offset:Point=[0,0,0]):Point=>plane==='xy'?[u+offset[0],v+offset[1],offset[2]]:plane==='xz'?[u+offset[0],offset[1],v+offset[2]]:[offset[0],u+offset[1],v+offset[2]];
 const edge=(a:Point,b:Point)=>positions.push(...a,...b);
 const path=(points:Point[],closed=false)=>{for(let i=1;i<points.length;i++)edge(points[i-1],points[i]);if(closed)edge(points.at(-1)!,points[0]);};
 const arc=(rx:number,ry:number,plane:Plane,offset:Point=[0,0,0],start=0,end=Math.PI*2,steps=40)=>path(Array.from({length:steps+1},(_,i)=>{const a=start+(end-start)*i/steps;return point(Math.cos(a)*rx,Math.sin(a)*ry,plane,offset);}));
 const rounded=(w:number,h:number,r:number,plane:Plane,offset:Point=[0,0,0])=>{const points:Point[]=[];for(let j=0;j<4;j++){const a=j*Math.PI/2,cx=(j===0||j===3?1:-1)*(w-r),cy=(j<2?1:-1)*(h-r);for(let i=0;i<=4;i++)points.push(point(cx+Math.cos(a+i*Math.PI/8)*r,cy+Math.sin(a+i*Math.PI/8)*r,plane,offset));}path(points,true);};
 const result=(family:ControllerShape['family'],detail=false)=>({positions,family,detail});
 if(id==='root'){
  for(let i=0;i<4;i++){const a=i*Math.PI/2;arc(.57,.57,'xy',[0,0,.004],a+.09,a+Math.PI/2-.09,18);edge(point(Math.cos(a)*.55,Math.sin(a)*.55,'xy',[0,0,.004]),point(Math.cos(a)*.61,Math.sin(a)*.61,'xy',[0,0,.004]));}
  path([[-.045,-.59,.004],[0,-.65,.004],[.045,-.59,.004]]);return result('master');
 }
 if(CONTROLS[id].kind==='pole'){
  // An octahedral diamond remains recognizable from the side as well as front.
  const r=.035,ring:Point[]=[[r,0,0],[0,r,0],[-r,0,0],[0,-r,0]];path(ring,true);for(const p of ring){edge(p,[0,0,r*.65]);edge(p,[0,0,-r*.65]);}return result('pole');
 }
 if(/^(heel|ball)_/.test(id)){
  // The roll handle is centered on the actual pivot, not an old mesh offset.
  arc(.027,.027,'xy',[0,0,0],-.25,Math.PI*1.65,26);path([[.027,-.007,0],[.032,.003,0],[.022,.001,0]]);edge([0,0,-.017],[0,0,.017]);return result('pivot');
 }
 if(/^(thumb|index|middle|ring|pinky)_/.test(id)){
  const palm=id.includes('_palm_'),cx=source?center[0]:side*.014,cy=source?center[1]:-side*.013;
  const length=Math.max(.006,Math.min(palm?.017:.014,Math.abs(cx)*.65)),width=palm?.0045:.006;
  rounded(length,width,Math.min(length,width)*.85,'xz',[cx,cy,source?center[2]:0]);return result('finger',palm);
 }
 if(id.includes('_twist_')){
  const r=id.startsWith('thigh')?.078:id.startsWith('calf')?.055:id.startsWith('upperarm')?.056:.042;
  arc(r,r,'yz',[0,0,0],-.65,.65,10);arc(r,r,'yz',[0,0,0],Math.PI-.65,Math.PI+.65,10);return result('twist',true);
 }
 if(id==='head'){
  rounded(.115,.103,.049,'xz',[.065,.105,0]);
  path([[.18,.105,-.024],[.194,.105,0],[.18,.105,.024]]);return result('head');
 }
 if(CONTROLS[id].group==='Body'){
  const neck=id.startsWith('neck'),hip=id==='hips',chest=id==='chest',x=hip?.045:source?center[0]:.03;
  const ry=neck?.059:hip?.13:chest?.145:id==='spine_04'||id==='spine_05'?.135:.12,rz=neck?.059:hip?.205:chest?.205:id==='spine_04'||id==='spine_05'?.19:.165;
  arc(ry,rz,'yz',[x,0,0],hip||chest||neck?0:-Math.PI*.47,hip||chest||neck?Math.PI*2:Math.PI*.47,hip||chest?40:28);
  return result('body',!hip&&!chest&&!neck);
 }
 if(id.startsWith('hand_')){
  rounded(.048,.056,.016,'yz',[0,-side*.008,0]);
  for(const z of [-.056,.056])path([[0,-side*.008,z],[side*.024,-side*.008,z],[side*.03,-side*.008,z*.7]]);
  return result('hand');
 }
 if(id.startsWith('foot_')){
  rounded(Math.max(.13,extent[1]),.062,.032,'yz',[source?center[0]:-side*.078,source?center[1]:-side*.075,0]);
  const x=source?center[0]:-side*.078,toe=source?bounds[1][side===1?0:1]:-side*.23;
  path([[x,toe+side*.022,-.02],[x,toe+side*.006,0],[x,toe+side*.022,.02]]);return result('foot');
 }
 if(CONTROLS[id].kind==='bone'){
  const wrist=id.startsWith('wrist'),toe=id.startsWith('toe'),shoulder=id.startsWith('shoulder');
  const r=source?Math.max(extent[1],extent[2]):wrist?.04:toe?.05:.07,x=source?center[0]:side*.065;
  arc(r,r,'yz',[x,0,0],toe?-.1:0,toe?Math.PI+.1:Math.PI*2,toe?24:36);
  if(!toe)path([[x,r,0],[x+side*(shoulder?.023:.015),r,0],[x+side*(shoulder?.023:.015),r*.78,0]]);
  return result('rotation');
 }
 if(id==='camera'){
  rounded(.085,.052,.012,'xy');path([[-.045,-.027,.07],[.045,-.027,.07],[.045,.027,.07],[-.045,.027,.07]],true);for(const s of [-1,1])edge([s*.085,0,0],[s*.045,0,.07]);return result('camera');
 }
 positions.push(...propControlShape(new Box3(new Vector3(-.04,-.06,-.025),new Vector3(.04,.06,.025))));return result('prop');
}

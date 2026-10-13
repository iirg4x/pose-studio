import {useState,useSyncExternalStore} from 'react';
import {Euler,Quaternion} from 'three';
import {ScrubNumber} from './ScrubNumber';
import {studio} from '../core/store';
import {useStudioChrome} from '../hooks';
import {clone,controlEnabled} from '../core/model';
import {editLayerAllowed} from '../core/layers';
import type {Q4} from '../core/model';
import {CONTROLS,isOffsetControl} from '../core/controls';
import {coordinatePose} from '../scene/coordinates';
import type {CoordinateSpace} from '../scene/coordinates';
import type {StudioScene} from '../scene/StudioScene';
const subscribeEmpty=()=>()=>{},emptySnapshot=()=>null;
export function TransformFields({runtime}:{runtime:StudioScene|null}){
 const s=useStudioChrome({edits:'live'}),[space,setSpace]=useState<CoordinateSpace>(()=>{try{const v=localStorage.getItem('pose-coordinate-space');if(v&&['local','parent','root','world'].includes(v))return v as CoordinateSpace;}catch{}return 'world';});
 const resolved=useSyncExternalStore(runtime?.subscribeCoordinates??subscribeEmpty,runtime?.getCoordinates??emptySnapshot),raw=studio.currentTransformPose();if(!s.project||!raw)return null;
 const snapshot=resolved?.id===s.selected?resolved:null,transform=space==='local'?raw:snapshot?coordinatePose(snapshot,space,raw):null;
 const e=new Euler().setFromQuaternion(new Quaternion(...(transform?.q??raw.q)),'XYZ');
 const edit=(axis:number,value:number,rotation:boolean)=>{if(!Number.isFinite(value))return;if(space!=='local'){runtime?.editCoordinate(space,axis,value,rotation);return;}const next=clone(studio.currentTransformPose()!);if(rotation){const a=new Euler().setFromQuaternion(new Quaternion(...next.q),'XYZ'),angles=[a.x,a.y,a.z];angles[axis]=value*Math.PI/180;next.q=new Quaternion().setFromEuler(new Euler(...angles as [number,number,number],'XYZ')).toArray() as Q4;}else next.p[axis]=value/100;s.project!.tracks[s.selected].additive?studio.editLayerOffset(s.selected,next):isOffsetControl(s.selected)?studio.editRaw(s.selected,next):studio.editWorld(s.selected,next);};
 return <><label className="property-row coordinate-space"><span>Coordinates</span><select aria-label="XYZ coordinate space" value={space} onChange={e=>{studio.endGesture();setSpace(e.target.value as CoordinateSpace);try{localStorage.setItem('pose-coordinate-space',e.target.value);}catch{}}}><option value="world">World</option><option value="root">Root</option><option value="parent">Parent</option><option value="local">Local offsets</option></select></label>
 {(['Location','Rotation'] as const).map((kind,k)=><div className="property-vector" key={kind}><div className="property-vector-label"><span>{kind}</span><small>{k?'degrees':'cm'}</small></div><div className="vector-inputs">{['X','Y','Z'].map((axis,i)=><label key={axis}><span>{axis}</span><ScrubNumber aria-label={(k?'Rotation ':'Position ')+axis} type="number" step={k?5:1} disabled={!transform||!controlEnabled(s.project!,s.selected,s.frame)||!editLayerAllowed(s.project!,s.selected)||!k&&CONTROLS[s.selected].kind==='pivot'} value={Number((k?[e.x,e.y,e.z][i]*180/Math.PI:(transform?.p[i]??0)*100).toFixed(k?1:2))} onFocus={()=>studio.beginGesture()} onBlur={()=>studio.endGesture()} onChange={event=>{if(event.target.value!=='')edit(i,Number(event.target.value),!!k);}}/></label>)}</div></div>)}
 <p className="property-note coordinate-space-note">{space==='world'?'Scene coordinates.':space==='root'?'Relative to the character root.':space==='parent'?'Relative to the current parent.':'Stored control or layer offsets.'} Changing space keeps the pose.</p></>;
}

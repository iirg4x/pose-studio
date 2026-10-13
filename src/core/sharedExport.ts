import {clone} from './model';
import {projectProps} from './assets';
import type {PropAsset} from './assets';
import type {AnimationLibrary} from './library';

export interface SharedExportPlan {
 version:2;name:string;
 characters:{id:string;name:string}[];
 clips:{id:string;name:string;type:'body'|'firstPerson';fps:number;end:number;sampleRate?:number;props:{slot:string;asset:string;visible:boolean}[]}[];
 sockets:{id:string;bone:string;socket:string;parent:string}[];
 props:{id:string;settings:PropAsset}[];
}
export type SharedExportItem={characterId:string;clipId?:never;sampleRate?:never}|{clipId:string;characterId?:never;sampleRate?:number};
// Stable identities make the same prop control share one attachment bone even
// when different animations bind a different mesh to that control.
function token(value:string){let h=2166136261;for(const c of value){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
export function sharedExportPlan(workspace:AnimationLibrary,allClips=true):SharedExportPlan {
 const clips=allClips?workspace.clips:workspace.clips.filter(c=>c.id===workspace.activeId);
 if(!clips.length)throw Error('Create an animation before exporting.');
 const slots=[...new Set(clips.flatMap(c=>Object.keys(projectProps(c.project))))].sort();
 const props:SharedExportPlan['props']=[],assets=new Map<string,string>();
 return {version:2,name:workspace.name,characters:[{id:'manny',name:'Manny'},...(workspace.characters??[]).map(c=>({id:c.id,name:c.name}))],
 sockets:slots.map(id=>({id,bone:'pose_prop_'+token(id),socket:'prop_'+token(id),parent:'root'})),props,
 clips:clips.map(c=>({id:c.id,name:c.project.name,type:c.project.editing,fps:c.project.fps,end:c.project.end,props:Object.entries(projectProps(c.project)).map(([slot,value])=>{
  const settings=value!,signature=JSON.stringify([settings.asset,settings.scale,settings.rotation,settings.offset]);let id=assets.get(signature);
  if(!id){id='asset_'+props.length;assets.set(signature,id);props.push({id,settings:clone(settings)});}
  return {slot,asset:id,visible:settings.visible};
 })}))};
}

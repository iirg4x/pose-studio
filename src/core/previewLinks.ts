import {clone,createFirstPersonAction,forLayer,layerFrame,putKey} from './model';
import type {Project,RigLayer} from './model';
import type {AnimationLibrary,Poses} from './library';
import {keyingFrame} from './layers';
const derived=new WeakMap<Project,{drafts:Poses|undefined;frame:number;project:Project}>();
export function firstPersonPreview(project:Project,drafts?:Poses,frame=0){
 const hasDrafts=drafts&&Object.keys(drafts).length>0,cached=derived.get(project),draftFrame=hasDrafts?frame:0;
 if(cached&&cached.drafts===(hasDrafts?drafts:undefined)&&cached.frame===draftFrame)return cached.project;
 let source=project;
 if(hasDrafts){source=clone(project);for(const [id,value] of Object.entries(drafts))if(value)putKey(source.tracks[id as keyof typeof source.tracks],keyingFrame(source,frame),value);}
 const preview=createFirstPersonAction(source,'preview-only');derived.set(project,{drafts:hasDrafts?drafts:undefined,frame:draftFrame,project:preview});return preview;
}
export interface PreviewView {project:Project;frame:number}
export function previewViews(project:Project,frame:number,workspace?:AnimationLibrary|null,drafts?:Poses):Record<RigLayer,PreviewView>{
 const views={firstPerson:{project:forLayer(project,'firstPerson'),frame:layerFrame(project,'firstPerson',frame)},body:{project:forLayer(project,'body'),frame:layerFrame(project,'body',frame)}};
 const active=workspace?.clips.find(c=>c.id===workspace.activeId),linked=active?.previewId&&workspace?.clips.find(c=>c.id===active.previewId&&c.project.editing!==project.editing);
 if(linked)views[linked.project.editing]={project:linked.project,frame:Math.min(linked.project.end,Math.max(0,active.previewSync==='phase'?frame/Math.max(1,project.end)*linked.project.end:frame/project.fps*linked.project.fps))};
 else if(project.editing==='body')views.firstPerson={project:firstPersonPreview(project,drafts,frame),frame};
 return views;
}

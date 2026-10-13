import {clone} from './model';
import type {Project} from './model';
import {entry} from './library';
import type {AnimationLibrary} from './library';

/** Keep refreshed source snapshots while severing live pose links.
 * A body source remains usable as its embedded saved copy. */
export function detachDeletedAnimation(project:Project,id:string):Project{
 const layers=project.layers?.map(layer=>layer.poseLinks?.some(link=>link.clipId===id)?{...layer,poseLinks:layer.poseLinks.filter(link=>link.clipId!==id)}:layer);
 const source=project.bodyBase&&detachDeletedAnimation(project.bodyBase.source,id);
 if(!layers?.some((layer,i)=>layer!==project.layers![i])&&source===project.bodyBase?.source)return project;
 return {...project,...(layers?{layers}:{}),...(project.bodyBase&&source?{bodyBase:{...project.bodyBase,source}}:{})};
}

export function deleteLibraryAnimation(workspace:AnimationLibrary,id:string,empty:()=>Project):AnimationLibrary{
 if(!workspace.clips.some(clip=>clip.id===id))return workspace;
 const clips=workspace.clips.filter(clip=>clip.id!==id).map(clip=>{
  const project=detachDeletedAnimation(clip.project,id);
  if(project===clip.project&&clip.previewId!==id)return clip;
  const next={...clip,project};if(next.previewId===id)delete next.previewId;return next;
 });
 if(!clips.length)clips.push(entry(empty()));
 const openIds=workspace.openIds.filter(open=>open!==id);
 const index=workspace.openIds.indexOf(id),activeId=workspace.activeId!==id?workspace.activeId:openIds[Math.min(Math.max(index,0),openIds.length-1)]??clips[0].id;
 if(!openIds.includes(activeId))openIds.push(activeId);
 return {...workspace,clips,openIds,activeId,poses:clone(workspace.poses)};
}

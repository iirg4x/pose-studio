import {loopRange} from './loops';
import type {Project} from './model';
export interface RecordingOptions {loops:number;range:'animation'|'loop';view:'player'|'scene';width:number;height:number;format:'mp4'|'webm';}
export function recordingPlan(project:Project,options:RecordingOptions){
 const {loops,width,height}=options;
 if(!Number.isInteger(loops)||loops<1||loops>100)throw Error('Choose 1–100 loops.');
 if(![width,height].every(v=>Number.isInteger(v)&&v>=2&&v<=3840&&v%2===0))throw Error('Recording dimensions must be even and between 2 and 3840 pixels.');
 const {start,end}=options.range==='loop'?loopRange(project):{start:0,end:project.end};
 if(!Number.isFinite(project.fps)||project.fps<=0||!Number.isInteger(start)||!Number.isInteger(end)||end<=start)throw Error('The recording needs a valid playback range.');
 // Playback wraps at the closing pose. Do not hold that pose for an extra frame on every repeat.
 const framesPerLoop=end-start,duration=framesPerLoop*loops/project.fps,fps=60,totalFrames=Math.ceil(duration*fps-1e-8);
 return {...options,start,end,fps,sourceFps:project.fps,framesPerLoop,totalFrames,duration};
}
export type RecordingPlan=ReturnType<typeof recordingPlan>;
export function recordingFrame(plan:RecordingPlan,index:number){return plan.start+(index*plan.sourceFps/plan.fps)%plan.framesPerLoop;}
export function recordingSampleDuration(plan:RecordingPlan,index:number){return Math.min(1/plan.fps,plan.duration-index/plan.fps);}

import {CanvasSource,canEncodeVideo,Mp4OutputFormat,Output,Quality,StreamTarget,WebMOutputFormat} from 'mediabunny';
import type {RecordingPlan} from '../core/recording';
import {recordingSampleDuration} from '../core/recording';
import type {StudioScene} from './StudioScene';
export async function exportRecording(runtime:StudioScene,plan:RecordingPlan,onProgress:(value:number)=>void,signal:AbortSignal){
 const desktop=window.studioDesktop,project=runtime.store.state.project;if(!desktop||!project)throw Error('Open the desktop app to export a recording.');
 const codec=plan.format==='mp4'?'avc':'vp9',quality=new Quality('high');
 if(!await canEncodeVideo(codec,{width:plan.width,height:plan.height,quality,frameRate:plan.fps}))throw Error(plan.format==='mp4'?'MP4 encoding is unavailable on this device. Choose WebM instead.':'Video encoding is unavailable at this resolution. Try a smaller size.');
 signal.throwIfAborted();
 const session=await desktop.beginRecording({name:project.name+'_'+plan.loops+'x',format:plan.format});if(!session)return null;
 let output:Output|undefined;
 try{
  signal.throwIfAborted();
  output=new Output({format:plan.format==='mp4'?new Mp4OutputFormat({fastStart:false}):new WebMOutputFormat(),target:new StreamTarget(new WritableStream({write:chunk=>desktop.writeRecording(session.id,chunk.data,chunk.position)}),{chunked:true,chunkSize:1024*1024})});
  const source=new CanvasSource(runtime.renderer.domElement,{codec,quality,keyFrameInterval:2});output.addVideoTrack(source,{frameRate:plan.fps});
  output.setMetadataTags({title:project.name});await output.start();
  await runtime.renderRecording(plan,async index=>{signal.throwIfAborted();await source.add(index/plan.fps,recordingSampleDuration(plan,index));onProgress((index+1)/plan.totalFrames*.96);},signal);
  signal.throwIfAborted();await output.finalize();signal.throwIfAborted();
  const filename=await desktop.finishRecording(session.id);onProgress(1);return filename;
 }catch(error){await output?.cancel().catch(()=>{});await desktop.cancelRecording(session.id);throw error;}
}

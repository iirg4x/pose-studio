import {useEffect,useState} from 'react';
import {SharedExportDialog} from './SharedExportDialog';
import {X,Check,FolderOpen,AlertCircle} from 'lucide-react';
import {projectProps} from '../core/assets';
import {loopRange} from '../core/loops';
import {useStudio} from '../hooks';
import type {StudioScene} from '../scene/StudioScene';
export function ExportDialog({runtime,close}:{runtime:StudioScene|null;close:()=>void}){
 const [shared,setShared]=useState(true);
 const s=useStudio(),body=s.project?.editing==='body',[includeMesh,setIncludeMesh]=useState(true),[onlyLoop,setOnlyLoop]=useState(false),[extractRoot,setExtractRoot]=useState(false),[status,setStatus]=useState<{blender:string|null}>(),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState(''),[result,setResult]=useState<{directory:string;files:string[]}|null>(null);
 useEffect(()=>{window.studioDesktop?.status().then(setStatus).catch(e=>setError(e.message));},[]);
 async function run(){
  if(!runtime||!s.project||!window.studioDesktop)return;
  setBusy(true);setError('');
  try{const data=await runtime.bake(s.project,setProgress,onlyLoop?loopRange(s.project):undefined,extractRoot?'extract':'keep');setProgress(.55);const res=await window.studioDesktop.exportAnimation(data,{includeMesh});if(!res.canceled){setProgress(1);setResult(res);}else setProgress(0);}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 if(shared)return <SharedExportDialog runtime={runtime} close={close} single={()=>setShared(false)}/>;
 return <div className="modal-backdrop"><section className="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title"><header><div><h2 id="export-title">Export to Unreal</h2><p>{s.project?.name} · Manny Simple · {s.project?.fps} fps · {s.project?(onlyLoop?loopRange(s.project).end-loopRange(s.project).start:s.project.end)+1:0} samples</p></div><button disabled={busy} aria-label="Close export" onClick={close}><X size={20}/></button></header>
  {!result&&<div className="segmented export-modes"><button aria-pressed="true" disabled={busy}>Current animation</button><button disabled={busy} onClick={()=>setShared(true)}>Shared skeleton</button></div>}
  {result?<div className="export-success"><Check size={28}/><h3>Animation exported</h3><p>{result.files.length} files saved to:</p><code>{result.directory}</code><button className="primary" onClick={()=>window.studioDesktop?.showFolder(result.directory)}><FolderOpen size={16}/> Open folder</button><p className="help-text">Import the body and arms as separate skeletal meshes. Legs use the body pose; floating arms and player props attach to the camera. The JSON sidecar records component settings and synchronized timing.</p></div>:<>
  <div className="export-summary"><span>{body?'Full body + legs':'Floating arms'}</span><strong>{body?'Body action FBX':'First-person action FBX'}</strong><span>{body?'World props':'Player props'}</span><strong>{Object.keys(projectProps(s.project)).length} animated FBX files</strong><span>Camera & attachments</span><strong>JSON sidecar</strong></div>
  <label className="check-row"><input type="checkbox" checked={onlyLoop} disabled={busy} onChange={e=>setOnlyLoop(e.target.checked)}/> Export loop range only{s.project?' ('+loopRange(s.project).start+'–'+loopRange(s.project).end+')':''}</label><p className="help-text">Modifiers are baked into the motion. Loop export includes the closing pose and starts at frame 0. The source project stays complete.</p>
  <label className="check-row"><input type="checkbox" disabled={!body||busy} checked={extractRoot} onChange={e=>setExtractRoot(e.target.checked)}/> Prepare body root motion for Unreal</label><p className="help-text">{extractRoot?'Body motion starts at the origin. World props use actor space so movement is applied once. Enable Root Motion on the body animation in Unreal; keep it off for arms and props.':'Root motion stays on the bones and world props. Use this for previewing the authored motion without Unreal root extraction.'}</p>
  <label className="check-row"><input type="checkbox" checked={includeMesh} onChange={e=>setIncludeMesh(e.target.checked)} disabled={busy}/> Include {body?'body and legs meshes':'floating arms mesh'}</label><p className="help-text">Include meshes for a first import. Manny PBR textures are included. Export the companion action separately for its matching arms or body motion.</p>
  {!window.studioDesktop?<p className="notice">Open the desktop app to export FBX. Project saving and animation editing are available in this browser preview.</p>:status&&!status.blender?<div className="notice">Select your Blender installation to enable FBX export.<button onClick={async()=>{const b=await window.studioDesktop!.chooseBlender();setStatus({blender:b});}}>Choose Blender</button></div>:null}
  {busy&&<div className="export-progress"><span>{progress<.5?'Baking animation…':'Writing FBX files…'}</span><progress value={progress} max={1}/></div>}
  {error&&<p role="alert" className="error-message"><AlertCircle size={16}/>{error}</p>}
  <footer><button disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy||!status?.blender||!s.ready} onClick={run}>{busy?'Exporting…':'Choose folder & export'}</button></footer></>}
 </section></div>;
}

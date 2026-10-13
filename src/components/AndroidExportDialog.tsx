import {useState} from 'react';
import {Save,Video,X} from 'lucide-react';
import type {StudioScene} from '../scene/StudioScene';
import {RecordingDialog} from './RecordingDialog';
export function AndroidExportDialog({runtime,save,close}:{runtime:StudioScene|null;save:()=>Promise<boolean>;close:()=>void}){
 const [record,setRecord]=useState(false),[busy,setBusy]=useState(false);
 if(record)return <RecordingDialog runtime={runtime} close={close}/>;
 return <div className="modal-backdrop"><section className="modal compact-modal" role="dialog" aria-modal="true" aria-label="Export" onKeyDown={e=>{if(e.key==='Escape'&&!busy)close();}}><header><h2>Take your animation with you</h2><button aria-label="Close export" disabled={busy} onClick={close}><X size={20}/></button></header><div className="android-export-options"><button disabled={busy} onClick={async()=>{setBusy(true);try{if(await save())close();}finally{setBusy(false);}}}><Save size={24}/><span>Pose project<small>Editable animation, models and props · .pose</small></span></button><button disabled={busy} onClick={()=>setRecord(true)}><Video size={24}/><span>Video recording<small>60 fps · choose your camera and loop count</small></span></button></div><p className="help-text">For a character GLB, select a preview model and use Export. FBX and shared Unreal packaging are available when you open this same .pose project in desktop Pose.</p></section></div>;
}

import {useState} from 'react';
import {PersonStanding,SlidersHorizontal,LoaderCircle} from 'lucide-react';
import {useStudioChrome} from '../hooks';
import {studio} from '../core/store';
import type {StudioScene} from '../scene/StudioScene';
import '../retarget.css';

export function PreviewModel({runtime,configure}:{runtime:StudioScene|null;configure:()=>void}){
 const s=useStudioChrome({frame:'none',edits:'live'}),[busy,setBusy]=useState(false),characters=s.workspace?.characters??[],selected=characters.find(c=>c.id===s.workspace?.previewCharacterId);
 const value=selected?.id??'manny';
 async function choose(value:string){if(!runtime||busy)return;setBusy(true);const playing=studio.state.playing;try{if(value==='manny')studio.selectPreviewCharacter('');else studio.selectPreviewCharacter(value);if(playing)studio.patch({playing:true});}catch(e){studio.patch({message:(e as Error).message});}finally{setBusy(false);}}
 return <div className="preview-model"><span title="Preview model">{busy||s.retargetLoading?<LoaderCircle size={15} className="spin"/>:<PersonStanding size={15}/>}</span><select aria-label="Preview model" title="Preview the same animation on another model" value={value} disabled={!s.ready||busy} onChange={e=>void choose(e.target.value)}><option value="manny">Manny</option>{characters.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><button title="Set up preview models" aria-label="Set up preview models" onClick={configure}><SlidersHorizontal size={15}/></button></div>;
}

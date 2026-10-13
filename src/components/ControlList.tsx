import {Eye,EyeOff} from 'lucide-react';
import {useState} from 'react';
import {useStudioChrome,useStudioSelector} from '../hooks';
import {studio} from '../core/store';
import {controlLabels,visibleControls,controlEnabled,limbMode} from '../core/model';
import {CONTROLS} from '../core/controls';
export function ControlList(){
 // Only keyed IK/FK changes affect the list while the playhead moves.
 useStudioSelector(s=>s.project?(['arm_l','arm_r','leg_l','leg_r'] as const).map(limb=>limbMode(s.project!,limb,s.frame)).join(':'):'');
 const s=useStudioChrome({frame:'none'}),[search,setSearch]=useState(''),labels=controlLabels(s.project),layer=s.project?.editing??'firstPerson',ids=visibleControls(layer,s.project),filtered=ids.filter(id=>labels[id].toLowerCase().includes(search.toLowerCase())),groups=[...new Set(filtered.map(id=>CONTROLS[id].group))];
 const visible=ids.filter(id=>!s.hiddenControls[layer].includes(id)).length;
 return <aside className="control-list" aria-label="Rig control visibility">
  <header><strong className="context-flair" title="A select all · Alt A clear · Shift-click to add">Controls</strong><span>{visible}/{ids.length}</span><div className="control-list-actions"><button aria-label="Show all" title="Show all controls (Alt H)" onClick={()=>studio.showControls(true)}><Eye size={14}/></button><button aria-label="Hide all" title="Hide all controls" onClick={()=>studio.showControls(false)}><EyeOff size={14}/></button></div></header>
  <input className="control-search" aria-label="Find rig control" placeholder="Find control…" value={search} onChange={e=>setSearch(e.target.value)}/>
  <div className="control-list-rows">{groups.map(group=><div className="control-group" key={group}><h3>{group}</h3>{filtered.filter(id=>CONTROLS[id].group===group).map(id=>{
   const shown=!s.hiddenControls[layer].includes(id);
   const enabled=s.project?controlEnabled(s.project,id,studio.state.frame):true;
   return <div key={id} className={'control-row '+(s.selection.includes(id)?'selected ':'')+(!shown?'hidden-control ':'')+(!enabled?'inactive-control':'')}>
    <button className="control-name" aria-label={'Select '+labels[id]} aria-pressed={s.selection.includes(id)} title={labels[id]+(!enabled?' · switch limb to '+CONTROLS[id].only?.toUpperCase():'')} onClick={e=>studio.selectControl(id,e.shiftKey||s.multiSelect)}>
     <i data-side={id.endsWith('_l')?'left':id.endsWith('_r')?'right':CONTROLS[id].group==='Props'?'prop':'center'}/><span>{labels[id]}</span>
    </button>
    <button className="control-eye" aria-label={(shown?'Hide ':'Show ')+labels[id]+' control'} aria-pressed={shown} title={(shown?'Hide ':'Show ')+labels[id]+' in the viewport'} onClick={()=>studio.setControlVisible(id,!shown)}>{shown?<Eye size={14}/>:<EyeOff size={14}/>}</button>
   </div>;
  })}</div>)}</div>
  
 </aside>;
}

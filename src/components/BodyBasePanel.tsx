import {ControlMask} from './ControlMask';
import {PropertySection} from './PropertySection';
import {controlLabels,visibleControls} from '../core/model';
import {sourceWouldCycle} from '../core/library';
import {useStudioChrome} from '../hooks';
import {studio} from '../core/store';
export function BodyBasePanel(){
 const s=useStudioChrome({frame:'none',edits:'live'}),p=s.project,base=p?.bodyBase;if(!p)return null;
 const sourceType=p.editing==='body'?'first-person':'full-body',heading=p.editing==='body'?'First-person source':'Full-body source';
 if(!base)return <PropertySection id="body-source" title="Source animation"><p className="property-note">Independent action. A new {p.editing==='body'?'first-person':'full-body'} version can use this animation as its source.</p></PropertySection>;
 const sources=s.workspace!.clips.filter(c=>c.project.editing!==p.editing&&!sourceWouldCycle(s.workspace!,s.workspace!.activeId,c.id)),available=sources.some(c=>c.id===base.sourceId);
 return <><PropertySection id="body-source" title={heading}>
  <div className="property-row"><span>Enabled</span><label className="property-checkbox"><input type="checkbox" aria-label={'Enable '+sourceType+' base'} checked={base.enabled} onChange={e=>studio.configureBodyBase({enabled:e.target.checked})}/>Inherit motion</label></div>
  <label className="property-row"><span>Action</span><select aria-label="Source animation" value={base.sourceId} onChange={e=>studio.setBodyBase(e.target.value)}>{!available&&<option value={base.sourceId}>{base.source.name} · saved copy</option>}{sources.map(c=><option key={c.id} value={c.id}>{c.project.name}</option>)}</select></label>
 </PropertySection><PropertySection id="source-exclusions" title="Source bone exclusions" defaultOpen={false}><p className="property-note">Checked bones ignore source motion. They remain editable in this animation.</p><ControlMask ids={visibleControls(p.editing,p)} labels={controlLabels(p)} excluded={base.excluded} mode="exclude" change={excluded=>studio.configureBodyBase({excluded})}/><p className="property-note">The player camera is edited separately.</p></PropertySection></>;
}

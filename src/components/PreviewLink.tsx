import {Link2} from 'lucide-react';
import {useStudioChrome} from '../hooks';
import {studio} from '../core/store';
export function PreviewLink(){
 const s=useStudioChrome({frame:'none',edits:'deferred'}),w=s.workspace,p=s.project;if(!w||!p)return null;
 const active=w.clips.find(c=>c.id===w.activeId),body=p.editing==='body',clips=w.clips.filter(c=>c.project.editing!==p.editing);
 return <section className="preview-link" aria-label="Preview animation"><label><span><Link2 size={14}/>{body?'First-person preview':'Body preview'}</span><select aria-label={body?'First-person preview animation':'Body preview animation'} value={active?.previewId??''} onChange={e=>studio.setPreviewAnimation(w.activeId,e.target.value||undefined)}><option value="">{body?'Use this animation':'Use current body motion'}</option>{clips.map(c=><option key={c.id} value={c.id}>{c.project.name}</option>)}</select></label>{active?.previewId&&<label><span>Timing</span><select aria-label="Paired preview timing" value={active.previewSync??'time'} onChange={e=>studio.setPreviewTiming(e.target.value as 'time'|'phase')}><option value="time">Same elapsed time</option><option value="phase">Match animation range</option></select></label>}<small>{active?.previewId?(active.previewSync==='phase'?'Starts and ends with the active animation.':'Plays in seconds; holds when the paired clip ends.'):body?'Shows this body animation on the first-person model.':'Shows the current body motion in the preview.'}</small></section>;
}

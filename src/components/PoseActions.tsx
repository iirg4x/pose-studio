import {mirrorDriver} from '../core/liveMirror';
import {MirrorDriverNotice} from './AnimationMirror';
import {FootPoseTools} from './FootPoseTools';
import {MotionPresence,Collapse} from './Motion';
import {useEffect,useRef,useState,useId} from 'react';
import {ArrowDownToLine,Copy,ClipboardPaste,FlipHorizontal2,Move,RotateCcw,Layers,ChevronDown,Check,Plus,Pin,Diamond} from 'lucide-react';
import {useStudioChrome,usePresence} from '../hooks';
import {CONTROLS} from '../core/controls';
import {mirrorDestination} from '../core/mirrorPose';
import {studio} from '../core/store';
import {controlLabel} from '../core/model';
import {activeAnimationLayer,editLayerAllowed} from '../core/layers';

export function ActiveLayer(){
 const menuId=useId(),s=useStudioChrome({frame:'none'}),[open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};document.addEventListener('pointerdown',close,true);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close,true);document.removeEventListener('keydown',escape);};},[open]);
 const p=s.project;if(!p||s.retargetMode)return null;const layer=activeAnimationLayer(p),name=layer?.name??(p.bodyBase?'Animation corrections':'Base animation');
 return <div className="active-layer-control" ref={root} data-editor-overlay><button className="active-layer-trigger" aria-label={'Active layer: '+name} aria-expanded={open} aria-controls={menuId} onClick={()=>setOpen(!open)}><small className="context-flair attached-flair">Editing layer</small><Layers size={18}/><strong>{name}</strong><ChevronDown size={15}/></button>
 <MotionPresence show={open}><section id={menuId} className="active-layer-menu" aria-label="Animation layers"><header className="context-flair">Layers</header>{[...(p.layers??[{id:'base',name,kind:'base',static:false,enabled:true,weight:1}])].reverse().map(l=><button key={l.id} aria-pressed={l.id===(layer?.id??'base')} onClick={()=>{if(p.layers)studio.selectLayer(l.id);setOpen(false);}}>{l.kind==='pose'||l.static?<Pin size={16}/>:<Diamond size={16}/>}<span><strong>{l.name}</strong><small>{l.kind==='pose'||l.static?'Pose · whole animation':l.kind==='base'?'Base animation':'Adjustment · keyed'}{!l.enabled?' · hidden':l.weight===0?' · zero weight':''}</small></span>{l.id===(layer?.id??'base')&&<Check size={16}/>}</button>)}<footer><button onClick={()=>{studio.addLayer('pose');setOpen(false);}}><Plus size={16}/>Pose layer</button><button onClick={()=>{studio.addLayer('additive');setOpen(false);}}><Plus size={16}/>Keyed layer</button></footer></section></MotionPresence>
 </div>;
}
export function PoseActions({mirror,pasteMirrored}:{mirror:()=>void;pasteMirrored:()=>void;timeline?:boolean}){
 const live=useStudioChrome({frame:'none'}),visible=!!live.project&&!!live.selection.length&&!live.gameView&&!live.retargetMode;
 const presence=usePresence(visible?live:null),s=presence.value,p=s?.project;if(!s||!p)return null;
 if(s.selection.length===1&&mirrorDriver(p,s.selected))return <section className="selection-pose-tools" aria-label="Selected pose actions" data-editor-overlay><MirrorDriverNotice project={p} id={s.selected}/></section>;
 const count=s.selection.length,editable=count>0&&s.selection.some(id=>editLayerAllowed(p,id)),mirrored=s.selection.some(id=>!!mirrorDestination(id));
 return <section data-motion="context" data-state={presence.exiting?'closing':'open'} inert={presence.exiting||undefined} aria-hidden={presence.exiting||undefined} className="selection-pose-tools" aria-label="Selected pose actions" data-editor-overlay><div className="pose-action-context context-flair attached-flair" title={(s.selection.length===1?controlLabel(s.selected,p):s.selection.length+' controls')+' · '+(s.autoKey?'Auto key on':'Unkeyed preview')}><i className={s.autoKey?'auto-key-on':'unkeyed-preview'} role="img" aria-label={s.autoKey?'Auto key on':'Unkeyed preview'}/><strong>{s.selection.length===1?controlLabel(s.selected,p):s.selection.length+' controls'}</strong></div><div className="pose-action-buttons">
 <button aria-label="Copy pose" disabled={!count} onClick={()=>studio.copySelectedPose()}><Copy size={18}/><span>Copy pose</span></button>
 {s.clipboard&&<button aria-label="Paste pose" disabled={!s.clipboard||!editable} onClick={()=>studio.pastePose(s.clipboard,true)}><ClipboardPaste size={18}/><span>Paste pose</span></button>}
 {s.clipboard&&Object.keys(s.clipboard.poses).some(id=>!!mirrorDestination(id as keyof typeof s.clipboard.poses))&&<button aria-label="Paste mirrored pose" disabled={!editable||s.clipboard.layer!==p.editing} onClick={pasteMirrored}><FlipHorizontal2 size={18}/><span>Paste mirrored</span></button>}
 {mirrored&&<button aria-label="Mirror pose to opposite side" title="Mirror selected controls to the opposite side; selecting both sides swaps them" disabled={!mirrored||!editable} onClick={mirror}><FlipHorizontal2 size={18}/><span>Mirror</span></button>}
 {s.selection.some(id=>CONTROLS[id].kind!=='pivot')&&<button type="button" className="pose-reset-command" title="Reset selected controllers to their rest location" aria-label="Reset location" disabled={!editable} onClick={()=>studio.resetSelected('location')}><Move size={18}/><span>Reset location</span></button>}
 <button type="button" className="pose-reset-command" title="Reset selected controllers to their rest rotation" aria-label="Reset rotation" disabled={!editable} onClick={()=>studio.resetSelected('rotation')}><RotateCcw size={18}/><span>Reset rotation</span></button>
 {s.selection.some(id=>id!=='camera')&&<button type="button" aria-label="Ground and key selected controls" title="Place on the floor and key this pose" disabled={!editable} onClick={()=>window.dispatchEvent(new Event('pose-ground-selection'))}><ArrowDownToLine size={18}/><span>Ground</span></button>}
 </div><Collapse open={s.selection.length===1&&/^(foot|ankle|toe|heel|ball)_[lr]$/.test(s.selected)}><FootPoseTools id={s.selected}/></Collapse></section>;
}

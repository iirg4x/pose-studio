import {Collapse} from './Motion';
import {useState} from 'react';
import {Plus,Trash2,Copy,ClipboardPaste,ChevronUp,ChevronDown,Files,Repeat2,Eye,EyeOff} from 'lucide-react';
import {ScrubNumber} from './ScrubNumber';
import {useStudioChrome} from '../hooks';
import {studio} from '../core/store';
import {CHANNEL_LABELS,channelUnit} from '../core/curves';
import type {Channel,Curve,Modifier} from '../core/curves';
const names:Record<Modifier['type'],string>={cycles:'Cycles',noise:'Noise',sine:'Sine wave',scale:'Scale / Offset',limits:'Limits'};
export function ModifierPanel({channel,curve}:{channel:Channel;curve:Curve}){
 const s=useStudioChrome({frame:'none'}),[addType,setAddType]=useState<Modifier['type']>('noise'),[advanced,setAdvanced]=useState(false),clip=s.modifierClipboard;
 return <div className="modifier-panel" aria-label="Channel modifiers">
  <div className="modifier-context"><span className="context-flair">{CHANNEL_LABELS[channel]}</span><small>{channelUnit(channel)}</small></div>
  <div className="modifier-clipboard"><button disabled={!curve.modifiers.length} onClick={()=>studio.copyModifiers(channel)}><Copy size={16}/>Copy stack</button><button disabled={!clip} onClick={()=>studio.pasteModifiers(channel)}><ClipboardPaste size={16}/>Paste{clip?' ('+clip.modifiers.length+')':''}</button></div>
  {clip&&<p className="modifier-clipboard-source">From {clip.source} · {clip.modifiers.length} modifier{clip.modifiers.length===1?'':'s'}{clip.unit!==channelUnit(channel)?' · uses destination units':''}</p>}
  <div className="add-modifier"><select aria-label="Modifier type" value={addType} onChange={e=>setAddType(e.target.value as Modifier['type'])}>{Object.entries(names).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select><button aria-label="Add modifier" onClick={()=>studio.addModifier(channel,addType)}><Plus size={18}/></button></div>
  {!curve.modifiers.length&&<p className="curve-note">Add a modifier or paste a stack to shape this channel without replacing its keys.</p>}
  {curve.modifiers.map((m,i)=><ModifierCard key={m.id} m={m} channel={channel} index={i} curve={curve}/>)}
  {curve.modifiers.length>0&&<><button className="modifier-advanced" aria-expanded={advanced} onClick={()=>setAdvanced(!advanced)}><ChevronDown size={14}/>Bake to keys</button><Collapse open={advanced}><div className="modifier-bake"><p className="curve-note">Replace this stack with a key on every frame. Undo restores the modifiers.</p><button className="bake-curve" onClick={()=>studio.bakeCurve(channel)}>Bake this channel</button></div></Collapse></>}
 </div>;
}
function Numeric({label,value,change,step=.1}:{label:string;value:number;change:(n:number)=>void;step?:number}){
 return <label className="curve-field">{label}<ScrubNumber aria-label={label} type="number" step={step} value={Number(value.toFixed(5))} onFocus={()=>studio.beginGesture()} onBlur={()=>studio.endGesture()} onChange={e=>{if(e.target.value!==''&&Number.isFinite(Number(e.target.value)))change(Number(e.target.value));}}/></label>;
}
function ModifierCard({m,channel,index,curve}:{m:Modifier;channel:Channel;index:number;curve:Curve}){
 const [open,setOpen]=useState(true);
 const update=(value:Partial<Modifier>)=>studio.updateModifier(channel,m.id,value);
 const param=(key:string,label:string,step=.1)=><Numeric key={key} label={label} value={(m as unknown as Record<string,number>)[key]} step={step} change={v=>update({[key]:v} as Partial<Modifier>)}/>;
 return <section className={'modifier-card '+(!m.enabled?'muted':'')}>
  <header><button className="modifier-disclosure" aria-expanded={open} aria-label={(open?'Collapse ':'Expand ')+names[m.type]+' modifier'} onClick={()=>setOpen(!open)}><ChevronDown size={15} data-open={open}/><strong>{names[m.type]}</strong><small>{index+1}</small></button><button className="modifier-copy" aria-label={'Copy '+m.type+' modifier'} title="Copy modifier" onClick={()=>studio.copyModifiers(channel,m.id)}><Copy size={16}/></button><button className="modifier-enabled" aria-label={'Enable '+m.type+' modifier'} aria-pressed={m.enabled} onClick={()=>update({enabled:!m.enabled})}>{m.enabled?<Eye size={17}/>:<EyeOff size={17}/>}</button></header>
  <Collapse open={open}><div className="modifier-body">
  {(m.type==='noise'||m.type==='sine')&&<div className="modifier-loop"><button aria-label="Seamless modifier loop" aria-pressed={!!m.loop} onClick={()=>studio.setModifierLoop(channel,m.id,!m.loop)}><Repeat2 size={17}/><span>Seamless loop</span><i/></button>{m.loop&&<small>Frames {m.loop.start}–{m.loop.end} · matches value and slope</small>}</div>}
  {m.type==='cycles'?<><div className="curve-field-pair">{(['before','after'] as const).map(side=><label key={side} className="curve-field">{side==='before'?'Before keys':'After keys'}<select aria-label={side+' cycle mode'} value={m[side]} onChange={e=>update({[side]:e.target.value} as Partial<Modifier>)}><option value="none">Hold</option><option value="repeat">Repeat</option><option value="offset">Repeat + offset</option><option value="mirror">Ping-pong</option></select></label>)}</div><p className="curve-note">{curve.keys.length<2?'Add a second key to define the cycle.':'Period: '+(curve.keys.at(-1)!.frame-curve.keys[0].frame)+' frames. Auto handles account for repeat seams.'}</p></>:null}
  {m.type==='noise'&&m.algorithm==='blender'?<>
   <p className="curve-note">Blender noise</p>
   <div className="curve-field-pair">{param('amplitude','Strength',.001)}{param('period','Scale',.1)}</div>
   <div className="curve-field-pair">{param('phase','Phase')}{param('offset','Offset (frames)')}</div>
   <div className="curve-field-pair">{param('depth','Depth',1)}{param('roughness','Roughness')}</div>
   {param('lacunarity','Lacunarity')}
   <label className="curve-field"><span><input type="checkbox" aria-label="Restrict noise range" checked={m.rangeStart!==undefined} onChange={e=>update(e.target.checked?{rangeStart:0,rangeEnd:studio.state.project!.end,blendIn:0,blendOut:0}:{rangeStart:undefined,rangeEnd:undefined})}/> Restrict frame range</span></label>
   {m.rangeStart!==undefined&&<><div className="curve-field-pair">{param('rangeStart','Start frame',1)}{param('rangeEnd','End frame',1)}</div><div className="curve-field-pair">{param('blendIn','Blend in',1)}{param('blendOut','Blend out',1)}</div></>}
  </>:(m.type==='noise'||m.type==='sine')&&<><div className="curve-field-pair">{param('amplitude','Amplitude')}{param('period','Period (frames)',1)}</div><div className="curve-field-pair">{param('phase',m.type==='noise'?'Phase (frames)':'Phase (degrees)')}{m.type==='noise'&&param('seed','Seed',1)}</div></>}
  {m.type==='scale'&&<div className="curve-field-pair">{param('factor','Factor')}{param('offset','Offset')}</div>}
  {m.type==='limits'&&<div className="curve-field-pair">{param('min','Minimum')}{param('max','Maximum')}</div>}
  <div className="modifier-card-actions">
   <button aria-label={'Duplicate '+m.type+' modifier'} title="Duplicate modifier" disabled={m.type==='cycles'||curve.modifiers.length>=20} onClick={()=>studio.duplicateModifier(channel,m.id)}><Files size={16}/><span>Duplicate</span></button>
   <button aria-label={'Move '+m.type+' modifier up'} title="Move up" disabled={m.type==='cycles'||index===0||curve.modifiers[index-1]?.type==='cycles'} onClick={()=>studio.moveModifier(channel,m.id,-1)}><ChevronUp size={17}/></button>
   <button aria-label={'Move '+m.type+' modifier down'} title="Move down" disabled={m.type==='cycles'||index===curve.modifiers.length-1} onClick={()=>studio.moveModifier(channel,m.id,1)}><ChevronDown size={17}/></button>
   <button aria-label={'Remove '+m.type+' modifier'} title="Remove modifier" onClick={()=>studio.removeModifier(channel,m.id)}><Trash2 size={16}/></button>
  </div></div></Collapse>
 </section>;
}

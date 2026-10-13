import {useState} from 'react';
import {ChevronDown,ChevronRight} from 'lucide-react';
import {CONTROLS} from '../core/controls';
import type {ControlId} from '../core/controls';

export function ControlMask({ids,excluded,labels,mode,change}:{ids:ControlId[];excluded:ControlId[];labels:Record<ControlId,string>;mode:'exclude'|'include';change:(ids:ControlId[])=>void}){
 const [open,setOpen]=useState(()=>new Set(['Left arm','Right arm']));
 const groups=[...new Set(ids.map(id=>CONTROLS[id].group))],prefix=mode==='exclude'?'Exclude ':'Layer includes ';
 const checked=(id:ControlId)=>mode==='exclude'?excluded.includes(id):!excluded.includes(id);
 const set=(targets:ControlId[],value:boolean)=>change((mode==='exclude'?value:!value)?[...new Set([...excluded,...targets])]:excluded.filter(id=>!targets.includes(id)));
 const item=(id:ControlId)=><label className="control-mask-item" key={id}><input type="checkbox" aria-label={prefix+labels[id]} checked={checked(id)} onChange={e=>set([id],e.target.checked)}/><span>{labels[id]}</span></label>;
 return <div className="control-mask-tree">{groups.map(group=>{
  const members=ids.filter(id=>CONTROLS[id].group===group);if(members.length===1)return item(members[0]);
  const count=members.filter(checked).length,expanded=open.has(group);
  return <div className="control-mask-group" key={group}><div className="control-mask-header"><button type="button" aria-label={(expanded?'Collapse ':'Expand ')+group+' mask'} aria-expanded={expanded} onClick={()=>{const next=new Set(open);expanded?next.delete(group):next.add(group);setOpen(next);}}>{expanded?<ChevronDown size={13}/>:<ChevronRight size={13}/>}</button><label><input type="checkbox" aria-label={prefix+group+' group'} checked={count===members.length} ref={node=>{if(node)node.indeterminate=count>0&&count<members.length;}} onChange={e=>set(members,e.target.checked)}/><span>{group}</span><small>{count}/{members.length}</small></label></div>{expanded&&<div className="control-mask-children">{members.map(item)}</div>}</div>;
 })}</div>;
}

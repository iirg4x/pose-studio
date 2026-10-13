import {liveMirrorLinks} from './liveMirror';
import {CONTROLS} from './controls';
import type {ControlId,Project,RigLayer} from './model';
export interface ControllerConstraint {
 /** Legacy file compatibility only. Grounding is authored as pose keys. */
 grounded?:boolean;clearance?:number;stretch?:boolean
}
export type ControllerConstraints=Partial<Record<ControlId,ControllerConstraint>>;
export const controllerConstraints=(project:Project):ControllerConstraints=>{const base=project.constraints?.[project.editing]??{},links=liveMirrorLinks(project);if(!links.length)return base;const result={...base};for(const link of links){if(base[link.source])result[link.target]=base[link.source];else delete result[link.target];}return result;};
/** Foot tools share a floor plane unless a toe has an explicit override. */
export function groundingClearance(project:Project,id:ControlId){
 const settings=controllerConstraints(project),foot=/^(toe|ankle|heel|ball)_[lr]$/.test(id)?('foot_'+id.at(-1)) as ControlId:id;
 return settings[id]?.clearance??settings[foot]?.clearance??0;
}
export function validateControllerConstraints(value:Project['constraints']){
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid controller constraints.');
 for(const [layer,controls] of Object.entries(value)){
  if(!(['firstPerson','body'] as RigLayer[]).includes(layer as RigLayer)||!controls||typeof controls!=='object'||Array.isArray(controls))throw Error('Invalid controller constraints.');
  for(const [id,c] of Object.entries(controls)){
   if(!CONTROLS[id as ControlId]||!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['grounded','clearance','stretch'].includes(k))||c.grounded!==undefined&&typeof c.grounded!=='boolean'||c.stretch!==undefined&&(typeof c.stretch!=='boolean'||! /^(hand|foot)_[lr]$/.test(id))||c.clearance!==undefined&&(!Number.isFinite(c.clearance)||c.clearance<0||c.clearance>100))throw Error('Invalid controller constraint.');
  }
 }
}

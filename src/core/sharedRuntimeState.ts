import {isProp} from './assets';
import {limbMode} from './model';
import type {ControlId,LimbId,Project} from './model';
import {retargetContact} from './retargetContact';

export interface SharedRuntimeStateLayout {
 version:1;
 /** Zero means no contact. Positive indices use this shared slot order. */
 slots:ControlId[];
 limbs:{limb:LimbId;curve:string}[];
 contacts:{control:ControlId;parentCurve:string;weightCurve:string}[];
}

/** Native AnimSequence float curves accompany the source transform stream.
 * Modes and parent indices require constant interpolation, never transform
 * translation interpolation. Contact weights preserve the preview transition.
 */
export function sharedRuntimeStateLayout(slots:ControlId[]):SharedRuntimeStateLayout {
 if(new Set(slots).size!==slots.length||slots.some(id=>!isProp(id)))throw Error('Invalid shared runtime prop slots.');
 return {version:1,slots:[...slots],
  limbs:(['arm_l','arm_r','leg_l','leg_r'] as const).map(limb=>({limb,curve:'pose_'+limb+'_ik'})),
  contacts:(['hand_l','hand_r'] as const).map(control=>({control,parentCurve:'pose_'+control+'_contact_parent',weightCurve:'pose_'+control+'_contact_weight'}))};
}

export function sharedRuntimeState(project:Project,frame:number,layout:SharedRuntimeStateLayout):Record<string,number> {
 if(!Number.isFinite(frame)||frame<0||frame>project.end)throw Error('Shared runtime state frame is outside the animation.');
 const values:Record<string,number>={};
 for(const {limb,curve} of layout.limbs)values[curve]=limbMode(project,limb,frame)==='ik'?1:0;
 for(const {control,parentCurve,weightCurve} of layout.contacts){
  const contact=retargetContact(project,control,frame),slot=contact?layout.slots.indexOf(contact.parent)+1:0;
  if(contact&&!slot)throw Error('Missing shared runtime contact prop: '+contact.parent);
  values[parentCurve]=slot;values[weightCurve]=contact?.weight??0;
 }
 return values;
}

import {CONTROLS} from './controls';
import type {ControlId} from './model';
// The same identity colors link viewport handles, the control tree and keys.
export const controlTint=(id:ControlId)=>id==='camera'?'var(--violet)':id.endsWith('_l')?'var(--cyan)':id.endsWith('_r')?'var(--red)':CONTROLS[id].group==='Props'?'var(--green)':'var(--amber)';

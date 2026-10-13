import { isProp, projectProps } from './assets';
import { boneFollowing } from './boneFollowing';
import { CONTROLS, CONTROL_IDS } from './controls';
import { controlParent } from './model';
import type { ControlId, Project } from './model';

export type PropParentFrame =
  | { kind: 'source' }
  | { kind: 'grip'; side: 'l' | 'r' }
  | { kind: 'bone'; bone: string }
  | { kind: 'prop'; control: ControlId };
export interface RuntimePropStep {
  control: ControlId;
  parent: PropParentFrame;
  position: boolean;
  rotation: boolean;
}
export interface SharedRuntimePropLayout {
  version: 1;
  slots: ControlId[];
  parents: PropParentFrame[];
  active: { control: ControlId; curve: string }[];
  steps: { slot: string; parent: string; position: string; rotation: string }[];
}
const parentFrame = (parent: ControlId | 'world' | 'native'): PropParentFrame => {
  if (parent === 'world' || parent === 'native' || parent === 'camera') return { kind: 'source' };
  if (isProp(parent)) return { kind: 'prop', control: parent as ControlId };
  if (['hand_l', 'wrist_l', 'hand_r', 'wrist_r'].includes(parent))
    return { kind: 'grip', side: parent.at(-1) as 'l' | 'r' };
  const bone = CONTROLS[parent]?.bone;
  if (bone) return { kind: 'bone', bone };
  throw Error('Unsupported runtime prop parent: ' + parent);
};
/** Same dependency order as ProportionalRig's prop resolver, including its
 * source-frame cycle fallback and final legacy magazine-following override.
 * Rifle/magazine primary-grip defaults are initialized before these steps.
 */
export function runtimePropSteps(project: Project, frame: number) {
  const bindings = boneFollowing(project, frame),
    resolved = new Set<ControlId>(),
    resolving = new Set<ControlId>(),
    steps: RuntimePropStep[] = [],
    active = new Set<ControlId>(['rifle', 'magazine']);
  const resolve = (id: ControlId) => {
    if (resolved.has(id)) return;
    resolving.add(id);
    active.add(id);
    const key = bindings[id],
      parent = key?.target ?? controlParent(project, id, frame);
    if (key?.target !== undefined || id.startsWith('prop:')) {
      let basis = parentFrame(parent);
      if (basis.kind === 'prop') {
        if (resolving.has(basis.control)) basis = { kind: 'source' };
        else resolve(basis.control);
      }
      steps.push({
        control: id,
        parent: basis,
        position: key?.position ?? true,
        rotation: key?.rotation ?? true,
      });
    }
    resolving.delete(id);
    resolved.add(id);
  };
  for (const id of Object.keys(projectProps(project)) as ControlId[]) resolve(id);
  if (!bindings.magazine && controlParent(project, 'magazine', frame) === 'rifle')
    steps.push({
      control: 'magazine',
      parent: { kind: 'prop', control: 'rifle' },
      position: true,
      rotation: true,
    });
  return { steps, active: [...active] };
}
export function sharedRuntimePropLayout(slots: ControlId[]): SharedRuntimePropLayout {
  if (new Set(slots).size !== slots.length || slots.some((id) => !isProp(id)))
    throw Error('Invalid runtime prop slots.');
  const bones = [
    ...new Set(CONTROL_IDS.map((id) => CONTROLS[id].bone).filter((n): n is string => !!n)),
  ];
  const parents: PropParentFrame[] = [
    { kind: 'source' },
    { kind: 'grip', side: 'l' },
    { kind: 'grip', side: 'r' },
    ...bones.map((bone) => ({ kind: 'bone' as const, bone })),
    ...slots.map((control) => ({ kind: 'prop' as const, control })),
  ];
  return {
    version: 1,
    slots: [...slots],
    parents,
    active: slots.map((control, i) => ({ control, curve: 'pose_prop_' + i + '_active' })),
    steps: Array.from({ length: slots.length + 1 }, (_, i) => ({
      slot: 'pose_prop_step_' + i + '_slot',
      parent: 'pose_prop_step_' + i + '_parent',
      position: 'pose_prop_step_' + i + '_position',
      rotation: 'pose_prop_step_' + i + '_rotation',
    })),
  };
}
export function sharedRuntimeProps(
  project: Project,
  frame: number,
  layout: SharedRuntimePropLayout,
): Record<string, number> {
  if (!Number.isFinite(frame) || frame < 0 || frame > project.end)
    throw Error('Runtime prop frame is outside the animation.');
  const plan = runtimePropSteps(project, frame),
    values: Record<string, number> = {};
  for (const id of plan.active)
    if (!layout.slots.includes(id) && id !== 'rifle' && id !== 'magazine')
      throw Error('Missing runtime prop slot: ' + id);
  // Unexported built-in defaults have no output; referenced parents still must exist.
  const steps = plan.steps.filter((step) => layout.slots.includes(step.control));
  if (steps.length > layout.steps.length)
    throw Error('Runtime prop dependency plan exceeds its layout.');
  for (const item of layout.active) values[item.curve] = +plan.active.includes(item.control);
  for (const [i, curves] of layout.steps.entries()) {
    const step = steps[i],
      parent = step
        ? layout.parents.findIndex((p) => JSON.stringify(p) === JSON.stringify(step.parent))
        : 0;
    if (parent < 0) throw Error('Missing runtime prop parent frame.');
    values[curves.slot] = step ? layout.slots.indexOf(step.control) + 1 : 0;
    values[curves.parent] = parent;
    values[curves.position] = step ? +step.position : 0;
    values[curves.rotation] = step ? +step.rotation : 0;
  }
  return values;
}

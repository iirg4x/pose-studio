import { CONTROL_IDS } from './controls';
import type { ControlId } from './controls';
export interface TimelineRow {
  control: ControlId;
  depth: number;
  children: ControlId[];
  ids: ControlId[];
  collapsed: boolean;
}
const parents: Partial<Record<ControlId, ControlId>> = {
  hips: 'root',
  spine_01: 'hips',
  spine_02: 'spine_01',
  chest: 'spine_02',
  spine_04: 'chest',
  spine_05: 'spine_04',
  neck_01: 'spine_05',
  neck_02: 'neck_01',
  head: 'neck_02',
  rifle: 'root',
  magazine: 'rifle',
  camera: 'root',
};
for (const side of ['l', 'r'] as const) {
  parents[`shoulder_${side}`] = 'spine_05';
  parents[`hand_${side}`] = `shoulder_${side}`;
  parents[`elbow_${side}`] = `shoulder_${side}`;
  parents[`upperarm_${side}`] = `shoulder_${side}`;
  parents[`forearm_${side}`] = `upperarm_${side}`;
  parents[`wrist_${side}`] = `forearm_${side}`;
  for (const digit of ['thumb', 'index', 'middle', 'ring', 'pinky'] as const) {
    if (digit !== 'thumb') parents[`${digit}_palm_${side}`] = `hand_${side}`;
    parents[`${digit}_01_${side}`] = digit === 'thumb' ? `hand_${side}` : `${digit}_palm_${side}`;
    parents[`${digit}_02_${side}`] = `${digit}_01_${side}`;
    parents[`${digit}_03_${side}`] = `${digit}_02_${side}`;
  }
  parents[`foot_${side}`] = 'hips';
  parents[`knee_${side}`] = 'hips';
  parents[`thigh_${side}`] = 'hips';
  parents[`shin_${side}`] = `thigh_${side}`;
  parents[`ankle_${side}`] = `shin_${side}`;
  for (const stem of ['toe', 'heel', 'ball'] as const) parents[`${stem}_${side}`] = `foot_${side}`;
}
// Organize by the rig, not animated attachment constraints: scrubbing a hand
// contact must not move its timeline row into a different part of the tree.
export function timelineParent(id: ControlId, visible: ReadonlySet<ControlId>): ControlId | null {
  let parent = parents[id];
  while (parent && !visible.has(parent)) parent = parents[parent];
  return parent ?? null;
}
export function timelineHierarchy(
  ids: ControlId[],
  collapsed: ReadonlySet<ControlId>,
): TimelineRow[] {
  const visible = new Set(ids),
    children = new Map<ControlId | null, ControlId[]>();
  for (const id of CONTROL_IDS.filter((id) => visible.has(id))) {
    const parent = timelineParent(id, visible);
    children.set(parent, [...(children.get(parent) ?? []), id]);
  }
  const descendants = (id: ControlId): ControlId[] =>
    (children.get(id) ?? []).flatMap((child) => [child, ...descendants(child)]);
  const rows: TimelineRow[] = [];
  const visit = (id: ControlId, depth: number) => {
    const all = descendants(id),
      folded = all.length > 0 && collapsed.has(id);
    rows.push({
      control: id,
      depth,
      children: all,
      ids: folded ? [id, ...all] : [id],
      collapsed: folded,
    });
    if (!folded) for (const child of children.get(id) ?? []) visit(child, depth + 1);
  };
  for (const id of children.get(null) ?? []) visit(id, 0);
  return rows;
}
export const DEFAULT_COLLAPSED: ControlId[] = [
  'hand_l',
  'hand_r',
  'upperarm_l',
  'upperarm_r',
  'thigh_l',
  'thigh_r',
  ...(['l', 'r'] as const).flatMap((side) =>
    ['thumb_01', 'index_palm', 'middle_palm', 'ring_palm', 'pinky_palm'].map(
      (stem) => `${stem}_${side}` as ControlId,
    ),
  ),
];
export function loadTimelineCollapsed(): Set<ControlId> {
  try {
    const saved = JSON.parse(localStorage.getItem('pose-timeline-collapsed') ?? 'null');
    if (Array.isArray(saved))
      return new Set(saved.filter((id: ControlId) => CONTROL_IDS.includes(id)));
  } catch {}
  return new Set(DEFAULT_COLLAPSED);
}

// Reveal the active channel without unfolding unrelated limbs.
export function revealTimelineControl(
  ids: ControlId[],
  collapsed: ReadonlySet<ControlId>,
  id: ControlId,
) {
  const visible = new Set(ids),
    next = new Set(collapsed);
  if (!visible.has(id)) return next;
  let parent = timelineParent(id, visible);
  while (parent) {
    next.delete(parent);
    parent = timelineParent(parent, visible);
  }
  return next;
}

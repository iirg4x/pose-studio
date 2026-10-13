import type { V3, Q4 } from './model';

/** The rest skeleton on which a clip was authored, in the shared bone axes.
 * Keep this separate from mesh selection: proportions are not animation keys. */
export interface MotionRig {
  positions: Record<string, V3>;
  partial: boolean;
  authoredBones?: string[];
  restRotations?: Record<string, Q4>;
  parents?: Record<string, string | null>;
}

export function validateMotionRig(value: MotionRig | undefined) {
  if (value === undefined) return;
  if (
    !value ||
    typeof value.partial !== 'boolean' ||
    !value.positions ||
    Array.isArray(value.positions) ||
    Object.keys(value.positions).length > 256 ||
    !value.positions.pelvis ||
    !value.positions.hand_l ||
    !value.positions.hand_r ||
    Object.entries(value.positions).some(
      ([name, p]) =>
        name.length > 100 ||
        !Array.isArray(p) ||
        p.length !== 3 ||
        p.some((n) => !Number.isFinite(n) || Math.abs(n) > 100),
    )
  )
    throw Error('Invalid animation reference skeleton.');
  if (
    value.authoredBones !== undefined &&
    (!Array.isArray(value.authoredBones) ||
      value.authoredBones.length > 256 ||
      value.authoredBones.some((n) => typeof n !== 'string' || !Object.hasOwn(value.positions, n)))
  )
    throw Error('Invalid authored bone mapping.');
  if (
    value.restRotations !== undefined &&
    (!value.restRotations ||
      Array.isArray(value.restRotations) ||
      Object.keys(value.restRotations).length > 256 ||
      Object.entries(value.restRotations).some(
        ([name, q]) =>
          !Object.hasOwn(value.positions, name) ||
          !Array.isArray(q) ||
          q.length !== 4 ||
          q.some((n) => !Number.isFinite(n)) ||
          Math.abs(Math.hypot(...q) - 1) > 0.001,
      ))
  )
    throw Error('Invalid reference bone rotations.');
  if (value.parents !== undefined) {
    if (
      !value.parents ||
      Array.isArray(value.parents) ||
      Object.keys(value.parents).length !== Object.keys(value.positions).length
    )
      throw Error('Invalid reference hierarchy.');
    for (const name of Object.keys(value.positions)) {
      const seen = new Set<string>();
      let current: string | null = name;
      while (current !== null) {
        if (
          seen.has(current) ||
          !Object.hasOwn(value.positions, current) ||
          !Object.hasOwn(value.parents, current)
        )
          throw Error('Invalid reference hierarchy.');
        seen.add(current);
        current = value.parents[current];
        if (current !== null && typeof current !== 'string')
          throw Error('Invalid reference hierarchy.');
      }
    }
  }
}

import type { Pose } from './model';
import type { MotionOptions } from './interpolation';

/** Copies a pose or key without structuredClone (hot path: every control, every frame).
 * Arrays and nested settings are new, so mutating the copy never touches the source. */
export function copyPose<T extends Pose>(value: T): T {
  const source = value as T & MotionOptions,
    copy = { ...source, p: [...source.p], q: [...source.q], grip: [...source.grip] };
  if (source.spring) copy.spring = { ...source.spring };
  if (source.bounce) copy.bounce = { ...source.bounce };
  return copy as T;
}

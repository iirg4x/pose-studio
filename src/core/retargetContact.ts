import { isProp } from './assets';
import { boneFollowing } from './boneFollowing';
import { controlParent } from './model';
import type { ControlId, Project } from './model';

export interface RetargetContact {
  parent: ControlId;
  weight: number;
}

/** The contact used by proportional retargeting, including its existing short
 * anticipation/release window. Export and preview must resolve the same parent
 * and weight; baking only the active space loses the transition at a grip change.
 */
export function retargetContact(
  project: Project,
  id: ControlId,
  frame: number,
): RetargetContact | undefined {
  const parent = (f: number) => {
    f = Math.max(0, Math.min(project.end, f));
    const key = boneFollowing(project, f)[id];
    return key?.target !== undefined
      ? key.position && key.target !== 'native'
        ? key.target
        : 'world'
      : controlParent(project, id, f);
  };
  const current = parent(frame),
    window = Math.max(1, project.fps * 0.12);
  if (isProp(current)) return { parent: current as ControlId, weight: 1 };
  for (let f = Math.floor(frame) + 1; f <= frame + window && f <= project.end; f++) {
    const p = parent(f);
    if (isProp(p)) return { parent: p as ControlId, weight: 1 - (f - frame) / window };
  }
  for (let f = Math.ceil(frame) - 1; f >= frame - window - 1 && f >= 0; f--) {
    const p = parent(f);
    if (isProp(p))
      return {
        parent: p as ControlId,
        weight: Math.max(0, Math.min(1, 1 - (frame - f - 1) / window)),
      };
  }
}

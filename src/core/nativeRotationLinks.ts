import { Quaternion } from 'three';
import { BONE_CONTROLS } from './controls';
import type { ControlId, Pose, Q4 } from './model';

export type NativeRotationLinks = Partial<Record<ControlId, ControlId>>;
type Values = Record<ControlId, Pose>;

/** Store a mesh-space delta once on its parent. Child keys are a residual in
 * that parent's reference axes. Resolve before weighting: slerp(A * B, w)
 * preserves native mesh additive semantics; slerp(A,w) * slerp(B,w) does not.
 */
export function resolveNativeRotations(values: Values, links?: NativeRotationLinks): Values {
  if (!links || !Object.keys(links).length) return values;
  const result = { ...values },
    done = new Set<ControlId>(),
    visiting = new Set<ControlId>();
  const resolve = (id: ControlId): Pose => {
    if (done.has(id)) return result[id];
    if (visiting.has(id)) throw Error('Native rotation links cannot form a cycle.');
    visiting.add(id);
    const source = links[id];
    if (source)
      result[id] = {
        ...values[id],
        q: new Quaternion(...resolve(source).q)
          .multiply(new Quaternion(...values[id].q))
          .normalize()
          .toArray() as Q4,
      };
    visiting.delete(id);
    done.add(id);
    return result[id];
  };
  for (const id of Object.keys(links) as ControlId[]) resolve(id);
  return result;
}

export function nativeRotationResidual(
  id: ControlId,
  value: Pose,
  resolved: Values,
  links?: NativeRotationLinks,
): Pose {
  const source = links?.[id];
  return source
    ? {
        ...value,
        q: new Quaternion(...resolved[source].q)
          .invert()
          .multiply(new Quaternion(...value.q))
          .normalize()
          .toArray() as Q4,
      }
    : value;
}

export function validateNativeRotationLinks(links: unknown, space?: string): void {
  if (links === undefined) return;
  if (space !== 'mesh' || !links || typeof links !== 'object' || Array.isArray(links))
    throw Error('Invalid native rotation links.');
  const allowed = new Set<string>(['root', ...BONE_CONTROLS]),
    map = links as Record<string, string>;
  for (const [id, source] of Object.entries(map)) {
    if (id === 'root' || !allowed.has(id) || !allowed.has(source))
      throw Error('Invalid native rotation link control.');
    const seen = new Set<string>([id]);
    let next: string | undefined = source;
    while (next) {
      if (seen.has(next)) throw Error('Native rotation links cannot form a cycle.');
      seen.add(next);
      next = map[next];
    }
  }
}

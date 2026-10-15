import { Matrix4, Quaternion, Vector3 } from 'three';
import { CONTROLS, isOffsetControl } from './controls';
import { clone, fromMatrix, matrix } from './model';
import type { ControlId, Pose } from './model';
const reflection = new Matrix4().makeScale(-1, 1, 1);
const rotation = (m: Matrix4) =>
  new Matrix4().makeRotationFromQuaternion(
    new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(m)),
  );
const reflectRotation = (m: Matrix4) => reflection.clone().multiply(m).multiply(reflection);
export function mirrorDestination(id: ControlId): ControlId | undefined {
  if (!CONTROLS[id]) return undefined;
  if (/_[lr]$/.test(id)) {
    const other = (id.slice(0, -1) + (id.endsWith('l') ? 'r' : 'l')) as ControlId;
    return CONTROLS[other] ? other : undefined;
  }
  return isOffsetControl(id) ? id : undefined;
}
export interface MirrorRest {
  world: Matrix4;
  parent: Matrix4;
}
/** Mirror a pose across the character's X plane, accounting for asymmetric bone axes. */
export function mirrorControlPose(
  value: Pose,
  sourceRest: Matrix4,
  targetRest: Matrix4,
  offset: boolean,
  sourceParent = new Matrix4(),
  targetParent = new Matrix4(),
  root = new Matrix4(),
): Pose {
  const sourceBasis = rotation(sourceRest),
    targetBasis = rotation(targetRest);
  if (offset) {
    const delta = sourceBasis
      .clone()
      .multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion(...value.q)))
      .multiply(sourceBasis.clone().invert());
    const q = targetBasis.clone().invert().multiply(reflectRotation(delta)).multiply(targetBasis);
    const p = new Vector3(...value.p).applyMatrix4(rotation(sourceParent));
    p.x = -p.x;
    p.applyMatrix4(rotation(targetParent).invert());
    return fromMatrix(q.setPosition(p), value);
  }
  const local = root.clone().invert().multiply(matrix(value)),
    p = new Vector3().setFromMatrixPosition(local);
  p.x = -p.x;
  const q = reflectRotation(rotation(local).multiply(sourceBasis.clone().invert())).multiply(
    targetBasis,
  );
  return fromMatrix(root.clone().multiply(q.setPosition(p)), clone(value));
}

/**
 * Build one current-frame pose for each selected control's opposite side.
 * Read every source from the same immutable values snapshot so selecting both
 * sides swaps them deterministically instead of letting an earlier write feed
 * a later source.
 */
export function mirrorControlPoses(
  values: Partial<Record<ControlId, Pose>>,
  ids: readonly ControlId[],
  rest: (id: ControlId) => MirrorRest,
  root: Matrix4,
) {
  const poses: Partial<Record<ControlId, Pose>> = {};
  for (const id of [...new Set(ids)].sort()) {
    const value = values[id],
      target = mirrorDestination(id);
    if (!value || !target) continue;
    const sourceRest = rest(id),
      targetRest = rest(target);
    poses[target] = mirrorControlPose(
      value,
      sourceRest.world,
      targetRest.world,
      isOffsetControl(id),
      sourceRest.parent,
      targetRest.parent,
      root,
    );
  }
  return poses;
}

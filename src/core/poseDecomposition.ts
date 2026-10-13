import { Matrix4 } from 'three';
import { IDS, controlParent, evaluate, fromMatrix, matrix, rigLocal } from './model';
import type { ControlId, Pose, Project } from './model';
import { layerBases, layerDelta } from './layerSpaces';
import type { LayerSpace } from './layerSpaces';

/** Factor an evaluated motion onto a reference pose without changing contacts.
 * Inputs and outputs use the same local axes as an ordinary adjustment layer.
 * The parent moves first; a child's residual is measured after that movement.
 */
export function poseLayerOffsets(
  base: Project,
  target: Record<ControlId, Pose>,
  frame = 0,
  space: LayerSpace = 'local',
) {
  const before = rigLocal(evaluate(base, frame)),
    after = rigLocal(target),
    bases = layerBases(before, base, frame, false);
  const result = {} as Record<ControlId, Pose>;
  for (const id of IDS) {
    const parent = controlParent(base, id, frame),
      carry =
        parent === 'world'
          ? new Matrix4()
          : matrix(after[parent]).multiply(matrix(before[parent]).invert());
    const value = fromMatrix(carry.multiply(matrix(before[id]))),
      delta = layerDelta(
        value,
        after[id],
        space,
        bases[id],
        before.root,
        parent === 'world' ? undefined : after[parent],
        id,
        true,
      );
    result[id] = {
      ...delta,
      grip: after[id].grip.map((v, i) => v - before[id].grip[i]),
      fov: 70 + after[id].fov - before[id].fov,
    };
  }
  return result;
}

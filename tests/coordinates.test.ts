import { describe, it, expect } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { coordinatePose, coordinateWorld } from '../src/scene/coordinates';
import type { CoordinateSnapshot } from '../src/scene/coordinates';
import { pose } from '../src/core/model';
const matrix = (p: [number, number, number], axis: [number, number, number], angle: number) =>
  new Matrix4().compose(
    new Vector3(...p),
    new Quaternion().setFromAxisAngle(new Vector3(...axis), angle),
    new Vector3(1, 1, 1),
  );
describe('Numeric coordinate spaces', () => {
  const parent = matrix([0.4, 1.2, -0.3], [0, 1, 0], 1.1),
    root = matrix([2, 0.2, 3], [0, 0, 1], 0.3),
    world = parent.clone().multiply(matrix([0.1, 0.4, 0.2], [1, 0, 0], 0.7)),
    snapshot: CoordinateSnapshot = { id: 'head', world, parent, root };
  it('switches readouts without changing the pose in any reference frame', () => {
    for (const space of ['world', 'parent', 'root'] as const) {
      const value = coordinatePose(snapshot, space, pose()),
        result = coordinateWorld(snapshot, space, value);
      expect(result.elements.every((v, i) => Math.abs(v - world.elements[i]) < 1e-10)).toBe(true);
    }
    expect(coordinatePose(snapshot, 'parent', pose()).p[1]).toBeCloseTo(0.4, 8);
  });
  it('edits one world coordinate independently of the rotated parent', () => {
    const value = coordinatePose(snapshot, 'world', pose()),
      before = [...value.p];
    value.p[0] = 0.72;
    const result = coordinateWorld(snapshot, 'world', value),
      position = new Vector3().setFromMatrixPosition(result);
    expect(position.x).toBe(0.72);
    expect(position.y).toBe(before[1]);
    expect(position.z).toBe(before[2]);
  });
  it('moves along a parent axis when parent coordinates are edited', () => {
    const value = coordinatePose(snapshot, 'parent', pose());
    value.p[0] += 0.1;
    const result = coordinateWorld(snapshot, 'parent', value),
      delta = new Vector3()
        .setFromMatrixPosition(result)
        .sub(new Vector3().setFromMatrixPosition(world)),
      expected = new Vector3(0.1, 0, 0).applyQuaternion(
        new Quaternion().setFromRotationMatrix(parent),
      );
    expect(delta.distanceTo(expected)).toBeLessThan(1e-10);
  });
});

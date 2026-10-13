import { Matrix4 } from 'three';
import { fromMatrix, matrix } from '../core/model';
import type { ControlId, Pose } from '../core/model';
export type CoordinateSpace = 'local' | 'parent' | 'root' | 'world';
export interface CoordinateSnapshot {
  id: ControlId;
  world: Matrix4;
  parent: Matrix4;
  root: Matrix4;
}
function coordinateFrame(snapshot: CoordinateSnapshot, space: Exclude<CoordinateSpace, 'local'>) {
  return space === 'world' ? new Matrix4() : space === 'root' ? snapshot.root : snapshot.parent;
}
export function coordinatePose(
  snapshot: CoordinateSnapshot,
  space: Exclude<CoordinateSpace, 'local'>,
  value: Pose,
) {
  return fromMatrix(
    coordinateFrame(snapshot, space).clone().invert().multiply(snapshot.world),
    value,
  );
}
export function coordinateWorld(
  snapshot: CoordinateSnapshot,
  space: Exclude<CoordinateSpace, 'local'>,
  value: Pose,
) {
  return coordinateFrame(snapshot, space).clone().multiply(matrix(value));
}

import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
export type TransformOrientation = 'world' | 'local' | 'view';
export type TransformPivot = 'median' | 'active' | 'individual' | 'bounds' | 'cursor';
export function pivotPoint(
  points: Vector3[],
  active: Vector3,
  mode: TransformPivot,
  cursor: Vector3,
) {
  if (mode === 'cursor') return cursor.clone();
  if (mode === 'active') return active.clone();
  if (!points.length) return active.clone();
  if (mode === 'bounds') return new Box3().setFromPoints(points).getCenter(new Vector3());
  return points.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(points.length);
}
export function transformedControl(
  world: Matrix4,
  delta: Matrix4,
  mode: 'translate' | 'rotate',
  pivot: TransformPivot,
  localOrientation?: Quaternion,
) {
  const target = delta.clone().multiply(world);
  if (mode === 'rotate' && pivot === 'individual') {
    const position = new Vector3().setFromMatrixPosition(world);
    if (localOrientation) {
      const localDelta = localOrientation
          .clone()
          .invert()
          .multiply(new Quaternion().setFromRotationMatrix(delta))
          .multiply(localOrientation),
        q = new Quaternion().setFromRotationMatrix(world).multiply(localDelta);
      target.compose(position, q, new Vector3(1, 1, 1));
    } else target.setPosition(position);
  }
  return target;
}
export function orientationQuaternion(
  space: TransformOrientation,
  active: Quaternion,
  view: Quaternion,
) {
  return space === 'world' ? undefined : (space === 'local' ? active : view).clone();
}

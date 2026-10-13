import { Matrix4, Vector3 } from 'three';
import type { ControlId } from '../core/model';
export type FootPivot = 'ankle' | 'sole' | 'heel' | 'ball' | 'toe';
export interface FootGeometry {
  heel: Vector3;
  ball: Vector3;
  toe: Vector3;
  sole: Vector3;
  forward: Vector3;
  right: Vector3;
  up: Vector3;
  width: number;
  length: number;
  foot: Matrix4;
  toeJoint: Matrix4;
}
/** A sole frame measured from the rendered shoe, independent of bone axes. */
export function measureFoot(points: Vector3[], foot: Matrix4, toeJoint: Matrix4): FootGeometry {
  const ankle = new Vector3().setFromMatrixPosition(foot),
    joint = new Vector3().setFromMatrixPosition(toeJoint),
    forward = joint.clone().sub(ankle);
  forward.y = 0;
  if (forward.lengthSq() < 1e-8) forward.set(0, 0, 1);
  forward.normalize();
  const up = new Vector3(0, 1, 0),
    right = up.clone().cross(forward).normalize();
  const floor = points.length ? Math.min(...points.map((p) => p.y)) : 0,
    solePoints = points.filter((p) => p.y < floor + 0.018);
  const samples = solePoints.length ? solePoints : points;
  const along = samples.map((p) => p.clone().sub(ankle).dot(forward)),
    across = samples.map((p) => p.clone().sub(ankle).dot(right));
  const back = along.length ? Math.min(...along) : -0.07,
    front = along.length ? Math.max(...along) : 0.22,
    left = across.length ? Math.min(...across) : -0.055,
    rightEdge = across.length ? Math.max(...across) : 0.055;
  const at = (distance: number) =>
    ankle
      .clone()
      .addScaledVector(forward, distance)
      .addScaledVector(right, (left + rightEdge) / 2)
      .setY(floor);
  return {
    heel: at(back),
    ball: joint.clone().setY(floor),
    toe: at(front),
    sole: at((back + front) / 2),
    forward,
    right,
    up,
    width: Math.max(0.06, rightEdge - left),
    length: Math.max(0.12, front - back),
    foot: foot.clone(),
    toeJoint: toeJoint.clone(),
  };
}
/** Handles occupy separate anatomical zones. Geometry offsets never move the
 * actual joint or roll pivot; the stem leads back toward the controlled region. */
export function footControlShape(id: ControlId, g: FootGeometry) {
  const side = id.endsWith('_l') ? 1 : -1,
    out = g.right.clone().multiplyScalar(side),
    positions: number[] = [];
  const matrix = id.startsWith('toe_') ? g.toeJoint.clone() : g.foot.clone();
  if (id.startsWith('heel_') || id.startsWith('ball_'))
    matrix.setPosition(id.startsWith('heel_') ? g.heel : g.ball);
  const inverse = matrix.invert(),
    p = (origin: Vector3, x: number, z: number, y = 0) =>
      origin
        .clone()
        .addScaledVector(g.right, x)
        .addScaledVector(g.forward, z)
        .addScaledVector(g.up, y)
        .applyMatrix4(inverse);
  const path = (points: Vector3[], closed = false) => {
    for (let i = 1; i < points.length; i++)
      positions.push(...points[i - 1].toArray(), ...points[i].toArray());
    if (closed) positions.push(...points.at(-1)!.toArray(), ...points[0].toArray());
  };
  const w = g.width / 2 + 0.024;
  if (id.startsWith('foot_')) {
    const back = g.heel,
      front = g.toe;
    path(
      [
        p(back, -w, 0.015, 0.012),
        p(back, -w * 0.6, -0.024, 0.012),
        p(back, w * 0.6, -0.024, 0.012),
        p(back, w, 0.015, 0.012),
        p(front, w, -0.012, 0.012),
        p(front, w * 0.62, 0.016, 0.012),
        p(front, -w * 0.62, 0.016, 0.012),
        p(front, -w, -0.012, 0.012),
      ],
      true,
    );
  } else if (id.startsWith('toe_')) {
    path([
      p(g.toe, -w * 0.7, 0.05, 0.018),
      p(g.toe, -w * 0.7, 0.07, 0.036),
      p(g.toe, w * 0.7, 0.07, 0.036),
      p(g.toe, w * 0.7, 0.05, 0.018),
    ]);
    path([
      p(g.toe, -w * 0.3, 0.044, 0.018),
      p(g.toe, 0, 0.06, 0.018),
      p(g.toe, w * 0.3, 0.044, 0.018),
    ]);
  } else if (id.startsWith('heel_')) {
    path(
      [
        p(g.heel, -w * 0.45, -0.058, 0.012),
        p(g.heel, -w * 0.45, -0.058, 0.065),
        p(g.heel, w * 0.45, -0.058, 0.065),
        p(g.heel, w * 0.45, -0.058, 0.012),
      ],
      true,
    );
    path([p(g.heel, 0, -0.035, 0.012), p(g.heel, 0, -0.058, 0.012)]);
  } else {
    const center = g.ball.clone().addScaledVector(out, w + 0.045);
    path(
      [
        p(center, 0, -0.028, 0.018),
        p(center, 0, -0.028, 0.072),
        p(center, 0, 0.028, 0.072),
        p(center, 0, 0.028, 0.018),
      ],
      true,
    );
    path([p(g.ball, side * (w + 0.018), 0, 0.018), p(center, 0, 0, 0.018)]);
  }
  return positions;
}

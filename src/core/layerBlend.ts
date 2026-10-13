import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { sampleCurve } from './curves';
import { BLEND_CHANNELS, blendChannel, blendDefault } from './blendChannels';
import type { BlendChannel, TransformAxis } from './blendChannels';
import type { ControlId, Pose, Track, Q4, V3 } from './model';
import type { LayerBasis, LayerSpace } from './layerSpaces';
import { isOffsetControl } from './controls';
export interface LayerReference {
  value: Pose;
  root: Pose;
  parent?: Pose;
  frame: number;
  basis?: { parent: Q4; rest: Q4; parentPosition?: V3; restPosition?: V3 };
}
export const blendValue = (t: Track, c: BlendChannel, f: number) =>
  Math.max(0, Math.min(100, t.curves?.[c] ? sampleCurve(t.curves[c]!, f) : blendDefault(c)));
export const controlLayerWeight = (t: Track, f: number) => blendValue(t, 'blendWeight', f) / 100;
export const hasAxisBlend = (t: Track) => BLEND_CHANNELS.slice(1).some((c) => !!t.curves?.[c]);
const q = (v: Pose) => new Quaternion(...v.q);
const transform = (v: Pose) =>
  new Matrix4().compose(new Vector3(...v.p), q(v), new Vector3(1, 1, 1));
const transformed = (v: Pose, m: Matrix4): Pose => {
  const p = new Vector3(),
    r = new Quaternion();
  m.multiply(transform(v)).decompose(p, r, new Vector3());
  return { ...v, p: p.toArray() as V3, q: r.normalize().toArray() as Q4 };
};
export function captureLayerReference(
  value: Pose,
  root: Pose,
  parent: Pose | undefined,
  basis: LayerBasis | undefined,
  frame: number,
): LayerReference {
  return structuredClone({
    value,
    root,
    parent,
    frame,
    basis: basis
      ? {
          parent: basis.parent.toArray() as Q4,
          rest: basis.rest.toArray() as Q4,
          parentPosition: basis.parentPosition?.toArray() as V3 | undefined,
          restPosition: basis.restPosition?.toArray() as V3 | undefined,
        }
      : undefined,
  });
}
/** Replacement keeps an authored pose in the chosen coordinate system. */
export function layerReferencePose(
  reference: LayerReference | undefined,
  fallback: Pose,
  space: LayerSpace,
  root: Pose,
  parent: Pose | undefined,
  basis: LayerBasis | undefined,
  id: ControlId,
): Pose {
  if (!reference) return fallback;
  const value = structuredClone(reference.value);
  if (space === 'world' && isOffsetControl(id) && reference.basis && basis) {
    const a = reference.basis;
    value.q = basis.rest
      .clone()
      .invert()
      .multiply(basis.parent.clone().invert())
      .multiply(new Quaternion(...a.parent))
      .multiply(new Quaternion(...a.rest))
      .multiply(q(value))
      .normalize()
      .toArray() as Q4;
    if (a.parentPosition && a.restPosition && basis.parentPosition && basis.restPosition)
      value.p = new Vector3(...value.p)
        .add(new Vector3(...a.restPosition))
        .applyQuaternion(new Quaternion(...a.parent))
        .add(new Vector3(...a.parentPosition))
        .sub(basis.parentPosition)
        .applyQuaternion(basis.parent.clone().invert())
        .sub(basis.restPosition)
        .toArray() as V3;
    return value;
  }
  if (id !== 'root' && !isOffsetControl(id)) {
    if (space === 'world')
      return transformed(value, transform(root).invert().multiply(transform(reference.root)));
    if (parent && reference.parent)
      return transformed(value, transform(parent).multiply(transform(reference.parent).invert()));
  }
  return value;
}
export interface BlendAxes {
  position: Quaternion;
  rotation: Quaternion;
}
/** Blend in layer axes. Uniform rotation influence stays quaternion-based;
 * only independent axis settings need Euler channel decomposition. */
export function blendLayerPoses(
  before: Pose,
  additive: Pose,
  replacement: Pose,
  axes: BlendAxes,
  track: Track,
  frame: number,
  weight: number,
): Pose {
  const ws = ['px', 'py', 'pz', 'rx', 'ry', 'rz'].map(
    (c) => (weight * blendValue(track, blendChannel(c as TransformAxis, 'Weight'), frame)) / 100,
  );
  const ms = ['px', 'py', 'pz', 'rx', 'ry', 'rz'].map(
    (c) => blendValue(track, blendChannel(c as TransformAxis, 'Replace'), frame) / 100,
  );
  const inv = axes.position.clone().invert(),
    a = new Vector3(...before.p).applyQuaternion(inv),
    b = new Vector3(...additive.p).applyQuaternion(inv),
    c = new Vector3(...replacement.p).applyQuaternion(inv);
  const av = a.toArray(),
    bv = b.toArray(),
    cv = c.toArray();
  const p = new Vector3(
    ...(av.map((v, i) => v + ws[i] * ((bv[i] - v) * (1 - ms[i]) + (cv[i] - v) * ms[i])) as V3),
  )
    .applyQuaternion(axes.position)
    .toArray() as V3;
  let rotation: Quaternion;
  if (
    ws.slice(3).every((w) => Math.abs(w - ws[3]) < 1e-12) &&
    ms.slice(3).every((m) => Math.abs(m - ms[3]) < 1e-12)
  )
    rotation = q(before).slerp(q(additive).slerp(q(replacement), ms[3]), ws[3]);
  else {
    const invR = axes.rotation.clone().invert(),
      order = track.rotationOrder ?? 'XYZ';
    const angles = (v: Pose) => {
      const e = new Euler().setFromQuaternion(invR.clone().multiply(q(v)), order);
      return [e.x, e.y, e.z];
    };
    const aa = angles(before),
      bb = angles(additive),
      cc = angles(replacement),
      near = (v: number, base: number) => v + Math.round((base - v) / (2 * Math.PI)) * 2 * Math.PI;
    const out = aa.map(
      (v, i) =>
        v + ws[i + 3] * ((near(bb[i], v) - v) * (1 - ms[i + 3]) + (near(cc[i], v) - v) * ms[i + 3]),
    );
    rotation = axes.rotation
      .clone()
      .multiply(new Quaternion().setFromEuler(new Euler(...(out as V3), order)));
  }
  return {
    ...before,
    p,
    q: rotation.normalize().toArray() as Q4,
    grip: before.grip.map((v, i) => v + (additive.grip[i] - v) * weight),
    fov: before.fov + (additive.fov - before.fov) * weight,
  };
}
/** Small local inverse for posing through independent channel blends. No rig
 * resampling occurs here. Singular (fully replaced/muted) axes stay unchanged. */
export function invertLayerBlend(
  initial: Pose,
  target: Pose,
  evaluate: (value: Pose) => Pose,
): Pose {
  const error = (a: Pose, b: Pose) => {
    const d = q(a).multiply(q(b).invert());
    if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
    const n = Math.hypot(d.x, d.y, d.z),
      k = n < 1e-12 ? 2 : (2 * Math.atan2(n, d.w)) / n;
    return [...a.p.map((v, i) => v - b.p[i]), d.x * k, d.y * k, d.z * k];
  };
  const move = (v: Pose, step: number[], amount = 1): Pose => {
    const axis = new Vector3(...(step.slice(3) as V3)),
      angle = axis.length() * amount,
      r = q(v);
    if (angle > 1e-14) r.premultiply(new Quaternion().setFromAxisAngle(axis.normalize(), angle));
    return {
      ...v,
      p: v.p.map((x, i) => x + step[i] * amount) as V3,
      q: r.normalize().toArray() as Q4,
    };
  };
  const norm = (x: number[]) => x.reduce((n, v) => n + v * v, 0);
  let value = structuredClone(initial),
    output = evaluate(value),
    diff = error(target, output),
    cost = norm(diff);
  for (let iter = 0; iter < 12 && cost > 1e-18; iter++) {
    const h = 1e-5,
      columns = Array.from({ length: 6 }, (_, i) => {
        const step = Array(6).fill(0);
        step[i] = h;
        return error(evaluate(move(value, step)), output).map((x) => x / h);
      });
    const rows = columns.map((a, i) => [
      ...columns.map((b, j) => a.reduce((n, v, k) => n + v * b[k], 0) + (i === j ? 1e-10 : 0)),
      a.reduce((n, v, k) => n + v * diff[k], 0),
    ]);
    for (let i = 0; i < 6; i++) {
      let pivot = i;
      for (let j = i + 1; j < 6; j++)
        if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
      [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
      const d = rows[i][i];
      for (let k = i; k <= 6; k++) rows[i][k] /= d;
      for (let j = 0; j < 6; j++)
        if (j !== i) {
          const d = rows[j][i];
          for (let k = i; k <= 6; k++) rows[j][k] -= d * rows[i][k];
        }
    }
    const step = rows.map((r) => r[6]),
      limit = Math.min(1, 0.5 / Math.max(1e-12, Math.hypot(...step.slice(3))));
    let improved = false;
    for (let amount = limit; amount >= limit / 32; amount /= 2) {
      const candidate = move(value, step, amount),
        out = evaluate(candidate),
        d = error(target, out),
        c = norm(d);
      if (c < cost) {
        value = candidate;
        output = out;
        diff = d;
        cost = c;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return value;
}

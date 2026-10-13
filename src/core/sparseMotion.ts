import { Quaternion, Vector3 } from 'three';
import type { Key, Track } from './model';
import type { Channel, CurveKey } from './curves';
export interface MotionTolerance {
  position: number;
  rotation: number;
}
const IMPORT_TOLERANCE: MotionTolerance = {
  position: 0.0002,
  rotation: (Math.PI / 180) * 0.25,
};
const channels: Channel[] = ['px', 'py', 'pz', 'qx', 'qy', 'qz', 'qw'];
const values = (k: Key) => [...k.p, ...k.q];
const cubic = (a: number, b: number, c: number, d: number, u: number) => {
  const v = 1 - u;
  return v * v * v * a + 3 * v * v * u * b + 3 * v * u * u * c + u * u * u * d;
};
/** Fit editable cubic segments, keeping endpoints and splitting at motion error.
 * Quaternions stay on one hemisphere and are normalized by the curve evaluator.
 * Position and angular tolerances also cover quarter-frame interpolation. */
export function sparseMotion(
  keys: Key[],
  tolerance: MotionTolerance = IMPORT_TOLERANCE,
): Pick<Track, 'keys' | 'curves' | 'rotationMode' | 'interpolation'> {
  if (!keys.length) throw Error('Motion has no samples.');
  if (
    !(
      tolerance.position > 0 &&
      Number.isFinite(tolerance.position) &&
      tolerance.rotation > 0 &&
      Number.isFinite(tolerance.rotation)
    )
  )
    throw Error('Invalid key reduction tolerance.');
  const samples = keys.map((k) => ({
    ...k,
    p: [...k.p] as Key['p'],
    q: new Quaternion(...k.q).normalize().toArray() as Key['q'],
  }));
  for (let i = 1; i < samples.length; i++)
    if (new Quaternion(...samples[i - 1].q).dot(new Quaternion(...samples[i].q)) < 0)
      samples[i].q = samples[i].q.map((v) => -v) as Key['q'];
  const v = samples.map(values),
    kept = new Set([0, samples.length - 1]),
    segments = new Map<number, { end: number; c1: number[]; c2: number[] }>();
  const pending: [number, number][] = [[0, samples.length - 1]];
  while (pending.length) {
    const [a, b] = pending.pop()!;
    if (a === b) continue;
    const span = samples[b].frame - samples[a].frame;
    if (span <= 0) throw Error('Motion samples must be ordered.');
    let aa = 0,
      ab = 0,
      bb = 0;
    const av = Array(7).fill(0),
      bv = Array(7).fill(0);
    for (let i = a; i < b; i++)
      for (let part = 0; part < 4; part++) {
        if (i === a && part === 0) continue;
        const frame = samples[i].frame + ((samples[i + 1].frame - samples[i].frame) * part) / 4,
          u = (frame - samples[a].frame) / span,
          w1 = 3 * (1 - u) ** 2 * u,
          w2 = 3 * (1 - u) * u * u;
        const point = [
          ...new Vector3(...samples[i].p)
            .lerp(new Vector3(...samples[i + 1].p), part / 4)
            .toArray(),
          ...new Quaternion(...samples[i].q)
            .slerp(new Quaternion(...samples[i + 1].q), part / 4)
            .toArray(),
        ];
        aa += w1 * w1;
        ab += w1 * w2;
        bb += w2 * w2;
        for (let c = 0; c < 7; c++) {
          const y = point[c] - (1 - u) ** 3 * v[a][c] - u ** 3 * v[b][c];
          av[c] += w1 * y;
          bv[c] += w2 * y;
        }
      }
    const det = aa * bb - ab * ab,
      c1 = v[a].map((x, c) =>
        det > 1e-12 ? (av[c] * bb - bv[c] * ab) / det : x + (v[b][c] - x) / 3,
      ),
      c2 = v[a].map((x, c) =>
        det > 1e-12 ? (bv[c] * aa - av[c] * ab) / det : x + (2 * (v[b][c] - x)) / 3,
      );
    let worst = 1,
      split = -1;
    for (let i = a; i < b; i++)
      for (let part = 0; part < 4; part++) {
        const f = samples[i].frame + ((samples[i + 1].frame - samples[i].frame) * part) / 4,
          u = (f - samples[a].frame) / span;
        const value = v[a].map((x, c) => cubic(x, c1[c], c2[c], v[b][c], u));
        const p = new Vector3(...samples[i].p).lerp(new Vector3(...samples[i + 1].p), part / 4),
          q = new Quaternion(...samples[i].q).slerp(new Quaternion(...samples[i + 1].q), part / 4);
        const error = Math.max(
          p.distanceTo(new Vector3(...value.slice(0, 3))) / tolerance.position,
          q.angleTo(new Quaternion(...value.slice(3)).normalize()) / tolerance.rotation,
        );
        if (error > worst) {
          worst = error;
          split = Math.max(a + 1, Math.min(b - 1, part < 2 ? i : i + 1));
        }
      }
    if (split > a && split < b) {
      kept.add(split);
      pending.push([a, split], [split, b]);
    } else segments.set(a, { end: b, c1, c2 });
  }
  const indexes = [...kept].sort((a, b) => a - b),
    curves: NonNullable<Track['curves']> = {};
  for (let c = 0; c < 7; c++) {
    const factor = c < 3 ? 100 : 1,
      flat = v.every((row) => Math.abs(row[c] - v[0][c]) < 1e-8);
    const curveKeys: CurveKey[] = (flat ? [0] : indexes).map((i) => ({
      frame: samples[i].frame,
      value: v[i][c] * factor,
      interpolation: 'bezier',
      handle: 'free',
    }));
    if (!flat)
      for (let n = 0; n < indexes.length - 1; n++) {
        const a = indexes[n],
          segment = segments.get(a)!,
          b = segment.end,
          span = samples[b].frame - samples[a].frame;
        curveKeys[n].right = [span / 3, (segment.c1[c] - v[a][c]) * factor];
        curveKeys[n + 1].left = [-span / 3, (segment.c2[c] - v[b][c]) * factor];
      }
    curves[channels[c]] = { keys: curveKeys, modifiers: [] };
  }
  const allFlat = Object.values(curves).every((c) => c!.keys.length === 1);
  return {
    keys: (allFlat ? [samples[0]] : indexes.map((i) => samples[i])).map((k) => ({
      ...k,
      interpolation: 'linear',
    })),
    curves,
    rotationMode: 'quaternion',
    interpolation: 'linear',
  };
}

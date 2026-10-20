import { Quaternion } from 'three';
import { baseCurve, handles, readCurve, channelsFor } from './curves';
import type { Channel, Curve, CurveKey } from './curves';
import { sample } from './model';
import type { ControlId, Track } from './model';
import { detectNoise } from './bakedNoise';
import type { BlenderNoiseSettings } from './blenderNoise';

export interface NoiseReduction {
  algorithm: 'blender';
  maxError: number;
  validationError: number;
}

export interface ReductionOptions {
  position: number;
  rotation: number;
  scalar: number;
  fit: 'auto' | 'bezier' | 'linear' | 'baked';
  skimHandles: boolean;
  preserveExtrema: boolean;
  /** Baked phase reconstruction: negligible drift as a percentage of range. */
  drift?: number;
  range?: [number, number];
  /** Infer a Blender-compatible Noise modifier from baked samples when safe. */
  detectNoise?: boolean;
}
export const DEFAULT_REDUCTION: ReductionOptions = {
  position: 0.02,
  rotation: 0.1,
  scalar: 0.1,
  fit: 'auto',
  skimHandles: true,
  preserveExtrema: true,
  detectNoise: false,
};
export interface ReductionInput {
  id: ControlId;
  label: string;
  track: Track;
  channels: Channel[];
  protectedFrames?: number[];
}
interface ReductionRow {
  channel: Channel;
  before: number;
  after: number;
  error: number;
  bound: number;
  tolerance: number;
  bezier: number;
  linear: number;
  reason?: string;
  noise?: NoiseReduction;
}
export interface ReductionResult {
  id: ControlId;
  label: string;
  track: Track;
  rows: ReductionRow[];
  before: number;
  after: number;
  positionError: number;
  rotationError: number;
  subframePositionError?: number;
  subframeRotationError?: number;
  changed: boolean;
}
type Point = [number, number];
type Cubic = [Point, Point, Point, Point];
type Span = { a: number; b: number; mode: 'linear' | 'bezier'; right: Point; left: Point };
type FitConstraints = {
  startSlope?: number;
  endSlope?: number;
  verticalStart?: boolean;
  approximate?: boolean;
};
const cp = <T>(v: T): T => structuredClone(v);
const lerp = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const cubic = (p: Cubic, t: number): Point => {
  const a = lerp(p[0], p[1], t),
    b = lerp(p[1], p[2], t),
    c = lerp(p[2], p[3], t);
  return lerp(lerp(a, b, t), lerp(b, c, t), t);
};
function split(p: Cubic, t: number): [Cubic, Cubic] {
  const a = lerp(p[0], p[1], t),
    b = lerp(p[1], p[2], t),
    c = lerp(p[2], p[3], t),
    d = lerp(a, b, t),
    e = lerp(b, c, t),
    f = lerp(d, e, t);
  return [
    [p[0], a, d, f],
    [f, e, c, p[3]],
  ];
}
function parameter(p: Cubic, frame: number) {
  if (frame <= p[0][0]) return 0;
  if (frame >= p[3][0]) return 1;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2;
    if (cubic(p, t)[0] < frame) lo = t;
    else hi = t;
  }
  return (lo + hi) / 2;
}
function slice(p: Cubic, from: number, to: number): Cubic {
  const a = parameter(p, from),
    b = parameter(p, to);
  return a === 0 ? split(p, b)[0] : b === 1 ? split(p, a)[1] : split(split(p, b)[0], a / b)[1];
}
function points(curve: Curve, i: number): Cubic {
  const a = curve.keys[i],
    b = curve.keys[i + 1],
    first: Point = [a.frame, a.value],
    last: Point = [b.frame, b.value];
  if (a.interpolation === 'linear')
    return [first, lerp(first, last, 1 / 3), lerp(first, last, 2 / 3), last];
  const r = handles(curve, i).right,
    l = handles(curve, i + 1).left,
    span = b.frame - a.frame,
    total = r[0] - l[0],
    scale = total > span ? span / total : 1;
  return [
    first,
    [a.frame + r[0] * scale, a.value + r[1] * scale],
    [b.frame + l[0] * scale, b.value + l[1] * scale],
    last,
  ];
}
function explicit(curve: Curve): Curve {
  return {
    ...cp(curve),
    keys: curve.keys.map((k, i) => ({ ...cp(k), handle: 'free', ...handles(curve, i) })),
  };
}
const primitive = (k: CurveKey) =>
  k.interpolation === 'step' || k.interpolation === 'spring' || k.interpolation === 'bounce';

/** Baked motion describes samples, not the corners of an earlier interpolation.
 * Fractional authored keys remain observations alongside each integer frame. */
function observationFrames(curve: Curve, from: number, to: number) {
  const frames = new Set([from, to]);
  for (const key of curve.keys) if (key.frame > from && key.frame < to) frames.add(key.frame);
  for (let frame = Math.ceil(from); frame < to; frame++) frames.add(frame);
  return [...frames].sort((a, b) => a - b);
}

function observationError(source: Curve, target: Curve) {
  let error = 0;
  for (const frame of observationFrames(source, source.keys[0].frame, source.keys.at(-1)!.frame))
    error = Math.max(error, Math.abs(baseCurve(source, frame) - baseCurve(target, frame)));
  return error;
}

function extrema(p: Cubic) {
  const d = p.slice(1).map((point, i) => point[1] - p[i][1]),
    a = d[0] - 2 * d[1] + d[2],
    b = 2 * (d[1] - d[0]),
    c = d[0],
    discriminant = b * b - 4 * a * c;
  const roots =
    Math.abs(a) < 1e-12
      ? Math.abs(b) < 1e-12
        ? []
        : [-c / b]
      : discriminant < 0
        ? []
        : [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)];
  return roots.filter((t) => t > 0 && t < 1).map((t) => cubic(p, t));
}

/** The convex hull bounds the entire difference, not just the fit samples.
 * Subtracting a common line tightens the hull for fast, nearly linear motion.
 * Both cubics are restricted to the same time interval before subdivision. */
function certify(source: Cubic, target: Cubic, tolerance: number) {
  const identical = source.every((p, i) => p.every((v, j) => Math.abs(v - target[i][j]) < 1e-12));
  if (identical) return { passed: true, peak: 0, bound: 0, worstFrame: source[0][0] };
  // baseCurve inverts Bezier time with 24 bisections. Account for that numeric
  // error as well as the continuous mathematical curves being compared here.
  const numeric = (p: Cubic) =>
    3 * Math.max(...p.slice(1).map((v, i) => Math.abs(v[1] - p[i][1]))) * 2 ** -24;
  const margin = numeric(source) + numeric(target);
  if (margin > tolerance)
    return { passed: false, peak: 0, bound: margin, worstFrame: (source[0][0] + source[3][0]) / 2 };
  let peak = 0,
    bound = 0,
    worstFrame = source[0][0],
    calls = 0;
  const pending: [Cubic, Cubic, number][] = [
    [source, slice(target, source[0][0], source[3][0]), 0],
  ];
  while (pending.length) {
    const [a, b, depth] = pending.pop()!,
      from = a[0][0],
      to = a[3][0],
      mid = (from + to) / 2;
    for (const f of [from, mid, to]) {
      const error = Math.abs(cubic(a, parameter(a, f))[1] - cubic(b, parameter(b, f))[1]);
      if (error > peak) {
        peak = error;
        worstFrame = f;
      }
      if (error > tolerance) return { passed: false, peak, bound: error, worstFrame };
    }
    const slope = (a[3][1] - a[0][1]) / (to - from),
      line = (p: Point) => p[1] - a[0][1] - slope * (p[0] - from),
      av = a.map(line),
      bv = b.map(line);
    const ceiling =
      Math.max(
        Math.abs(Math.min(...av) - Math.max(...bv)),
        Math.abs(Math.max(...av) - Math.min(...bv)),
      ) +
      margin +
      1e-10;
    if (ceiling <= tolerance) {
      bound = Math.max(bound, ceiling);
      continue;
    }
    if (depth >= 16 || ++calls > 8192)
      return { passed: false, peak, bound: ceiling, worstFrame: mid };
    const [al, ar] = split(a, parameter(a, mid)),
      [bl, br] = split(b, parameter(b, mid));
    pending.push([ar, br, depth + 1], [al, bl, depth + 1]);
  }
  return { passed: true, peak, bound, worstFrame };
}

function fitSpan(
  source: Curve,
  a: number,
  b: number,
  options: ReductionOptions,
  tolerance: number,
  constraints: FitConstraints = {},
  cachedObservations?: Point[],
): { span?: Span; error: number; bound: number; split: number } {
  const ka = source.keys[a],
    kb = source.keys[b],
    length = kb.frame - ka.frame;
  const fitSamples: Point[] = [];
  const observations =
    options.fit === 'baked'
      ? (cachedObservations?.filter(([frame]) => frame >= ka.frame && frame <= kb.frame) ??
        observationFrames(source, ka.frame, kb.frame).map(
          (frame) => [frame, baseCurve(source, frame)] as Point,
        ))
      : undefined;
  let observedLow = Infinity,
    observedHigh = -Infinity;
  for (const point of observations ?? []) {
    observedLow = Math.min(observedLow, point[1]);
    observedHigh = Math.max(observedHigh, point[1]);
  }
  const stride = Math.max(1, Math.ceil((b - a) / 48));
  if (observations) {
    const observationStride = Math.max(1, Math.ceil(observations.length / 192));
    for (let i = 0; i < observations.length - 1; i += observationStride)
      fitSamples.push(observations[i]);
  } else {
    for (let i = a; i < b; i += stride) {
      const p = points(source, i);
      for (const t of [0.0, 0.2113248654, 0.5, 0.7886751346]) fitSamples.push(cubic(p, t));
    }
  }
  fitSamples.push([kb.frame, kb.value]);
  const cycles = !!source.loop || source.modifiers.some((m) => m.enabled && m.type === 'cycles');
  const lockStart = (cycles && a === 0) || constraints.startSlope !== undefined,
    lockEnd = (cycles && b === source.keys.length - 1) || constraints.endSlope !== undefined;
  const startSlope =
      constraints.startSlope ?? handles(source, a).right[1] / handles(source, a).right[0],
    endSlope = constraints.endSlope ?? handles(source, b).left[1] / handles(source, b).left[0];
  const make = (r: number, l: number): Cubic => {
    if (constraints.verticalStart) r = 0.001 / length;
    const p: Cubic = [
      [ka.frame, ka.value],
      [ka.frame + length * r, ka.value + length * r * startSlope],
      [kb.frame - length * l, kb.value - length * l * endSlope],
      [kb.frame, kb.value],
    ];
    let aa = 0,
      ab = 0,
      bb = 0,
      ay = 0,
      by = 0;
    for (const [f, v] of fitSamples) {
      const u = parameter(p, f),
        w1 = 3 * (1 - u) ** 2 * u,
        w2 = 3 * (1 - u) * u * u,
        y =
          v -
          (1 - u) ** 3 * ka.value -
          u ** 3 * kb.value -
          (lockStart ? w1 * p[1][1] : 0) -
          (lockEnd ? w2 * p[2][1] : 0);
      aa += w1 * w1;
      ab += w1 * w2;
      bb += w2 * w2;
      ay += w1 * y;
      by += w2 * y;
    }
    // Three frame observations give only one independent interior value for
    // two vertical handles. Regularize toward the endpoint tangents instead
    // of solving both handles independently and counting that value twice.
    if (!lockStart && !lockEnd && aa * bb - ab * ab <= 1e-14) {
      const ridge = Math.max(aa, bb, 1) * 1e-8;
      aa += ridge;
      bb += ridge;
      ay += ridge * p[1][1];
      by += ridge * p[2][1];
    }
    const det = aa * bb - ab * ab;
    if (!lockStart && !lockEnd && det > 1e-14) {
      p[1][1] = (ay * bb - by * ab) / det;
      p[2][1] = (by * aa - ay * ab) / det;
    } else {
      if (!lockStart && aa > 1e-14) p[1][1] = ay / aa;
      if (!lockEnd && bb > 1e-14) p[2][1] = by / bb;
    }
    if (constraints.approximate) {
      const lo = Math.min(ka.value, kb.value),
        hi = Math.max(ka.value, kb.value);
      p[1][1] = Math.max(lo, Math.min(hi, p[1][1]));
      p[2][1] = Math.max(lo, Math.min(hi, p[2][1]));
    }
    return p;
  };
  const score = (p: Cubic) =>
    fitSamples.reduce((sum, [f, v]) => sum + (cubic(p, parameter(p, f))[1] - v) ** 2, 0);
  const check = (p: Cubic) => {
    let error = 0,
      bound = 0,
      worst = a + 1,
      failureScore = 0,
      passed = true;
    if (observations) {
      let frame = ka.frame;
      for (const [f, value] of observations) {
        const difference = Math.abs(cubic(p, parameter(p, f))[1] - value);
        if (difference > error) {
          error = difference;
          frame = f;
        }
      }
      // Sample reconstruction may smooth old corners, but must not invent a
      // spike outside the observed motion's range between those samples.
      for (const [f, value] of extrema(p)) {
        const difference = Math.max(observedLow - value, value - observedHigh, 0);
        if (difference > error) {
          error = difference;
          frame = f;
        }
      }
      for (let i = a + 1; i < b; i++)
        if (Math.abs(source.keys[i].frame - frame) < Math.abs(source.keys[worst].frame - frame))
          worst = i;
      return { passed: error <= tolerance, error, bound: error, split: worst };
    }
    for (let i = a; i < b; i++) {
      const v = certify(points(source, i), p, tolerance);
      error = Math.max(error, v.peak);
      bound = Math.max(bound, v.bound);
      if (!v.passed) {
        passed = false;
        const score = v.peak > tolerance ? v.peak : v.bound;
        if (score > failureScore) {
          failureScore = score;
          worst = Math.max(
            a + 1,
            Math.min(
              b - 1,
              Math.abs(v.worstFrame - source.keys[i].frame) <
                Math.abs(v.worstFrame - source.keys[i + 1].frame)
                ? i
                : i + 1,
            ),
          );
        }
      }
    }
    return { passed, error, bound, split: worst };
  };
  const finish = (p: Cubic, mode: 'linear' | 'bezier', v: ReturnType<typeof check>) => ({
    ...v,
    span: v.passed
      ? {
          a,
          b,
          mode,
          right: [p[1][0] - ka.frame, p[1][1] - ka.value] as Point,
          left: [p[2][0] - kb.frame, p[2][1] - kb.value] as Point,
        }
      : undefined,
  });
  const line: Cubic = [
    [ka.frame, ka.value],
    lerp([ka.frame, ka.value], [kb.frame, kb.value], 1 / 3),
    lerp([ka.frame, ka.value], [kb.frame, kb.value], 2 / 3),
    [kb.frame, kb.value],
  ];
  if (
    !constraints.approximate &&
    options.fit !== 'bezier' &&
    ((!lockStart && !lockEnd) || options.fit === 'linear')
  ) {
    const v = check(line);
    if (
      (lockStart && Math.abs(startSlope - (kb.value - ka.value) / length) > 1e-9) ||
      (lockEnd && Math.abs(endSlope - (kb.value - ka.value) / length) > 1e-9)
    )
      v.passed = false;
    if (v.passed || options.fit === 'linear') return finish(line, 'linear', v);
  }
  let r = 1 / 3,
    l = 1 / 3,
    best = make(r, l),
    bestScore = score(best);
  const initial = check(best);
  if (!options.skimHandles || (initial.passed && !constraints.approximate))
    return finish(best, 'bezier', constraints.approximate ? { ...initial, passed: true } : initial);
  const residuals = (p: Cubic) =>
    fitSamples.map(([f, value]) => cubic(p, parameter(p, f))[1] - value);
  // Solve the two horizontal handle lengths together. A one-pass coordinate
  // search can stall along a narrow valley even when an accurate sparse fit
  // exists. Vertical handle values remain the least-squares solution in make().
  for (let iteration = 0; iteration < 16; iteration++) {
    const errors = residuals(best),
      hR = r + l + 0.0001 < 0.99 && r + 0.0001 < 0.95 ? 0.0001 : -0.0001,
      hL = r + l + 0.0001 < 0.99 && l + 0.0001 < 0.95 ? 0.0001 : -0.0001,
      right = residuals(make(r + hR, l)),
      left = residuals(make(r, l + hL));
    let aa = 0,
      ab = 0,
      bb = 0,
      ar = 0,
      br = 0;
    for (let i = 0; i < errors.length; i++) {
      const dr = (right[i] - errors[i]) / hR,
        dl = (left[i] - errors[i]) / hL;
      aa += dr * dr;
      ab += dr * dl;
      bb += dl * dl;
      ar += dr * errors[i];
      br += dl * errors[i];
    }
    const ridge = Math.max(aa, bb, 1) * 1e-8;
    aa += ridge;
    bb += ridge;
    const determinant = aa * bb - ab * ab;
    if (determinant <= 1e-20) break;
    const dr = Math.max(-0.25, Math.min(0.25, (ab * br - bb * ar) / determinant)),
      dl = Math.max(-0.25, Math.min(0.25, (ab * ar - aa * br) / determinant));
    let improved = false;
    for (let scale = 1; scale >= 1 / 128; scale /= 2) {
      const nr = Math.max(0.01, Math.min(0.95, r + dr * scale)),
        nl = Math.max(0.01, Math.min(0.95, l + dl * scale));
      if (nr + nl > 0.99) continue;
      const p = make(nr, nl),
        s = score(p);
      if (s < bestScore - Math.max(1e-20, bestScore * 1e-10)) {
        r = nr;
        l = nl;
        best = p;
        bestScore = s;
        improved = true;
        break;
      }
    }
    if (!improved) break;
    const certified = check(best);
    if (certified.passed && !constraints.approximate) return finish(best, 'bezier', certified);
  }
  // A bounded pattern search also covers constrained solutions near a handle
  // limit, where a local derivative can point outside the feasible region.
  for (const step of [
    0.2, 0.1, 0.05, 0.025, 0.0125, 0.00625, 0.003125, 0.0015625, 0.00078125, 0.000390625, 0.0001,
  ]) {
    for (const axis of [0, 1])
      for (const direction of [-1, 1]) {
        const nr = axis === 0 ? Math.max(0.01, Math.min(0.95, r + step * direction)) : r,
          nl = axis === 1 ? Math.max(0.01, Math.min(0.95, l + step * direction)) : l;
        if (nr + nl > 0.99) continue;
        const p = make(nr, nl),
          s = score(p);
        if (s < bestScore) {
          r = nr;
          l = nl;
          best = p;
          bestScore = s;
        }
      }
    const certified = check(best);
    if (certified.passed && !constraints.approximate) return finish(best, 'bezier', certified);
  }
  if (constraints.approximate && constraints.verticalStart) {
    // A sharp departure can concentrate least-squares error in the first
    // frame. Refine its free height and the arriving handle for worst-frame
    // error, keeping the departure vertical and the arrival horizontal.
    const lo = Math.min(ka.value, kb.value),
      height = Math.abs(kb.value - ka.value),
      peak = (p: Cubic) => {
        let error = 0;
        for (const [frame, value] of fitSamples)
          error = Math.max(error, Math.abs(cubic(p, parameter(p, frame))[1] - value));
        return error;
      };
    let bestPeak = peak(best);
    for (const length of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) {
      const candidate = make(r, length),
        error = peak(candidate);
      if (error < bestPeak) {
        best = candidate;
        bestPeak = error;
      }
    }
    for (const step of [0.2, 0.1, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001, 0.0002]) {
      for (let iteration = 0; iteration < 12; iteration++) {
        let improved = false;
        const incoming = (kb.frame - best[2][0]) / length,
          freeHeight = height ? (best[1][1] - lo) / height : 0;
        for (const dx of [-1, 0, 1])
          for (const dy of [-1, 0, 1]) {
            if (!dx && !dy) continue;
            const candidate = cp(best);
            candidate[1][1] = lo + height * Math.max(0, Math.min(1, freeHeight + dy * step));
            candidate[2][0] =
              kb.frame - length * Math.max(0.001 / length, Math.min(0.99, incoming + dx * step));
            const error = peak(candidate);
            if (error < bestPeak - 1e-9) {
              best = candidate;
              bestPeak = error;
              improved = true;
            }
          }
        if (!improved) break;
      }
    }
  }
  const final = check(best);
  return finish(best, 'bezier', constraints.approximate ? { ...final, passed: true } : final);
}

/** Distill a bake into holds and moves rather than preserving frame-local
 * interpolation artifacts. Long stable windows define the phase boundaries. */
function rebuildPhases(curve: Curve, options: ReductionOptions, protectedFrames: number[]) {
  const keys = curve.keys,
    first = keys[0].frame,
    last = keys.at(-1)!.frame;
  if (
    options.range ||
    curve.loop ||
    curve.modifiers.some((m) => m.enabled) ||
    keys.some((key) => primitive(key) || key.interpolation === 'loop') ||
    protectedFrames.some((frame) => frame > first && frame < last)
  )
    return;
  const observations = observationFrames(curve, first, last).map((frame) => ({
    frame,
    value: baseCurve(curve, frame),
  }));
  let low = Infinity,
    high = -Infinity;
  for (const point of observations) {
    low = Math.min(low, point.value);
    high = Math.max(high, point.value);
  }
  const band = ((high - low) * (options.drift ?? 2)) / 100,
    minimumHold = Math.min(4, Math.max(2, (last - first) / 8));
  if (!band) return;
  const candidates: { a: number; b: number }[] = [];
  // Sliding min/max queues find each maximal stable window in linear time.
  const minima: number[] = [],
    maxima: number[] = [];
  let minHead = 0,
    maxHead = 0,
    end = 0;
  for (let start = 0; start < observations.length; start++) {
    while (end < observations.length) {
      const value = observations[end].value,
        min = Math.min(
          value,
          minima.length > minHead ? observations[minima[minHead]].value : value,
        ),
        max = Math.max(
          value,
          maxima.length > maxHead ? observations[maxima[maxHead]].value : value,
        );
      if (max - min > band) break;
      while (minima.length > minHead && observations[minima.at(-1)!].value >= value) minima.pop();
      while (maxima.length > maxHead && observations[maxima.at(-1)!].value <= value) maxima.pop();
      minima.push(end);
      maxima.push(end);
      end++;
    }
    if (end > start && observations[end - 1].frame - observations[start].frame >= minimumHold)
      candidates.push({ a: start, b: end - 1 });
    if (minima[minHead] === start) minHead++;
    if (maxima[maxHead] === start) maxHead++;
  }
  candidates.sort(
    (a, b) =>
      observations[b.b].frame -
      observations[b.a].frame -
      (observations[a.b].frame - observations[a.a].frame),
  );
  const holds: typeof candidates = [];
  for (const candidate of candidates)
    if (!holds.some((hold) => candidate.a <= hold.b && candidate.b >= hold.a))
      holds.push(candidate);
  holds.sort((a, b) => a.a - b.a);
  if (holds.length < 2) return;
  const holdValue = (hold: { a: number; b: number }) => {
    const values = observations
      .slice(hold.a, hold.b + 1)
      .map((point) => point.value)
      .sort((a, b) => a - b);
    return Math.max(Math.abs(values[0]), Math.abs(values.at(-1)!)) <= band
      ? 0
      : values[Math.floor(values.length / 2)];
  };
  // A maximal min/max window can stop short of the visually flat phase when
  // harmless chatter exists elsewhere in that window. Extend each chosen hold
  // through adjacent observations that are individually within the drift band
  // of its robust level. Midpoints between neighboring holds keep expansions
  // from consuming a distinct motion phase.
  const originalHolds = holds.map((hold) => ({ ...hold }));
  for (let i = 0; i < holds.length; i++) {
    const hold = holds[i],
      value = holdValue(hold),
      leftLimit = i ? Math.ceil((originalHolds[i - 1].b + originalHolds[i].a) / 2) : 0,
      rightLimit =
        i + 1 < holds.length
          ? Math.floor((originalHolds[i].b + originalHolds[i + 1].a) / 2)
          : observations.length - 1;
    while (hold.a > leftLimit && Math.abs(observations[hold.a - 1].value - value) <= band) hold.a--;
    while (hold.b < rightLimit && Math.abs(observations[hold.b + 1].value - value) <= band)
      hold.b++;
  }
  const phaseKeys: CurveKey[] = [];
  const insert = (frame: number, value: number) => {
    if (phaseKeys.at(-1)?.frame !== frame)
      phaseKeys.push({ frame, value, interpolation: 'linear', handle: 'free' });
  };
  insert(first, observations[0].value);
  for (const hold of holds) {
    const value = holdValue(hold);
    if (phaseKeys.at(-1)?.frame === observations[hold.a].frame) phaseKeys.at(-1)!.value = value;
    else insert(observations[hold.a].frame, value);
    insert(observations[hold.b].frame, value);
  }
  insert(last, observations.at(-1)!.value);
  // Holds alone are not a motion skeleton: a moving interval can contain
  // distinct lifts, dips or rebounds. Keep turning points whose excursion on
  // both sides exceeds the drift band, while ignoring small bake chatter.
  const turns = new Set<number>(),
    held = new Uint8Array(observations.length),
    epsilon = Math.max(1e-8, band * 0.05);
  for (const hold of holds) held.fill(1, hold.a, hold.b + 1);
  for (let i = 1; i < observations.length - 1; i++) {
    const point = observations[i],
      left = point.value - observations[i - 1].value;
    if (Math.abs(left) <= epsilon || held[i]) continue;
    let plateau = i;
    while (
      plateau + 1 < observations.length &&
      Math.abs(observations[plateau + 1].value - point.value) <= epsilon
    )
      plateau++;
    if (plateau === observations.length - 1) continue;
    const right = observations[plateau + 1].value - point.value;
    if (left * right >= 0) continue;
    const excursion = (direction: number) => {
      let index = i,
        sign = 0;
      while (index + direction >= 0 && index + direction < observations.length) {
        const raw = observations[index + direction].value - observations[index].value,
          delta = Math.abs(raw) > epsilon ? raw : 0;
        if (delta && sign && Math.sign(delta) !== sign) break;
        if (delta) sign = Math.sign(delta);
        index += direction;
      }
      return Math.abs(observations[index].value - point.value);
    };
    if (Math.min(excursion(-1), excursion(1)) <= band) continue;
    const flatTop = observations
      .slice(i, plateau + 1)
      .every((value) => value.value === point.value);
    for (const index of new Set(flatTop ? [i, plateau] : [i])) {
      const turn = observations[index];
      turns.add(turn.frame);
      if (!phaseKeys.some((key) => key.frame === turn.frame))
        phaseKeys.push({
          frame: turn.frame,
          value: turn.value,
          interpolation: 'linear',
          handle: 'free',
        });
    }
  }
  phaseKeys.sort((a, b) => a.frame - b.frame);
  // A stable window can leave an interior boundary in a run whose entire
  // observed range is below the requested drift. Its neighbors already carry
  // that hold, even when their canonical values differ by roundoff.
  for (let i = phaseKeys.length - 2; i > 0; i--)
    if (!turns.has(phaseKeys[i].frame)) {
      const from = phaseKeys[i - 1].frame,
        to = phaseKeys[i + 1].frame;
      let low = Math.min(phaseKeys[i - 1].value, phaseKeys[i].value, phaseKeys[i + 1].value),
        high = Math.max(phaseKeys[i - 1].value, phaseKeys[i].value, phaseKeys[i + 1].value);
      for (const point of observations)
        if (point.frame >= from && point.frame <= to) {
          low = Math.min(low, point.value);
          high = Math.max(high, point.value);
        }
      if (high - low <= band) phaseKeys.splice(i, 1);
    }
  if (phaseKeys.length >= keys.length) return;
  if (phaseKeys.some((key, index) => index > 0 && key.frame - phaseKeys[index - 1].frame < 0.002))
    return;
  const reference = cp(curve);
  for (const key of phaseKeys) {
    const index = reference.keys.findIndex((point) => point.frame >= key.frame);
    if (index >= 0 && reference.keys[index].frame === key.frame)
      reference.keys[index].value = key.value;
    else reference.keys.splice(index < 0 ? reference.keys.length : index, 0, cp(key));
  }
  for (let i = 0; i < phaseKeys.length - 1; i++) {
    const start = phaseKeys[i],
      finish = phaseKeys[i + 1];
    if (start.value === finish.value) continue;
    const duration = finish.frame - start.frame,
      linearEpsilon = Math.max(1e-8, band * 0.01);
    let linearError = 0;
    for (const point of observations)
      if (point.frame >= start.frame && point.frame <= finish.frame) {
        const t = (point.frame - start.frame) / duration,
          value = start.value + (finish.value - start.value) * t;
        linearError = Math.max(linearError, Math.abs(point.value - value));
      }
    // Preserve literal constant-speed motion as linear. A Bezier with
    // collinear handles evaluates similarly, but presents the wrong authored
    // interpolation and needless handles to the curve editor.
    if (linearError <= linearEpsilon) {
      start.interpolation = 'linear';
      delete start.right;
      delete finish.left;
      continue;
    }
    const a = reference.keys.findIndex((key) => key.frame === start.frame),
      b = reference.keys.findIndex((key) => key.frame === finish.frame),
      // A small opening secant followed by a larger one identifies a soft
      // departure; an immediate large move gets a vertical free handle.
      next = observations.findIndex((point) => point.frame > start.frame),
      immediate = observations[next],
      following = observations[next + 1],
      openingSpeed = immediate
        ? Math.abs(immediate.value - baseCurve(curve, start.frame)) /
          (immediate.frame - start.frame)
        : 0,
      nextSpeed =
        immediate && following
          ? Math.abs(following.value - immediate.value) / (following.frame - immediate.frame)
          : 0,
      sharp =
        !turns.has(start.frame) &&
        openingSpeed > band / minimumHold &&
        openingSpeed >= nextSpeed * 0.6,
      tangentModels: { constraints: FitConstraints; freedom: number }[] = [
        {
          freedom: 0,
          constraints: {
            approximate: true,
            ...(sharp ? { verticalStart: true } : { startSlope: 0 }),
            endSlope: 0,
          },
        },
        {
          freedom: 1,
          constraints: {
            approximate: true,
            ...(sharp ? { verticalStart: true } : { startSlope: 0 }),
          },
        },
        { freedom: 1, constraints: { approximate: true, endSlope: 0 } },
        { freedom: 2, constraints: { approximate: true } },
      ],
      fits = tangentModels.map(({ constraints, freedom }) => ({
        ...fitSpan(reference, a, b, options, 0, constraints),
        freedom,
      })),
      // Horizontal (or deliberately vertical) phase tangents are the simplest
      // explanation for a bake. Free an endpoint only when doing so recovers
      // more observed motion than the user has declared negligible drift. If
      // any model meets that declared band, prefer the least-free such model;
      // otherwise retain the penalized best effort rather than adding handles
      // that cannot materially improve the reconstruction.
      withinBand = fits.filter((candidate) => candidate.error <= band),
      fit = withinBand.length
        ? withinBand.reduce((best, candidate) =>
            candidate.freedom < best.freedom ||
            (candidate.freedom === best.freedom && candidate.error < best.error)
              ? candidate
              : best,
          )
        : fits.reduce((best, candidate) =>
            candidate.error + band * candidate.freedom < best.error + band * best.freedom
              ? candidate
              : best,
          );
    if (!fit.span) return;
    start.interpolation = 'bezier';
    start.right = fit.span.right;
    finish.left = fit.span.left;
  }
  const candidate: Curve = { ...cp(curve), keys: phaseKeys };
  return { curve: candidate, error: observationError(curve, candidate) };
}

/** Reduce one editable scalar curve. Existing modifiers and non-polynomial
 * interpolation remain procedural; their boundary segments are not rewritten. */
export function reduceCurve(
  curve: Curve,
  tolerance: number,
  options: ReductionOptions,
  protectedFrames: number[] = [],
  noiseHints: readonly BlenderNoiseSettings[] = [],
): { curve: Curve; error: number; bound: number; noise?: NoiseReduction } {
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw Error('Choose a positive error tolerance.');
  if (
    options.fit === 'baked' &&
    options.drift !== undefined &&
    (!Number.isFinite(options.drift) || options.drift < 0 || options.drift > 10)
  )
    throw Error('Choose a drift threshold between 0 and 10 percent.');
  const source = explicit(curve),
    keys = source.keys,
    n = keys.length;
  if (
    n > 1 &&
    !curve.loop &&
    !options.range &&
    !protectedFrames.length &&
    !curve.modifiers.some((m) => m.type === 'cycles') &&
    curve.keys.every((k) => k.value === curve.keys[0].value) &&
    curve.keys
      .slice(0, -1)
      .every((k, i) => primitive(k) || points(curve, i).every((p) => p[1] === k.value))
  )
    return { curve: { ...cp(curve), keys: [cp(curve.keys[0])] }, error: 0, bound: 0 };
  if (n < 2) return { curve: cp(curve), error: 0, bound: 0 };
  const hasInteriorProtectedFrame = protectedFrames.some(
    (frame) => frame > keys[0].frame && frame < keys[n - 1].frame,
  );
  // Noise inference is deliberately opt-in and only runs on a plain source
  // curve. Existing modifiers, loops, protected attachment boundaries, and
  // locked source curves must remain procedural/source-authored data.
  if (
    options.detectNoise &&
    options.fit !== 'linear' &&
    !options.range &&
    !hasInteriorProtectedFrame &&
    !curve.keyLock &&
    !curve.loop &&
    curve.modifiers.length === 0
  ) {
    const noise = detectNoise(curve, tolerance, noiseHints);
    if (noise) return noise;
  }
  const gain = curve.modifiers.reduce(
      (g, m) => (m.enabled && m.type === 'scale' ? g * Math.abs(m.factor) : g),
      1,
    ),
    baseTolerance = tolerance / Math.max(1, gain);
  const pinned = new Set([0, n - 1]);
  const switches = protectedFrames.filter(
    (frame) => frame > keys[0].frame && frame < keys[n - 1].frame,
  );
  if (
    options.fit === 'baked' &&
    !options.range &&
    !switches.length &&
    !curve.loop &&
    !curve.modifiers.some((m) => m.enabled && m.type === 'cycles') &&
    !keys.some(primitive)
  ) {
    const flat: Curve = {
        ...cp(curve),
        keys: [
          {
            ...cp(keys[0]),
            interpolation: 'linear',
            handle: 'free',
            left: undefined,
            right: undefined,
          },
        ],
      },
      error = observationError(curve, flat) * gain;
    if (error <= tolerance)
      return {
        curve: flat,
        error,
        bound: error,
      };
  }
  if (n < 3) return { curve: cp(curve), error: 0, bound: 0 };
  if (options.fit === 'baked') {
    const phases = rebuildPhases(source, options, switches);
    if (phases)
      return { curve: phases.curve, error: phases.error * gain, bound: phases.error * gain };
  }
  for (let i = 0; i < n; i++) {
    if (options.range && (keys[i].frame <= options.range[0] || keys[i].frame >= options.range[1]))
      pinned.add(i);
    if (i < n - 1 && primitive(keys[i])) {
      pinned.add(i);
      pinned.add(i + 1);
    }
    if (options.preserveExtrema && i > 0 && i < n - 1) {
      const left = keys[i].value - keys[i - 1].value,
        right = keys[i + 1].value - keys[i].value;
      if (left * right < 0 || (left === 0) !== (right === 0)) {
        // Quantization chatter is not a meaningful extremum. Measure the adjacent
        // monotone runs, rather than pinning every tiny direction change in a bake.
        const excursion = (direction: number) => {
          let j = i,
            sign = 0;
          while (j + direction >= 0 && j + direction < n) {
            const d = keys[j + direction].value - keys[j].value;
            if (d && sign && Math.sign(d) !== sign) break;
            if (d) sign = Math.sign(d);
            j += direction;
          }
          return Math.abs(keys[j].value - keys[i].value);
        };
        const prominence =
          left * right < 0
            ? Math.min(excursion(-1), excursion(1))
            : Math.max(excursion(-1), excursion(1));
        if (prominence > baseTolerance * 2) pinned.add(i);
      }
    }
  }
  // Protect the segments touching a switch, even when it falls between keys.
  for (const frame of switches) {
    const i = keys.findIndex((k) => k.frame >= frame);
    if (i < 0) continue;
    for (const j of [i - 2, i - 1, i, i + 1]) if (j >= 0 && j < n) pinned.add(j);
  }
  const indexes = [...pinned].sort((a, b) => a - b),
    pending = indexes.slice(1).map((b, i) => [indexes[i], b] as [number, number]),
    segments: Span[] = [];
  const cachedObservations =
    options.fit === 'baked'
      ? observationFrames(curve, keys[0].frame, keys[n - 1].frame).map(
          (frame) => [frame, baseCurve(curve, frame)] as Point,
        )
      : undefined;
  let error = 0,
    bound = 0;
  while (pending.length) {
    const [a, b] = pending.pop()!;
    if (b === a + 1) {
      segments.push({
        a,
        b,
        mode: keys[a].interpolation === 'linear' ? 'linear' : 'bezier',
        right: handles(source, a).right,
        left: handles(source, b).left,
      });
      continue;
    }
    const result = fitSpan(curve, a, b, options, baseTolerance, {}, cachedObservations);
    if (result.span) {
      segments.push(result.span);
      error = Math.max(error, result.error * gain);
      bound = Math.max(bound, result.bound * gain);
    } else {
      const split = Math.max(a + 1, Math.min(b - 1, result.split));
      pending.push([a, split], [split, b]);
    }
  }
  segments.sort((a, b) => a.a - b.a);
  // A split chosen for a failed long fit need not remain a boundary once its
  // neighbors are fitted. Reconsider adjacent spans without crossing protected
  // keys; each accepted merge still passes the original continuous certificate.
  const merged: Span[] = [];
  for (const segment of segments) {
    merged.push(segment);
    while (merged.length > 1) {
      const right = merged.at(-1)!,
        left = merged.at(-2)!;
      if (pinned.has(right.a)) break;
      const result = fitSpan(
        curve,
        left.a,
        right.b,
        options,
        baseTolerance,
        {},
        cachedObservations,
      );
      if (!result.span) break;
      merged.splice(-2, 2, result.span);
    }
  }
  segments.splice(0, segments.length, ...merged);
  if (segments.length + 1 >= n) return { curve: cp(curve), error: 0, bound: 0 };
  const reduced: CurveKey[] = [cp(keys[0])];
  for (const segment of segments) {
    const start = reduced.at(-1)!,
      end = cp(keys[segment.b]);
    if (segment.b > segment.a + 1) {
      start.interpolation = segment.mode;
      start.right = segment.right;
      end.left = segment.left;
    }
    reduced.push(end);
  }
  const candidate = { ...cp(curve), keys: reduced };
  if (options.fit === 'baked') {
    error = observationError(curve, candidate) * gain;
    return error <= tolerance
      ? { curve: candidate, error, bound: error }
      : { curve: cp(curve), error: 0, bound: 0 };
  }
  // Recheck assembled neighbors too: freezing automatic handles, removing a
  // neighbor, or the evaluator's minimum handle width can affect those spans.
  let targetIndex = 0;
  error = 0;
  bound = 0;
  for (let i = 0; i < curve.keys.length - 1; i++) {
    while (candidate.keys[targetIndex + 1].frame <= curve.keys[i].frame) targetIndex++;
    if (primitive(curve.keys[i])) continue;
    const result = certify(points(curve, i), points(candidate, targetIndex), baseTolerance);
    if (!result.passed) return { curve: cp(curve), error: 0, bound: 0 };
    error = Math.max(error, result.peak * gain);
    bound = Math.max(bound, result.bound * gain);
  }
  return { curve: candidate, error, bound };
}

const rotation = (c: Channel) => ['rx', 'ry', 'rz', 'qx', 'qy', 'qz', 'qw'].includes(c);
const position = (c: Channel) => ['px', 'py', 'pz'].includes(c);
function times(track: Track, end: number) {
  const boundaries = [
      ...new Set([
        0,
        end,
        ...track.keys.map((k) => k.frame),
        ...Object.values(track.curves ?? {}).flatMap((c) => c!.keys.map((k) => k.frame)),
        ...track.spaces.map((k) => k.frame),
        ...(track.following ?? []).map((k) => k.frame),
      ]),
    ].sort((a, b) => a - b),
    out: number[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const a = boundaries[i],
      b = boundaries[i + 1],
      steps = Math.max(8, Math.ceil((b - a) * 8));
    for (let j = 0; j < steps; j++) out.push(a + ((b - a) * j) / steps);
    out.push(a + (b - a) * 0.38196601125);
  }
  out.push(boundaries.at(-1)!);
  return out;
}
function poseErrors(original: Track, next: Track, frames: number[]) {
  let position = 0,
    rotation = 0;
  for (const f of frames) {
    const a = sample(original, f),
      b = sample(next, f);
    position = Math.max(position, Math.hypot(...a.p.map((v, i) => (v - b.p[i]) * 100)));
    rotation = Math.max(
      rotation,
      (new Quaternion(...a.q).angleTo(new Quaternion(...b.q)) * 180) / Math.PI,
    );
  }
  return { position, rotation };
}
function prunePoseKeys(track: Track, protectedFrames: number[]) {
  const covered =
    (['px', 'py', 'pz'] as Channel[]).every((c) => track.curves?.[c]) &&
    (track.rotationMode === 'quaternion' ? ['qx', 'qy', 'qz', 'qw'] : ['rx', 'ry', 'rz']).every(
      (c) => track.curves?.[c as Channel],
    );
  if (!covered) return;
  const first = track.keys[0];
  if (
    track.keys.some(
      (k) =>
        k.layerPosition !== first.layerPosition ||
        (k.fov !== first.fov && !track.curves?.fov) ||
        k.grip.some(
          (v, i) =>
            v !== first.grip[i] &&
            !track.curves?.[(['thumb', 'index', 'middle', 'ring', 'pinky'] as Channel[])[i]],
        ),
    )
  )
    return;
  track.keys = track.keys.filter(
    (_, i, all) =>
      i === 0 ||
      i === all.length - 1 ||
      protectedFrames.some(
        (f) =>
          i === all.findIndex((k) => k.frame >= f) || i === all.findIndex((k) => k.frame >= f) - 1,
      ),
  );
}
export function reduceTrack(
  input: ReductionInput,
  options: ReductionOptions,
  end: number,
): ReductionResult {
  for (const v of [options.position, options.rotation, options.scalar])
    if (!Number.isFinite(v) || v <= 0) throw Error('Choose positive error tolerances.');
  if (
    options.fit === 'baked' &&
    options.drift !== undefined &&
    (!Number.isFinite(options.drift) || options.drift < 0 || options.drift > 10)
  )
    throw Error('Choose a drift threshold between 0 and 10 percent.');
  const original = input.track,
    next = cp(original),
    rows: ReductionRow[] = [],
    protectedFrames = [
      ...(input.protectedFrames ?? []),
      ...original.spaces.map((k) => k.frame),
      ...(original.following ?? []).map((k) => k.frame),
    ];
  const subframes = times(original, end);
  const observed = new Set([
    0,
    end,
    ...original.keys.map((key) => key.frame),
    ...Object.values(original.curves ?? {}).flatMap(
      (curve) => curve?.keys.map((key) => key.frame) ?? [],
    ),
    ...protectedFrames,
  ]);
  if (options.fit === 'baked') for (let frame = 0; frame <= end; frame++) observed.add(frame);
  const frames = options.fit === 'baked' ? [...observed].sort((a, b) => a - b) : subframes;
  const eulerRotationChannels = input.channels.filter((c) => ['rx', 'ry', 'rz'].includes(c)).length;
  const positionChannels = input.channels.filter((c) => ['px', 'py', 'pz'].includes(c)).length;
  const noiseHints: BlenderNoiseSettings[] = [];
  for (const channel of input.channels) {
    const source = readCurve(original, channel),
      tolerance = position(channel)
        ? options.position / Math.sqrt(Math.max(1, positionChannels))
        : channel.startsWith('q')
          ? Math.sin((options.rotation * Math.PI) / 180 / 4) / 2
          : rotation(channel)
            ? options.rotation / Math.max(1, eulerRotationChannels)
            : options.scalar;
    const result = reduceCurve(source, tolerance, options, protectedFrames, noiseHints),
      candidate = result.curve;
    const row: ReductionRow = {
      channel,
      before: source.keys.length,
      after: candidate.keys.length,
      error: result.error,
      bound: result.bound,
      tolerance,
      bezier: candidate.keys.filter((k) => k.interpolation === 'bezier').length,
      linear: candidate.keys.filter((k) => k.interpolation === 'linear').length,
      ...(result.noise ? { noise: result.noise } : {}),
    };
    if (candidate.keys.length < source.keys.length || result.noise) {
      next.curves ??= {};
      next.curves[channel] = candidate;
      const transformChannel = rotation(channel) || position(channel);
      const noiseNeedsTransformCheck = !!result.noise && transformChannel;
      if ((options.fit !== 'baked' || noiseNeedsTransformCheck) && transformChannel) {
        const error = poseErrors(original, next, frames);
        const subframeError = result.noise ? poseErrors(original, next, subframes) : error;
        if (
          error.position > options.position ||
          error.rotation > options.rotation ||
          subframeError.position > options.position ||
          subframeError.rotation > options.rotation
        ) {
          if (original.curves?.[channel]) next.curves[channel] = cp(original.curves[channel]!);
          else delete next.curves[channel];
          Object.assign(row, {
            after: row.before,
            error: 0,
            bound: 0,
            reason: 'Kept original: combined transform error exceeds tolerance',
          });
          delete row.noise;
        }
      }
    }
    if (row.noise) {
      const modifier = candidate.modifiers.find(
        (m) => m.type === 'noise' && m.algorithm === 'blender',
      );
      if (modifier?.type === 'noise') noiseHints.push(modifier);
    }
    rows.push(row);
  }
  // Original pose keys are a fallback for channels that have not been made explicit.
  // Remove redundant fallback keys only when every changing value has a curve.
  if (!options.range) prunePoseKeys(next, protectedFrames);
  const error = poseErrors(original, next, frames);
  const subframeError = options.fit === 'baked' ? poseErrors(original, next, subframes) : undefined;
  if (
    options.fit !== 'baked' &&
    (error.position > options.position || error.rotation > options.rotation)
  )
    throw Error(
      'The reduced track did not pass transform validation. Original keys are unchanged.',
    );
  if (!original.curves && next.curves && !Object.keys(next.curves).length) delete next.curves;
  return {
    id: input.id,
    label: input.label,
    track: next,
    rows,
    before: rows.reduce((n, r) => n + r.before, 0),
    after: rows.reduce((n, r) => n + r.after, 0),
    positionError: error.position,
    rotationError: error.rotation,
    ...(subframeError
      ? {
          subframePositionError: subframeError.position,
          subframeRotationError: subframeError.rotation,
        }
      : {}),
    changed: JSON.stringify(original) !== JSON.stringify(next),
  };
}
export function reductionChannels(id: ControlId, track: Track, axis?: Channel) {
  return axis ? [axis] : channelsFor(id, track);
}

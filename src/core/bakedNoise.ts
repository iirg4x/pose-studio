import { blenderNoise, blenderNoiseSampler } from './blenderNoise';
import type { BlenderNoiseSettings } from './blenderNoise';
import { sampleCurve } from './curves';
import type { Curve, CurveKey } from './curves';

/**
 * The reducer calls this module with a curve made from baked samples.  It is
 * deliberately independent of the importer and of authored F-Curve data: a
 * candidate is allowed to see only the frame/value pairs in `curve.keys`.
 *
 * Noise reconstruction is intentionally conservative.  A procedural model is
 * only returned after it beats a linear base by a wide margin and survives a
 * validation pass over every sample and every inter-sample midpoint.  Curves
 * that do not meet those checks return `null` and are reduced as ordinary
 * editable keys by the caller.
 */

export interface NoiseDetection {
  curve: Curve;
  error: number;
  bound: number;
  noise: {
    algorithm: 'blender';
    maxError: number;
    validationError: number;
  };
}

type Envelope = {
  rangeStart?: number;
  rangeEnd?: number;
  blendIn?: number;
  blendOut?: number;
};

type Candidate = Envelope & {
  period: number;
  phase: number;
  offset: number;
  depth: number;
  roughness: number;
  lacunarity: number;
  legacy?: boolean;
  fixedBase?: { intercept: number; slope: number };
};

type Fit = Candidate & {
  amplitude: number;
  intercept: number;
  slope: number;
  sse: number;
  maxError: number;
  source: 'modern' | 'legacy';
};

type Point = { frame: number; value: number };

// Re-analysis of identical observations must not repeat the global search.
// This bounded in-memory cache is not part of a project or modifier payload.
const fitCache = new Map<string, NoiseDetection | null>();
function remember(key: string, value: NoiseDetection | null) {
  if (fitCache.size >= 8) fitCache.delete(fitCache.keys().next().value!);
  fitCache.set(key, structuredClone(value));
  return value;
}
const EPS = 1e-12;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const finite = (v: number) => Number.isFinite(v);

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length & 1 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
}

/** Solve a three-column least-squares fit: y = intercept + slope*t + amplitude*n. */
function fitLinearNoise(
  points: Point[],
  noise: number[],
): {
  intercept: number;
  slope: number;
  amplitude: number;
  sse: number;
  maxError: number;
} | null {
  if (!points.length || points.length !== noise.length) return null;
  let s00 = 0,
    s01 = 0,
    s02 = 0,
    s11 = 0,
    s12 = 0,
    s22 = 0,
    b0 = 0,
    b1 = 0,
    b2 = 0;
  for (let i = 0; i < points.length; i++) {
    const t = points[i].frame,
      n = noise[i],
      y = points[i].value;
    if (![t, n, y].every(finite)) return null;
    s00++;
    s01 += t;
    s02 += n;
    s11 += t * t;
    s12 += t * n;
    s22 += n * n;
    b0 += y;
    b1 += t * y;
    b2 += n * y;
  }
  const a00 = s00,
    a01 = s01,
    a02 = s02,
    a10 = s01,
    a11 = s11,
    a12 = s12,
    a20 = s02,
    a21 = s12,
    a22 = s22,
    det =
      a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
  if (Math.abs(det) <= EPS * Math.max(1, Math.abs(a00 * a11 * a22))) return null;
  const det0 =
      b0 * (a11 * a22 - a12 * a21) - a01 * (b1 * a22 - a12 * b2) + a02 * (b1 * a21 - a11 * b2),
    det1 = a00 * (b1 * a22 - a12 * b2) - b0 * (a10 * a22 - a12 * a20) + a02 * (a10 * b2 - b1 * a20),
    det2 = a00 * (a11 * b2 - b1 * a21) - a01 * (a10 * b2 - b1 * a20) + b0 * (a10 * a21 - a11 * a20),
    intercept = det0 / det,
    slope = det1 / det,
    amplitude = det2 / det;
  if (![intercept, slope, amplitude].every(finite)) return null;
  let sse = 0,
    maxError = 0;
  for (let i = 0; i < points.length; i++) {
    const error = points[i].value - (intercept + slope * points[i].frame + amplitude * noise[i]);
    if (!finite(error)) return null;
    sse += error * error;
    maxError = Math.max(maxError, Math.abs(error));
  }
  return { intercept, slope, amplitude, sse, maxError };
}

function noiseAt(frame: number, candidate: Candidate): number {
  return blenderNoise(frame, candidate as BlenderNoiseSettings);
}

function evaluateCandidate(candidate: Candidate, points: Point[], source: 'modern' | 'legacy') {
  const sampler = blenderNoiseSampler(candidate);
  const n = points.map((point) => sampler(point.frame));
  let fit;
  if (candidate.fixedBase) {
    const { intercept, slope } = candidate.fixedBase;
    let numerator = 0,
      denominator = 0;
    for (let i = 0; i < points.length; i++) {
      numerator += n[i] * (points[i].value - intercept - slope * points[i].frame);
      denominator += n[i] * n[i];
    }
    if (denominator < EPS) return null;
    const amplitude = numerator / denominator;
    const errors = points.map((p, i) => p.value - intercept - slope * p.frame - amplitude * n[i]);
    fit = {
      intercept,
      slope,
      amplitude,
      sse: errors.reduce((s, v) => s + v * v, 0),
      maxError: Math.max(...errors.map(Math.abs)),
    };
  } else fit = fitLinearNoise(points, n);
  if (!fit) return null;
  return { ...candidate, ...fit, source } satisfies Fit;
}

function sortFits(fits: Fit[], limit: number) {
  fits.sort((a, b) => a.sse - b.sse || a.period - b.period || a.phase - b.phase);
  const out: Fit[] = [];
  for (const fit of fits) {
    // Keep locally distinct seeds so all the refinements do not collapse onto
    // one equivalent point in the Perlin field.
    if (
      out.every(
        (other) =>
          Math.abs(Math.log(fit.period / other.period)) > 0.02 ||
          Math.abs(fit.phase - other.phase) > 1 ||
          Math.abs(fit.offset - other.offset) > 0.02 * fit.period,
      )
    )
      out.push(fit);
    if (out.length >= limit) break;
  }
  return out;
}

function refine(
  seed: Fit,
  points: Point[],
  _span: number,
  minPeriod: number,
  maxPeriod: number,
  source: 'modern' | 'legacy',
  freeOffset = false,
  freezeShape = false,
) {
  const latentPhase = seed.legacy ? (seed.phase + 1) / seed.period : seed.phase;
  const detail = seed.depth > 0 && !seed.legacy && !freezeShape;
  const initial = [
    Math.log(seed.period),
    latentPhase,
    ...(freeOffset ? [seed.offset / seed.period] : []),
    ...(detail ? [seed.roughness, seed.lacunarity] : []),
  ];
  const frequency = freezeShape ? 1 : Math.pow(seed.lacunarity, Math.max(0, seed.depth - 1));
  const steps = [
    0.035 / Math.sqrt(frequency),
    0.17 / frequency,
    0.08 / frequency,
    0.15,
    0.1 / Math.max(1, seed.depth * Math.abs(seed.phase) * frequency),
  ];
  const bounds = (p: number[]) =>
    p.map((v, i) =>
      i === 0
        ? clamp(v, Math.log(minPeriod), Math.log(maxPeriod))
        : i === 1
          ? clamp(v, -256, 256)
          : i === 2
            ? clamp(v, -8, 8)
            : i === 3
              ? clamp(v, 0, 4)
              : clamp(v, 1.1, 4),
    );
  const candidate = (p: number[]): Candidate => {
    const period = Math.exp(p[0]);
    return {
      ...seed,
      period,
      phase: source === 'legacy' ? p[1] * period - 1 : p[1],
      offset: freeOffset ? p[2] * period : 0,
      ...(detail ? { roughness: p[3], lacunarity: p[4] } : {}),
    };
  };
  const evaluate = (p: number[]) => ({
    p: bounds(p),
    fit: evaluateCandidate(candidate(bounds(p)), points, source),
  });
  const simplex = [
    evaluate(initial),
    ...initial.map((_, i) => evaluate(initial.map((v, j) => v + (i === j ? steps[i] : 0)))),
  ];
  const score = (v: { fit: Fit | null }) => v.fit?.sse ?? Infinity;
  for (let iteration = 0; iteration < (detail ? 400 : 200); iteration++) {
    simplex.sort((a, b) => score(a) - score(b));
    const n = initial.length,
      best = simplex[0],
      worst = simplex[n];
    const center = initial.map(
      (_, axis) => simplex.slice(0, n).reduce((s, v) => s + v.p[axis], 0) / n,
    );
    const trial = (factor: number) => evaluate(center.map((v, i) => v + factor * (v - worst.p[i])));
    const reflected = trial(1);
    if (score(reflected) < score(best)) {
      const expanded = trial(2);
      simplex[n] = score(expanded) < score(reflected) ? expanded : reflected;
    } else if (score(reflected) < score(simplex[n - 1])) simplex[n] = reflected;
    else {
      const outside = score(reflected) < score(worst);
      const contracted = trial(outside ? 0.5 : -0.5);
      if (score(contracted) < (outside ? score(reflected) : score(worst))) simplex[n] = contracted;
      else
        for (let i = 1; i <= n; i++)
          simplex[i] = evaluate(best.p.map((v, j) => v + (simplex[i].p[j] - v) * 0.5));
    }
  }
  simplex.sort((a, b) => score(a) - score(b));
  return simplex[0].fit;
}

function linearBase(points: Point[]) {
  if (!points.length) return null;
  let s0 = points.length,
    s1 = 0,
    s2 = 0,
    b0 = 0,
    b1 = 0;
  for (const point of points) {
    s1 += point.frame;
    s2 += point.frame * point.frame;
    b0 += point.value;
    b1 += point.frame * point.value;
  }
  const det = s0 * s2 - s1 * s1;
  if (Math.abs(det) <= EPS) return null;
  const intercept = (b0 * s2 - s1 * b1) / det,
    slope = (s0 * b1 - s1 * b0) / det;
  if (![intercept, slope].every(finite)) return null;
  let sse = 0,
    maxError = 0;
  for (const point of points) {
    const error = point.value - (intercept + slope * point.frame);
    sse += error * error;
    maxError = Math.max(maxError, Math.abs(error));
  }
  return { intercept, slope, amplitude: 0, sse, maxError };
}

function secondDifference(values: number[], dt: number) {
  return values.slice(1, -1).map((value, i) => (values[i + 2] - 2 * value + values[i]) / (dt * dt));
}

/**
 * Infer blend widths from edge impulses.  The source noise has no metadata in
 * this stage; the only signal used here is a local second-difference peak
 * relative to its nearby median.  This also gives useful candidates for
 * interior, windowed noise without baking in a particular source range.
 */
function inferBlendWidths(points: Point[], residual: number[], dt: number) {
  const span = points.at(-1)!.frame - points[0].frame;
  const d2 = secondDifference(residual, dt);
  const impulses = d2.map((v, i) =>
    i > 0 && i < d2.length - 1 ? Math.abs(v - (d2[i - 1] + d2[i + 1]) / 2) : 0,
  );
  const floor = median(impulses),
    peak = Math.max(...impulses, 0);
  const threshold = Math.max(floor * 8, peak * 0.01, EPS);
  const peaks = impulses
    .map((prominence, i) => ({ frame: points[i + 1].frame, prominence, i }))
    .filter(
      (p) =>
        p.prominence > threshold &&
        p.i > 0 &&
        p.i < impulses.length - 1 &&
        p.prominence >= impulses[p.i - 1] &&
        p.prominence >= impulses[p.i + 1],
    )
    .sort((a, b) => b.prominence - a.prominence);
  const range = Math.max(...residual) - Math.min(...residual);
  const isBlendJoin = (p: (typeof peaks)[number], width: number) => {
    const i = p.i + 1;
    if (i < 2 || i > residual.length - 3 || width <= 0) return false;
    const leftSlope = (3 * residual[i] - 4 * residual[i - 1] + residual[i - 2]) / (2 * dt);
    const rightSlope = (-3 * residual[i] + 4 * residual[i + 1] - residual[i + 2]) / (2 * dt);
    // A linear influence fade has a diagnostic first-derivative jump:
    // deltaSlope * blendWidth = -noiseValue at either inner join.
    // Ordinary smooth Bezier joins do not satisfy that relation.
    return (
      Math.abs((rightSlope - leftSlope) * width + residual[i]) <=
      Math.max(range * 0.025, Math.abs(residual[i]) * 0.15, EPS)
    );
  };
  const left = peaks.find(
    (p) => p.frame - points[0].frame < span * 0.45 && isBlendJoin(p, p.frame - points[0].frame),
  );
  const right = peaks.find(
    (p) =>
      points.at(-1)!.frame - p.frame < span * 0.45 &&
      isBlendJoin(p, points.at(-1)!.frame - p.frame),
  );
  return {
    leftWidth: left ? left.frame - points[0].frame : undefined,
    rightWidth: right ? points.at(-1)!.frame - right.frame : undefined,
    widths: [],
    strong: !!left && !!right,
  };
}

function envelopeCandidates(points: Point[], _residual: number[], dt: number): Envelope[] {
  const first = points[0],
    last = points.at(-1)!;
  const span = last.frame - first.frame;
  const slope = (last.value - first.value) / span;
  const residual = points.map((p) => p.value - first.value - slope * (p.frame - first.frame));
  const range = Math.max(...residual) - Math.min(...residual);
  // Flat/linear tails reveal an interior influence window independently of its
  // blend widths. Do not confuse the window start with the end of its fade.
  const floor = Math.max(
    EPS,
    range * 1e-6,
    Math.max(...points.map((p) => Math.abs(p.value))) * 1e-9,
  );
  const active = residual.map((v, i) => (Math.abs(v) > floor ? i : -1)).filter((i) => i >= 0);
  const startIndex = active.length && active[0] > 1 ? active[0] - 1 : 0;
  const endIndex =
    active.length && active.at(-1)! < points.length - 2 ? active.at(-1)! + 1 : points.length - 1;
  const section = points.slice(startIndex, endIndex + 1);
  const inferred = inferBlendWidths(section, residual.slice(startIndex, endIndex + 1), dt);
  const candidates: Envelope[] = [{}];
  if (!inferred.strong) return candidates;
  const rangeStart = section[0].frame,
    rangeEnd = section.at(-1)!.frame;
  const widths: [number, number][] = [
    [inferred.leftWidth!, inferred.rightWidth!],
    [inferred.leftWidth!, inferred.leftWidth!],
    [inferred.rightWidth!, inferred.rightWidth!],
    [(rangeEnd - rangeStart) * 0.1, (rangeEnd - rangeStart) * 0.1],
    [0, 0],
  ];
  for (const [blendIn, blendOut] of widths) {
    const value = { rangeStart, rangeEnd, blendIn, blendOut };
    if (!candidates.some((c) => JSON.stringify(c) === JSON.stringify(value)))
      candidates.push(value);
  }
  return candidates;
}

function sampleIndices(points: Point[], limit = 65) {
  const eligible = points.map((_, i) => i).filter((i) => i % 5 !== 0);
  if (eligible.length <= limit) return eligible;
  const selected: number[] = [];
  for (let i = 0; i < limit; i++) {
    const index = eligible[Math.round((i * (eligible.length - 1)) / (limit - 1))];
    if (!selected.includes(index)) selected.push(index);
  }
  return selected;
}

function gridSearch(
  points: Point[],
  envelopes: Envelope[],
  _span: number,
  minPeriod: number,
  maxPeriod: number,
  source: 'modern' | 'legacy',
  shape: { depth: number; roughness: number; lacunarity: number },
) {
  const train = sampleIndices(points).map((i) => points[i]);
  const coarse = sampleIndices(points, 33).map((i) => points[i]);
  const fits: Fit[] = [],
    common = new Map<number, Fit>();
  const first = points[0],
    last = points.at(-1)!;
  const slope = (last.value - first.value) / (last.frame - first.frame);
  const fixedBase = { intercept: first.value - slope * first.frame, slope };
  const periods = Array.from({ length: 49 }, (_, i) =>
    Math.exp(Math.log(minPeriod) + (i * Math.log(maxPeriod / minPeriod)) / 48),
  );
  for (const envelope of envelopes.slice(0, 2))
    for (const period of periods)
      for (let cell = -16; cell <= 16; cell++)
        for (const fraction of [0, 0.25, 0.5, 0.75])
          for (const offsetFraction of Array.from({ length: 17 }, (_, i) => (i - 8) * 0.5)) {
            const phase = source === 'legacy' ? (cell + fraction) * period - 1 : cell + fraction;
            const constrained =
              envelope.rangeStart !== undefined &&
              (envelope.rangeStart > first.frame || !!envelope.blendIn) &&
              (envelope.rangeEnd! < last.frame || !!envelope.blendOut);
            const fit = evaluateCandidate(
              {
                ...envelope,
                period,
                phase,
                offset: offsetFraction * period,
                ...shape,
                ...(constrained ? { fixedBase } : {}),
                ...(source === 'legacy' ? { legacy: true } : {}),
              },
              coarse,
              source,
            );
            if (!fit) continue;
            fits.push(fit);
            if (fits.length >= 256) {
              fits.sort((a, b) => a.sse - b.sse);
              fits.length = 64;
            }
            const key = (cell + fraction) * 2;
            if (
              (envelope.rangeStart !== undefined || envelopes.length === 1) &&
              (!common.has(key) || fit.sse < common.get(key)!.sse)
            )
              common.set(key, fit);
          }
  const seeds = [...sortFits(fits, 16), ...common.values()];
  const stage = seeds
    .map((seed) => refine(seed, coarse, _span, minPeriod, maxPeriod, source, true, true))
    .filter((fit): fit is Fit => !!fit);
  // Promote multiple distinct basins to the full, independently reserved
  // training set. Both candidate and refinement counts are fixed and bounded.
  return { train, seeds: sortFits(stage, 48) };
}

function makeCurve(curve: Curve, fit: Fit, firstFrame: number, lastFrame: number): Curve {
  const base = (frame: number) => fit.intercept + fit.slope * frame;
  const keys: CurveKey[] = [
    {
      ...curve.keys[0],
      frame: firstFrame,
      value: base(firstFrame),
      interpolation: 'linear',
      handle: 'free',
      left: undefined,
      right: undefined,
    },
    {
      ...curve.keys.at(-1)!,
      frame: lastFrame,
      value: base(lastFrame),
      interpolation: 'linear',
      handle: 'free',
      left: undefined,
      right: undefined,
    },
  ];
  const modifier = {
    id: 'reconstructed-noise',
    type: 'noise' as const,
    enabled: true,
    algorithm: 'blender' as const,
    amplitude: fit.amplitude,
    period: fit.period,
    phase: fit.phase,
    seed: 0,
    offset: fit.offset,
    depth: fit.depth,
    roughness: fit.roughness,
    lacunarity: fit.lacunarity,
    ...(fit.rangeStart !== undefined
      ? {
          rangeStart: fit.rangeStart,
          rangeEnd: fit.rangeEnd,
          blendIn: fit.blendIn,
          blendOut: fit.blendOut,
        }
      : {}),
    ...(fit.legacy ? { legacy: true } : {}),
  } as Curve['modifiers'][number];
  return {
    ...(curve.keyLock !== undefined ? { keyLock: curve.keyLock } : {}),
    keys,
    modifiers: [modifier],
  };
}

function countMeaningfulTurns(values: number[], tolerance: number) {
  const step = Math.max(1, Math.floor(values.length / 64));
  const sampled = values.filter((_, index) => index % step === 0);
  if (sampled.at(-1) !== values.at(-1)) sampled.push(values.at(-1)!);
  const scale = Math.max(tolerance * 2, (Math.max(...sampled) - Math.min(...sampled)) * 0.02);
  let direction = 0,
    extremum = sampled[0],
    anchor = sampled[0],
    turns = 0;
  for (const value of sampled.slice(1)) {
    if (!direction) {
      if (Math.abs(value - anchor) > scale) {
        direction = Math.sign(value - anchor);
        extremum = value;
      }
    } else if (direction > 0) {
      extremum = Math.max(extremum, value);
      if (extremum - value > scale) {
        direction = -1;
        extremum = value;
        turns++;
      }
    } else {
      extremum = Math.min(extremum, value);
      if (value - extremum > scale) {
        direction = 1;
        extremum = value;
        turns++;
      }
    }
  }
  return turns;
}

function hasPolynomialNoiseStructure(points: Point[]) {
  // Along time, modern Perlin is piecewise degree six (degree seven while
  // linearly faded); the legacy field has an even lower polynomial degree.
  // Away from lattice joins, eighth differences should be roundoff-sized.
  // This rejects analytic harmonic motion before the expensive inverse search.
  let differences = points.map((p) => p.value);
  for (let order = 0; order < 8; order++)
    differences = differences.slice(1).map((v, i) => v - differences[i]);
  const values = points.map((p) => p.value);
  const roundoff = Math.max(
    EPS,
    Math.max(...values.map(Math.abs)) * 1e-5 + (Math.max(...values) - Math.min(...values)) * 1e-5,
  );
  return differences.filter((v) => Math.abs(v) <= roundoff).length / differences.length >= 0.65;
}

function validate(
  source: Curve,
  candidate: Fit,
  tolerance: number,
  baseSse: number,
  signalRange: number,
) {
  const result = makeCurve(source, candidate, source.keys[0].frame, source.keys.at(-1)!.frame);
  const frames: number[] = [];
  for (let i = 0; i < source.keys.length; i++) frames.push(source.keys[i].frame);
  for (let i = 0; i < source.keys.length - 1; i++)
    frames.push((source.keys[i].frame + source.keys[i + 1].frame) / 2);
  frames.sort((a, b) => a - b);
  let maxError = 0,
    sumSquared = 0,
    heldoutError = 0;
  for (const frame of frames) {
    const target = sampleCurve(source, frame),
      actual = sampleCurve(result, frame),
      error = Math.abs(actual - target);
    if (!finite(error)) return null;
    maxError = Math.max(maxError, error);
    sumSquared += error * error;
  }
  for (let i = 0; i < source.keys.length; i += 5) {
    const frame = source.keys[i].frame;
    heldoutError = Math.max(
      heldoutError,
      Math.abs(sampleCurve(result, frame) - source.keys[i].value),
    );
  }
  const validationError = Math.max(heldoutError, maxError),
    rms = Math.sqrt(sumSquared / frames.length),
    relative = rms / Math.max(signalRange, tolerance * 4, EPS),
    improvement = baseSse > EPS ? 1 - candidate.sse / baseSse : 0;
  if (maxError > tolerance || validationError > tolerance || relative > 0.012 || improvement < 0.9)
    return null;
  return { result, maxError, validationError, rms, relative, improvement };
}

function trySource(
  points: Point[],
  tolerance: number,
  source: 'modern' | 'legacy',
  envelope: Envelope[],
  _baseSse: number,
  signalRange: number,
  minPeriod: number,
  maxPeriod: number,
) {
  const span = points.at(-1)!.frame - points[0].frame;
  const shapes =
    source === 'legacy'
      ? [
          { depth: 0, roughness: 0.5, lacunarity: 2 },
          { depth: 1, roughness: 0.5, lacunarity: 2 },
          { depth: 2, roughness: 0.5, lacunarity: 2 },
        ]
      : [
          { depth: 0, roughness: 0.5, lacunarity: 2 },
          { depth: 1, roughness: 0.5, lacunarity: 2 },
          { depth: 1, roughness: 1.5, lacunarity: 2 },
          { depth: 2, roughness: 0.5, lacunarity: 2 },
          { depth: 2, roughness: 1.5, lacunarity: 2 },
          { depth: 2, roughness: 0.5, lacunarity: 1.75 },
          { depth: 2, roughness: 0.5, lacunarity: 2.25 },
          { depth: 3, roughness: 0.5, lacunarity: 2 },
          { depth: 3, roughness: 1.5, lacunarity: 2 },
        ];
  const sourceCurve = pointsToCurve(points);
  for (const shape of shapes) {
    const searched = gridSearch(points, envelope, span, minPeriod, maxPeriod, source, shape);
    const trainBaseSse = linearBase(searched.train)?.sse ?? _baseSse;
    const refined = searched.seeds
      .map((seed) => refine(seed, searched.train, span, minPeriod, maxPeriod, source, true))
      .filter((fit): fit is Fit => !!fit)
      .sort((a, b) => a.sse - b.sse);
    for (const fit of refined) {
      // A lower training SSE must never displace another model that satisfies
      // the all-sample error limit. Validate candidates independently.
      if (fit.sse > tolerance * tolerance * searched.train.length) continue;
      const hasEnvelope = fit.rangeStart !== undefined && envelope.length > 1;
      if (
        !hasEnvelope &&
        countMeaningfulTurns(
          points.map((p) => fit.amplitude * noiseAt(p.frame, fit)),
          tolerance,
        ) < 2
      )
        continue;
      const validated = validate(sourceCurve, fit, tolerance, trainBaseSse, signalRange);
      if (validated) return validated;
    }
  }
  return null;
}

/** Previously validated models from neighbouring baked channels are starting
 * points only. No source observations or authored metadata are borrowed. */
function tryRelated(
  points: Point[],
  tolerance: number,
  envelopes: Envelope[],
  signalRange: number,
  minPeriod: number,
  maxPeriod: number,
  related: readonly BlenderNoiseSettings[],
) {
  const train = sampleIndices(points).map((i) => points[i]);
  const first = points[0],
    last = points.at(-1)!,
    span = last.frame - first.frame;
  const slope = (last.value - first.value) / span;
  const fixedBase = { intercept: first.value - slope * first.frame, slope };
  const periods = Array.from({ length: 65 }, (_, i) =>
    Math.exp(Math.log(minPeriod) + (i * Math.log(maxPeriod / minPeriod)) / 64),
  );
  const seeds: Fit[] = [];
  for (const hint of related.slice(-8))
    for (const envelope of envelopes.slice(0, 2))
      for (const depth of [
        ...new Set([
          hint.depth ?? 0,
          Math.max(0, (hint.depth ?? 0) - 1),
          Math.min(3, (hint.depth ?? 0) + 1),
        ]),
      ])
        for (const period of [...periods, hint.period]) {
          const constrained =
            envelope.rangeStart !== undefined &&
            (envelope.rangeStart > first.frame || !!envelope.blendIn) &&
            (envelope.rangeEnd! < last.frame || !!envelope.blendOut);
          const fit = evaluateCandidate(
            {
              ...envelope,
              period,
              phase: hint.phase,
              offset: hint.offset ?? 0,
              depth,
              roughness: hint.roughness ?? 0.5,
              lacunarity: hint.lacunarity ?? 2,
              ...(hint.legacy ? { legacy: true } : {}),
              ...(constrained ? { fixedBase } : {}),
            },
            train,
            hint.legacy ? 'legacy' : 'modern',
          );
          if (fit) seeds.push(fit);
        }
  const stage = sortFits(seeds, 32)
    .map((seed) => refine(seed, train, span, minPeriod, maxPeriod, seed.source, true, true))
    .filter((f): f is Fit => !!f);
  const sourceCurve = pointsToCurve(points),
    baseSse = linearBase(train)?.sse ?? 0;
  for (const seed of sortFits(stage, 16)) {
    const fit = refine(seed, train, span, minPeriod, maxPeriod, seed.source, true);
    if (!fit || fit.sse > tolerance * tolerance * train.length) continue;
    const result = validate(sourceCurve, fit, tolerance, baseSse, signalRange);
    if (result) return result;
  }
  return null;
}

function pointsToCurve(points: Point[]): Curve {
  return {
    keys: points.map((point) => ({
      frame: point.frame,
      value: point.value,
      interpolation: 'linear' as const,
      handle: 'free' as const,
    })),
    modifiers: [],
  };
}

/**
 * Detect one additive Blender Noise modifier from a dense baked curve.
 * Returns `null` when the samples are not sufficiently diagnostic; callers
 * should then keep their normal key-based reduction path.
 */
export function detectNoise(
  curve: Curve,
  tolerance: number,
  related: readonly BlenderNoiseSettings[] = [],
): NoiseDetection | null {
  if (!curve || !Array.isArray(curve.keys) || curve.keys.length < 32 || curve.keys.length > 5000)
    return null;
  if (!finite(tolerance) || tolerance <= 0) return null;
  if (curve.modifiers.length || curve.loop || curve.keyLock) return null;
  const keys = curve.keys;
  if (
    keys.some((key) => !finite(key.frame) || !finite(key.value) || key.interpolation !== 'linear')
  )
    return null;
  const dt = keys[1].frame - keys[0].frame;
  if (
    !(dt > 0) ||
    keys.some(
      (key, i) => i && Math.abs(key.frame - keys[i - 1].frame - dt) > Math.max(1e-6, dt * 1e-4),
    )
  )
    return null;
  const points = keys.map((key) => ({ frame: key.frame, value: key.value }));
  const span = points.at(-1)!.frame - points[0].frame;
  if (!(span > dt * 8)) return null;
  const baseOnly = linearBase(points);
  if (!baseOnly) return null;
  const sourceRange =
    Math.max(...points.map((point) => point.value)) -
    Math.min(...points.map((point) => point.value));
  const baseResidual = points.map(
    (point) => point.value - (baseOnly!.intercept + baseOnly!.slope * point.frame),
  );
  const residualRange = Math.max(...baseResidual) - Math.min(...baseResidual);
  if (!(sourceRange > tolerance * 4) || !(residualRange > tolerance * 4)) return null;
  const baseSse = baseResidual.reduce((sum, value) => sum + value * value, 0);
  if (!(baseSse > tolerance * tolerance * points.length)) return null;
  const envelopes = envelopeCandidates(points, baseResidual, dt);
  if (envelopes.length === 1 && countMeaningfulTurns(baseResidual, tolerance) < 3) return null;
  const d2 = secondDifference(baseResidual, dt).map(Math.abs);
  if ((median(d2) * dt * dt) / residualRange > 0.03) return null;
  if (!hasPolynomialNoiseStructure(points)) return null;
  const minPeriod = Math.max(dt * 2, span / 32);
  const maxPeriod = Math.max(minPeriod * 2, span * 2);
  const fingerprint = JSON.stringify([tolerance, points, related]);
  if (fitCache.has(fingerprint)) return structuredClone(fitCache.get(fingerprint)!);
  // Legacy support is an opt-in evaluator extension.  Search the modern model
  // first and only spend the second bounded pass when it cannot validate; this
  // keeps normal reductions fast while still handling older Blender noise.
  let bestResult = related.length
    ? tryRelated(points, tolerance, envelopes, residualRange, minPeriod, maxPeriod, related)
    : null;
  if (!bestResult)
    bestResult = trySource(
      points,
      tolerance,
      'modern',
      envelopes,
      baseSse,
      residualRange,
      minPeriod,
      maxPeriod,
    );
  if (!bestResult)
    bestResult = trySource(
      points,
      tolerance,
      'legacy',
      envelopes,
      baseSse,
      residualRange,
      minPeriod,
      maxPeriod,
    );
  if (!bestResult) return remember(fingerprint, null);
  return remember(fingerprint, {
    curve: bestResult.result,
    error: bestResult.maxError,
    bound: bestResult.maxError,
    noise: {
      algorithm: 'blender',
      maxError: bestResult.maxError,
      validationError: bestResult.validationError,
    },
  });
}

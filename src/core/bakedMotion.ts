import { blenderInterpolationValue, motionProgress } from './interpolation';
import type {
  BounceSettings,
  ElasticSettings,
  EaseDirection,
  MotionMode,
  MotionOptions,
  SpringSettings,
} from './interpolation';
import type { Curve, CurveKey } from './curves';

/** A conservative inverse fit of one runtime motion segment from baked values. */
export interface MotionDetection {
  curve: Curve;
  error: number;
  bound: number;
  motion: {
    spring: number;
    bounce: number;
    elastic: number;
    maxError: number;
    validationError: number;
  };
}

type Point = { t: number; value: number };
type Span = { from: number; to: number };
type Shape =
  | { mode: 'spring'; easing: EaseDirection; spring: SpringSettings }
  | { mode: 'bounce'; easing: EaseDirection; bounce: BounceSettings }
  | {
      mode: 'elastic';
      easing: EaseDirection;
      elastic: ElasticSettings;
      begin: number;
      change: number;
      duration: number;
    };
type Fit = Shape & { sse: number; trainMax: number };
type Validated = Fit & { span: Span; maxError: number; validationError: number; rms: number };

const EPS = 1e-12;
const DIRECTIONS: EaseDirection[] = ['out', 'in', 'inOut'];
const ELASTIC_DIRECTIONS: EaseDirection[] = ['auto', 'out', 'in', 'inOut'];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: number) => Number.isFinite(value);

function settings(fit: Shape): MotionOptions {
  if (fit.mode === 'spring') return { spring: fit.spring, easing: fit.easing };
  if (fit.mode === 'bounce') return { bounce: fit.bounce, easing: fit.easing };
  return { elastic: fit.elastic, easing: fit.easing };
}

function progress(fit: Shape, t: number) {
  if (fit.mode !== 'elastic') return motionProgress(fit.mode, t, settings(fit));
  return blenderInterpolationValue(
    'elastic',
    t * fit.duration,
    fit.begin,
    fit.change,
    fit.duration,
    settings(fit),
  );
}

function training(points: Point[]) {
  // Endpoints are fixed by the curve representation. Every fifth interior
  // observation is kept out of parameter selection as an independent check.
  const available = points.filter(
    (_, index) => index > 0 && index < points.length - 1 && index % 5 !== 0,
  );
  if (available.length <= 97) return available;
  const selected: Point[] = [];
  for (let index = 0; index < 97; index++)
    selected.push(available[Math.round((index * (available.length - 1)) / 96)]);
  return selected;
}

function solveLinearDimension(
  mode: MotionMode,
  easing: EaseDirection,
  points: Point[],
  zero: MotionOptions,
  one: MotionOptions,
  limit: number,
) {
  let numerator = 0,
    denominator = 0;
  for (const point of points) {
    const base = motionProgress(mode, point.t, { ...zero, easing }),
      basis = motionProgress(mode, point.t, { ...one, easing }) - base;
    numerator += basis * (point.value - base);
    denominator += basis * basis;
  }
  return denominator > EPS ? clamp(numerator / denominator, 0, limit) : 0;
}

function score(shape: Shape, points: Point[]): Fit | null {
  let sse = 0,
    trainMax = 0;
  for (const point of points) {
    const error = progress(shape, point.t) - point.value;
    if (!finite(error)) return null;
    sse += error * error;
    trainMax = Math.max(trainMax, Math.abs(error));
  }
  return { ...shape, sse, trainMax };
}

function springFit(points: Point[], easing: EaseDirection, oscillations: number, damping: number) {
  const spring = { oscillations, damping, strength: 0 },
    strength = solveLinearDimension(
      'spring',
      easing,
      points,
      { spring },
      { spring: { ...spring, strength: 1 } },
      2,
    );
  return score({ mode: 'spring', easing, spring: { ...spring, strength } }, points);
}

function bounceFit(
  points: Point[],
  easing: EaseDirection,
  bounces: number,
  decay: number,
  impact: number,
) {
  const bounce = { bounces, decay, impact, height: 0 },
    height = solveLinearDimension(
      'bounce',
      easing,
      points,
      { bounce },
      { bounce: { ...bounce, height: 1 } },
      1,
    );
  return score({ mode: 'bounce', easing, bounce: { ...bounce, height } }, points);
}

function rawSpanPoints(keys: CurveKey[], span: Span) {
  const first = keys[span.from],
    last = keys[span.to],
    duration = last.frame - first.frame;
  return keys.slice(span.from, span.to + 1).map((key) => ({
    t: (key.frame - first.frame) / duration,
    value: key.value,
  }));
}

function elasticFit(
  points: Point[],
  easing: EaseDirection,
  begin: number,
  change: number,
  duration: number,
  amplitude: number,
  period: number,
) {
  return elasticScore(
    {
      mode: 'elastic',
      easing,
      elastic: { amplitude, period },
      begin,
      change,
      duration,
    },
    points,
  );
}

function elasticScore(shape: Extract<Shape, { mode: 'elastic' }>, points: Point[]): Fit | null {
  let sse = 0,
    trainMax = 0;
  for (const point of points) {
    const error = progress(shape, point.t) - point.value;
    if (!finite(error)) return null;
    sse += error * error;
    trainMax = Math.max(trainMax, Math.abs(error));
  }
  return { ...shape, sse, trainMax };
}

function residualExtrema(values: number[], band: number) {
  const extrema: { index: number; value: number }[] = [];
  for (let index = 1; index < values.length - 1; index++) {
    const value = values[index],
      left = values[index - 1],
      right = values[index + 1],
      maximum = value >= left && value >= right && (value > left || value > right),
      minimum = value <= left && value <= right && (value < left || value < right);
    if ((!maximum && !minimum) || Math.abs(value) <= band) continue;
    const previous = extrema.at(-1);
    // A baked plateau can report the same extremum on adjacent frames. Keep
    // the most prominent sample so the period estimate remains stable.
    if (previous && previous.value * value > 0) {
      if (Math.abs(value) > Math.abs(previous.value))
        ((previous.value = value), (previous.index = index));
    } else extrema.push({ index, value });
  }
  return extrema;
}

function decays(values: number[]) {
  if (values.length < 2) return false;
  const first = Math.abs(values[0]),
    last = Math.abs(values.at(-1)!);
  return last < first * 0.96 && Math.max(...values.slice(1).map(Math.abs)) < first * 1.8;
}

function symmetricLobes(extrema: { index: number; value: number }[], pointCount: number) {
  const midpoint = (pointCount - 1) / 2,
    left = extrema.filter((point) => point.index < midpoint),
    right = extrema.filter((point) => point.index > midpoint);
  if (left.length < 3 || right.length < 3) return false;
  const leftPeak = Math.max(...left.map((point) => Math.abs(point.value))),
    rightPeak = Math.max(...right.map((point) => Math.abs(point.value))),
    center = Math.min(leftPeak, rightPeak),
    leftEdge = Math.abs(left[0].value),
    rightEdge = Math.abs(right.at(-1)!.value);
  // InOut elastic has a pair of equally strong center lobes. Its envelope
  // grows toward the midpoint and decays symmetrically toward both holds,
  // unlike a single ordinary Bezier bump.
  return (
    center > 0 &&
    Math.abs(leftPeak - rightPeak) <= center * 0.28 &&
    leftEdge < center * 0.8 &&
    rightEdge < center * 0.8
  );
}

function elasticEvidence(points: Point[], band: number) {
  if (points.length < 12) return false;
  const first = points[0].value,
    last = points.at(-1)!.value,
    change = last - first,
    residuals = points.map((point) => point.value - (first + change * point.t)),
    peak = Math.max(...residuals.map(Math.abs));
  if (!(peak > band)) return false;
  const extrema = residualExtrema(residuals, band * 0.35),
    positive = extrema.some((point) => point.value > band),
    negative = extrema.some((point) => point.value < -band),
    tail = residuals.slice(Math.floor(residuals.length * 0.8));
  // A Blender elastic segment crosses the endpoint line. This rejects eased
  // bumps and ordinary Bezier arcs that only have one-sided drift.
  if (extrema.length < 2 || !positive || !negative) return false;
  if (Math.max(...tail.map(Math.abs)) > Math.max(band * 2, peak * 0.45)) return false;
  // A large endpoint change can dominate the residual line. In that case the
  // first lobe is not expected to be monotone in residual magnitude; signs and
  // a settled tail are the useful evidence. Equal-endpoint curves still need
  // the characteristic decaying oscillation in either time direction.
  if (Math.abs(change) > band * 4) return true;
  const magnitudes = extrema.map((point) => point.value);
  return (
    decays(magnitudes) ||
    decays(magnitudes.slice().reverse()) ||
    symmetricLobes(extrema, points.length)
  );
}

function elasticPeriods(points: Point[], duration: number, band: number) {
  const periods = new Set<number>();
  // Blender's common elastic period is often a fractional cycle count over
  // the authored span (for example 7.5 cycles over 96 frames gives 12.8
  // frames). Keep that seed in the bounded coarse pass so symmetric InOut
  // curves do not fall into a nearby period valley before refinement.
  for (const cycles of [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10, 12, 16]) {
    const period = duration / cycles;
    if (period >= 1.5 && period <= duration * 2) periods.add(period);
  }
  const extrema: number[] = [];
  const residuals = points.map(
    (point) => point.value - (points[0].value + (points.at(-1)!.value - points[0].value) * point.t),
  );
  for (let index = 1; index < residuals.length - 1; index++) {
    if (
      Math.abs(residuals[index]) > band * 0.35 &&
      (residuals[index] - residuals[index - 1]) * (residuals[index + 1] - residuals[index]) <= 0
    )
      extrema.push(points[index].t);
  }
  for (let index = 1; index < extrema.length; index++) {
    const period = (extrema[index] - extrema[index - 1]) * duration * 2;
    if (period >= 1.5 && period <= duration * 2) periods.add(period);
  }
  return [...periods].sort((a, b) => a - b).slice(0, 32);
}

function searchElastic(
  points: Point[],
  begin: number,
  change: number,
  duration: number,
  band: number,
) {
  const peak = Math.max(
      ...points.map((point) => Math.abs(point.value - (begin + change * point.t))),
    ),
    transition = Math.max(Math.abs(change), band),
    scale = Math.max(peak * 1.25, transition * 0.08, band * 2),
    amplitudes = [
      ...new Set([
        ...[0.02, 0.04, 0.06, 0.08, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.2].map(
          (factor) => transition * factor,
        ),
        ...[0.25, 0.4, 0.6, 0.8, 1, 1.25, 1.5, 2, 3].map((factor) => scale * factor),
      ]),
    ].filter((amplitude) => amplitude > 0 && amplitude <= Math.max(scale * 8, transition * 2)),
    periods = elasticPeriods(points, duration, band),
    coarse: (Fit | null)[] = [];
  for (const easing of ELASTIC_DIRECTIONS)
    for (const amplitude of amplitudes)
      for (const period of periods)
        coarse.push(elasticFit(points, easing, begin, change, duration, amplitude, period));
  const refined: Fit[] = [];
  for (const seed of bestSeeds(coarse, 6)) {
    if (seed.mode !== 'elastic') continue;
    let current: Extract<Fit, { mode: 'elastic' }> = seed,
      amplitudeStep = Math.max(current.elastic.amplitude * 0.35, band * 0.5),
      periodStep = Math.max(duration * 0.04, 0.25);
    for (let iteration = 0; iteration < 7; iteration++) {
      const candidates: (Fit | null)[] = [],
        amplitudes = [
          current.elastic.amplitude - amplitudeStep,
          current.elastic.amplitude,
          current.elastic.amplitude + amplitudeStep,
        ],
        periods = [
          current.elastic.period - periodStep,
          current.elastic.period,
          current.elastic.period + periodStep,
        ];
      // Search the small local amplitude/period grid together. Independent
      // coordinate steps can settle on the wrong valley for symmetric InOut
      // curves, where both parameters move slightly before the residual drops.
      for (const amplitude of amplitudes)
        for (const period of periods)
          if (
            amplitude > 0 &&
            amplitude <= Math.max(scale * 8, Math.abs(change) * 2) &&
            period >= 1.5 &&
            period <= duration * 2
          )
            candidates.push(
              elasticFit(points, current.easing, begin, change, duration, amplitude, period),
            );
      const next = bestSeeds(candidates, 1)[0];
      if (!next || next.mode !== 'elastic') break;
      current = next;
      amplitudeStep *= 0.5;
      periodStep *= 0.5;
    }
    refined.push(current);
  }
  return bestSeeds(refined, 4);
}

function bestSeeds(fits: (Fit | null)[], count: number) {
  return fits
    .filter((fit): fit is Fit => !!fit)
    .sort((a, b) => a.sse - b.sse || a.trainMax - b.trainMax)
    .slice(0, count);
}

function searchSpring(points: Point[]) {
  const coarse: (Fit | null)[] = [];
  for (const easing of DIRECTIONS)
    for (let oscillations = 0.5; oscillations <= 8; oscillations += 0.5)
      for (const damping of [0, 1, 2, 3, 4, 6, 8, 11, 15, 20])
        coarse.push(springFit(points, easing, oscillations, damping));
  const refined: Fit[] = [];
  for (const seed of bestSeeds(coarse, 8)) {
    let current = seed,
      oscillationStep = 0.25,
      dampingStep = 1;
    for (let iteration = 0; iteration < 6; iteration++) {
      const candidates: (Fit | null)[] = [current];
      if (current.mode !== 'spring') continue;
      for (const oscillations of [
        current.spring.oscillations - oscillationStep,
        current.spring.oscillations + oscillationStep,
      ])
        if (oscillations >= 0.5 && oscillations <= 8)
          candidates.push(springFit(points, current.easing, oscillations, current.spring.damping));
      for (const damping of [
        current.spring.damping - dampingStep,
        current.spring.damping + dampingStep,
      ])
        if (damping >= 0 && damping <= 20)
          candidates.push(springFit(points, current.easing, current.spring.oscillations, damping));
      current = bestSeeds(candidates, 1)[0];
      oscillationStep /= 2;
      dampingStep /= 2;
    }
    refined.push(current);
  }
  return bestSeeds(refined, 4);
}

function searchBounce(points: Point[]) {
  const coarse: (Fit | null)[] = [];
  for (const easing of DIRECTIONS)
    for (let bounces = 1; bounces <= 8; bounces++)
      for (const decay of [0.1, 0.25, 0.4, 0.5, 0.55, 0.6, 0.7, 0.85, 0.95])
        for (const impact of [0.1, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8])
          coarse.push(bounceFit(points, easing, bounces, decay, impact));
  const refined: Fit[] = [];
  for (const seed of bestSeeds(coarse, 8)) {
    let current = seed,
      decayStep = 0.05,
      impactStep = 0.05;
    for (let iteration = 0; iteration < 6; iteration++) {
      const candidates: (Fit | null)[] = [current];
      if (current.mode !== 'bounce') continue;
      for (const decay of [current.bounce.decay - decayStep, current.bounce.decay + decayStep])
        if (decay >= 0.1 && decay <= 0.95)
          candidates.push(
            bounceFit(points, current.easing, current.bounce.bounces, decay, current.bounce.impact),
          );
      for (const impact of [current.bounce.impact - impactStep, current.bounce.impact + impactStep])
        if (impact >= 0.1 && impact <= 0.8)
          candidates.push(
            bounceFit(points, current.easing, current.bounce.bounces, current.bounce.decay, impact),
          );
      current = bestSeeds(candidates, 1)[0];
      decayStep /= 2;
      impactStep /= 2;
    }
    refined.push(current);
  }
  return bestSeeds(refined, 4);
}

function observedAt(points: Point[], t: number) {
  if (t <= 0) return points[0].value;
  if (t >= 1) return points.at(-1)!.value;
  let low = 0,
    high = points.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (points[middle].t <= t) low = middle;
    else high = middle;
  }
  const a = points[low],
    b = points[high],
    u = (t - a.t) / (b.t - a.t);
  return a.value + (b.value - a.value) * u;
}

function targetCrossings(values: number[], band: number) {
  let side = 0,
    crossings = 0;
  for (const value of values) {
    const next = value > 1 + band ? 1 : value < 1 - band ? -1 : 0;
    if (!next) continue;
    if (side && next !== side) crossings++;
    side = next;
  }
  return crossings;
}

function outsideExcursions(values: number[], band: number) {
  const excursions: number[] = [];
  for (let index = 1; index < values.length - 1; index++) {
    const value = values[index],
      left = values[index - 1],
      right = values[index + 1];
    if (value >= left && value > right && value > 1 + band) excursions.push(value - 1);
    else if (value <= left && value < right && value < -band) excursions.push(-value);
  }
  return excursions;
}

function decayingExcursions(values: number[], band: number) {
  const excursions = outsideExcursions(values, band);
  return excursions.length < 3 || excursions.at(-1)! < excursions[0] * 0.85;
}

function decreasingValleys(values: number[], band: number) {
  const depths: number[] = [];
  for (let index = 1; index < values.length - 1; index++) {
    const value = values[index];
    if (value < values[index - 1] && value <= values[index + 1] && value < 1 - band)
      depths.push(1 - value);
  }
  return (
    depths.length >= 2 &&
    depths[0] >= band &&
    depths[1] >= band * 0.45 &&
    depths[1] < depths[0] * 0.96
  );
}

function canonicalValues(values: number[], easing: EaseDirection) {
  if (easing === 'out') return values;
  if (easing === 'in')
    return values
      .slice()
      .reverse()
      .map((value) => 1 - value);
  return values.slice(Math.floor(values.length / 2)).map((value) => 2 * value - 1);
}

function springEvidence(values: number[], band: number) {
  const excursion = Math.max(0, Math.max(...values) - 1, -Math.min(...values));
  return (
    (excursion >= band || targetCrossings(values, band * 0.45) >= 2) &&
    decayingExcursions(values, band * 0.45)
  );
}

function cheapModes(points: Point[], band: number) {
  const values = points.map((point) => point.value),
    directions = DIRECTIONS.map((easing) => canonicalValues(values, easing)),
    spring = directions.some((candidate) => springEvidence(candidate, band)),
    bounce = directions.some((candidate) => decreasingValleys(candidate, band));
  return { spring, bounce };
}

function springSignature(fit: Extract<Fit, { mode: 'spring' }>, points: Point[], band: number) {
  const observed = canonicalValues(
      points.map((point) => point.value),
      fit.easing,
    ),
    predicted = canonicalValues(
      points.map((point) => progress(fit, point.t)),
      fit.easing,
    ),
    excursion = (values: number[]) => Math.max(0, Math.max(...values) - 1, -Math.min(...values));
  return (
    decayingExcursions(observed, band * 0.45) &&
    ((excursion(observed) >= band && excursion(predicted) >= band) ||
      (targetCrossings(observed, band * 0.45) >= 2 && targetCrossings(predicted, band * 0.45) >= 2))
  );
}

function canonicalBounceSample(
  fit: Extract<Fit, { mode: 'bounce' }>,
  points: Point[],
  canonicalTime: number,
) {
  if (fit.easing === 'out') return observedAt(points, canonicalTime);
  if (fit.easing === 'in') return 1 - observedAt(points, 1 - canonicalTime);
  return 2 * observedAt(points, 0.5 + canonicalTime / 2) - 1;
}

function bounceCriticalTimes(fit: Extract<Fit, { mode: 'bounce' }>) {
  const durations = Array.from(
      { length: fit.bounce.bounces },
      (_, index) => Math.sqrt(fit.bounce.decay) ** index,
    ),
    total = durations.reduce((sum, duration) => sum + duration, 0),
    times = [fit.bounce.impact];
  let start = fit.bounce.impact;
  for (const weight of durations) {
    const duration = ((0.98 - fit.bounce.impact) * weight) / total;
    times.push(start + duration / 2, start + duration);
    start += duration;
  }
  times.push(0.98);
  return times;
}

function bounceSignature(fit: Extract<Fit, { mode: 'bounce' }>, points: Point[], band: number) {
  if (fit.bounce.bounces < 2 || fit.bounce.height < band) return false;
  const durations = Array.from(
      { length: fit.bounce.bounces },
      (_, index) => Math.sqrt(fit.bounce.decay) ** index,
    ),
    total = durations.reduce((sum, duration) => sum + duration, 0),
    sampleSpacing = (1 / (points.length - 1)) * (fit.easing === 'inOut' ? 2 : 1);
  let start = fit.bounce.impact;
  const depths: number[] = [];
  for (let index = 0; index < Math.min(3, durations.length); index++) {
    const duration = ((0.98 - fit.bounce.impact) * durations[index]) / total;
    if (duration < sampleSpacing * 1.5) break;
    const value = canonicalBounceSample(fit, points, start + duration / 2);
    depths.push(1 - value);
    start += duration;
  }
  if (depths.length < 2 || depths[0] < band || depths[1] < band * 0.45) return false;
  for (let index = 1; index < depths.length; index++)
    if (!(depths[index] > 0 && depths[index] < depths[index - 1] * 0.96)) return false;
  // The observed bake must include samples on both sides of the first impact.
  return fit.bounce.impact > sampleSpacing && fit.bounce.impact < 1 - sampleSpacing;
}

function criticalTimes(fit: Fit) {
  if (fit.mode !== 'bounce') return [];
  const canonical = bounceCriticalTimes(fit);
  if (fit.easing === 'out') return canonical;
  if (fit.easing === 'in') return canonical.map((time) => 1 - time);
  return canonical.flatMap((time) => [0.5 - time / 2, 0.5 + time / 2]);
}

function validate(
  fit: Extract<Fit, { mode: 'spring' | 'bounce' }>,
  points: Point[],
  span: Span,
  tolerance: number,
  magnitude: number,
): Validated | null {
  const allTimes = points.map((point) => point.t);
  for (let index = 0; index < points.length - 1; index++)
    allTimes.push((points[index].t + points[index + 1].t) / 2);
  allTimes.push(...criticalTimes(fit));
  let maxError = 0,
    validationError = 0,
    sumSquared = 0;
  for (let index = 0; index < points.length; index++) {
    const error = Math.abs(progress(fit, points[index].t) - points[index].value) * magnitude;
    if (!finite(error)) return null;
    maxError = Math.max(maxError, error);
  }
  for (const t of allTimes) {
    const error = Math.abs(progress(fit, t) - observedAt(points, t)) * magnitude;
    if (!finite(error)) return null;
    validationError = Math.max(validationError, error);
    sumSquared += error * error;
  }
  const rms = Math.sqrt(sumSquared / allTimes.length),
    relativeRms = rms / magnitude,
    relativeMax = validationError / magnitude,
    allowed = Math.min(tolerance, magnitude * 0.055),
    signatureBand = Math.max(0.025, (allowed / magnitude) * 1.25),
    linearSse = training(points).reduce((sum, point) => sum + (point.value - point.t) ** 2, 0),
    improvement = linearSse > EPS ? 1 - fit.sse / linearSse : 0,
    signature =
      fit.mode === 'spring'
        ? springSignature(fit, points, signatureBand)
        : bounceSignature(fit, points, signatureBand);
  if (
    validationError > allowed ||
    relativeRms > 0.018 ||
    relativeMax > 0.055 ||
    improvement < 0.85 ||
    !signature
  )
    return null;
  return { ...fit, span, maxError, validationError, rms };
}

function validateElastic(
  fit: Extract<Fit, { mode: 'elastic' }>,
  points: Point[],
  span: Span,
  tolerance: number,
  band: number,
): Validated | null {
  const allTimes = points.map((point) => point.t);
  for (let index = 0; index < points.length - 1; index++)
    allTimes.push((points[index].t + points[index + 1].t) / 2);
  let maxError = 0,
    validationError = 0,
    sumSquared = 0;
  for (const point of points) {
    const error = Math.abs(progress(fit, point.t) - point.value);
    if (!finite(error)) return null;
    maxError = Math.max(maxError, error);
  }
  for (const t of allTimes) {
    const error = Math.abs(progress(fit, t) - observedAt(points, t));
    if (!finite(error)) return null;
    validationError = Math.max(validationError, error);
    sumSquared += error * error;
  }
  const scale = Math.max(
      band * 2,
      ...points.map((point) => Math.abs(point.value - fit.begin)),
      Math.abs(fit.change),
      // Blender's InOut elastic curve exposes half of the absolute
      // amplitude in each lobe. Use the authored-unit amplitude as the
      // validation scale so its legitimate fractional-frame curvature is
      // not judged against only one lobe's observed height.
      Math.abs(fit.elastic.amplitude),
    ),
    rms = Math.sqrt(sumSquared / allTimes.length),
    relativeRms = rms / scale,
    relativeMax = validationError / scale,
    allowed = Math.min(tolerance, Math.max(band * 0.6, scale * 0.055)),
    residuals = points.map((point) => point.value - (fit.begin + fit.change * point.t)),
    linearSse = residuals.reduce((sum, value) => sum + value * value, 0),
    improvement = linearSse > EPS ? 1 - fit.sse / linearSse : 1;
  if (
    validationError > allowed ||
    relativeRms > 0.018 ||
    relativeMax > 0.055 ||
    improvement < 0.85 ||
    !elasticEvidence(points, band)
  )
    return null;
  return { ...fit, span, maxError, validationError, rms };
}

function spanPoints(keys: CurveKey[], span: Span) {
  const first = keys[span.from],
    last = keys[span.to],
    duration = last.frame - first.frame,
    delta = last.value - first.value;
  return keys.slice(span.from, span.to + 1).map((key) => ({
    t: (key.frame - first.frame) / duration,
    value: (key.value - first.value) / delta,
  }));
}

function median(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function candidateSpans(keys: CurveKey[], tolerance: number) {
  const spans: Span[] = [{ from: 0, to: keys.length - 1 }],
    values = keys.map((key) => key.value),
    range = Math.max(...values) - Math.min(...values),
    tailCount = Math.min(5, Math.max(3, Math.floor(keys.length / 8))),
    baseline = median(values.slice(-tailCount)),
    holdBand = Math.max(tolerance * 0.75, range * 0.02),
    hasBaselineHolds =
      Math.abs(values[0] - baseline) <= holdBand &&
      values.slice(-tailCount).every((value) => Math.abs(value - baseline) <= holdBand),
    salient = Math.max(tolerance * 4, range * 0.3),
    extrema = hasBaselineHolds
      ? values
          .map((value, index) => ({ index, distance: Math.abs(value - baseline) }))
          .filter(({ index, distance }) => {
            if (index < 1 || index > keys.length - 12 || distance < salient) return false;
            const local = values.slice(Math.max(0, index - 2), index + 3),
              margin = Math.max(EPS, range * 1e-5),
              value = values[index];
            return value >= Math.max(...local) - margin || value <= Math.min(...local) + margin;
          })
          .sort((a, b) => b.distance - a.distance || b.index - a.index)
      : [];
  const starts: number[] = [];
  for (const extremum of extrema) {
    if (starts.every((index) => Math.abs(index - extremum.index) > 2)) starts.push(extremum.index);
    if (starts.length === 3) break;
  }
  for (const from of starts) {
    const endpoints = new Set([keys.length - 1]),
      settleBands = [Math.max(EPS, tolerance * 0.1), Math.max(tolerance * 0.75, range * 0.015)];
    for (const settleBand of settleBands) {
      for (let to = from + 11; to < keys.length - 2; to++) {
        if (values.slice(to).every((value) => Math.abs(value - baseline) <= settleBand)) {
          endpoints.add(to);
          // Bounce leaves its deliberate rest tail at normalized time 0.98.
          // A bake therefore becomes exactly flat just before its authored
          // segment endpoint; project that observed onset back to the endpoint
          // instead of shortening and time-warping the inverse fit.
          const projected = from + Math.round((to - from) / 0.98);
          if (projected > to && projected < keys.length) endpoints.add(projected);
          break;
        }
      }
    }
    for (const to of endpoints) spans.push({ from, to });
  }
  return spans.filter(
    (span, index, all) =>
      all.findIndex((other) => other.from === span.from && other.to === span.to) === index,
  );
}

function elasticCandidateSpans(keys: CurveKey[], tolerance: number) {
  const values = keys.map((key) => key.value),
    range = Math.max(...values) - Math.min(...values),
    tailCount = Math.min(8, Math.max(3, Math.floor(keys.length / 8))),
    baseline = median(values.slice(-tailCount)),
    band = Math.max(tolerance * 0.5, range * 0.015),
    first = values[0],
    last = values.at(-1)!,
    change = last - first,
    residuals = values.map(
      (value, index) => value - (first + change * (index / (values.length - 1))),
    ),
    active = residuals
      .map((value, index) => ({ value, index }))
      .filter(({ value }) => Math.abs(value) > band);
  if (!active.length) return [{ from: 0, to: keys.length - 1 }];
  const firstActive = active[0].index,
    lastActive = active.at(-1)!.index,
    pad = Math.max(1, Math.round(keys.length / 192));
  const spans: Span[] = [
    { from: 0, to: keys.length - 1 },
    { from: Math.max(0, firstActive - pad), to: Math.min(keys.length - 1, lastActive + pad) },
  ];
  // A pulse can be surrounded by a long baseline. Include its baseline-to-
  // event bounds so the reconstructed span does not absorb unrelated motion.
  if (Math.abs(first - baseline) <= band && Math.abs(last - baseline) <= band) {
    const deviation = values.map((value) => Math.abs(value - baseline)),
      firstDeviation = deviation.findIndex((value) => value > band),
      lastDeviation =
        deviation.length -
        1 -
        deviation
          .slice()
          .reverse()
          .findIndex((value) => value > band);
    if (firstDeviation >= 0 && lastDeviation >= firstDeviation)
      spans.push({
        from: Math.max(0, firstDeviation - pad),
        to: Math.min(keys.length - 1, lastDeviation + pad),
      });
  }
  return spans.filter(
    (span, index, all) =>
      all.findIndex((other) => other.from === span.from && other.to === span.to) === index,
  );
}

function makeCurve(source: Curve, fit: Validated) {
  const curve = structuredClone(source),
    keys = curve.keys,
    start = keys[fit.span.from];
  start.interpolation = fit.mode;
  start.handle = 'free';
  delete start.left;
  delete start.right;
  delete start.spring;
  delete start.bounce;
  delete start.elastic;
  delete start.easing;
  if (fit.mode === 'spring') start.spring = { ...fit.spring };
  else if (fit.mode === 'bounce') start.bounce = { ...fit.bounce };
  else start.elastic = { ...fit.elastic };
  start.easing = fit.easing;
  curve.keys = [
    ...keys.slice(0, fit.span.from + 1),
    keys[fit.span.to],
    ...keys.slice(fit.span.to + 1),
  ];
  return curve;
}

/**
 * Infer one editable dynamic interpolation span from a uniform, linear baked
 * scalar curve. The source is never mutated and ambiguous fits return null.
 */
export function detectMotion(curve: Curve, tolerance: number): MotionDetection | null {
  if (!curve || !Array.isArray(curve.keys) || curve.keys.length < 12 || curve.keys.length > 5000)
    return null;
  if (!finite(tolerance) || tolerance <= 0 || curve.modifiers.length || curve.loop || curve.keyLock)
    return null;
  const keys = curve.keys;
  if (
    keys.some(
      (key) =>
        !finite(key.frame) ||
        !finite(key.value) ||
        key.interpolation !== 'linear' ||
        key.spring !== undefined ||
        key.bounce !== undefined ||
        key.elastic !== undefined ||
        key.easing !== undefined,
    )
  )
    return null;
  const spacing = keys[1].frame - keys[0].frame;
  if (
    !(spacing > 0) ||
    keys.some(
      (key, index) =>
        index > 0 &&
        Math.abs(key.frame - keys[index - 1].frame - spacing) > Math.max(1e-6, spacing * 1e-4),
    )
  )
    return null;
  const values = keys.map((key) => key.value),
    sourceRange = Math.max(...values) - Math.min(...values);
  if (!(sourceRange > tolerance * 2)) return null;
  const accepted: Validated[] = [];
  const spans = [
    ...candidateSpans(keys, tolerance),
    ...elasticCandidateSpans(keys, tolerance),
  ].filter(
    (span, index, all) =>
      all.findIndex((other) => other.from === span.from && other.to === span.to) === index,
  );
  for (const span of spans) {
    const first = keys[span.from],
      last = keys[span.to],
      magnitude = Math.abs(last.value - first.value),
      rawPoints = rawSpanPoints(keys, span),
      elasticBand = Math.max(tolerance * 0.5, sourceRange * 0.015),
      elastic = rawPoints.length >= 12 && elasticEvidence(rawPoints, elasticBand),
      points = magnitude > EPS ? spanPoints(keys, span) : [],
      train = training(points),
      modes =
        magnitude > tolerance * 4 && magnitude >= sourceRange * 0.2
          ? cheapModes(points, Math.max(0.02, (tolerance / magnitude) * 1.1))
          : { spring: false, bounce: false };
    if (elastic) {
      const duration = last.frame - first.frame;
      for (const fit of searchElastic(
        training(rawPoints),
        first.value,
        last.value - first.value,
        duration,
        elasticBand,
      )) {
        if (fit.mode !== 'elastic') continue;
        const validated = validateElastic(fit, rawPoints, span, tolerance, elasticBand);
        if (validated) accepted.push(validated);
      }
    }
    if (train.length < 7) continue;
    if (modes.spring || modes.bounce) {
      const fits = [
        ...(modes.spring ? searchSpring(train) : []),
        ...(modes.bounce ? searchBounce(train) : []),
      ];
      for (const fit of fits) {
        if (fit.mode === 'elastic') continue;
        const validated = validate(fit, points, span, tolerance, magnitude);
        if (validated) accepted.push(validated);
      }
    }
  }
  if (!accepted.length) return null;
  accepted.sort(
    (a, b) =>
      b.span.to - b.span.from - (a.span.to - a.span.from) ||
      a.validationError - b.validationError ||
      a.rms - b.rms ||
      (a.mode === 'elastic' ? -1 : a.mode === 'spring' ? 0 : 1),
  );
  const best = accepted[0],
    result = makeCurve(curve, best);
  return {
    curve: result,
    error: best.maxError,
    bound: best.validationError,
    motion: {
      spring: best.mode === 'spring' ? 1 : 0,
      bounce: best.mode === 'bounce' ? 1 : 0,
      elastic: best.mode === 'elastic' ? 1 : 0,
      maxError: best.maxError,
      validationError: best.validationError,
    },
  };
}

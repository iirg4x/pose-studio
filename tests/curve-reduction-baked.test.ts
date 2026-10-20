import { Quaternion } from 'three';
import { it, expect } from 'vitest';
import fs from 'node:fs';
import type { Channel, Curve } from '../src/core/curves';
import { readCurve, sampleCurve } from '../src/core/curves';
import { reduceCurve, reduceTrack, DEFAULT_REDUCTION } from '../src/core/curveReduction';
import { sample, type Track } from '../src/core/model';

const fixture = JSON.parse(
  fs.readFileSync('tests/fixtures/reload-empty-reduction.json', 'utf8'),
) as { track: Track; end: number; protectedFrames: number[] };

const bakedOptions = { ...DEFAULT_REDUCTION, fit: 'baked' as const };

const inputFor = (channels: Channel[]) => ({
  id: 'hand_r' as const,
  label: 'Right hand IK',
  track: fixture.track,
  channels,
  protectedFrames: fixture.protectedFrames,
});

const quaternionError = (original: Track, reduced: Track, frames: number[]) => {
  let peak = 0;
  for (const frame of frames) {
    peak = Math.max(
      peak,
      (new Quaternion(...sample(original, frame).q).angleTo(
        new Quaternion(...sample(reduced, frame).q),
      ) *
        180) /
        Math.PI,
    );
  }
  return peak;
};

const integerFrames = (end: number) => Array.from({ length: end + 1 }, (_, frame) => frame);

const denseFrames = (end: number) => Array.from({ length: end * 32 + 1 }, (_, index) => index / 32);

const scalarError = (source: Curve, reduced: Curve, frames: number[]) =>
  Math.max(
    ...frames.map((frame) => Math.abs(sampleCurve(source, frame) - sampleCurve(reduced, frame))),
  );

const linearCurve = (values: [number, number][]): Curve => ({
  keys: values.map(([frame, value]) => ({
    frame,
    value,
    interpolation: 'linear' as const,
    handle: 'vector' as const,
  })),
  modifiers: [],
});

it('fits the reload fixture as the six-key phase-aware baked curve', () => {
  const original = structuredClone(fixture.track);
  const result = reduceTrack(inputFor(['rx']), bakedOptions, fixture.end);
  const reducedCurve = readCurve(result.track, 'rx');
  const frames = integerFrames(fixture.end);
  const dense = denseFrames(fixture.end);
  const frameRotation = quaternionError(original, result.track, frames);
  const denseRotation = quaternionError(original, result.track, dense);
  const at = (frame: number) => reducedCurve.keys.find((key) => key.frame === frame);

  expect(readCurve(original, 'rx').keys).toHaveLength(38);
  expect(result.before).toBe(38);
  expect(result.after).toBe(6);
  expect(reducedCurve.keys.map((key) => key.frame)).toEqual([0, 53, 62, 68, 82, 103]);

  // The phase fit intentionally preserves the user's plateau and transition shape.
  expect(at(0)?.value).toBeCloseTo(0, 6);
  expect(at(53)?.value).toBeCloseTo(0, 6);
  expect(at(82)?.value).toBeCloseTo(0, 6);
  expect(at(103)?.value).toBeCloseTo(0, 6);
  expect(at(62)?.value).toBeCloseTo(at(68)?.value ?? Number.NaN, 6);
  expect(at(53)?.interpolation).toBe('bezier');
  expect(at(53)?.right?.[1]).toBeCloseTo(0, 6);
  expect(at(62)?.left?.[1]).toBeCloseTo(0, 6);
  expect(at(68)?.interpolation).toBe('bezier');
  expect(at(68)?.right?.[0]).toBeCloseTo(0.001, 6);
  expect(at(68)?.right?.[1]).toBeGreaterThan(0);
  expect(reducedCurve.keys.filter((key) => key.interpolation === 'bezier')).toHaveLength(2);

  // Baked phase mode reports measured drift rather than enforcing the scalar tolerance cap.
  expect(frameRotation).toBeLessThan(3.5);
  expect(denseRotation).toBeLessThan(3.5);
  expect(result.rotationError).toBeCloseTo(frameRotation, 6);
  expect(result.subframeRotationError).toBeDefined();
  expect(result.subframeRotationError).toBeLessThan(3.5);
  expect(Math.abs(result.subframeRotationError! - denseRotation)).toBeLessThanOrEqual(0.02);

  for (const channel of ['px', 'py', 'pz', 'ry', 'rz'] as Channel[])
    expect(result.track.curves?.[channel]).toEqual(original.curves?.[channel]);
  expect(fixture.track).toEqual(original);
});

it('retains both Position Y peaks and the valley hold while dropping flat noise', () => {
  const original = structuredClone(fixture.track);
  const source = readCurve(original, 'py');
  const result = reduceTrack(inputFor(['py']), bakedOptions, fixture.end);
  const reduced = readCurve(result.track, 'py');
  const reducedValue = (frame: number) => sampleCurve(reduced, frame);
  const maxFrameError = Math.max(
    ...integerFrames(fixture.end).map((frame) =>
      Math.abs(sampleCurve(source, frame) - reducedValue(frame)),
    ),
  );
  const peak = (from: number, to: number, low: number, high: number) => {
    const key = reduced.keys.find((candidate) => candidate.frame >= from && candidate.frame <= to);
    expect(key).toBeDefined();
    expect(key!.value).toBeGreaterThanOrEqual(low);
    expect(key!.value).toBeLessThanOrEqual(high);
  };

  expect(source.keys).toHaveLength(39);
  expect(result.before).toBe(39);
  expect(reduced.keys.length).toBeLessThan(source.keys.length);
  // Drift-equivalent chatter before the first authored lift is one hold, not
  // another editable boundary at frame 7.
  expect(reduced.keys.filter((key) => key.frame < 53).map((key) => key.frame)).toEqual([0]);
  expect(reduced.keys.map((key) => key.frame)).toEqual([0, 53, 58, 64, 68, 70, 82, 103]);
  peak(56, 60, 10.15 - 0.21, 10.15 + 0.21);
  peak(69, 71, 5.48 - 0.21, 5.48 + 0.21);
  peak(64, 68, 3.43 - 0.21, 3.43 + 0.21);
  expect(reducedValue(58)).toBeGreaterThanOrEqual(10.15 - 0.21);
  expect(reducedValue(58)).toBeLessThanOrEqual(10.15 + 0.21);
  expect(reducedValue(70)).toBeGreaterThanOrEqual(5.48 - 0.21);
  expect(reducedValue(70)).toBeLessThanOrEqual(5.48 + 0.21);
  expect(reducedValue(64)).toBeGreaterThanOrEqual(3.43 - 0.21);
  expect(reducedValue(68)).toBeLessThanOrEqual(3.43 + 0.21);
  expect(maxFrameError).toBeLessThan(0.5);
  expect(result.positionError).toBeLessThan(0.5);

  const noiseKeys = reduced.keys.filter((key) => key.frame > 0 && key.frame < 53);
  expect(noiseKeys.every((key) => Math.abs(key.value) < 0.5)).toBe(true);
  for (const channel of ['px', 'pz', 'rx', 'ry', 'rz'] as Channel[])
    expect(result.track.curves?.[channel]).toEqual(original.curves?.[channel]);
  expect(fixture.track).toEqual(original);
});

it('frees baked endpoint tangents when horizontal easing loses meaningful motion', () => {
  const bezier = (t: number, a: number, b: number, c: number, d: number) => {
    const s = 1 - t;
    return s ** 3 * a + 3 * s ** 2 * t * b + 3 * s * t ** 2 * c + t ** 3 * d;
  };
  const source = linearCurve(
    Array.from({ length: 41 }, (_, frame) => [
      frame,
      frame <= 8 ? 0 : frame >= 28 ? -10 : bezier((frame - 8) / 20, 0, -8, -2, -10),
    ]),
  );
  const result = reduceCurve(source, 0.1, { ...bakedOptions, drift: 2 });

  expect(result.curve.keys.map((key) => key.frame)).toEqual([0, 8, 28, 40]);
  expect(result.error).toBeLessThan(1e-6);
  expect(Math.abs(result.curve.keys[1].right?.[1] ?? 0)).toBeGreaterThan(1);
  expect(Math.abs(result.curve.keys[2].left?.[1] ?? 0)).toBeGreaterThan(1);
  for (const key of result.curve.keys)
    for (const handle of [key.left, key.right])
      if (handle) expect(handle.every(Number.isFinite)).toBe(true);
  expect(scalarError(source, result.curve, denseFrames(40))).toBeLessThan(0.03);
});

it('keeps a baked constant-speed phase literally linear', () => {
  const source = linearCurve(
    Array.from({ length: 31 }, (_, frame) => [
      frame,
      frame <= 6 ? 0 : frame >= 24 ? 9 : (frame - 6) / 2,
    ]),
  );
  const result = reduceCurve(source, 0.1, { ...bakedOptions, drift: 1 });

  expect(result.curve.keys.map((key) => key.frame)).toEqual([0, 6, 24, 30]);
  expect(result.curve.keys[1].interpolation).toBe('linear');
  expect(result.curve.keys[1].right).toBeUndefined();
  expect(result.curve.keys[2].left).toBeUndefined();
  expect(scalarError(source, result.curve, denseFrames(30))).toBeLessThan(1e-8);
});

it('preserves the Inspect weapon descent and recovery with sparse finite tangents', () => {
  const fixture = JSON.parse(
    fs.readFileSync('tests/fixtures/inspect-weapon-reduction.json', 'utf8'),
  ) as { end: number; curve: Curve };
  const original = structuredClone(fixture.curve);
  const result = reduceCurve(fixture.curve, 0.1, { ...bakedOptions, drift: 2 });

  // Forced horizontal/vertical endpoints lost over 11 degrees on this source.
  expect(result.curve.keys.length).toBeLessThan(20);
  expect(scalarError(original, result.curve, denseFrames(fixture.end))).toBeLessThan(3.1);
  expect(
    result.curve.keys.some(
      (key) => key.right && Math.abs(key.right[0]) > 0.01 && Math.abs(key.right[1]) > 1,
    ),
  ).toBe(true);
  expect(fixture.curve).toEqual(original);
});

it('keeps phase-fit flat-topped peaks and troughs bounded', () => {
  for (const sign of [1, -1]) {
    const source = linearCurve([
      ...Array.from({ length: 9 }, (_, frame) => [frame, 0] as [number, number]),
      [9, sign * 2],
      [10, sign * 4],
      [11, sign * 4],
      [12, sign * 2],
      ...Array.from({ length: 12 }, (_, index) => [13 + index, 0] as [number, number]),
    ]);
    const original = structuredClone(source);
    const result = reduceCurve(source, 0.1, { ...bakedOptions, preserveExtrema: false });
    const plateauValues = [10, 11].map((frame) => sampleCurve(result.curve, frame));
    const motionError = scalarError(source, result.curve, integerFrames(24));

    expect(result.curve.keys.length).toBeLessThan(source.keys.length);
    if (sign > 0) {
      expect(Math.min(...plateauValues)).toBeGreaterThanOrEqual(3.5);
      expect(Math.max(...plateauValues)).toBeLessThanOrEqual(4.5);
    } else {
      expect(Math.max(...plateauValues)).toBeLessThanOrEqual(-3.5);
      expect(Math.min(...plateauValues)).toBeGreaterThanOrEqual(-4.5);
    }
    expect(motionError).toBeLessThan(0.5);
    for (const key of result.curve.keys) {
      expect(Number.isFinite(key.frame)).toBe(true);
      expect(Number.isFinite(key.value)).toBe(true);
      for (const handle of [key.left, key.right])
        if (handle) expect(handle.every((value) => Number.isFinite(value))).toBe(true);
    }
    expect(source).toEqual(original);
  }
});

it('collapses near-constant baked curves to one key, including a protected endpoint', () => {
  for (const count of [2, 101]) {
    const source = linearCurve(
      Array.from(
        { length: count },
        (_, frame) => [frame, 0.04 * Math.sin(frame * 0.2)] as [number, number],
      ),
    );
    const result = reduceCurve(source, 0.1, bakedOptions, [0]);
    expect(result.curve.keys).toHaveLength(1);
    expect(result.curve.keys[0].frame).toBe(0);
    expect(result.error).toBeLessThanOrEqual(0.1 + 1e-9);
  }
});

it('keeps baked switch, range, and primitive boundaries protected', () => {
  const switchSource = linearCurve(
    Array.from({ length: 31 }, (_, frame) => [frame, frame * 0.01] as [number, number]),
  );
  const switched = reduceCurve(switchSource, 0.01, { ...bakedOptions, preserveExtrema: false }, [
    15,
  ]);
  const switchedFrames = new Set(switched.curve.keys.map((key) => key.frame));
  for (const frame of [13, 14, 15, 16]) expect(switchedFrames.has(frame)).toBe(true);

  const rangeSource = linearCurve(
    Array.from({ length: 21 }, (_, frame) => [frame, frame * 0.01] as [number, number]),
  );
  const ranged = reduceCurve(rangeSource, 0.01, { ...bakedOptions, range: [6, 14] });
  const rangedFrames = new Set(ranged.curve.keys.map((key) => key.frame));
  for (const frame of [
    ...Array.from({ length: 7 }, (_, i) => i),
    ...Array.from({ length: 7 }, (_, i) => i + 14),
  ])
    expect(rangedFrames.has(frame)).toBe(true);

  const primitiveSource = linearCurve(
    Array.from(
      { length: 13 },
      (_, frame) => [frame, frame < 4 ? 0 : frame < 5 ? 1 : 0] as [number, number],
    ),
  );
  primitiveSource.keys[4].interpolation = 'step';
  const primitive = reduceCurve(primitiveSource, 0.1, bakedOptions);
  expect(primitive.curve.keys.find((key) => key.frame === 4)?.interpolation).toBe('step');
  expect(primitive.curve.keys.some((key) => key.frame === 5)).toBe(true);
});

it('observes fractional authored keys', () => {
  const fractional = linearCurve([
    [0, 0],
    [1.5, 0.6],
    [3, 0],
    [4.5, 0.6],
    [6, 0],
  ]);
  const fractionalResult = reduceCurve(fractional, 0.1, {
    ...bakedOptions,
    preserveExtrema: false,
  });
  // Fallback fitting may relocate keys, but authored fractional observations stay within tolerance.
  expect(scalarError(fractional, fractionalResult.curve, [0, 1.5, 3, 4.5, 6])).toBeLessThanOrEqual(
    0.1 + 1e-9,
  );
});

it('retains cyclic endpoints and modifiers', () => {
  const cyclic = linearCurve(
    Array.from(
      { length: 17 },
      (_, frame) => [frame, Math.sin((frame / 16) * Math.PI)] as [number, number],
    ),
  );
  cyclic.modifiers = [
    { id: 'cycles', type: 'cycles', enabled: true, before: 'repeat', after: 'repeat' },
  ];
  const cyclicResult = reduceCurve(cyclic, 0.1, bakedOptions);
  expect(cyclicResult.curve.keys[0].frame).toBe(0);
  expect(cyclicResult.curve.keys.at(-1)?.frame).toBe(16);
  expect(cyclicResult.curve.modifiers).toEqual(cyclic.modifiers);
});

it('does not invent subframe overshoot outside the baked observation envelope', () => {
  const source = linearCurve([
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
    [4, 0],
  ]);
  const result = reduceCurve(source, 0.1, { ...bakedOptions, preserveExtrema: false });
  expect(result.curve.keys.length).toBeLessThan(source.keys.length);
  const values = source.keys.map((key) => key.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // Fallback baked fitting is allowed the API's scalar tolerance at subframes.
  const envelopeEpsilon = 0.1 + 1e-9;
  for (const frame of denseFrames(4)) {
    const value = sampleCurve(result.curve, frame);
    expect(value).toBeGreaterThanOrEqual(low - envelopeEpsilon);
    expect(value).toBeLessThanOrEqual(high + envelopeEpsilon);
  }
});

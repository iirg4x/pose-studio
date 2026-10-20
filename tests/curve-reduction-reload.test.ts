import { Quaternion } from 'three';
import { it, expect } from 'vitest';
import fs from 'node:fs';
import type { Channel } from '../src/core/curves';
import { readCurve, sampleCurve } from '../src/core/curves';
import { sample, type Track } from '../src/core/model';
import { reduceTrack, DEFAULT_REDUCTION } from '../src/core/curveReduction';

const fixture = JSON.parse(
  fs.readFileSync('tests/fixtures/reload-empty-reduction.json', 'utf8'),
) as { track: Track; end: number; protectedFrames: number[] };

const inputFor = (channels: Channel[]) => ({
  id: 'hand_r' as const,
  label: 'Right hand IK',
  track: fixture.track,
  channels,
  protectedFrames: fixture.protectedFrames,
});

const quaternionError = (original: Track, reduced: Track, end: number) => {
  let peak = 0;
  for (let i = 0; i <= end * 32; i++) {
    const frame = i / 32;
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

const sampledPeak = (curve: ReturnType<typeof readCurve>, from: number, to: number) => {
  let peak = Number.POSITIVE_INFINITY;
  for (let i = Math.round(from * 32); i <= Math.round(to * 32); i++)
    peak = Math.min(peak, sampleCurve(curve, i / 32));
  return peak;
};

it('reduces the exact reload rotation curve within the observable transform contract', () => {
  const original = structuredClone(fixture.track);
  const result = reduceTrack(inputFor(['rx']), { ...DEFAULT_REDUCTION }, fixture.end);
  const sourceCurve = readCurve(original, 'rx');
  const reducedCurve = readCurve(result.track, 'rx');
  const row = result.rows.find((candidate) => candidate.channel === 'rx')!;

  expect(original.rotationMode).toBe('euler');
  expect(original.rotationOrder).toBe('YZX');
  expect(original.additive).toBe(true);
  expect(fixture.end).toBe(103);
  expect(fixture.protectedFrames).toEqual([0]);
  expect(sourceCurve.keys).toHaveLength(38);
  expect(result.before).toBe(38);
  expect(reducedCurve.keys[0].frame).toBe(0);
  expect(reducedCurve.keys.at(-1)?.frame).toBe(103);
  expect(
    reducedCurve.keys.filter((key) => key.frame >= 70 && key.frame <= 82).length,
  ).toBeLessThanOrEqual(5);

  expect(row.bound).toBeLessThanOrEqual(DEFAULT_REDUCTION.rotation + 1e-9);
  expect(quaternionError(original, result.track, fixture.end)).toBeLessThanOrEqual(0.10001);

  const sourcePeak = sampledPeak(sourceCurve, 53, 64);
  const reducedPeak = sampledPeak(reducedCurve, 53, 64);
  expect(Math.abs(reducedPeak - sourcePeak)).toBeLessThanOrEqual(DEFAULT_REDUCTION.rotation + 1e-9);

  const bezierKeys = reducedCurve.keys.filter((key) => key.interpolation === 'bezier');
  expect(bezierKeys.length).toBeGreaterThan(1);
  expect(
    bezierKeys.every((key, index) => {
      const last = bezierKeys.length - 1;
      return (
        (index === 0 || Array.isArray(key.left)) && (index === last || Array.isArray(key.right))
      );
    }),
  ).toBe(true);

  expect(result.track.curves?.px).toEqual(original.curves?.px);
  expect(result.track.curves?.py).toEqual(original.curves?.py);
  expect(result.track.curves?.pz).toEqual(original.curves?.pz);
  expect(result.track.curves?.ry).toEqual(original.curves?.ry);
  expect(result.track.curves?.rz).toEqual(original.curves?.rz);
  expect(fixture.track).toEqual(original);
  expect(result.after).toBeLessThanOrEqual(20);
});

it('budgets selected Euler and position axes independently', () => {
  const eulerRuns = [
    { channels: ['rx'] as Channel[], tolerance: 0.1 },
    { channels: ['rx', 'ry'] as Channel[], tolerance: 0.05 },
    { channels: ['rx', 'ry', 'rz'] as Channel[], tolerance: 0.1 / 3 },
  ];
  for (const run of eulerRuns) {
    const result = reduceTrack(inputFor(run.channels), { ...DEFAULT_REDUCTION }, fixture.end);
    expect(result.rows.map((row) => row.tolerance)).toEqual(
      run.channels.map(() => expect.closeTo(run.tolerance, 1e-12)),
    );
    expect(result.rows.every((row) => row.bound <= row.tolerance + 1e-9)).toBe(true);
    expect(result.rotationError).toBeLessThanOrEqual(DEFAULT_REDUCTION.rotation + 1e-9);
  }

  const positionRuns = [
    { channels: ['px'] as Channel[], tolerance: 0.02 },
    { channels: ['px', 'py'] as Channel[], tolerance: 0.02 / Math.sqrt(2) },
    { channels: ['px', 'py', 'pz'] as Channel[], tolerance: 0.02 / Math.sqrt(3) },
  ];
  for (const run of positionRuns) {
    const result = reduceTrack(inputFor(run.channels), { ...DEFAULT_REDUCTION }, fixture.end);
    expect(result.rows.map((row) => row.tolerance)).toEqual(
      run.channels.map(() => expect.closeTo(run.tolerance, 1e-12)),
    );
    expect(result.rows.every((row) => row.bound <= row.tolerance + 1e-9)).toBe(true);
    expect(result.positionError).toBeLessThanOrEqual(DEFAULT_REDUCTION.position + 1e-9);
  }
});

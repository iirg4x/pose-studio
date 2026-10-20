import { it, expect } from 'vitest';
import fs from 'node:fs';
import type { Channel, Curve } from '../src/core/curves';
import { readCurve, sampleCurve } from '../src/core/curves';
import { reduceCurve, reduceTrack, DEFAULT_REDUCTION } from '../src/core/curveReduction';
import type { Track } from '../src/core/model';

const fixture = JSON.parse(
  fs.readFileSync('tests/fixtures/reload-magazine-px-reduction.json', 'utf8'),
) as { end: number; track: Track; protectedFrames: number[] };

const inputFor = (channels: Channel[]) => ({
  id: 'magazine' as const,
  label: 'AR 01 · Magazine Default',
  track: fixture.track,
  channels,
  protectedFrames: fixture.protectedFrames,
});

const integerFrames = (end: number) => Array.from({ length: end + 1 }, (_, frame) => frame);

const denseFrames = (end: number) => Array.from({ length: end * 32 + 1 }, (_, index) => index / 32);

const scalarError = (source: Curve, reduced: Curve, frames: number[]) =>
  Math.max(
    ...frames.map((frame) => Math.abs(sampleCurve(source, frame) - sampleCurve(reduced, frame))),
  );

it('keeps a monotone shoulder anchor while reducing the magazine position curve', () => {
  const original = structuredClone(fixture.track);
  const options = { ...DEFAULT_REDUCTION, fit: 'baked' as const, drift: 2 };
  const result = reduceTrack(inputFor(['px']), options, fixture.end);
  const source = readCurve(original, 'px');
  const reduced = readCurve(result.track, 'px');
  const anchor = reduced.keys.find((key) => key.frame >= 26 && key.frame <= 30);
  const sourceRange =
    Math.max(...source.keys.map((key) => key.value)) -
    Math.min(...source.keys.map((key) => key.value));

  expect(source.keys).toHaveLength(16);
  expect(result.before).toBe(16);
  expect(result.after).toBe(6);
  expect(reduced.keys.map((key) => key.frame)).toEqual([0, 12, 15, 29, 39, 80]);
  expect(anchor?.frame).toBe(29);
  expect(anchor?.value).toBe(sampleCurve(source, 29));

  const sourceAt = (frame: number) => sampleCurve(source, frame);
  const reducedAt = (frame: number) => sampleCurve(reduced, frame);
  const sourceBefore = (sourceAt(29) - sourceAt(26)) / 3;
  const sourceAfter = (sourceAt(33) - sourceAt(29)) / 4;
  const reducedBefore = (reducedAt(29) - reducedAt(26)) / 3;
  const reducedAfter = (reducedAt(33) - reducedAt(29)) / 4;

  // The descent eases into the shoulder and accelerates again afterwards.
  expect(sourceBefore).toBeLessThan(0);
  expect(sourceAfter).toBeLessThan(sourceBefore);
  expect(reducedBefore).toBeLessThan(0);
  expect(reducedAfter).toBeLessThan(reducedBefore);

  expect(scalarError(source, reduced, integerFrames(fixture.end))).toBeLessThanOrEqual(
    sourceRange * 0.02 + 1e-9,
  );
  expect(scalarError(source, reduced, denseFrames(fixture.end))).toBeLessThan(0.35);

  expect(result.track.curves?.py).toEqual(original.curves?.py);
  expect(result.track.curves?.pz).toEqual(original.curves?.pz);
  expect(result.track.curves?.rx).toEqual(original.curves?.rx);
  expect(result.track.curves?.ry).toEqual(original.curves?.ry);
  expect(result.track.curves?.rz).toEqual(original.curves?.rz);
  for (const key of reduced.keys) {
    expect(Number.isFinite(key.frame)).toBe(true);
    expect(Number.isFinite(key.value)).toBe(true);
    for (const handle of [key.left, key.right])
      if (handle) expect(handle.every(Number.isFinite)).toBe(true);
  }
  expect(fixture.track).toEqual(original);
});

it('retains the same shoulder when the motion direction is reversed', () => {
  const source = structuredClone(readCurve(fixture.track, 'px'));
  for (const key of source.keys) {
    key.value *= -1;
    if (key.left) key.left[1] *= -1;
    if (key.right) key.right[1] *= -1;
  }
  const before = structuredClone(source);
  const result = reduceCurve(source, 0.02, {
    ...DEFAULT_REDUCTION,
    fit: 'baked',
    drift: 2,
  });
  const anchor = result.curve.keys.find((key) => key.frame === 29);
  expect(result.curve.keys).toHaveLength(6);
  expect(anchor?.value).toBe(sampleCurve(source, 29));
  expect(anchor?.left?.[1]).toBeLessThan(0);
  expect(anchor?.right?.[1]).toBeGreaterThan(0);
  expect(scalarError(source, result.curve, denseFrames(fixture.end))).toBeLessThan(0.35);
  expect(source).toEqual(before);
});

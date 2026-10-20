import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { detectNoise } from '../src/core/bakedNoise';
import type { Curve } from '../src/core/curves';

const piecewiseLinearWeaponCurve = (): Curve => {
  const knots = [
    [0, 148.20614624023435],
    [3, 147.8776397705078],
    [8, 148.26002502441406],
    [14, 147.96141052246094],
    [52, 147.6072540283203],
    [54, 147.2480926513672],
    [58, 147.15542602539062],
    [59, 147.5052490234375],
    [60, 147.91366577148438],
    [62, 148.25552368164062],
    [80, 148.20614624023435],
  ] as const;
  const valueAt = (frame: number) => {
    const right = knots.findIndex(([knotFrame]) => knotFrame >= frame);
    if (right <= 0) return knots[0][1];
    const [aFrame, aValue] = knots[right - 1];
    const [bFrame, bValue] = knots[right];
    return aValue + ((bValue - aValue) * (frame - aFrame)) / (bFrame - aFrame);
  };
  return {
    keys: Array.from({ length: 321 }, (_, index) => {
      const frame = index * 0.25;
      return {
        frame,
        value: valueAt(frame),
        interpolation: 'linear' as const,
        handle: 'free' as const,
      };
    }),
    modifiers: [],
  };
};

it('rejects long piecewise-linear holds before the inverse noise search', () => {
  const source = piecewiseLinearWeaponCurve();
  const before = structuredClone(source);
  const started = performance.now();

  expect(detectNoise(source, 0.02)).toBeNull();
  expect(performance.now() - started).toBeLessThan(250);
  expect(source).toEqual(before);
});

import { expect, it } from 'vitest';
import fixture from './fixtures/blender-elastic-samples.json';
import { detectMotion } from '../src/core/bakedMotion';
import { sampleCurve, type Curve } from '../src/core/curves';

const baked = (values: readonly number[]): Curve => ({
  keys: values.map((value, index) => ({
    frame: index,
    value,
    interpolation: 'linear' as const,
    handle: 'free' as const,
  })),
  modifiers: [],
});

it('reconstructs equal-endpoint Blender elastic samples as an editable effect', () => {
  for (const [name, values] of Object.entries(fixture.samples)) {
    const source = baked(values);
    const detected = detectMotion(source, 0.02);

    expect(detected, name).not.toBeNull();
    expect(detected!.motion.elastic).toBe(1);
    expect(detected!.motion.spring).toBe(0);
    expect(detected!.motion.bounce).toBe(0);
    expect(detected!.bound).toBeLessThanOrEqual(0.02 + 1e-9);
    const key = detected!.curve.keys.find((candidate) => candidate.interpolation === 'elastic');
    expect(key?.elastic).toBeDefined();
    expect(key!.elastic!.amplitude).toBeCloseTo(fixture.amplitude, 1);
    expect(key!.elastic!.period).toBeCloseTo(fixture.period, 0);
    expect(sampleCurve(detected!.curve, 16)).toBeCloseTo(values[16], 2);
    expect(sampleCurve(detected!.curve, 48)).toBeCloseTo(values[48], 2);
  }
});

it('does not label a two-lobe Bezier arc as elastic', () => {
  const cubic = (t: number) => {
    const u = 1 - t;
    return 3 * u * u * t * -1 + 3 * u * t * t;
  };
  const source = baked(
    Array.from({ length: fixture.duration + 1 }, (_, frame) => cubic(frame / fixture.duration)),
  );
  expect(detectMotion(source, 0.02)).toBeNull();
});

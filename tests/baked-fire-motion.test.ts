import { expect, it } from 'vitest';
import fixture from './fixtures/weapon-fire-spring.json';
import { detectMotion } from '../src/core/bakedMotion';
import { sampleCurve, type Curve } from '../src/core/curves';
import { DEFAULT_REDUCTION, reduceCurve } from '../src/core/curveReduction';

// Numeric train/heldout observations extracted from the accepted fire audit
// series 8c9ed84ea93b1cbdb0ff177efb0b9253464dcdf52a7d816e9a537fe725fdbf7c;
// no authored handles, modifiers, or motion settings.
const tolerance = 0.1;
type Pair = readonly [number, number];
const toPairs = (points: readonly number[][]): Pair[] =>
  points.map(([frame, value]) => [frame, value] as const);
const train = toPairs(fixture.train);
const heldout = toPairs(fixture.heldout);

const linearCurve = (points: readonly (readonly [number, number])[]): Curve => ({
  keys: points.map(([frame, value]) => ({
    frame,
    value,
    interpolation: 'linear' as const,
    handle: 'free' as const,
  })),
  modifiers: [],
});

const maxObservationError = (curve: Curve, points: readonly (readonly [number, number])[]) =>
  Math.max(...points.map(([frame, value]) => Math.abs(sampleCurve(curve, frame) - value)));

it('fits the accepted fire spring from numeric observations and preserves heldout error', () => {
  const source = linearCurve(train);
  const before = structuredClone(source);
  expect(source.modifiers).toEqual([]);
  expect(source.keys.every((key) => key.interpolation === 'linear' && key.handle === 'free')).toBe(
    true,
  );

  const detected = detectMotion(source, tolerance);
  expect(detected).not.toBeNull();
  expect(detected!.motion.spring).toBe(1);
  expect(detected!.motion.bounce).toBe(0);
  expect(detected!.curve.keys.some((key) => key.interpolation === 'spring')).toBe(true);
  expect(detected!.error).toBeLessThanOrEqual(tolerance + 1e-9);
  expect(detected!.bound).toBeLessThanOrEqual(tolerance + 1e-9);
  expect(source).toEqual(before);
  const detectedBeforeReduction = structuredClone(detected!.curve);

  const spring = detected!.curve.keys.find((key) => key.interpolation === 'spring');
  expect(spring?.spring).toBeDefined();
  for (const value of Object.values(spring!.spring!)) {
    expect(typeof value).toBe('number');
    expect(Number.isFinite(value)).toBe(true);
  }

  const reduced = reduceCurve(detected!.curve, tolerance, {
    ...DEFAULT_REDUCTION,
    fit: 'auto',
    detectMotion: false,
    detectNoise: false,
  });
  const finalSpring = reduced.curve.keys.find((key) => key.interpolation === 'spring');
  expect(finalSpring?.spring).toBeDefined();
  expect(reduced.curve.keys.length).toBeLessThanOrEqual(4);
  expect(maxObservationError(reduced.curve, train)).toBeLessThanOrEqual(tolerance + 1e-9);
  expect(maxObservationError(reduced.curve, heldout)).toBeLessThanOrEqual(tolerance + 1e-9);
  expect(detected!.curve).toEqual(detectedBeforeReduction);

  const edited = structuredClone(reduced.curve);
  edited.keys.find((key) => key.interpolation === 'spring')!.spring!.strength += 0.1;
  expect(sampleCurve(edited, heldout[100][0])).not.toBe(
    sampleCurve(reduced.curve, heldout[100][0]),
  );
  expect(source).toEqual(before);
});

import fs from 'node:fs';
import { expect, it } from 'vitest';
import type { Curve } from '../src/core/curves';
import { sampleCurve } from '../src/core/curves';
import { DEFAULT_REDUCTION, reduceCurve } from '../src/core/curveReduction';

const fixture = JSON.parse(
  fs.readFileSync('tests/fixtures/inspect-weapon-py-reduction.json', 'utf8'),
) as { end: number; curve: Curve };

it('culls redundant baked hold boundaries inside the declared drift budget', () => {
  const original = structuredClone(fixture.curve);
  const integerValues = Array.from({ length: fixture.end + 1 }, (_, frame) =>
    sampleCurve(original, frame),
  );
  const driftBand = (Math.max(...integerValues) - Math.min(...integerValues)) * 0.02;
  const result = reduceCurve(fixture.curve, 0.1, {
    ...DEFAULT_REDUCTION,
    fit: 'baked',
    drift: 2,
    preserveExtrema: false,
  });
  const frames = result.curve.keys.map((key) => key.frame);
  let denseError = 0;
  for (let index = 0; index <= fixture.end * 32; index++) {
    const frame = index / 32;
    denseError = Math.max(
      denseError,
      Math.abs(sampleCurve(original, frame) - sampleCurve(result.curve, frame)),
    );
  }

  expect(original.keys).toHaveLength(39);
  expect(frames).toEqual([0, 6, 25, 75, 87, 119, 133, 149]);
  expect(denseError).toBeLessThanOrEqual(driftBand + 1e-9);

  // The high hold, the low turn and exact clip boundaries remain editable.
  expect(result.curve.keys[3].value).toBeCloseTo(result.curve.keys[4].value, 9);
  expect(sampleCurve(result.curve, 78)).toBeGreaterThan(11.5);
  expect(sampleCurve(result.curve, 116)).toBeLessThan(-9.5);
  expect(result.curve.keys[0].value).toBe(original.keys[0].value);
  expect(result.curve.keys.at(-1)?.value).toBe(original.keys.at(-1)?.value);
  for (const key of result.curve.keys)
    for (const handle of [key.left, key.right])
      if (handle) expect(handle.every(Number.isFinite)).toBe(true);
  expect(fixture.curve).toEqual(original);
});

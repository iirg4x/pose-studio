import { expect, it, vi } from 'vitest';
vi.mock('../src/core/curveReduction', () => ({
  reduceTrack: () => {
    throw Error(
      'The reduced track did not pass transform validation. Original keys are unchanged.',
    );
  },
}));
import { sparseMotion } from '../src/core/sparseMotion';
import { pose } from '../src/core/model';

it('keeps the sampled keys of a bone the fitter rejects instead of failing the import', () => {
  const keys = Array.from({ length: 12 }, (_, frame) => ({ ...pose([frame * 0.01, 0, 0]), frame })),
    result = sparseMotion(keys);
  expect(result.curves).toBeUndefined();
  expect(result.keys).toHaveLength(12);
  expect(result.keys.at(-1)!.p[0]).toBeCloseTo(0.11, 12);
});

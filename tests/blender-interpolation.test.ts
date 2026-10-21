import { describe, expect, it } from 'vitest';
import {
  BLENDER_INTERPOLATION_MODES,
  blenderInterpolationValue,
  DEFAULT_BACK,
  DEFAULT_ELASTIC,
  resolveEaseDirection,
  validateMotionOptions,
} from '../src/core/interpolation';
import { baseCurve, type Curve } from '../src/core/curves';

const span = (interpolation: Curve['keys'][number]['interpolation'], options = {}): Curve => ({
  keys: [
    { frame: 0, value: 10, interpolation, handle: 'flat', ...options },
    { frame: 10, value: 30, interpolation: 'linear', handle: 'flat' },
  ],
  modifiers: [],
});

describe('Blender interpolation', () => {
  it('exposes all Blender easing and dynamic modes with the documented auto direction', () => {
    expect(BLENDER_INTERPOLATION_MODES).toEqual([
      'sine',
      'quad',
      'cubic',
      'quart',
      'quint',
      'expo',
      'circ',
      'back',
      'blenderBounce',
      'elastic',
    ]);
    expect(resolveEaseDirection('quad', 'auto')).toBe('in');
    expect(resolveEaseDirection('elastic', 'auto')).toBe('out');
    expect(resolveEaseDirection('blenderBounce', 'auto')).toBe('out');
  });

  it("matches Blender's scalar quad and sine easing equations for frame durations", () => {
    expect(blenderInterpolationValue('quad', 5, 10, 20, 10, { easing: 'in' })).toBe(15);
    expect(blenderInterpolationValue('quad', 5, 10, 20, 10, { easing: 'out' })).toBe(25);
    expect(blenderInterpolationValue('quad', 5, 10, 20, 10, { easing: 'inOut' })).toBe(20);
    expect(blenderInterpolationValue('sine', 5, 10, 20, 10, { easing: 'inOut' })).toBeCloseTo(
      20,
      12,
    );
    expect(blenderInterpolationValue('cubic', 0, -3, -12, 8, { easing: 'out' })).toBe(-3);
    expect(blenderInterpolationValue('cubic', 8, -3, -12, 8, { easing: 'in' })).toBe(-15);
  });

  it('preserves signed changes and exact endpoints for every new mode', () => {
    for (const mode of BLENDER_INTERPOLATION_MODES) {
      for (const easing of ['in', 'out', 'inOut'] as const) {
        const options = {
          easing,
          back: DEFAULT_BACK,
          elastic: DEFAULT_ELASTIC,
        };
        expect(blenderInterpolationValue(mode, 0, 12, -7, 13, options)).toBe(12);
        expect(blenderInterpolationValue(mode, 13, 12, -7, 13, options)).toBe(5);
        expect(Number.isFinite(blenderInterpolationValue(mode, 6.5, 12, -7, 13, options))).toBe(
          true,
        );
      }
    }
  });

  it('keeps Blender elastic motion when endpoint values are equal', () => {
    const options = { easing: 'out' as const, elastic: { amplitude: 0.2, period: 12.8 } };
    const samples = [1, 3, 7, 11].map((time) =>
      blenderInterpolationValue('elastic', time, 2, 0, 100, options),
    );
    expect(samples.some((value) => Math.abs(value - 2) > 1e-6)).toBe(true);
    expect(samples.every(Number.isFinite)).toBe(true);
  });

  it('uses the scalar evaluator for channel curves and keeps dynamic settings valid', () => {
    const curve = span('elastic', {
      easing: 'out' as const,
      elastic: { amplitude: 0.2, period: 12.8 },
    });
    expect(baseCurve(curve, 0)).toBe(10);
    expect(baseCurve(curve, 10)).toBe(30);
    expect(baseCurve(curve, 3)).not.toBeCloseTo(16, 6);
    expect(() =>
      validateMotionOptions({
        easing: 'auto',
        back: { overshoot: 1.70158 },
        elastic: { amplitude: 0.2, period: 12.8 },
      }),
    ).not.toThrow();
  });
});

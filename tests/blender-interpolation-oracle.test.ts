import { expect, it } from 'vitest';
import oracle from './fixtures/blender-interpolation-oracle.json';
import { baseCurve, sampleCurve, type Curve } from '../src/core/curves';
import { blenderInterpolationValue, type InterpolationName } from '../src/core/interpolation';

type OracleCase = (typeof oracle.cases)[number];
type CurveInterpolation = Exclude<InterpolationName, 'smooth'>;

const modeFor = (mode: OracleCase['mode']): CurveInterpolation => {
  switch (mode) {
    case 'CONSTANT':
      return 'step';
    case 'LINEAR':
      return 'linear';
    case 'BOUNCE':
      return 'blenderBounce';
    default:
      return mode.toLowerCase() as CurveInterpolation;
  }
};

const easingFor = (easing: OracleCase['easing']) => {
  switch (easing) {
    case 'EASE_IN':
      return 'in' as const;
    case 'EASE_OUT':
      return 'out' as const;
    case 'EASE_IN_OUT':
      return 'inOut' as const;
    default:
      return 'auto' as const;
  }
};

const curveFor = (item: OracleCase, mode: CurveInterpolation): Curve => ({
  keys: [
    {
      frame: 1,
      value: item.begin,
      interpolation: mode,
      handle: 'flat',
      easing: easingFor(item.easing),
      back: { overshoot: item.overshoot },
      elastic: { amplitude: item.amplitude, period: item.period },
    },
    {
      frame: item.duration + 1,
      value: item.end,
      interpolation: 'linear',
      handle: 'flat',
    },
  ],
  modifiers: [],
});

it('matches Blender 4.3.2 representative interpolation samples in scalar and curve APIs', () => {
  expect(oracle.source.application).toBe('Blender');
  expect(oracle.source.version).toBe('4.3.2');
  expect(oracle.cases).toHaveLength(144);

  for (const item of oracle.cases) {
    const mode = modeFor(item.mode);
    const options = {
      easing: easingFor(item.easing),
      back: { overshoot: item.overshoot },
      elastic: { amplitude: item.amplitude, period: item.period },
    };
    const curve = curveFor(item, mode);
    for (const [frame, expected] of item.samples) {
      const actual = blenderInterpolationValue(
        mode,
        frame - 1,
        item.begin,
        item.end - item.begin,
        item.duration,
        options,
      );
      expect(actual).toBeCloseTo(expected, 5);
      expect(baseCurve(curve, frame)).toBeCloseTo(expected, 5);
      expect(sampleCurve(curve, frame)).toBeCloseTo(expected, 5);
    }
  }
});

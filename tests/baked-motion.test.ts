import { expect, it } from 'vitest';
import { detectMotion } from '../src/core/bakedMotion';
import {
  motionProgress,
  type EaseDirection,
  type MotionMode,
  type MotionOptions,
} from '../src/core/interpolation';
import { sampleCurve, type Curve } from '../src/core/curves';
import { DEFAULT_REDUCTION, reduceTrack } from '../src/core/curveReduction';
import { pose, type Key, type Track } from '../src/core/model';
import { sparseMotion } from '../src/core/sparseMotion';

const end = 160;
const tolerance = 0.08;

/**
 * Deliberately only carries baked observations. Motion settings belong to the
 * generator in each test, never to the input curve handed to the detector.
 */
const linearCurve = (values: readonly number[], step = 1, firstFrame = 0): Curve => ({
  keys: values.map((value, index) => ({
    frame: firstFrame + index * step,
    value,
    interpolation: 'linear' as const,
    handle: 'free' as const,
  })),
  modifiers: [],
});

const bakedMotion = (
  mode: MotionMode,
  options: MotionOptions,
  amplitude = 8,
  offset = -3,
  count = end * 8 + 1,
) =>
  linearCurve(
    Array.from({ length: count }, (_, index) => {
      const t = index / (count - 1);
      return offset + amplitude * motionProgress(mode, t, options);
    }),
    end / (count - 1),
  );

const springOptions = (easing: EaseDirection): MotionOptions => ({
  easing,
  spring: { oscillations: 3, damping: 5, strength: 1.25 },
});

const bounceOptions = (easing: EaseDirection): MotionOptions => ({
  easing,
  bounce: { bounces: 4, height: 0.62, decay: 0.6, impact: 0.4 },
});

const motionKey = (curve: Curve, mode: MotionMode) =>
  curve.keys.find((key) => key.interpolation === mode);

const trackFor = (curve: Curve): Track => {
  const first = curve.keys[0];
  const last = curve.keys.at(-1)!;
  return {
    keys: [
      { ...pose([first.value / 100, 0, 0]), frame: first.frame, interpolation: 'linear' },
      { ...pose([last.value / 100, 0, 0]), frame: last.frame, interpolation: 'linear' },
    ],
    spaces: [],
    interpolation: 'linear',
    curves: { px: curve },
  };
};

const bakedKeys = (mode: MotionMode, options: MotionOptions, amplitude = 0.12): Key[] =>
  Array.from({ length: end * 8 + 1 }, (_, index) => ({
    ...pose([amplitude * motionProgress(mode, index / 8 / end, options), 0, 0]),
    frame: index / 8,
    interpolation: 'linear' as const,
  }));

it('detects spring and bounce shapes in all easing directions from observations only', () => {
  const cases: Array<{
    mode: MotionMode;
    easing: EaseDirection;
    options: MotionOptions;
    amplitude: number;
    offset: number;
  }> = [
    { mode: 'spring', easing: 'out', options: springOptions('out'), amplitude: 8, offset: -3 },
    { mode: 'spring', easing: 'in', options: springOptions('in'), amplitude: 8, offset: 4 },
    {
      mode: 'spring',
      easing: 'inOut',
      options: springOptions('inOut'),
      amplitude: -8,
      offset: 5,
    },
    { mode: 'bounce', easing: 'out', options: bounceOptions('out'), amplitude: 8, offset: -3 },
    { mode: 'bounce', easing: 'in', options: bounceOptions('in'), amplitude: 8, offset: 4 },
    {
      mode: 'bounce',
      easing: 'inOut',
      options: bounceOptions('inOut'),
      amplitude: -8,
      offset: 5,
    },
  ];

  for (const testCase of cases) {
    const source = bakedMotion(
      testCase.mode,
      testCase.options,
      testCase.amplitude,
      testCase.offset,
    );
    const detected = detectMotion(source, tolerance);

    expect(detected, `${testCase.mode}/${testCase.easing}`).not.toBeNull();
    expect(detected!.motion.spring).toBe(testCase.mode === 'spring' ? 1 : 0);
    expect(detected!.motion.bounce).toBe(testCase.mode === 'bounce' ? 1 : 0);
    expect(detected!.error).toBeLessThanOrEqual(tolerance + 1e-9);
    expect(detected!.bound).toBeLessThanOrEqual(tolerance + 1e-9);
    expect(detected!.motion.maxError).toBe(detected!.error);
    expect(detected!.motion.validationError).toBe(detected!.bound);
    expect(motionKey(detected!.curve, testCase.mode)?.easing).toBe(testCase.easing);

    // These oracle times differ from the baked lattice and its adjacent midpoints.
    // None of these times is an authored frame or an adjacent midpoint from
    // the detector's validation grid.
    for (const t of [0.137, 0.347, 0.613, 0.893]) {
      const expected =
        testCase.offset + testCase.amplitude * motionProgress(testCase.mode, t, testCase.options);
      const actual = sampleCurve(detected!.curve, t * end);
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance + 1e-9);
    }
  }
});

it('finds a motion span inside a baseline-to-peak-to-baseline pulse', () => {
  const options = bounceOptions('out');
  const peakFrame = 24;
  const spanEnd = 120;
  const source = linearCurve(
    Array.from({ length: end * 8 + 1 }, (_, index) => {
      const frame = index / 8;
      if (frame < peakFrame || frame > spanEnd) return 0;
      const t = (frame - peakFrame) / (spanEnd - peakFrame);
      return 10 * (1 - motionProgress('bounce', t, options));
    }),
    1 / 8,
  );
  const before = structuredClone(source);
  const detected = detectMotion(source, tolerance);

  expect(detected).not.toBeNull();
  expect(detected!.motion.bounce).toBe(1);
  expect(detected!.motion.spring).toBe(0);
  const fitted = motionKey(detected!.curve, 'bounce');
  expect(fitted).toBeDefined();
  expect(fitted!.frame).toBeGreaterThanOrEqual(peakFrame - 2);
  expect(fitted!.frame).toBeLessThanOrEqual(peakFrame + 2);
  expect(detected!.curve.keys[0].value).toBe(0);
  expect(detected!.curve.keys.at(-1)!.value).toBe(0);
  expect(detected!.bound).toBeLessThanOrEqual(tolerance + 1e-9);
  expect(source).toEqual(before);
});

it('recognizes a recoil return when the impulse starts immediately without an opening hold', () => {
  const source = linearCurve(
    Array.from({ length: end * 8 + 1 }, (_, index) => {
      const frame = index / 8;
      if (frame <= 1) return 9 * frame;
      if (frame >= 144) return 0;
      return 9 * (1 - motionProgress('spring', (frame - 1) / 143, springOptions('out')));
    }),
    1 / 8,
  );
  const detected = detectMotion(source, tolerance);
  expect(detected).not.toBeNull();
  expect(detected!.motion.spring).toBe(1);
  expect(motionKey(detected!.curve, 'spring')?.frame).toBe(1);
  expect(detected!.bound).toBeLessThanOrEqual(tolerance);
});

it('is deterministic and immutable while returning editable motion options', () => {
  const source = bakedMotion('spring', springOptions('out'));
  const before = structuredClone(source);
  const first = detectMotion(source, tolerance);
  const second = detectMotion(source, tolerance);

  expect(first).not.toBeNull();
  expect(first).toEqual(second);
  expect(source).toEqual(before);
  expect(JSON.stringify(first)).not.toMatch(/samples|bakedValues/);

  const mode = first!.motion.spring ? 'spring' : 'bounce';
  const key = motionKey(first!.curve, mode);
  expect(key).toBeDefined();
  expect(key!.spring ?? key!.bounce).toBeDefined();
  const edited = structuredClone(first!.curve);
  if (mode === 'spring')
    edited.keys.find((candidate) => candidate.interpolation === mode)!.spring!.strength = 0;
  else edited.keys.find((candidate) => candidate.interpolation === mode)!.bounce!.height = 0;
  expect(sampleCurve(edited, end * 0.37)).not.toBeCloseTo(sampleCurve(first!.curve, end * 0.37), 3);
});

it('rejects monotonic, eased, weak, noisy, and ordinary Bezier observations', () => {
  const cubic = (t: number, a: number, b: number, c: number, d: number) => {
    const u = 1 - t;
    return u ** 3 * a + 3 * u ** 2 * t * b + 3 * u * t ** 2 * c + t ** 3 * d;
  };
  const sources: Curve[] = [
    linearCurve(Array.from({ length: end + 1 }, (_, frame) => frame / end)),
    linearCurve(Array.from({ length: end + 1 }, (_, frame) => (frame / end) ** 3)),
    bakedMotion(
      'spring',
      { ...springOptions('out'), spring: { ...springOptions('out').spring!, strength: 0.005 } },
      8,
      0,
    ),
    bakedMotion(
      'bounce',
      { ...bounceOptions('out'), bounce: { ...bounceOptions('out').bounce!, height: 0.01 } },
      8,
      0,
    ),
    linearCurve(
      Array.from({ length: end + 1 }, (_, frame) => {
        const t = frame / end;
        return t + 0.12 * Math.sin(frame * 1.73) + 0.09 * Math.sin(frame * 0.37);
      }),
    ),
    linearCurve(Array.from({ length: end + 1 }, (_, frame) => cubic(frame / end, 0, 0.2, 0.8, 1))),
  ];

  for (const source of sources) expect(detectMotion(source, tolerance)).toBeNull();
});

it('rejects nonuniform and undersampled bakes plus locked, looped, and modified curves', () => {
  const source = bakedMotion('spring', springOptions('out'));
  const nonuniform = structuredClone(source);
  nonuniform.keys[47].frame += 0.25;
  const undersampled = bakedMotion('spring', springOptions('out'), 8, -3, 11);
  const locked = { ...structuredClone(source), keyLock: true };
  const looped = { ...structuredClone(source), loop: { start: 0, end } };
  const modified = {
    ...structuredClone(source),
    modifiers: [{ id: 'scale', type: 'scale' as const, enabled: true, factor: 1, offset: 0 }],
  };

  for (const candidate of [nonuniform, undersampled, locked, looped, modified])
    expect(detectMotion(candidate, tolerance)).toBeNull();
});

it('keeps detection opt-in, preserves a primitive through reduceTrack, and enables it for imports', () => {
  const source = bakedMotion('spring', springOptions('out'));
  const track = trackFor(source);
  const off = reduceTrack(
    { id: 'root', label: 'baked spring', track, channels: ['px'] },
    DEFAULT_REDUCTION,
    end,
  );
  expect(off.rows[0].motion).toBeUndefined();
  expect(
    off.track.curves?.px?.keys.some((key) => ['spring', 'bounce'].includes(key.interpolation)),
  ).toBe(false);

  const on = reduceTrack(
    { id: 'root', label: 'baked spring', track, channels: ['px'] },
    { ...DEFAULT_REDUCTION, detectMotion: true },
    end,
  );
  expect(on.rows[0].motion).toBeDefined();
  expect(on.track.curves?.px?.keys.some((key) => key.interpolation === 'spring')).toBe(true);

  const primitive = structuredClone(source);
  const primitiveFrame = 48;
  primitive.keys.find((key) => key.frame === primitiveFrame)!.interpolation = 'step';
  const protectedResult = reduceTrack(
    {
      id: 'root',
      label: 'primitive baked curve',
      track: trackFor(primitive),
      channels: ['px'],
      protectedFrames: [primitiveFrame],
    },
    { ...DEFAULT_REDUCTION, detectMotion: true },
    end,
  );
  const protectedCurve = protectedResult.track.curves?.px;
  expect(protectedResult.rows[0].motion).toBeUndefined();
  expect(protectedCurve?.keys.some((key) => key.frame === primitiveFrame)).toBe(true);
  expect(protectedCurve?.keys.find((key) => key.frame === primitiveFrame)?.interpolation).toBe(
    'step',
  );
});

it('auto-enables baked motion detection through sparseMotion without mutating imported keys', () => {
  const options = springOptions('out');
  const keys = bakedKeys('spring', options);
  const before = structuredClone(keys);
  const reduced = sparseMotion(keys);
  const curve = reduced.curves?.px;

  expect(curve?.keys.some((key) => key.interpolation === 'spring')).toBe(true);
  expect(curve?.keys.some((key) => 'samples' in key || 'bakedValues' in key)).toBe(false);
  expect(keys).toEqual(before);
  for (const frame of [0, 37.137, 91.347, 149.613, end]) {
    const expected = 0.12 * motionProgress('spring', frame / end, options);
    expect(sampleCurve(curve!, frame) / 100).toBeCloseTo(expected, 3);
  }
});

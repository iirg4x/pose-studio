import fs from 'node:fs';
import { it, expect } from 'vitest';
import { pose, sample, type Track } from '../src/core/model';
import {
  blenderNoise,
  blenderNoiseSampler,
  type BlenderNoiseSettings,
} from '../src/core/blenderNoise';
import { detectNoise } from '../src/core/bakedNoise';
import { sampleCurve, type Curve, type Modifier } from '../src/core/curves';
import { reduceTrack } from '../src/core/curveReduction';
import { sparseMotion } from '../src/core/sparseMotion';

type NoiseReference = {
  settings: BlenderNoiseSettings;
  samples: [number, number][];
};

const reference = JSON.parse(
  fs.readFileSync('tests/fixtures/blender-noise-reference.json', 'utf8'),
) as { cases: NoiseReference[] };

const settings: BlenderNoiseSettings = {
  // Keep the primary detector case deliberately outside the coarse search grid.
  // This is the common single-octave Blender modifier shape.
  period: 17.3,
  phase: 3.5,
  offset: 0,
  depth: 0,
  roughness: 0.5,
  lacunarity: 2,
};

const windowedSettings: BlenderNoiseSettings = {
  period: 23.7,
  phase: -5.25,
  offset: 4.75,
  depth: 2,
  roughness: 0.6,
  lacunarity: 1.8,
  rangeStart: 4,
  rangeEnd: 118,
  blendIn: 9,
  blendOut: 11,
};

const baseValue = (frame: number) => 2 + frame * 0.003;
const noiseAmplitude = 0.6;

/** A source curve with only baked observations. Its modifier is intentionally
 * omitted, so fitting cannot accidentally read authored modifier metadata. */
const bakedNoiseCurve = (
  step = 0.25,
  end = 128,
  noiseSettings: BlenderNoiseSettings = settings,
): Curve => ({
  keys: Array.from({ length: Math.round(end / step) + 1 }, (_, index) => {
    const frame = index * step;
    return {
      frame,
      value: baseValue(frame) + noiseAmplitude * blenderNoise(frame, noiseSettings),
      interpolation: 'linear' as const,
      handle: 'free' as const,
    };
  }),
  modifiers: [],
});

const runtimeNoise = (enabled = true, amplitude = noiseAmplitude): Modifier => ({
  id: 'fixture-noise',
  type: 'noise',
  enabled,
  algorithm: 'blender',
  amplitude,
  period: settings.period,
  phase: settings.phase,
  seed: 17,
  offset: settings.offset,
  depth: settings.depth,
  roughness: settings.roughness,
  lacunarity: settings.lacunarity,
});

const settingsFromModifier = (
  modifier: Extract<Modifier, { type: 'noise' }>,
): BlenderNoiseSettings => ({
  period: modifier.period,
  phase: modifier.phase,
  offset: modifier.offset,
  depth: modifier.depth,
  roughness: modifier.roughness,
  lacunarity: modifier.lacunarity,
  ...(modifier.rangeStart !== undefined
    ? {
        rangeStart: modifier.rangeStart,
        rangeEnd: modifier.rangeEnd,
        blendIn: modifier.blendIn,
        blendOut: modifier.blendOut,
      }
    : {}),
});

const bakedTrack = (curve: Curve): Track => ({
  keys: curve.keys.map((key) => ({
    ...pose([key.value / 100, 0, 0]),
    frame: key.frame,
    interpolation: 'linear',
  })),
  spaces: [],
  interpolation: 'linear',
});

const reductionOptions = {
  position: 0.02,
  rotation: 0.1,
  scalar: 0.02,
  fit: 'baked' as const,
  skimHandles: true,
  preserveExtrema: false,
  detectNoise: true,
};

it('matches Blender 5.2.1 reference values without reading authored metadata', () => {
  for (const testCase of reference.cases) {
    const compiled = blenderNoiseSampler(testCase.settings);
    for (const [frame, expected] of testCase.samples) {
      expect(Math.abs(blenderNoise(frame, testCase.settings) - expected)).toBeLessThan(5e-6);
      expect(compiled(frame)).toBeCloseTo(blenderNoise(frame, testCase.settings), 12);
    }
  }
});

it('detects a genuine baked Noise modifier and validates unseen fractional samples', () => {
  const source = bakedNoiseCurve();
  const before = structuredClone(source);
  const detected = detectNoise(source, 0.02);

  expect(detected).not.toBeNull();
  expect(detected!.curve.keys).toHaveLength(2);
  expect(detected!.curve.modifiers).toHaveLength(1);
  expect(detected!.noise).toMatchObject({ algorithm: 'blender' });
  expect(detected!.error).toBeLessThanOrEqual(0.02);
  expect(detected!.bound).toBeLessThanOrEqual(0.02);
  expect(Object.keys(detected!.curve.modifiers[0])).not.toContain('samples');
  expect(Object.keys(detected!.curve.modifiers[0])).not.toContain('bakedValues');

  // These are deliberately off the bake grid. The reconstructed modifier must
  // evaluate the continuous noise field instead of interpolating a hidden array.
  for (const frame of [0.137, 7.41, 37.37, 83.91, 117.229]) {
    const expected = baseValue(frame) + noiseAmplitude * blenderNoise(frame, settings);
    expect(Math.abs(sampleCurve(detected!.curve, frame) - expected)).toBeLessThan(0.02);
  }
  expect(source).toEqual(before);
}, 30_000);

it('uses only an accepted prior fit as a batch hint for a second baked curve', () => {
  const primary = detectNoise(bakedNoiseCurve(), 0.02);
  expect(primary).not.toBeNull();
  const priorModifier = primary!.curve.modifiers[0];
  expect(priorModifier.type).toBe('noise');
  const related = [settingsFromModifier(priorModifier as Extract<Modifier, { type: 'noise' }>)];
  const targetSettings: BlenderNoiseSettings = {
    ...settings,
    period: 28.4,
  };
  const targetInput = bakedNoiseCurve(0.25, 128, targetSettings);
  const beforeTarget = structuredClone(targetInput);
  const beforeRelated = structuredClone(related);
  const target = detectNoise(targetInput, 0.03, related);

  expect(target).not.toBeNull();
  expect(target!.curve.keys).toHaveLength(2);
  expect(target!.curve.modifiers).toHaveLength(1);
  expect(target!.curve.modifiers[0].type).toBe('noise');
  expect(target!.noise.validationError).toBeLessThanOrEqual(0.03);
  for (const frame of [0.371, 19.41, 57.91, 101.229, 126.75]) {
    const expected = baseValue(frame) + noiseAmplitude * blenderNoise(frame, targetSettings);
    expect(Math.abs(sampleCurve(target!.curve, frame) - expected)).toBeLessThan(0.03);
  }
  expect(targetInput).toEqual(beforeTarget);
  expect(related).toEqual(beforeRelated);
}, 60_000);

it('detects depth-two windowed noise from baked samples with no source metadata', () => {
  const source = bakedNoiseCurve(0.25, 128, windowedSettings);
  const detected = detectNoise(source, 0.03);

  expect(detected).not.toBeNull();
  expect(detected!.curve.keys).toHaveLength(2);
  expect(detected!.curve.modifiers).toHaveLength(1);
  expect(detected!.curve.modifiers[0]).toMatchObject({ algorithm: 'blender' });
  expect(detected!.noise.maxError).toBeLessThanOrEqual(0.03);
  expect(detected!.noise.validationError).toBeLessThanOrEqual(0.03);
  expect(Object.keys(detected!.curve.modifiers[0])).not.toContain('samples');

  // Include both sides of the inferred envelope and fractional points within
  // it. These values were not present in the baked input at these times.
  for (const frame of [0.137, 4.37, 17.41, 63.91, 107.229, 123.75]) {
    const expected = baseValue(frame) + noiseAmplitude * blenderNoise(frame, windowedSettings);
    expect(Math.abs(sampleCurve(detected!.curve, frame) - expected)).toBeLessThan(0.03);
  }
}, 60_000);

it('keeps noise strength and mute state as editable modifier behavior', () => {
  const baked = bakedNoiseCurve();
  const detected = detectNoise(baked, 0.02);
  expect(detected).not.toBeNull();
  const active = detected!.curve;
  const muted = structuredClone(active);
  muted.modifiers[0].enabled = false;
  const doubled = structuredClone(active);
  (doubled.modifiers[0] as Extract<Modifier, { type: 'noise' }>).amplitude *= 2;
  const frame = 37.37;
  const base = sampleCurve({ ...active, modifiers: [] }, frame);
  const activeValue = sampleCurve(active, frame);
  const mutedValue = sampleCurve(muted, frame);
  const doubledValue = sampleCurve(doubled, frame);
  expect(Math.abs(activeValue - mutedValue)).toBeGreaterThan(1e-4);
  expect(doubledValue - base).toBeCloseTo(2 * (activeValue - base), 5);
  expect(active.modifiers[0]).not.toHaveProperty('samples');
}, 30_000);

it('is deterministic, immutable, and reconstructs through reduceTrack', () => {
  const source = bakedNoiseCurve();
  const before = structuredClone(source);
  const first = detectNoise(source, 0.02);
  const second = detectNoise(source, 0.02);
  expect(first).toEqual(second);
  expect(source).toEqual(before);

  const result = reduceTrack(
    {
      id: 'hand_r',
      label: 'Baked noise fixture',
      track: bakedTrack(source),
      channels: ['px'],
    },
    reductionOptions,
    128,
  );
  const curve = result.track.curves?.px;
  expect(result.rows[0].noise).toMatchObject({ algorithm: 'blender' });
  expect(curve?.keys).toHaveLength(2);
  expect(curve?.modifiers).toHaveLength(1);
  expect(curve?.modifiers[0].type).toBe('noise');
  expect(result.rows[0].after).toBeLessThan(result.rows[0].before);
  expect(result.subframePositionError ?? result.positionError).toBeLessThanOrEqual(0.02);
}, 60_000);

it('preserves a detected modifier through sparseMotion integration', () => {
  const source = bakedNoiseCurve(0.5, 64);
  const result = sparseMotion(bakedTrack(source).keys, {
    position: 0.0002,
    rotation: (0.25 * Math.PI) / 180,
  });
  expect(result.curves?.px?.modifiers).toHaveLength(1);
  expect(result.curves?.px?.modifiers[0].type).toBe('noise');
  for (const frame of [0.13, 17.37, 42.91, 63.229]) {
    const expected = (baseValue(frame) + noiseAmplitude * blenderNoise(frame, settings)) / 100;
    expect(sample(result as Track, frame).p[0]).toBeCloseTo(expected, 4);
  }
}, 60_000);

it('rejects flat, linear, cubic-eased, and unsupported baked inputs', () => {
  const make = (value: (frame: number) => number, step = 0.25, end = 128): Curve => ({
    keys: Array.from({ length: Math.round(end / step) + 1 }, (_, index) => {
      const frame = index * step;
      return { frame, value: value(frame), interpolation: 'linear', handle: 'free' };
    }),
    modifiers: [],
  });
  expect(
    detectNoise(
      make(() => 1),
      0.02,
    ),
  ).toBeNull();
  expect(
    detectNoise(
      make((frame) => 1 + frame * 0.01, 0.25, 64),
      0.02,
    ),
  ).toBeNull();
  expect(
    detectNoise(
      make((frame) => 1 + 0.6 * (frame / 128) ** 3),
      0.02,
    ),
  ).toBeNull();

  let seed = 0x12345678;
  const random = make(
    () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 0xffffffff;
    },
    2,
    64,
  );
  expect(detectNoise(random, 0.02)).toBeNull();

  // A non-uniform bake is not safely attributable to a continuous modifier.
  const aliased = make(
    (frame) => baseValue(frame) + noiseAmplitude * blenderNoise(frame, settings),
    1,
    64,
  );
  aliased.keys[12].frame += 0.125;
  expect(detectNoise(aliased, 0.02)).toBeNull();
}, 60_000);

it('leaves step, locked, looped, and already-modified curves untouched', () => {
  const source = bakedNoiseCurve(0.5, 64);
  const step = structuredClone(source);
  step.keys = step.keys.map((key) => ({ ...key, interpolation: 'step' as const }));
  const locked = { ...structuredClone(source), keyLock: true };
  const looped = { ...structuredClone(source), loop: { start: 0, end: 64 } };
  const existing = { ...structuredClone(source), modifiers: [runtimeNoise()] };
  for (const candidate of [step, locked, looped, existing])
    expect(detectNoise(candidate, 0.02)).toBeNull();
});

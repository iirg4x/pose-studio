import { it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { sparseMotion } from '../src/core/sparseMotion';
import { pose, sample } from '../src/core/model';
import type { Key, Track } from '../src/core/model';
const dense = (keys: Key[]): Track => ({ keys, spaces: [], interpolation: 'linear' });

/** A deliberately mixed authored bake. The x channel is a small, exact
 * plateau/ease-out/plateau move while y and orientation contain independent
 * detail. A reducer that shares split indexes between all seven channels
 * needlessly copies the y/quaternion timing onto x. */
const mixedAuthoredKeys = (end = 120) =>
  Array.from({ length: end + 1 }, (_, frame) => {
    const u = Math.max(0, Math.min(1, (frame - 20) / 40)),
      ease = 0.08 * (1 - (1 - u) ** 3),
      px = frame < 20 ? 0 : frame > 60 ? 0.08 : ease,
      py = 0.035 * Math.sin(frame * 0.29) + 0.014 * Math.sin(frame * 0.71),
      // The noise returns to the same value at both endpoints so the reducer
      // can collapse it without weakening endpoint preservation.
      pz = frame === 0 || frame === end ? 0 : 0.00003 * Math.sin((frame * Math.PI) / 10),
      yaw = 0.55 * Math.sin(frame * 0.19) + 0.17 * Math.sin(frame * 0.53),
      pitch = 0.22 * Math.sin(frame * 0.37),
      q = new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), yaw)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch))
        .normalize();
    return { ...pose([px, py, pz], q.toArray()), frame, interpolation: 'linear' as const };
  });

it('fits sparse editable curves with bounded subframe error and unchanged endpoints', () => {
  const keys = Array.from({ length: 121 }, (_, frame) => ({
    ...pose(
      [0, Math.sin((frame / 120) * Math.PI) * 0.02, 0],
      new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), Math.sin((frame / 120) * Math.PI) * 0.6)
        .toArray(),
    ),
    frame,
    interpolation: 'linear' as const,
  }));
  const track = { ...dense(keys), ...sparseMotion(keys) },
    ref = dense(keys);
  expect(track.keys.length).toBeLessThan(25);
  expect(track.rotationMode).toBe('quaternion');
  expect(track.curves?.px?.keys).toHaveLength(1);
  for (let f = 0; f <= 120; f += 0.25) {
    const a = sample(track, f),
      b = sample(ref, f);
    expect(new Vector3(...a.p).distanceTo(new Vector3(...b.p))).toBeLessThan(0.000201);
    expect(new Quaternion(...a.q).angleTo(new Quaternion(...b.q))).toBeLessThan(
      (0.251 * Math.PI) / 180,
    );
  }
  for (const f of [0, 120]) expect(sample(track, f).p).toEqual(sample(ref, f).p);
});

it('reduces authored channels independently instead of copying unrelated timing', () => {
  const keys = mixedAuthoredKeys();
  // These non-curve fields must stay on their authored fallback keys even
  // though the transform channels are reduced independently.
  keys[13].fov = 62;
  keys[13].grip[0] = 0.95;
  keys[14].fov = 70;
  keys[14].grip[0] = 0.4;
  const before = keys.map((key) => ({
      ...key,
      p: [...key.p],
      q: [...key.q] as Key['q'],
      grip: [...key.grip],
    })),
    source = dense(keys),
    result = { ...source, ...sparseMotion(keys) },
    px = result.curves?.px?.keys ?? [],
    pz = result.curves?.pz?.keys ?? [];

  // The x move has two holds and one cubic ease. Its key count must not be
  // driven by the independent y/quaternion motion in the same bake.
  expect(px.length).toBeLessThanOrEqual(6);
  expect(px.some((key) => key.interpolation === 'bezier')).toBe(true);
  expect(
    px.some((key) => (key.right?.[1] ?? 0) !== 0) || px.some((key) => (key.left?.[1] ?? 0) !== 0),
  ).toBe(true);
  expect(px.some((key) => Math.abs(key.frame - 20) <= 1)).toBe(true);
  expect(px.some((key) => Math.abs(key.frame - 60) <= 1)).toBe(true);

  // Sub-tolerance sensor noise should not leave a separate authored curve.
  expect(pz.length).toBe(1);
  expect(result.keys.find((key) => key.frame === 13)?.fov).toBe(62);
  expect(result.keys.find((key) => key.frame === 13)?.grip[0]).toBe(0.95);
  expect(result.keys.find((key) => key.frame === 14)?.fov).toBe(70);
  expect(result.keys.find((key) => key.frame === 14)?.grip[0]).toBe(0.4);

  // sparseMotion must treat the input as a snapshot and leave the sampled
  // source untouched while preserving transform accuracy between frames.
  expect(keys).toEqual(before);
  for (let frame = 0; frame <= 120; frame += 0.137) {
    const actual = sample(result, frame),
      expected = sample(source, frame);
    expect(new Vector3(...actual.p).distanceTo(new Vector3(...expected.p))).toBeLessThan(0.000201);
    expect(new Quaternion(...actual.q).angleTo(new Quaternion(...expected.q))).toBeLessThan(
      (0.251 * Math.PI) / 180,
    );
  }
  for (const frame of [0, 120]) {
    const actual = sample(result, frame),
      expected = sample(source, frame);
    for (const axis of [0, 1, 2]) expect(actual.p[axis]).toBeCloseTo(expected.p[axis], 12);
    const actualQ = new Quaternion(...actual.q),
      expectedQ = new Quaternion(...expected.q);
    expect(Math.abs(actualQ.dot(expectedQ))).toBeGreaterThan(1 - 1e-12);
  }
});

it('fits a single-axis cubic ease-out with sparse Bezier handles', () => {
  const keys = Array.from({ length: 41 }, (_, frame) => ({
      ...pose([0.08 * (1 - (1 - frame / 40) ** 3), 0, 0]),
      frame,
      interpolation: 'linear' as const,
    })),
    source = dense(keys),
    result = { ...source, ...sparseMotion(keys) },
    curve = result.curves?.px?.keys ?? [];
  expect(curve.length).toBeLessThanOrEqual(3);
  expect(curve[0]?.frame).toBe(0);
  expect(curve.at(-1)?.frame).toBe(40);
  expect(curve.some((key) => key.interpolation === 'bezier')).toBe(true);
  expect(curve.some((key) => Math.abs(key.right?.[1] ?? 0) > 1e-6)).toBe(true);
  for (let frame = 0.037; frame < 40; frame += 0.173)
    expect(Math.abs(sample(result, frame).p[0] - sample(source, frame).p[0])).toBeLessThan(
      0.000201,
    );
});

it('retains grip and FOV fallback keys when every transform channel is static', () => {
  const keys = Array.from({ length: 21 }, (_, frame) => ({
      ...pose(
        [0, 0, 0],
        [0, 0, 0, 1],
        [frame < 7 ? 0.4 : frame < 14 ? 0.9 : 0.2, 0.6, 0.7, 0.7, 0.7],
        frame < 7 ? 70 : frame < 14 ? 90 : 60,
      ),
      frame,
      interpolation: 'linear' as const,
    })),
    before = keys.map((key) => ({
      ...key,
      p: [...key.p],
      q: [...key.q] as Key['q'],
      grip: [...key.grip],
    })),
    source = dense(keys),
    result = { ...source, ...sparseMotion(keys) },
    fallbackFrames = new Set(result.keys.map((key) => key.frame));
  for (const frame of [0, 7, 14, 20]) expect(fallbackFrames.has(frame)).toBe(true);
  for (const channel of ['px', 'py', 'pz', 'qx', 'qy', 'qz', 'qw'] as const)
    expect(result.curves?.[channel]?.keys.length ?? 0).toBeLessThanOrEqual(1);
  const at = (frame: number) => {
    const actual = sample(result, frame),
      expected = sample(source, frame);
    expect(actual.grip[0]).toBeCloseTo(expected.grip[0], 12);
    expect(actual.fov).toBeCloseTo(expected.fov, 12);
  };
  for (const frame of [0, 3.5, 7, 10.5, 14, 17, 20]) at(frame);
  expect(keys).toEqual(before);
});

it('keeps constant tracks at one key and handles alternating quaternion signs', () => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5).toArray();
  const keys = Array.from({ length: 30 }, (_, frame) => ({
    ...pose([1, 2, 3], q.map((v) => (frame % 2 ? -v : v)) as Key['q']),
    frame,
  }));
  const result = sparseMotion(keys);
  expect(result.keys).toHaveLength(1);
  expect(Object.values(result.curves!).every((c) => c!.keys.length === 1)).toBe(true);
});
it('preserves fast turns between adjacent keys instead of normalized linear rotation drift', () => {
  const keys = [
      { ...pose(), frame: 0 },
      {
        ...pose(
          [0, 0, 0],
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (150 * Math.PI) / 180).toArray(),
        ),
        frame: 1,
      },
    ],
    track = { ...dense(keys), ...sparseMotion(keys) },
    ref = dense(keys);
  for (let f = 0; f <= 1; f += 0.125)
    expect(
      new Quaternion(...sample(track, f).q).angleTo(new Quaternion(...sample(ref, f).q)),
    ).toBeLessThan((0.25 * Math.PI) / 180);
});
it('retains holds and a sharp direction change', () => {
  const keys = Array.from({ length: 41 }, (_, frame) => ({
    ...pose([
      frame < 10 ? 0 : frame < 20 ? (frame - 10) * 0.01 : frame < 30 ? (30 - frame) * 0.01 : 0,
      0,
      0,
    ]),
    frame,
  }));
  const track = { ...dense(keys), ...sparseMotion(keys) };
  expect(track.keys.length).toBeLessThan(15);
  const xFrames = track.curves?.px?.keys.map((key) => key.frame) ?? [];
  for (const frame of [0, 10, 20, 30, 40]) expect(xFrames).toContain(frame);
  for (let f = 0; f <= 40; f += 0.25)
    expect(Math.abs(sample(track, f).p[0] - sample(dense(keys), f).p[0])).toBeLessThan(0.000201);
});

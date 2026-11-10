import { expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { pose, sample } from '../src/core/model';
import type { Key, Q4, Track } from '../src/core/model';
import { sparseMotion } from '../src/core/sparseMotion';

const tolerance = { position: 0.002, rotation: (2 * Math.PI) / 180 };
/** A smooth swing: one slow arc of rotation with a small bob. */
const samples: Key[] = Array.from({ length: 41 }, (_, frame) => ({
  ...pose(
    [0, 0.03 * Math.sin((frame / 40) * Math.PI), 0],
    new Quaternion()
      .setFromAxisAngle(new Vector3(0, 0, 1), 0.9 * Math.sin((frame / 40) * Math.PI))
      .toArray() as Q4,
    [0, 0, 0, 0, 0],
  ),
  frame,
  interpolation: 'linear' as const,
}));

it('describes smooth motion with a few poses that every moving channel shares', () => {
  const reduced = sparseMotion(samples, tolerance, { shared: true });
  const frames = (channel: string) =>
    reduced.curves![channel as 'px']!.keys.map((key) => key.frame).join(',');
  const moving = ['py', 'qz', 'qw'];
  expect(reduced.curves!.py!.keys.length).toBeGreaterThan(2);
  expect(reduced.curves!.py!.keys.length).toBeLessThan(12);
  for (const channel of moving) expect(frames(channel)).toBe(frames('py'));
  // Channels that never move stay one key instead of repeating every pose.
  for (const channel of ['px', 'pz', 'qx', 'qy']) expect(frames(channel)).toBe('0');
  expect(reduced.keys.map((key) => key.frame).join(',')).toBe(frames('py'));

  const track: Track = { ...reduced, spaces: [] };
  for (const original of samples) {
    const fitted = sample(track, original.frame);
    expect(new Vector3(...fitted.p).distanceTo(new Vector3(...original.p))).toBeLessThanOrEqual(
      tolerance.position,
    );
    expect(new Quaternion(...fitted.q).angleTo(new Quaternion(...original.q))).toBeLessThanOrEqual(
      tolerance.rotation,
    );
  }
});

it('keeps fitting each channel on its own unless shared poses are asked for', () => {
  const separate = sparseMotion(samples, tolerance);
  expect(separate.interpolation).toBe('linear');
  expect(sparseMotion(samples, tolerance, { shared: true }).interpolation).toBe('smooth');
});

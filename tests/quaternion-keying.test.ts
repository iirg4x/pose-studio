import { expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { pose, putKey, sample } from '../src/core/model';
import type { Q4, Track } from '../src/core/model';
import type { Curve } from '../src/core/curves';

const turn = (angle: number) =>
  new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle).toArray() as Q4;

it('keys a quaternion on the side of its neighbours, so the frames between do not sweep', () => {
  const a = turn(0.2),
    b = turn(0.4),
    curve = (i: number): Curve => ({
      keys: [
        { frame: 0, value: a[i], interpolation: 'linear', handle: 'clamped' },
        { frame: 10, value: b[i], interpolation: 'linear', handle: 'clamped' },
      ],
      modifiers: [],
    });
  const track: Track = {
    keys: [
      { ...pose([0, 0, 0], a), frame: 0 },
      { ...pose([0, 0, 0], b), frame: 10 },
    ],
    spaces: [],
    interpolation: 'linear',
    rotationMode: 'quaternion',
    curves: { qx: curve(0), qy: curve(1), qz: curve(2), qw: curve(3) },
  };
  // The same rotation as frame 0, written with the opposite sign.
  putKey(track, 0, pose([0, 0, 0], a.map((v) => -v) as Q4));
  expect(new Quaternion(...sample(track, 0).q).angleTo(new Quaternion(...a))).toBeLessThan(1e-6);
  const between = new Quaternion(...sample(track, 5).q);
  expect(between.angleTo(new Quaternion(...turn(0.3)))).toBeLessThan(0.01);
});

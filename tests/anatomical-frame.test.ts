import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { anatomicalFrame, palmFinger } from '../src/core/anatomicalFrame';

const at = (x: number, y: number, z: number, turn = new Quaternion()) =>
  new Matrix4().compose(new Vector3(x, y, z), turn, new Vector3(1, 1, 1));

describe('anatomical frames', () => {
  it('measures the palm with a finger every compared skeleton has', () => {
    const five = (bone: string) => /^(index|middle|ring|pinky)_01_r$/.test(bone),
      three = (bone: string) => /^(index|middle)_01_r$/.test(bone);
    expect(palmFinger('r', five, five)).toBe('pinky');
    expect(palmFinger('r', five, three)).toBe('middle');
    expect(palmFinger('r', three, (bone) => bone === 'index_01_r')).toBeUndefined();
  });

  it('ignores how a bone is rolled around its own axes', () => {
    const joints = (roll: number) =>
      new Map([
        [
          'upperarm_l',
          at(0.2, 1.4, 0, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), roll)),
        ],
        ['lowerarm_l', at(0.5, 1.4, 0)],
      ]);
    const plain = anatomicalFrame('upperarm_l', joints(0))!,
      rolled = anatomicalFrame('upperarm_l', joints(1.2))!;
    expect(plain.angleTo(rolled)).toBeLessThan(1e-9);
    expect(
      new Vector3(1, 0, 0).applyQuaternion(plain).distanceTo(new Vector3(1, 0, 0)),
    ).toBeLessThan(1e-9);
  });

  it('turns a three-fingered hand by its palm, like a five-fingered one', () => {
    const hand = (roll: number, fingers: string[]) => {
      const turn = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), roll),
        place = (x: number, y: number, z: number) => {
          const p = new Vector3(x, y, z).applyQuaternion(turn);
          return at(p.x, p.y, p.z);
        };
      const all: Record<string, Matrix4> = {
        hand_r: place(0, 0, 0),
        index_01_r: place(0.09, 0, 0.03),
        middle_01_r: place(0.1, 0, 0),
        pinky_01_r: place(0.08, 0, -0.04),
      };
      return new Map(['hand_r', ...fingers].map((name) => [name, all[name]]));
    };
    for (const fingers of [
      ['index_01_r', 'middle_01_r', 'pinky_01_r'],
      ['index_01_r', 'middle_01_r'],
    ]) {
      const flat = hand(0, fingers),
        turned = hand(Math.PI / 2, fingers),
        palm = palmFinger(
          'r',
          (bone) => flat.has(bone),
          (bone) => turned.has(bone),
        );
      const between = anatomicalFrame('hand_r', turned, palm)!.multiply(
        anatomicalFrame('hand_r', flat, palm)!.invert(),
      );
      expect(
        between.angleTo(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)),
      ).toBeLessThan(1e-6);
    }
  });

  it('leaves feet and the torso to plain rest differences', () => {
    const joints = new Map([
      ['foot_l', at(0.1, 0.1, 0)],
      ['ball_l', at(0.1, 0.02, 0.15)],
      ['spine_01', at(0, 1, 0)],
      ['spine_02', at(0, 1.1, 0)],
    ]);
    expect(anatomicalFrame('foot_l', joints)).toBeNull();
    expect(anatomicalFrame('spine_01', joints)).toBeNull();
  });
});

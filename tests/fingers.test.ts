import { rigLoader } from './rig-loader';
import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { MannyRig } from '../src/scene/rig';
import {
  createProject,
  evaluate,
  forLayer,
  putKey,
  validateProject,
  clone,
  sample,
} from '../src/core/model';
import { library, capturePose, applyPose, validateLibrary } from '../src/core/library';
import { ensureCurve } from '../src/core/curves';
import type { ControlId } from '../src/core/controls';
let rig: MannyRig;
beforeAll(async () => {
  const bytes = await fs.readFile('public/assets/manny.glb');
  rig = new MannyRig(
    (
      await rigLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      )
    ).scene,
  );
});
describe('signed finger curl', () => {
  it('closes both hands toward the palm and bends outward for negative curl', () => {
    const p = forLayer(createProject(rig.restControls, false), 'body'),
      values = evaluate(p, 0);
    for (const side of ['l', 'r']) {
      const id = ('hand_' + side) as ControlId;
      values[id].grip = [0, 0, 0, 0, 0];
      rig.apply(values, { arm_l: 'fk', arm_r: 'fk' });
      const hand = rig.bones.get(id)!,
        inverse = hand.matrixWorld.clone().invert();
      const tips = Object.fromEntries(
        ['thumb', 'index', 'middle', 'ring', 'pinky'].map((d) => [
          d,
          rig.position(d + '_03_' + side).applyMatrix4(inverse),
        ]),
      );
      for (const curl of [0.3, -0.3]) {
        values[id].grip = Array(5).fill(curl);
        rig.apply(values, { arm_l: 'fk', arm_r: 'fk' });
        for (const digit of ['index', 'middle', 'ring', 'pinky']) {
          const delta = rig
            .position(digit + '_03_' + side)
            .applyMatrix4(inverse)
            .sub(tips[digit]);
          // Manny's left palm faces local +Y, its mirrored right palm local -Y.
          expect(
            delta.y * (side === 'l' ? 1 : -1) * Math.sign(curl),
            side + ' ' + digit,
          ).toBeGreaterThan(0.004);
        }
        // Thumb flexion moves its tip toward the little-finger side of the palm.
        const thumbDelta = rig
          .position('thumb_03_' + side)
          .applyMatrix4(inverse)
          .sub(tips.thumb);
        const towardPinky = tips.pinky.clone().sub(tips.thumb).normalize();
        expect(thumbDelta.dot(towardPinky) * Math.sign(curl), side + ' thumb').toBeGreaterThan(
          0.002,
        );
        for (const digit of ['thumb', 'index', 'middle', 'ring', 'pinky'])
          for (let joint = 1; joint <= 3; joint++) {
            const bone = rig.bones.get(digit + '_0' + joint + '_' + side)!;
            expect(
              Math.abs(bone.quaternion.dot(rig.offsetBase(bone.name as ControlId))),
            ).toBeCloseTo(1, 5);
          }
      }
    }
  });
  it('round trips negative curl through animation, pose libraries and interpolation', () => {
    const p = createProject(rig.restControls, false),
      t = p.tracks.hand_l;
    const start = { ...t.keys[0], grip: [-1, -0.8, -0.6, -0.4, -0.2] };
    putKey(t, 0, start);
    putKey(t, 24, { ...start, grip: [1, 0.8, 0.6, 0.4, 0.2] });
    t.interpolation = 'linear';
    expect(validateProject(clone(p)).tracks.hand_l.keys[0].grip).toEqual(start.grip);
    expect(sample(t, 6).grip).toEqual([-0.5, -0.4, -0.3, -0.2, -0.1]);
    const saved = library(p);
    saved.poses.push(capturePose(p, 0, {}, 'control', 'hand_l'));
    saved.clips[0].drafts.hand_l = start;
    const reopened = validateLibrary(JSON.parse(JSON.stringify(saved)));
    const pasted = applyPose(
      createProject(rig.restControls, false),
      12,
      reopened.poses[0],
      'hand_r',
    );
    expect(evaluate(pasted, 12).hand_r.grip).toEqual(start.grip);
    ensureCurve(t, 'index').keys[0].value = -200;
    expect(sample(t, 0).grip[1]).toBe(-1);
    ensureCurve(t, 'index').keys[0].value = -50;
    expect(sample(t, 0).grip[1]).toBe(-0.5);
    const bad = clone(p);
    bad.tracks.hand_l.keys[0].grip[0] = -1.01;
    expect(() => validateProject(bad)).toThrow();
  });
});

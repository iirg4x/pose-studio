import { afterAll, beforeAll, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { BodySourceSampler } from '../src/scene/BodySourceSampler';
import { AttachmentSolver } from '../src/scene/attachments';
import { blankProject } from '../src/core/assets';
import {
  createFirstPersonAction,
  evaluate,
  forLayer,
  putKey,
  pose,
  matrix,
  rigLocal,
  setBodySourceResolver,
  limbMode,
} from '../src/core/model';
import { boneFollowing } from '../src/core/boneFollowing';
let sourceRig: MannyRig, firstRig: MannyRig;
beforeAll(async () => {
  const b = await fs.readFile('public/assets/manny.glb'),
    load = async () =>
      new MannyRig(
        (
          await rigLoader().parseAsync(
            b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
            '',
          )
        ).scene,
      );
  sourceRig = await load();
  firstRig = await load();
  setBodySourceResolver(new BodySourceSampler(await load()).sample);
});
afterAll(() => setBodySourceResolver());
it('matches solved wrists and attached props with root motion and mixed IK/FK', () => {
  const p = forLayer(blankProject(sourceRig.restControls), 'body');
  p.actionType = 'body';
  const solver = new AttachmentSolver(),
    sample = (f: number) => {
      const v = evaluate(p, f);
      sourceRig.apply(
        v,
        { arm_l: limbMode(p, 'arm_l', f), arm_r: limbMode(p, 'arm_r', f) },
        boneFollowing(p, f),
      );
      solver.apply(sourceRig, v, p, f);
      return v;
    };
  const v = sample(0);
  p.tracks.rifle.following = [solver.capture(sourceRig, v, 'rifle', 'hand_r', 0, true, true)];
  putKey(p.tracks.hips, 10, pose([0, -0.15, 0]));
  putKey(
    p.tracks.root,
    10,
    pose([1, 0, 0.5], new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4).toArray()),
  );
  p.limbModes = { body: { arm_l: [{ frame: 0, mode: 'fk' }], arm_r: [{ frame: 0, mode: 'ik' }] } };
  putKey(
    p.tracks.upperarm_l,
    10,
    pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.2).toArray()),
  );
  const fp = createFirstPersonAction(p, 'body');
  for (const f of [0, 5, 10]) {
    const body = sample(f),
      first = evaluate(fp, f);
    firstRig.apply(first, { arm_l: limbMode(fp, 'arm_l', f), arm_r: limbMode(fp, 'arm_r', f) });
    const inv = matrix(body.root).invert();
    for (const name of ['hand_l', 'hand_r'])
      expect(
        firstRig.position(name).distanceTo(sourceRig.position(name).applyMatrix4(inv)),
      ).toBeLessThan(0.0001);
    expect(
      new Vector3(...first.rifle.p).distanceTo(new Vector3(...body.rifle.p).applyMatrix4(inv)),
    ).toBeLessThan(0.00001);
  }
});

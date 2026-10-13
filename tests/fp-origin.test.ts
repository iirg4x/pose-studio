import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { Vector3 } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { ProportionalRig, mannyPreviewConfig } from '../src/scene/MannyCharacter';
import { createProject, evaluate } from '../src/core/model';
import type { V3 } from '../src/core/model';

it('removes sole placement for camera-authored motion while retaining it for full-body motion', async () => {
  const bytes = await fs.readFile('public/assets/manny.glb');
  const load = async () =>
    (
      await rigLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      )
    ).scene;
  const source = new MannyRig(await load()),
    targetRoot = await load(),
    lift = 0.007276;
  targetRoot.position.y = lift;
  targetRoot.userData = { canonicalSkinning: true, floorLift: lift };
  const target = new ProportionalRig(targetRoot, source),
    p = createProject(source.restControls, false);
  p.motionRig = {
    partial: true,
    positions: Object.fromEntries(
      [...source.rest].map(([n, r]) => [
        n,
        new Vector3().setFromMatrixPosition(r.world).toArray() as V3,
      ]),
    ),
  };
  const config = { ...mannyPreviewConfig(source), handIK: false, footIK: false },
    values = evaluate(p, 0);
  source.setMotionRig(p.motionRig);
  source.apply(values);
  target.sample(source, values, p, 0, config);
  for (const name of ['upperarm_l', 'lowerarm_l', 'hand_l', 'thumb_03_l', 'hand_r'])
    expect(target.position(name).distanceTo(source.position(name))).toBeLessThan(1e-5);
  p.motionRig = { ...p.motionRig, partial: false };
  target.sample(source, values, p, 0, config);
  expect(target.position('hand_r').y - source.position('hand_r').y).toBeCloseTo(lift, 4);
});

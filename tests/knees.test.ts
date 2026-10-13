import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { Quaternion, Vector3 } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import {
  evaluate,
  createBodyAction,
  putKey,
  pose,
  validateProject,
  clone,
  matrix,
} from '../src/core/model';
import type { Project } from '../src/core/model';
let rig: MannyRig, source: Project;
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
  source = JSON.parse(await fs.readFile('tests/fixtures/axe-equip-idle.json', 'utf8'))
    .clips[0].project;
});
describe('imported knee poles', () => {
  it('repairs the old identity import without changing authored animation curves', () => {
    const fixed = validateProject(source);
    expect(fixed.otherTracks.knee_l.keys[0].p).toEqual([0.18, 0.5, 0.7]);
    expect(fixed.otherTracks.knee_r.keys[0].p).toEqual([-0.18, 0.5, 0.7]);
    for (const id of ['hand_l', 'hand_r', 'camera', 'rifle'] as const)
      expect(fixed.tracks[id]).toEqual(source.tracks[id]);
    expect(validateProject(fixed)).toEqual(fixed);
  });
  it('bends both knees forwards with planted feet through a deep squat and root rotation', () => {
    const body = validateProject(createBodyAction(validateProject(source), 'source')),
      footRest = { l: rig.rest.get('foot_l')!.world, r: rig.rest.get('foot_r')!.world };
    for (const yaw of [0, 1.2])
      for (let drop = 0; drop <= 0.4501; drop += 0.025) {
        putKey(body.tracks.hips, 0, pose([0, 0, -drop]));
        putKey(
          body.tracks.root,
          0,
          pose(
            [0.3, 0, -0.2],
            new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).toArray(),
          ),
        );
        const values = evaluate(body, 0),
          root = matrix(values.root);
        rig.apply(values);
        for (const side of ['l', 'r'] as const) {
          const knee = rig.position('calf_' + side).applyMatrix4(root.clone().invert()),
            foot = rig.position('foot_' + side),
            expected = new Vector3().setFromMatrixPosition(footRest[side]).applyMatrix4(root);
          if (drop > 0.05) expect(foot.distanceTo(expected)).toBeLessThan(0.00001);
          if (drop > 0.05) expect(knee.z).toBeGreaterThan(0.12);
          expect(knee.x * (side === 'l' ? 1 : -1)).toBeGreaterThan(0.08);
        }
      }
  });
  it('preserves authored poles and additive correction keys', () => {
    const changed = clone(source);
    changed.otherTracks.knee_l.keys[0].p = [0.4, 0.5, 0.2];
    changed.otherTracks.knee_l.curves!.px!.keys[0].value = 40;
    const fixed = validateProject(changed);
    expect(fixed.otherTracks.knee_l).toEqual(changed.otherTracks.knee_l);
    const body = createBodyAction(validateProject(source), 'source');
    putKey(body.tracks.knee_l, 12, pose([0.1, 0, 0]));
    expect(validateProject(body).tracks.knee_l).toEqual(body.tracks.knee_l);
  });
});

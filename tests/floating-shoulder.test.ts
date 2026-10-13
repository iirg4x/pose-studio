import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { Matrix4, Vector3 } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { MannyCharacter, mannyPreviewConfig } from '../src/scene/MannyCharacter';
import { RetargetRig } from '../src/scene/RetargetRig';
import { createProject, evaluate, fromMatrix, matrix, pose } from '../src/core/model';
import type { ControlId, Pose, Project } from '../src/core/model';

it('does not turn the native holster elbow flip into a target-only shoulder jump, including after seeking', async () => {
  const fixture = JSON.parse(
    await fs.readFile('tests/fixtures/holster-elbow-flip.json', 'utf8'),
  ) as {
    motionRig: Project['motionRig'];
    frames: { frame: number; values: Record<ControlId, Pose> }[];
  };
  const bytes = await fs.readFile('public/assets/manny.glb'),
    load = async () =>
      (
        await rigLoader().parseAsync(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          '',
        )
      ).scene;
  const canonical = new MannyRig(await load()),
    source = new MannyRig(await load(), true),
    target = new MannyCharacter(
      new RetargetRig(await load()),
      canonical,
      mannyPreviewConfig(canonical),
    ).first;
  const p = createProject(canonical.restControls, false);
  p.motionRig = fixture.motionRig;
  p.ikReference = 'fk';
  p.end = 23;
  p.limbModes = {
    firstPerson: {
      arm_l: [{ frame: 0, mode: 'ik' }],
      arm_r: [{ frame: 0, mode: 'ik' }],
      leg_l: [{ frame: 0, mode: 'fk' }],
      leg_r: [{ frame: 0, mode: 'fk' }],
    },
  };
  for (const id of Object.keys(p.tracks) as ControlId[]) {
    const parent = /^(hand|elbow)_[lr]$/.test(id) ? 'rifle' : 'world';
    p.tracks[id] = {
      interpolation: 'linear',
      keys: fixture.frames.map(({ frame, values }) => ({
        ...(values[id] ?? pose()),
        ...(parent === 'rifle'
          ? fromMatrix(matrix(values.rifle).invert().multiply(matrix(values[id])), values[id])
          : {}),
        frame,
      })),
      spaces:
        parent === 'world'
          ? []
          : [{ frame: 0, parent, offset: new Matrix4().toArray(), base: new Matrix4().toArray() }],
    };
  }
  const shifts: Vector3[] = [],
    poses = new Map<number, Vector3>();
  source.setMotionRig(p.motionRig);
  for (const frame of [0, 12, 13, 14, 15, 23, 13]) {
    const values = evaluate(p, frame);
    source.apply(values, { arm_l: 'ik', arm_r: 'ik', leg_l: 'fk', leg_r: 'fk' }, {}, true);
    target.sample(source, values, p, frame, mannyPreviewConfig(canonical));
    const baseline = new Vector3().setFromMatrixPosition(target.rest.get('upperarm_l')!.world).add(
      source
        .position('upperarm_l')
        .sub(new Vector3().setFromMatrixPosition(source.rest.get('upperarm_l')!.world))
        .multiplyScalar(target.motionScale),
    );
    shifts.push(target.position('upperarm_l').sub(baseline));
    expect(
      new Vector3()
        .setFromMatrixPosition(target.gripMatrix('l'))
        .distanceTo(new Vector3().setFromMatrixPosition(target.gripMatrix('l', source))),
    ).toBeLessThan(0.00001);
    if (poses.has(frame))
      expect(target.position('upperarm_l').distanceTo(poses.get(frame)!)).toBeLessThan(1e-9);
    else poses.set(frame, target.position('upperarm_l'));
  }
  expect(shifts[2].distanceTo(shifts[1])).toBeLessThan(0.0001);
  expect(shifts[4].distanceTo(shifts[3])).toBeLessThan(0.0001);
});

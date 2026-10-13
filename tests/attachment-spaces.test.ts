import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { Matrix4, Vector3, Quaternion } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { AttachmentSolver, controlWorld } from '../src/scene/attachments';
import { blankProject } from '../src/core/assets';
import { evaluate, putKey, pose, clone, limbMode } from '../src/core/model';
import { boneFollowing } from '../src/core/boneFollowing';
import type { Project, ControlId } from '../src/core/model';
let rig: MannyRig;
const solver = new AttachmentSolver();
beforeAll(async () => {
  const b = await fs.readFile('public/assets/manny.glb');
  rig = new MannyRig(
    (
      await rigLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
    ).scene,
  );
});
function sample(p: Project, f: number) {
  const v = evaluate(p, f);
  rig.apply(
    v,
    Object.fromEntries(
      ['arm_l', 'arm_r', 'leg_l', 'leg_r'].map((id) => [id, limbMode(p, id as 'arm_l', f)]),
    ),
    boneFollowing(p, f),
  );
  solver.apply(rig, v, p, f);
  return v;
}
describe('general parent frames', () => {
  it('keeps a world-bound head fixed while Root follows root motion', () => {
    for (const target of ['world', 'root'] as const) {
      const p = blankProject(rig.restControls),
        v = sample(p, 0),
        before = rig.position('head');
      p.tracks.head.following = [solver.capture(rig, v, 'head', target, 0, true, true)];
      putKey(p.tracks.root, 10, pose([1, 0, 0]));
      sample(p, 10);
      expect(rig.position('head').x - before.x).toBeCloseTo(target === 'world' ? 0 : 1, 5);
    }
  });
  it('lets a prop follow any bone with separate location and rotation', () => {
    const p = blankProject(rig.restControls);
    p.props = {
      rifle: {
        name: 'Test',
        asset: 'builtin-rifle',
        scale: 1,
        rotation: [0, 0, 0],
        offset: [0, 0, 0],
        visible: true,
      },
    };
    const v = sample(p, 0),
      before = v.rifle.q;
    p.tracks.rifle.following = [solver.capture(rig, v, 'rifle', 'head', 0, true, false)];
    putKey(
      p.tracks.head,
      10,
      pose([0, 0.15, 0], new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7).toArray()),
    );
    const next = sample(p, 10);
    expect(new Quaternion(...next.rifle.q).angleTo(new Quaternion(...before))).toBeLessThan(1e-6);
    expect(new Vector3(...next.rifle.p).distanceTo(new Vector3(...v.rifle.p))).toBeGreaterThan(0.1);
  });
  it('preserves pose when switching an existing binding and rejects cycles', () => {
    const p = blankProject(rig.restControls),
      v = sample(p, 0);
    p.tracks.head.following = [solver.capture(rig, v, 'head', 'root', 0, true, true)];
    const before = rig.bones.get('head')!.matrixWorld.clone();
    sample(p, 0);
    expect(
      new Vector3().setFromMatrixPosition(before).distanceTo(rig.position('head')),
    ).toBeLessThan(1e-7);
    expect(() => solver.capture(rig, v, 'hips', 'head', 0, true, true)).toThrow(/descendant/);
  });
  it('places heel pivots at the sole rather than the ankle and keeps them fixed through a heel roll', () => {
    const p = blankProject(rig.restControls);
    p.limbModes!.body!.leg_l = [{ frame: 0, mode: 'ik' }];
    sample(p, 0);
    const pivot = new Vector3().setFromMatrixPosition(rig.pivotWorld('heel_l'));
    expect(pivot.y).toBeLessThan(rig.position('foot_l').y - 0.04);
    putKey(
      p.tracks.heel_l,
      10,
      pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.2).toArray()),
    );
    sample(p, 10);
    expect(
      new Vector3().setFromMatrixPosition(rig.pivotWorld('heel_l')).distanceTo(pivot),
    ).toBeLessThan(0.002);
  });
});

it('keeps a first-person world attachment stationary as the camera moves', () => {
  const p = blankProject(rig.restControls),
    v = sample(p, 0),
    before = rig.position('head');
  p.tracks.head.following = [solver.capture(rig, v, 'head', 'world', 0, true, true)];
  const camera = new Matrix4().makeTranslation(1, 0.2, -0.3);
  const next = evaluate(p, 0);
  rig.apply(next, { arm_l: 'fk', arm_r: 'fk', leg_l: 'fk', leg_r: 'fk' });
  solver.apply(rig, next, p, 0, camera);
  expect(rig.position('head').applyMatrix4(camera).distanceTo(before)).toBeLessThan(1e-6);
});

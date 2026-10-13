import { beforeAll, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { Quaternion, Vector3 } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { importMotion } from '../src/core/importAnimation';
import { blankProject } from '../src/core/assets';
import { autoMapBones } from '../src/core/retarget';
import { evaluate, pose, putKey, validateProject } from '../src/core/model';
let source: MannyRig, target: MannyRig;
it('keeps authored arm roll and joint translations when reconstructing editable IK targets', () => {
  const p = blankProject(source.restControls);
  p.ikReference = 'fk';
  putKey(
    p.tracks.upperarm_l,
    0,
    pose([0.006, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3).toArray()),
  );
  putKey(
    p.tracks.forearm_l,
    0,
    pose([0.008, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.4).toArray()),
  );
  putKey(
    p.tracks.lowerarm_twist_01_l,
    0,
    pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.2).toArray()),
  );
  source.apply(evaluate(p, 0), { arm_l: 'fk', arm_r: 'fk' }, {}, true);
  const names = ['upperarm_l', 'lowerarm_l', 'hand_l', 'lowerarm_twist_01_l'],
    before = names.map((n) => ({
      p: source.position(n),
      q: source.bones.get(n)!.getWorldQuaternion(new Quaternion()).normalize(),
    }));
  putKey(p.tracks.hand_l, 0, pose(before[2].p.toArray(), before[2].q.toArray(), [0, 0, 0, 0, 0]));
  putKey(p.tracks.elbow_l, 0, pose(before[1].p.toArray()));
  source.apply(evaluate(validateProject(p), 0), { arm_l: 'ik', arm_r: 'fk' }, {}, true);
  for (const [i, n] of names.entries()) {
    expect(source.position(n).distanceTo(before[i].p)).toBeLessThan(0.00001);
    expect(
      source.bones.get(n)!.getWorldQuaternion(new Quaternion()).normalize().angleTo(before[i].q),
    ).toBeLessThan(0.0001);
  }
  const moved = evaluate(p, 0);
  moved.hand_l.p[1] += 0.03;
  source.apply(moved, { arm_l: 'ik', arm_r: 'fk' }, {}, true);
  expect(source.position('hand_l').distanceTo(new Vector3(...moved.hand_l.p))).toBeLessThan(0.0001);
  expect(() => validateProject({ ...p, ikReference: 'unknown' })).toThrow(
    'Invalid IK reference pose',
  );
});
beforeAll(async () => {
  const bytes = await fs.readFile('public/assets/manny.glb');
  const parse = async () =>
    new MannyRig(
      (
        await rigLoader().parseAsync(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          '',
        )
      ).scene,
    );
  source = await parse();
  target = await parse();
});
it('imports sampled humanoid motion with native lengths, root movement and editable FK keys', () => {
  const p = blankProject(source.restControls);
  p.end = 10;
  putKey(
    p.tracks.root,
    10,
    pose([0.3, 0, 0.2], new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2).toArray()),
  );
  putKey(
    p.tracks.head,
    10,
    pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.25).toArray()),
  );
  putKey(
    p.tracks.thigh_l,
    10,
    pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.15).toArray()),
  );
  const bones = [...source.bones].map(([name, b]) => ({
      name,
      parent: b.parent?.name ?? null,
      rest: source.rest.get(name)!.world.toArray(),
    })),
    frames: number[][][] = [];
  for (let f = 0; f <= 10; f++) {
    source.apply(evaluate(p, f), { arm_l: 'fk', arm_r: 'fk', leg_l: 'fk', leg_r: 'fk' });
    frames.push(bones.map((b) => source.bones.get(b.name)!.matrixWorld.toArray()));
  }
  const imported = importMotion(
    { name: 'Test', fps: 30, end: 10, bones, frames },
    { root: 'root', ...autoMapBones(bones.map((b) => b.name)) },
    target,
  );
  expect(imported.props).toEqual({});
  for (const f of [0, 5, 10]) {
    target.apply(evaluate(imported, f), { arm_l: 'fk', arm_r: 'fk', leg_l: 'fk', leg_r: 'fk' });
    for (const name of ['root', 'pelvis', 'head', 'thigh_l', 'foot_l', 'hand_r']) {
      const original = source.bones
        .get(name)!
        .matrixWorld.clone()
        .fromArray(frames[f][bones.findIndex((b) => b.name === name)]);
      expect(
        target.position(name).distanceTo(new Vector3().setFromMatrixPosition(original)),
      ).toBeLessThan(0.0002);
      expect(
        target.bones
          .get(name)!
          .getWorldQuaternion(new Quaternion())
          .normalize()
          .angleTo(new Quaternion().setFromRotationMatrix(original).normalize()),
        name + ' frame ' + f,
      ).toBeLessThan(0.001);
    }
  }
});
it('maps Auto-Rig Pro deform names independently of the bundled example', () => {
  expect(
    autoMapBones([
      'root.x',
      'head.x',
      'arm_stretch.l',
      'forearm_stretch.l',
      'hand.l',
      'thigh_stretch.r',
      'leg_stretch.r',
      'foot.r',
      'c_index2.l',
    ]),
  ).toMatchObject({
    pelvis: 'root.x',
    head: 'head.x',
    upperarm_l: 'arm_stretch.l',
    lowerarm_l: 'forearm_stretch.l',
    hand_l: 'hand.l',
    thigh_r: 'thigh_stretch.r',
    calf_r: 'leg_stretch.r',
    foot_r: 'foot.r',
    index_02_l: 'c_index2.l',
  });
});

it('preserves translated joints and aligns limb directions across different rest poses', () => {
  source.reset();
  source.bones.get('upperarm_l')!.rotateZ(0.4);
  source.root.updateMatrixWorld(true);
  const bones = [...source.bones].map(([name, b]) => ({
    name,
    parent: b.parent?.name ?? null,
    rest: b.matrixWorld.toArray(),
  }));
  source.bones.get('clavicle_l')!.position.x += 0.05;
  source.bones.get('upperarm_l')!.rotateZ(-0.65);
  source.root.updateMatrixWorld(true);
  const frame = bones.map((b) => source.bones.get(b.name)!.matrixWorld.toArray()),
    p = importMotion(
      { name: 'A pose source', fps: 30, end: 1, bones, frames: [frame, frame] },
      autoMapBones(bones.map((b) => b.name)),
      target,
    );
  target.apply(evaluate(p, 0), { arm_l: 'fk', arm_r: 'fk', leg_l: 'fk', leg_r: 'fk' });
  for (const [a, b] of [
    ['upperarm_l', 'lowerarm_l'],
    ['lowerarm_l', 'hand_l'],
  ]) {
    const expected = source.position(b).sub(source.position(a)).normalize(),
      actual = target.position(b).sub(target.position(a)).normalize();
    expect(actual.distanceTo(expected)).toBeLessThan(0.00001);
  }
  expect(target.position('clavicle_l').distanceTo(source.position('clavicle_l'))).toBeLessThan(
    0.00001,
  );
  source.reset();
});
it('places camera-origin first-person clips at the player camera without changing body import', () => {
  source.reset();
  const bones = [...source.bones].map(([name, b]) => ({
    name,
    parent: b.parent?.name ?? null,
    rest: b.matrixWorld.toArray(),
  }));
  source.bones.get('pelvis')!.position.z -= 1.65;
  source.root.updateMatrixWorld(true);
  const frame = bones.map((b) => source.bones.get(b.name)!.matrixWorld.toArray()),
    data = { name: 'Camera origin', fps: 30, end: 1, bones, frames: [frame, frame] },
    map = autoMapBones(bones.map((b) => b.name));
  const camera = importMotion(data, map, target, 'firstPerson'),
    scene = importMotion(data, map, target, 'firstPerson', 0, 1, undefined, 'scene');
  target.apply(evaluate(camera, 0), { arm_l: 'fk', arm_r: 'fk', leg_l: 'fk', leg_r: 'fk' });
  const a = target.position('pelvis');
  target.apply(evaluate(scene, 0), { arm_l: 'fk', arm_r: 'fk', leg_l: 'fk', leg_r: 'fk' });
  expect(a.sub(target.position('pelvis')).distanceTo(new Vector3(0, 1.65, 0))).toBeLessThan(
    0.00001,
  );
  source.reset();
});

it('preserves distal finger direction when source and target have different fingertip bind curls', () => {
  source.reset();
  for (const side of ['l', 'r']) source.bones.get('index_03_' + side)!.rotateZ(0.32);
  source.root.updateMatrixWorld(true);
  const bones = [...source.bones].map(([name, b]) => ({
    name,
    parent: b.parent?.name ?? null,
    rest: b.matrixWorld.toArray(),
  }));
  const frame = bones.map((b) => source.bones.get(b.name)!.matrixWorld.toArray());
  const p = importMotion(
    { name: 'Different distal bind curl', fps: 30, end: 1, bones, frames: [frame, frame] },
    autoMapBones(bones.map((b) => b.name)),
    target,
    'body',
    0,
    1,
    false,
  );
  target.apply(evaluate(p, 0), { arm_l: 'fk', arm_r: 'fk', leg_l: 'fk', leg_r: 'fk' });
  for (const side of ['l', 'r']) {
    const name = 'index_03_' + side;
    const expected = new Vector3(1, 0, 0).applyQuaternion(
      source.bones.get(name)!.getWorldQuaternion(new Quaternion()),
    );
    const actual = new Vector3(1, 0, 0).applyQuaternion(
      target.bones.get(name)!.getWorldQuaternion(new Quaternion()),
    );
    expect(actual.angleTo(expected), name).toBeLessThan(0.0001);
  }
  source.reset();
});

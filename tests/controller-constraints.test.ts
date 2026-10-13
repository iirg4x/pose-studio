import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { Matrix4, Vector3, Quaternion, SkinnedMesh, Bone } from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { ProportionalRig, mannyPreviewConfig } from '../src/scene/MannyCharacter';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { AttachmentSolver } from '../src/scene/attachments';
import { SharedPoseSampler } from '../src/scene/sharedSkeletonExport';
import {
  createProject,
  forLayer,
  evaluate,
  fromMatrix,
  pose,
  putKey,
  limbMode,
  validateProject,
} from '../src/core/model';
import { controllerConstraints, groundingClearance } from '../src/core/controllerConstraints';
import { boneFollowing } from '../src/core/boneFollowing';
import { StudioStore } from '../src/core/store';
import type { Project, ControlId } from '../src/core/model';
let rig: MannyRig;
beforeAll(async () => {
  const b = await fs.readFile('public/assets/manny.glb');
  rig = new MannyRig(
    (
      await rigLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
    ).scene,
  );
});
const actualMeshMinimum = (r: MannyRig, id: ControlId, scene = new Matrix4()) => {
  const branch = new Set<Bone>();
  r.bodyBone(id).traverse((b) => {
    if (b instanceof Bone) branch.add(b);
  });
  let low = Infinity;
  r.root.traverse((mesh) => {
    if (!(mesh instanceof SkinnedMesh) || !mesh.visible) return;
    const p = mesh.geometry.getAttribute('position'),
      si = mesh.geometry.getAttribute('skinIndex'),
      sw = mesh.geometry.getAttribute('skinWeight'),
      drawn = mesh.geometry.index
        ? new Set<number>(Array.from(mesh.geometry.index.array))
        : new Set(Array.from({ length: p.count }, (_, i) => i));
    for (const i of drawn) {
      let belongs = false;
      for (let k = 0; k < 4; k++)
        if (sw.getComponent(i, k) > 1e-5 && branch.has(mesh.skeleton.bones[si.getComponent(i, k)]))
          belongs = true;
      if (belongs)
        low = Math.min(
          low,
          mesh
            .getVertexPosition(i, new Vector3())
            .applyMatrix4(mesh.matrixWorld)
            .applyMatrix4(scene).y,
        );
    }
  });
  return low;
};
const project = () => forLayer(createProject(rig.restControls, false), 'body');
const solve = (p: Project, scene = new Matrix4(), frame = 0) => {
  const v = evaluate(p, frame);
  rig.apply(
    v,
    Object.fromEntries(
      (['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const).map((id) => [id, limbMode(p, id, frame)]),
    ),
    boneFollowing(p, frame),
    false,
    controllerConstraints(p),
  );
  new AttachmentSolver().apply(rig, v, p, frame, scene);
  return v;
};
const applyTargets = (r: MannyRig, targets: Map<ControlId, Matrix4>) => {
  for (const [id, m] of targets) {
    const b = r.bodyBone(id);
    b.parent!.matrixWorld.clone().invert().multiply(m).decompose(b.position, b.quaternion, b.scale);
    b.updateMatrixWorld(true);
  }
};
describe('Keyed grounding and controller reach', () => {
  it('keeps legacy grounding flags inert during evaluation and export', () => {
    const p = project();
    putKey(p.tracks.foot_l, 0, { ...p.tracks.foot_l.keys[0], p: [0.14, -0.15, 0] });
    const reference = solve(p),
      original = rig.bodyBone('foot_l').matrixWorld.clone();
    p.constraints = {
      body: { foot_l: { grounded: true }, head: { grounded: true }, rifle: { grounded: true } },
    };
    expect(solve(p)).toEqual(reference);
    expect(rig.bodyBone('foot_l').matrixWorld.elements).toEqual(original.elements);
    const sampler = new SharedPoseSampler(rig),
      sample = sampler.sample(p, 0);
    expect(sample.rig.position('foot_l').distanceTo(rig.position('foot_l'))).toBeLessThan(1e-7);
    sampler.dispose();
  });
  it('saves clearance and stretch without changing the animated pose', () => {
    const p = project(),
      s = new StudioStore();
    s.open(p);
    s.patch({ playing: true });
    s.configureConstraint('hand_l', { clearance: 0.03, stretch: true });
    expect(s.state.playing).toBe(true);
    expect(
      controllerConstraints(validateProject(JSON.parse(JSON.stringify(s.state.project)))).hand_l,
    ).toEqual({ clearance: 0.03, stretch: true });
    s.undo();
    expect(s.state.project!.constraints).toBeUndefined();
  });
  it('rejects malformed settings and stretch on non-IK bones', () => {
    for (const c of [
      { grounded: 'yes' },
      { clearance: -1 },
      { clearance: Infinity },
      { stretch: 2 },
    ]) {
      const p = project();
      p.constraints = { body: { hand_l: c as never } };
      expect(() => validateProject(p)).toThrow(/constraint/);
    }
    const p = project();
    p.constraints = { body: { head: { stretch: true } } };
    expect(() => validateProject(p)).toThrow(/constraint/);
  });
  it('places elevated or submerged soles and bent toes flat using mesh geometry', () => {
    for (const side of ['l', 'r'])
      for (const height of [0.25, -0.15]) {
        const p = project(),
          id = ('foot_' + side) as ControlId;
        putKey(p.tracks[id], 0, {
          ...p.tracks[id].keys[0],
          p: [side === 'l' ? 0.14 : -0.14, height, 0.1],
        });
        putKey(
          p.tracks[('toe_' + side) as ControlId],
          0,
          pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.45).toArray()),
        );
        solve(p);
        const before = new Map([...rig.bones].map(([name, b]) => [name, b.matrixWorld.toArray()])),
          targets = rig.groundPose(id, 0.01);
        for (const [name, b] of rig.bones)
          expect(b.matrixWorld.toArray()).toEqual(before.get(name));
        applyTargets(rig, targets);
        expect(actualMeshMinimum(rig, id)).toBeCloseTo(0.01, 5);
        const normal = new Vector3(0, 1, 0).transformDirection(
          rig.bodyBone(id).matrixWorld.clone().multiply(rig.contactFrame(id)),
        );
        expect(normal.y).toBeGreaterThan(0.999);
        expect(targets.has(('toe_' + side) as ControlId)).toBe(true);
      }
  });
  it('uses the preview character own shoe thickness for a ground key', () => {
    rig.reset();
    const root = cloneSkeleton(rig.root) as typeof rig.root;
    root.userData.canonicalSkinning = true;
    root.traverse((mesh) => {
      if (!(mesh instanceof SkinnedMesh)) return;
      mesh.geometry = mesh.geometry.clone();
      const p = mesh.geometry.getAttribute('position'),
        si = mesh.geometry.getAttribute('skinIndex'),
        sw = mesh.geometry.getAttribute('skinWeight');
      for (let i = 0; i < p.count; i++) {
        let weight = 0;
        for (let k = 0; k < 4; k++)
          if (/^(foot|ball)_l$/.test(mesh.skeleton.bones[si.getComponent(i, k)]?.name ?? ''))
            weight += sw.getComponent(i, k);
        p.setY(i, p.getY(i) - 0.025 * weight);
      }
    });
    const target = new ProportionalRig(root, rig),
      p = project(),
      v = solve(p);
    target.sample(rig, v, p, 0, mannyPreviewConfig(rig));
    const a = rig.groundPose('foot_l'),
      b = target.groundPose('foot_l');
    applyTargets(rig, a);
    applyTargets(target, b);
    expect(actualMeshMinimum(target, 'foot_l')).toBeCloseTo(0, 5);
    expect(target.position('foot_l').y).toBeGreaterThan(rig.position('foot_l').y + 0.01);
  });
  it('interpolates into and out of a keyed floor pose without runtime corrections', () => {
    const p = project(),
      id = 'foot_l',
      toe = 'toe_l';
    p.constraints = { body: { foot_l: { stretch: true } } };
    p.tracks[id].interpolation = 'smooth';
    const start = { ...p.tracks[id].keys[0], p: [0.14, 0.26, 0.15] as [number, number, number] };
    putKey(p.tracks[id], 0, start);
    putKey(p.tracks[id], 24, start);
    solve(p);
    const targets = rig.groundPose(id),
      foot = targets.get(id)!,
      toeLocal = foot.clone().invert().multiply(targets.get(toe)!),
      r = rig.rest.get('ball_l')!,
      position = new Vector3(),
      q = new Quaternion();
    toeLocal.decompose(position, q, new Vector3());
    putKey(p.tracks[id], 12, fromMatrix(foot, start));
    putKey(p.tracks[toe], 12, {
      ...p.tracks[toe].keys[0],
      p: position.sub(r.p).toArray() as [number, number, number],
      q: r.q.clone().invert().multiply(q).toArray(),
    });
    solve(p, new Matrix4(), 12);
    expect(actualMeshMinimum(rig, id)).toBeCloseTo(0, 4);
    const at = (frame: number) => {
      const v = solve(p, new Matrix4(), frame);
      return { p: new Vector3(...v[id].p), q: new Quaternion(...v[id].q) };
    };
    for (const frame of [0, 12, 24]) {
      const a = at(Math.max(0, frame - 0.001)),
        b = at(Math.min(24, frame + 0.001));
      expect(a.p.distanceTo(b.p)).toBeLessThan(0.0001);
      expect(a.q.angleTo(b.q)).toBeLessThan(0.0001);
    }
    expect(at(6).p.y).toBeGreaterThan(at(12).p.y + 0.03);
    expect(at(18).p.y).toBeGreaterThan(at(12).p.y + 0.03);
    expect(p.tracks[id].keys.map((k) => k.frame)).toEqual([0, 12, 24]);
  });
  it('keeps fixed arm and leg lengths but reaches distant targets when stretch is enabled', () => {
    for (const [limb, tip, mid] of [
      ['arm', 'hand', 'lowerarm'],
      ['leg', 'foot', 'calf'],
    ] as const) {
      const p = project(),
        id = (tip + '_l') as ControlId,
        target = pose(limb === 'arm' ? [2, 1.4, 0.2] : [1.5, 0.1, 0.4]);
      putKey(p.tracks[id], 0, target);
      solve(p);
      const restMid = rig.bones.get(mid + '_l')!.position.length(),
        restEnd = rig.bones.get(tip + '_l')!.position.length();
      expect(rig.position(tip + '_l').distanceTo(new Vector3(...target.p))).toBeGreaterThan(0.1);
      p.constraints = { body: { [id]: { stretch: true } } };
      solve(p);
      expect(rig.position(tip + '_l').distanceTo(new Vector3(...target.p))).toBeLessThan(0.00001);
      expect(rig.bones.get(mid + '_l')!.position.length() / restMid).toBeCloseTo(
        rig.bones.get(tip + '_l')!.position.length() / restEnd,
        6,
      );
      for (let i = 0; i < 8; i++) {
        solve(p);
        expect(rig.position(tip + '_l').distanceTo(new Vector3(...target.p))).toBeLessThan(0.00001);
      }
      p.constraints = {};
      solve(p);
      expect(rig.bones.get(mid + '_l')!.position.length()).toBeCloseTo(restMid, 8);
      expect(rig.bones.get(tip + '_l')!.position.length()).toBeCloseTo(restEnd, 8);
    }
  });
  it('shrinks back to the original lengths when a second attachment solve brings the target closer', () => {
    const p = project();
    p.constraints = { body: { hand_l: { stretch: true } } };
    putKey(p.tracks.hand_l, 0, pose([2, 1.3, 0]));
    solve(p);
    const mid = rig.bones.get('lowerarm_l')!,
      end = rig.bones.get('hand_l')!,
      restMid = rig.rest.get(mid.name)!.p.length(),
      restEnd = rig.rest.get(end.name)!.p.length();
    expect(mid.position.length()).toBeGreaterThan(restMid);
    rig.solve('l', 'arm', pose([0.2, 1.3, 0.2]), new Vector3(0.5, 1, 0.4));
    expect(mid.position.length()).toBeCloseTo(restMid, 8);
    expect(end.position.length()).toBeCloseTo(restEnd, 8);
  });
});

describe('toe grounding floor plane', () => {
  it('inherits foot clearance and respects an explicit toe override', () => {
    const p = forLayer(createProject({}, false), 'body');
    p.constraints = { body: { foot_l: { clearance: 0.015 } } };
    expect(groundingClearance(p, 'toe_l')).toBe(0.015);
    expect(groundingClearance(p, 'ankle_l')).toBe(0.015);
    expect(groundingClearance(p, 'toe_r')).toBe(0);
    p.constraints.body!.toe_l = { clearance: 0 };
    expect(groundingClearance(p, 'toe_l')).toBe(0);
  });
});

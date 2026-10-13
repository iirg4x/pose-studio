import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { Matrix4, Vector3, Quaternion, PerspectiveCamera } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { MeshGrounding } from '../src/scene/meshGrounding';
import { ControlVisual, pickControl } from '../src/scene/controlVisual';
import { createProject, forLayer, evaluate, pose, putKey } from '../src/core/model';
import type { ControlId } from '../src/core/model';
let rig: MannyRig;
beforeAll(async () => {
  const b = await fs.readFile('public/assets/manny.glb');
  rig = new MannyRig(
    (
      await rigLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
    ).scene,
  );
});
const apply = (targets: Map<ControlId, Matrix4>) => {
  for (const [id, m] of targets) {
    const b = rig.bodyBone(id);
    b.parent!.matrixWorld.clone().invert().multiply(m).decompose(b.position, b.quaternion, b.scale);
    b.updateMatrixWorld(true);
  }
};
describe('foot contact authoring', () => {
  it('grounds toes without separating their joint from the supporting foot', () => {
    for (const side of ['l', 'r'] as const) {
      const foot = ('foot_' + side) as const,
        toe = ('toe_' + side) as const,
        p = forLayer(createProject(rig.restControls, false), 'body');
      putKey(p.tracks[foot], 0, {
        ...p.tracks[foot].keys[0],
        p: [side === 'l' ? 0.14 : -0.14, 0.28, 0.1],
      });
      putKey(
        p.tracks[toe],
        0,
        pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.5).toArray()),
      );
      rig.apply(evaluate(p, 0));
      const joint = rig.bodyBone(toe).position.clone();
      const targets = rig.groundPose(toe);
      expect(targets.has(foot)).toBe(true);
      apply(targets);
      expect(rig.bodyBone(toe).position.distanceTo(joint)).toBeLessThan(1e-6);
      expect(rig.meshMinimum(foot)).toBeCloseTo(0, 5);
      expect(
        new Vector3(0, 1, 0).transformDirection(
          rig.bodyBone(toe).matrixWorld.clone().multiply(rig.contactFrame(toe)),
        ).y,
      ).toBeGreaterThan(0.999);
    }
  });
  it('plants toes while keeping a raised heel and the original toe joint length', () => {
    for (const side of ['l', 'r'] as const) {
      const foot = ('foot_' + side) as const,
        toe = ('toe_' + side) as const,
        p = forLayer(createProject(rig.restControls, false), 'body');
      rig.apply(evaluate(p, 0));
      apply(rig.groundPose(foot));
      const center = rig.bodyBone(toe).getWorldPosition(new Vector3()),
        axis = rig.footGeometry(side).right,
        q = new Quaternion().setFromAxisAngle(axis, 0.55),
        world = new Matrix4()
          .makeTranslation(...center.toArray())
          .multiply(new Matrix4().makeRotationFromQuaternion(q))
          .multiply(new Matrix4().makeTranslation(...center.clone().negate().toArray()))
          .multiply(rig.bodyBone(foot).matrixWorld);
      apply(new Map([[foot, world]]));
      const joint = rig.bodyBone(toe).position.clone(),
        rotation = rig.bodyBone(foot).getWorldQuaternion(new Quaternion()).normalize(),
        targets = rig.groundPose(toe);
      apply(targets);
      expect(
        rig.bodyBone(foot).getWorldQuaternion(new Quaternion()).normalize().angleTo(rotation),
      ).toBeLessThan(1e-6);
      expect(rig.meshMinimum(toe)).toBeCloseTo(0, 5);
      expect(rig.meshMinimum(foot)).toBeGreaterThanOrEqual(-1e-6);
      expect(rig.bodyBone(toe).position.distanceTo(joint)).toBeLessThan(1e-6);
      expect(rig.footContactPoint(side, 'heel').y).toBeGreaterThan(0.025);
    }
  });
  it('keeps the rendered sole above the floor when authoring rotations at each contact pivot', () => {
    for (const side of ['l', 'r'] as const)
      for (const pivot of ['sole', 'heel', 'ball', 'toe'] as const)
        for (const angle of [-0.5, 0.5]) {
          const id = ('foot_' + side) as const,
            p = forLayer(createProject(rig.restControls, false), 'body');
          rig.apply(evaluate(p, 0));
          apply(rig.groundPose(id));
          const before = rig.bodyBone(id).matrixWorld.clone(),
            center = rig.footContactPoint(side, pivot),
            q = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle),
            delta = new Matrix4()
              .makeTranslation(...center.toArray())
              .multiply(new Matrix4().makeRotationFromQuaternion(q))
              .multiply(new Matrix4().makeTranslation(...center.clone().negate().toArray())),
            desired = delta.multiply(before),
            safe = rig.floorRotation(id, desired);
          const min = new MeshGrounding().minimum(rig.root, rig.bodyBone(id), safe);
          expect(min, pivot + ' ' + side).toBeGreaterThanOrEqual(-1e-7);
          expect(
            new Quaternion()
              .setFromRotationMatrix(desired)
              .normalize()
              .angleTo(new Quaternion().setFromRotationMatrix(safe).normalize()),
          ).toBeLessThan(1e-7);
          expect(rig.bodyBone(id).matrixWorld.elements).toEqual(before.elements);
        }
  });
  it('makes heel, ball and toe handles independently pickable from an oblique view', () => {
    for (const side of ['l', 'r'] as const) {
      rig.reset();
      const controls = (['foot', 'toe', 'heel', 'ball'] as const).map((stem) => {
        const id = (stem + '_' + side) as ControlId,
          m = new ControlVisual(id);
        m.setPropShape(rig.footShape(id));
        const world =
          stem === 'heel' || stem === 'ball' ? rig.pivotWorld(id) : rig.bodyBone(id).matrixWorld;
        world.decompose(m.position, m.quaternion, m.scale);
        m.updateMatrixWorld();
        return m;
      });
      const center = rig.footContactPoint(side, 'sole'),
        camera = new PerspectiveCamera(40, 1, 0.01, 20);
      camera.position.copy(center).add(new Vector3(side === 'l' ? 0.65 : -0.65, 0.55, 0.65));
      camera.lookAt(center);
      camera.updateMatrixWorld();
      for (const marker of controls) {
        let best = 0;
        for (let i = 0; i < marker.points.length; i += 2) {
          const p = marker.points[i]
            .clone()
            .lerp(marker.points[i + 1], 0.5)
            .applyMatrix4(marker.matrixWorld)
            .project(camera);
          if (
            pickControl(controls, camera, 900, 900, (p.x + 1) * 450, (1 - p.y) * 450, () => true)[0]
              ?.id === marker.controlId
          )
            best++;
        }
        expect(best, marker.controlId).toBeGreaterThan(2);
      }
      controls.forEach((m) => m.dispose());
    }
  });

  it('plants toe contact across foot pitches without a gap or heel penetration', () => {
    const results = [];
    for (const angle of [-1, -0.5, 0, 0.3, 0.8]) {
      rig.reset();
      const foot = rig.bodyBone('foot_l'),
        toe = rig.bodyBone('toe_l'),
        center = toe.getWorldPosition(new Vector3()),
        q = new Quaternion().setFromAxisAngle(rig.footGeometry('l').right, angle);
      apply(
        new Map([
          [
            'foot_l',
            new Matrix4()
              .makeTranslation(...center.toArray())
              .multiply(new Matrix4().makeRotationFromQuaternion(q))
              .multiply(new Matrix4().makeTranslation(...center.clone().negate().toArray()))
              .multiply(foot.matrixWorld),
          ],
        ]),
      );
      apply(rig.groundPose('toe_l'));
      results.push({ angle, toe: rig.meshMinimum('toe_l'), foot: rig.meshMinimum('foot_l') });
    }
    for (const r of results) {
      expect(r.foot).toBeGreaterThan(-1e-6);
      expect(Math.abs(r.toe!)).toBeLessThan(0.0001);
    }
  });
});

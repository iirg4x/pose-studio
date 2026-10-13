import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { MannyCharacter, mannyPreviewConfig } from '../src/scene/MannyCharacter';
import { RetargetRig } from '../src/scene/RetargetRig';
import { SharedPoseSampler } from '../src/scene/sharedSkeletonExport';
import { blankProject } from '../src/core/assets';
import { fromMatrix, matrix, pose, validateProject } from '../src/core/model';
import type { ControlId, Pose, Project } from '../src/core/model';
import type { MotionRig } from '../src/core/motionRig';

// Numeric bind and motion samples from the UE4 arms FBX, without its mesh/textures.
let fixture: {
  motionRig: MotionRig;
  samples: { frame: number; values: Record<ControlId, Pose>; expected: Record<string, number[]> }[];
};
const load = async () => {
  const b = await fs.readFile('public/assets/manny.glb');
  return (
    await rigLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
  ).scene;
};
const modes = { arm_l: 'ik', arm_r: 'ik', leg_l: 'fk', leg_r: 'fk' } as const;
let source: MannyRig, target: MannyCharacter, project: Project;
beforeAll(async () => {
  fixture = JSON.parse(await fs.readFile('tests/fixtures/ue4-arms-reload.json', 'utf8'));
  source = new MannyRig(await load(), true);
  target = new MannyCharacter(new RetargetRig(await load()), source, mannyPreviewConfig(source));
  project = blankProject(source.restControls);
  project.editing = 'firstPerson';
  project.actionType = 'firstPerson';
  project.end = 104;
  project.fps = 30;
  project.motionRig = fixture.motionRig;
  project.ikReference = 'fk';
  project.limbModes = {
    firstPerson: Object.fromEntries(
      Object.entries(modes).map(([id, mode]) => [id, [{ frame: 0, mode }]]),
    ),
  };
  for (const id of ['hand_l', 'hand_r'] as const)
    project.tracks[id].spaces = [
      { frame: 0, parent: 'rifle', offset: new Matrix4().toArray(), base: new Matrix4().toArray() },
    ];
});
describe('source skeleton independent of preview proportions', () => {
  it('keeps the native elbow bend plane and grip while fitting the target arm lengths', async () => {
    const holster: typeof fixture = JSON.parse(
      await fs.readFile('tests/fixtures/ue4-arms-holster.json', 'utf8'),
    );
    const p = { ...structuredClone(project), motionRig: holster.motionRig, end: 23 };
    source.setMotionRig(holster.motionRig);
    for (const [id, value] of Object.entries(holster.samples[0].values)) {
      const control = id as ControlId;
      if (!p.tracks[control]) continue;
      const attached = id === 'hand_l' || id === 'hand_r';
      p.tracks[control].spaces = attached ? project.tracks[control].spaces : [];
      p.tracks[control].keys = [
        {
          ...(attached
            ? fromMatrix(
                matrix(holster.samples[0].values.rifle).invert().multiply(matrix(value)),
                value,
              )
            : value),
          frame: 0,
        },
      ];
    }
    for (const sample of holster.samples) {
      source.apply(sample.values, modes, {}, true);
      target.first.sample(source, sample.values, p, sample.frame, target.config);
      for (const side of ['l', 'r']) {
        const name = 'lowerarm_' + side,
          bone = target.first.bones.get(name)!,
          rest = target.first.rest.get(name)!;
        // A shorter limb needs a different elbow angle. Preserve the bend plane,
        // lengths and contact, rather than requiring the shoulder to chase FK.
        const bend = (rig: MannyRig) => {
          const a = rig.position('upperarm_' + side),
            b = rig.position(name),
            c = rig.position('hand_' + side),
            axis = c.sub(a).normalize(),
            v = b.sub(a);
          return v.addScaledVector(axis, -v.dot(axis)).normalize();
        };
        expect(bend(target.first).dot(bend(source)), `${name} at ${sample.frame}`).toBeGreaterThan(
          0.9,
        );
        expect(bone.position.distanceTo(rest.p)).toBeLessThan(0.0001);
        expect(
          new Vector3()
            .setFromMatrixPosition(target.first.gripMatrix(side))
            .distanceTo(new Vector3().setFromMatrixPosition(target.first.gripMatrix(side, source))),
        ).toBeLessThan(0.0001);
      }
    }
  });
  it('reproduces the original joints instead of baking a camera-height offset into Manny', () => {
    source.setMotionRig(fixture.motionRig);
    for (const sample of fixture.samples) {
      source.apply(sample.values, modes, {}, true);
      for (const [name, p] of Object.entries(sample.expected))
        expect(
          source.position(name).distanceTo(new Vector3(...p)),
          `${name} at ${sample.frame}`,
        ).toBeLessThan(0.005);
    }
  });
  it('retargets both hands around unchanged camera-authored props, including release poses', () => {
    source.setMotionRig(fixture.motionRig);
    for (const sample of fixture.samples) {
      source.apply(sample.values, modes, {}, true);
      target.first.sample(source, sample.values, project, sample.frame, target.config);
      expect(target.first.props.rifle!.elements).toEqual(matrix(sample.values.rifle).elements);
      for (const side of ['l', 'r']) {
        // Equal grip frames mean the same source-relative contact, not equal wrist locations.
        expect(
          new Vector3()
            .setFromMatrixPosition(target.first.gripMatrix(side))
            .distanceTo(new Vector3().setFromMatrixPosition(target.first.gripMatrix(side, source))),
        ).toBeLessThan(0.002);
        expect(target.first.position('hand_' + side).y).toBeLessThan(2);
        for (const name of ['lowerarm_', 'index_02_'])
          expect(
            target.first.bones
              .get(name + side)!
              .position.distanceTo(target.first.rest.get(name + side)!.p),
          ).toBeLessThan(0.0001);
        // The FBX has a small authored wrist translation; retain that motion without stretching to source limb lengths.
        const wristRatio =
          target.first.bones.get('hand_' + side)!.position.length() /
          target.first.rest.get('hand_' + side)!.p.length();
        expect(wristRatio).toBeGreaterThan(0.98);
        expect(wristRatio).toBeLessThan(1.02);
      }
      const camera = new Matrix4().makeTranslation(0, 1.65, 0);
      expect(target.first.cameraMatrix(camera).elements).toEqual(camera.elements);
    }
  });
  it('distributes forearm roll onto Manny’s extra twist joints when the source has only one', () => {
    source.setMotionRig(fixture.motionRig);
    const sample = fixture.samples[0];
    source.apply(sample.values, modes, {}, true);
    target.first.sample(source, sample.values, project, 0, target.config);
    for (const side of ['l', 'r']) {
      const name = 'lowerarm_twist_02_' + side;
      expect(fixture.motionRig.authoredBones).not.toContain(name);
      const near = target.first.bones
          .get('lowerarm_twist_01_' + side)!
          .quaternion.angleTo(target.first.rest.get('lowerarm_twist_01_' + side)!.q),
        far = target.first.bones.get(name)!.quaternion.angleTo(target.first.rest.get(name)!.q);
      expect(far).toBeGreaterThan(0.01);
      expect(far / near).toBeCloseTo(2, 4);
    }
  });
  it('restores the canonical bind when switching back to an ordinary clip', () => {
    source.setMotionRig();
    const rest = [...source.rest].map(([n, r]) => [n, r.world.toArray()] as const);
    source.setMotionRig(fixture.motionRig);
    source.apply(fixture.samples[0].values, modes, {}, true);
    source.setMotionRig();
    for (const [n, world] of rest) expect(source.rest.get(n)!.world.elements).toEqual(world);
    expect(source.motionRig).toBeUndefined();
  });
  it('keeps the reference through save/load and rejects malformed reference coordinates', () => {
    expect(validateProject(JSON.parse(JSON.stringify(project))).motionRig).toEqual(
      fixture.motionRig,
    );
    expect(() =>
      validateProject({
        ...project,
        motionRig: { partial: true, positions: { hand_l: [NaN, 0, 0] } },
      }),
    ).toThrow('reference skeleton');
  });
  it('exports the same Manny pose as the preview, rather than the authoring proportions', async () => {
    const exportSource = new MannyRig(await load(), true),
      sampler = new SharedPoseSampler(exportSource),
      p = structuredClone(project),
      sample = fixture.samples[0];
    // Store world poses with identity parent transforms for this one-frame check.
    for (const [id, value] of Object.entries(sample.values)) {
      if (!p.tracks[id as ControlId]) continue;
      p.tracks[id as ControlId].keys = [{ ...value, frame: 0 }];
      p.tracks[id as ControlId].spaces = [];
    }
    for (const id of ['hand_l', 'hand_r'] as const) {
      p.tracks[id].spaces = project.tracks[id].spaces;
      p.tracks[id].keys = [
        {
          ...pose(),
          ...sample.values[id],
          p: new Vector3(...sample.values[id].p)
            .applyMatrix4(matrix(sample.values.rifle).invert())
            .toArray(),
          q: new Quaternion(...sample.values.rifle.q)
            .invert()
            .multiply(new Quaternion(...sample.values[id].q))
            .toArray(),
          frame: 0,
        },
      ];
    }
    source.setMotionRig(fixture.motionRig);
    source.apply(sample.values, modes, {}, true);
    target.first.sample(source, sample.values, project, 0, target.config);
    const output = sampler.sample(p, 0);
    expect(output.rig).not.toBe(exportSource);
    for (const name of ['hand_l', 'hand_r', 'index_03_l', 'thumb_03_r'])
      expect(output.rig.position(name).distanceTo(target.first.position(name))).toBeLessThan(
        0.00001,
      );
    sampler.dispose();
  });
});

import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { AnimationMixer, Matrix4, Quaternion, Vector3 } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { sharedRuntimeRig } from '../src/scene/sharedRuntimeRig';
import { sharedRuntimeInputs } from '../src/scene/sharedRuntimeInputs';
import { SharedPoseSampler, sharedAnimationGLB } from '../src/scene/sharedSkeletonExport';
import { blankProject } from '../src/core/assets';
import { clone, pose, putKey } from '../src/core/model';
import type { MotionRig } from '../src/core/motionRig';
let source: MannyRig;
beforeAll(async () => {
  const bytes = await fs.readFile('public/assets/manny.glb');
  source = new MannyRig(
    (
      await rigLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      )
    ).scene,
  );
});
const close = (a: Matrix4, b: Matrix4, tolerance = 1e-5) =>
  expect(Math.max(...a.elements.map((n, i) => Math.abs(n - b.elements[i])))).toBeLessThan(
    tolerance,
  );
const movingProject = () => {
  source.setMotionRig();
  source.reset();
  const p = blankProject(source.restControls);
  p.end = 2;
  p.fps = 30;
  putKey(p.tracks.root, 0, pose([0.3, 0.1, -0.2]));
  putKey(
    p.tracks.root,
    2,
    pose([0.6, 0.2, -0.1], new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.25).toArray()),
  );
  return p;
};
describe('self-contained shared runtime animation inputs', () => {
  it('carries immutable source reference/calibration and evaluated controllers without applying root motion twice', () => {
    const p = movingProject(),
      out = sharedRuntimeRig(source, []),
      inputs = sharedRuntimeInputs(out),
      sampler = new SharedPoseSampler(source);
    const before = JSON.stringify(p);
    let calibration: number[][] | undefined;
    try {
      for (const frame of [0, 1.25, 2, 0.5]) {
        const sample = sampler.sampleSource(p, frame),
          sourceBefore = [...source.bones.values()].map((b) => b.matrixWorld.toArray());
        out.sync(sample.rig, sample.props);
        inputs.sync(source, p, sample.values, new Matrix4().fromArray(sample.camera));
        close(out.bones.get(inputs.layout.carrier)!.matrixWorld, new Matrix4());
        for (const { driver, bone } of inputs.layout.reference)
          close(out.bones.get(bone)!.matrixWorld, source.rest.get(driver)!.world);
        for (const { control, bone } of inputs.layout.controllers)
          expect(
            out.bones
              .get(bone)!
              .getWorldPosition(new Vector3())
              .distanceTo(new Vector3(...sample.values[control].p)),
          ).toBeLessThan(1e-8);
        close(
          out.bones.get(inputs.layout.camera)!.matrixWorld,
          new Matrix4().fromArray(sample.camera),
        );
        close(
          out.bones.get(inputs.layout.settings)!.matrixWorld,
          new Matrix4().makeTranslation(
            p.motionRig?.partial ? 1 : 0,
            p.editing === 'firstPerson' ? 1 : 0,
            p.ikReference === 'fk' ? 1 : 0,
          ),
        );
        const actual = inputs.layout.calibration.map(({ bone }) =>
          out.bones.get(bone)!.matrixWorld.toArray(),
        );
        if (calibration)
          actual.forEach((m, i) =>
            close(new Matrix4().fromArray(m), new Matrix4().fromArray(calibration![i])),
          );
        else calibration = actual;
        expect([...source.bones.values()].map((b) => b.matrixWorld.toArray())).toEqual(
          sourceBefore,
        );
      }
      expect(JSON.stringify(p)).toBe(before);
      expect(new Set(out.hierarchy.map((x) => x.name)).size).toBe(out.bones.size);
      for (const mesh of [...out.variants, out.dummy])
        expect(mesh.skeleton.bones.map((b) => b.name)).toEqual([...out.bones.keys()]);
      expect(() => sharedRuntimeInputs(out)).toThrow('conflicts');
    } finally {
      out.dispose();
      sampler.dispose();
    }
  });
  it('updates clip references when switching native skeleton proportions and recalibrates only at frame zero', async () => {
    const p = movingProject(),
      out = sharedRuntimeRig(source, []),
      inputs = sharedRuntimeInputs(out),
      sampler = new SharedPoseSampler(source);
    const native = JSON.parse(await fs.readFile('tests/fixtures/ue4-arms-reload.json', 'utf8')) as {
      motionRig: MotionRig;
    };
    try {
      const sample = sampler.sampleSource(p, 1);
      out.sync(source, sample.props);
      inputs.sync(source, p, sample.values, new Matrix4().fromArray(sample.camera));
      const ref = out.bones.get('pose_reference_hand_l')!.matrixWorld.clone(),
        zero = out.bones.get('pose_calibration_root')!.matrixWorld.clone();
      const next = clone(p);
      next.motionRig = native.motionRig;
      next.editing = 'firstPerson';
      next.ikReference = 'fk';
      putKey(next.tracks.root, 0, pose([-0.4, 0.2, 0.6]));
      const nextSample = sampler.sampleSource(next, 2);
      out.sync(source, nextSample.props);
      inputs.sync(source, next, nextSample.values, new Matrix4().fromArray(nextSample.camera));
      expect(
        new Vector3()
          .setFromMatrixPosition(out.bones.get('pose_reference_hand_l')!.matrixWorld)
          .distanceTo(new Vector3().setFromMatrixPosition(ref)),
      ).toBeGreaterThan(0.01);
      close(out.bones.get('pose_reference_hand_l')!.matrixWorld, source.rest.get('hand_l')!.world);
      close(
        out.bones.get(inputs.layout.settings)!.matrixWorld,
        new Matrix4().makeTranslation(native.motionRig.partial ? 1 : 0, 1, 1),
      );
      expect(
        new Vector3()
          .setFromMatrixPosition(out.bones.get('pose_calibration_root')!.matrixWorld)
          .distanceTo(new Vector3().setFromMatrixPosition(zero)),
      ).toBeGreaterThan(0.5);
      const expected = sampler.sampleSource(next, 0);
      close(
        out.bones.get('pose_calibration_root')!.matrixWorld,
        expected.rig.bones.get('root')!.matrixWorld,
      );
    } finally {
      out.dispose();
      sampler.dispose();
      source.setMotionRig();
    }
  });
  it('can retry calibration after a missing source reference is repaired', () => {
    const p = movingProject(),
      out = sharedRuntimeRig(source, []),
      inputs = sharedRuntimeInputs(out),
      sampler = new SharedPoseSampler(source),
      rest = new Map(source.rest);
    try {
      const sample = sampler.sampleSource(p, 0);
      out.sync(source, sample.props);
      const camera = new Matrix4().fromArray(sample.camera);
      source.rest.delete('hand_r');
      expect(() => inputs.sync(source, p, sample.values, camera)).toThrow(
        'Missing source reference bone: hand_r',
      );
      source.rest.clear();
      for (const [name, value] of rest) source.rest.set(name, value);
      expect(() => inputs.sync(source, p, sample.values, camera)).not.toThrow();
      close(out.bones.get('pose_reference_hand_r')!.matrixWorld, source.rest.get('hand_r')!.world);
    } finally {
      source.rest.clear();
      for (const [name, value] of rest) source.rest.set(name, value);
      out.dispose();
      sampler.dispose();
    }
  });
  it('round-trips controller and reference tracks inside a single GLB animation', async () => {
    const p = movingProject(),
      out = sharedRuntimeRig(source, []),
      inputs = sharedRuntimeInputs(out),
      sampler = new SharedPoseSampler(source);
    vi.stubGlobal(
      'FileReader',
      class {
        result?: ArrayBuffer;
        onloadend?: () => void;
        onerror?: (e: unknown) => void;
        readAsArrayBuffer(blob: Blob) {
          blob
            .arrayBuffer()
            .then((data) => {
              this.result = data;
              this.onloadend?.();
            })
            .catch((e) => this.onerror?.(e));
        }
      },
    );
    try {
      const bytes = await sharedAnimationGLB(
        out,
        'Runtime input test',
        p.fps,
        p.end,
        (frame) => {
          const sample = sampler.sampleSource(p, frame);
          out.sync(source, sample.props);
          inputs.sync(source, p, sample.values, new Matrix4().fromArray(sample.camera));
        },
        () => {},
      );
      const gltf = await rigLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        '',
      );
      expect(gltf.animations).toHaveLength(1);
      const mixer = new AnimationMixer(gltf.scene);
      mixer.clipAction(gltf.animations[0]).play();
      for (const frame of [0.125, 0.75, 1.625]) {
        mixer.setTime(frame / p.fps);
        gltf.scene.updateMatrixWorld(true);
        const sample = sampler.sampleSource(p, frame);
        for (const { control, bone } of inputs.layout.controllers)
          expect(
            gltf.scene
              .getObjectByName(bone)!
              .getWorldPosition(new Vector3())
              .distanceTo(new Vector3(...sample.values[control].p)),
          ).toBeLessThan(0.0002);
        for (const { driver, bone } of inputs.layout.reference)
          close(
            gltf.scene.getObjectByName(bone)!.matrixWorld,
            source.rest.get(driver)!.world,
            0.0002,
          );
        close(
          gltf.scene.getObjectByName(inputs.layout.settings)!.matrixWorld,
          new Matrix4().makeTranslation(
            p.motionRig?.partial ? 1 : 0,
            p.editing === 'firstPerson' ? 1 : 0,
            p.ikReference === 'fk' ? 1 : 0,
          ),
          0.0002,
        );
      }
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
    } finally {
      vi.unstubAllGlobals();
      out.dispose();
      sampler.dispose();
    }
  }, 20000);
});

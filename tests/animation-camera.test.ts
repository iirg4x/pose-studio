import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { Matrix4, Quaternion, Vector3, Group } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { animationCamera, cameraControl } from '../src/scene/animationCamera';
import {
  createProject,
  createFirstPersonAction,
  evaluate,
  matrix,
  fromMatrix,
  CAMERA_REFERENCE,
  validateProject,
  visibleControls,
} from '../src/core/model';
import { StudioStore } from '../src/core/store';

it('moves the lens with an animated bone without moving the hands, and handles an external rig transform', async () => {
  const bytes = await fs.readFile('public/assets/manny.glb'),
    rig = new MannyRig(
      (
        await rigLoader().parseAsync(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          '',
        )
      ).scene,
    );
  const p = createProject(rig.restControls, false),
    before = evaluate(p, 0);
  rig.apply(before);
  p.cameraBinding = {
    bone: 'head',
    enabled: true,
    offset: rig.bones
      .get('head')!
      .matrixWorld.clone()
      .invert()
      .multiply(matrix(CAMERA_REFERENCE))
      .toArray(),
  };
  const head = rig.bones.get('head')!,
    hand = rig.position('hand_r'),
    camera0 = animationCamera(p, rig, before.camera);
  head.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1));
  head.updateMatrixWorld(true);
  const animated = animationCamera(p, rig, before.camera);
  expect(
    new Quaternion()
      .setFromRotationMatrix(camera0)
      .angleTo(new Quaternion().setFromRotationMatrix(animated)),
  ).toBeCloseTo(0.1);
  expect(rig.position('hand_r').distanceTo(hand)).toBeLessThan(1e-9);
  const group = new Group();
  group.position.set(2, 3, 4);
  group.rotation.y = 0.4;
  group.add(rig.root);
  group.updateMatrixWorld(true);
  animationCamera(p, rig, before.camera).elements.forEach((v, i) =>
    expect(v).toBeCloseTo(animated.elements[i]),
  );
  const desired = animated
      .clone()
      .premultiply(new Matrix4().makeRotationZ(0.2))
      .setPosition(0.1, 1.7, 0.2),
    control = fromMatrix(cameraControl(p, rig, desired, before.camera), before.camera);
  animationCamera(p, rig, control).elements.forEach((v, i) =>
    expect(v).toBeCloseTo(desired.elements[i]),
  );
  expect(control.fov).toBe(before.camera.fov);
  p.cameraBinding.enabled = false;
  animationCamera(p, rig, before.camera).elements.forEach((v, i) =>
    expect(v).toBeCloseTo(camera0.elements[i]),
  );
});
it('persists camera bindings, exposes the driving bone and supports undo without pausing', () => {
  const p = createProject({}, false);
  p.cameraBinding = { bone: 'head', enabled: true, offset: new Matrix4().toArray() };
  expect(visibleControls('firstPerson', p)).toContain('head');
  expect(validateProject(p).cameraBinding).toEqual(p.cameraBinding);
  p.editing = 'body';
  p.actionType = 'body';
  expect(createFirstPersonAction(p, 'body').cameraBinding).toEqual(p.cameraBinding);
  const s = new StudioStore();
  s.open(p);
  s.patch({ playing: true });
  s.setCameraMotion(false);
  expect(s.state.playing).toBe(true);
  expect(s.state.project!.cameraBinding!.enabled).toBe(false);
  s.undo();
  expect(s.state.project!.cameraBinding!.enabled).toBe(true);
  expect(() =>
    validateProject({ ...p, cameraBinding: { ...p.cameraBinding, bone: 'missing' } }),
  ).toThrow('camera bone');
});

import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import {
  createProject,
  forLayer,
  evaluate,
  putKey,
  pose,
  clone,
  validateProject,
} from '../src/core/model';
import { boneFollowing } from '../src/core/boneFollowing';
import { addAnimationLayer } from '../src/core/layers';
import {
  trackFrames,
  moveTimelineKeys,
  copyTimelineKeys,
  pasteTimelineKeys,
  deleteTimelineKeys,
} from '../src/core/timelineKeys';
let rig: MannyRig;
const q = (angle: number) =>
  new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), angle).toArray();
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
});
const project = () => {
  const p = forLayer(createProject(rig.restControls, false), 'body');
  p.end = 30;
  putKey(p.tracks.root, 0, pose());
  putKey(p.tracks.root, 20, pose([0.4, 0.1, 0.2], q(0.8)));
  return p;
};
const apply = (p: ReturnType<typeof project>, frame: number) =>
  rig.apply(evaluate(p, frame), {}, boneFollowing(p, frame));
const head = () => rig.bodyBone('head');
const closeMatrix = (a: Matrix4, b: Matrix4) =>
  expect(Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])))).toBeLessThan(1e-6);
describe('keyed bone following', () => {
  for (const [position, rotation] of [
    [true, false],
    [false, true],
    [false, false],
    [true, true],
  ])
    it(`independently follows position=${position} rotation=${rotation} without a switch pop`, () => {
      const p = project();
      apply(p, 0);
      const initial = head().matrixWorld.clone(),
        event = rig.captureFollowing('head', 0, position, rotation);
      p.tracks.head.following = [event];
      apply(p, 0);
      closeMatrix(head().matrixWorld, initial);
      apply(p, 20);
      const later = head().matrixWorld.clone(),
        natural = clone(p);
      delete natural.tracks.head.following;
      apply(natural, 20);
      const expected = head().matrixWorld.clone();
      expect(
        new Vector3()
          .setFromMatrixPosition(later)
          .distanceTo(new Vector3().setFromMatrixPosition(position ? expected : initial)),
      ).toBeLessThan(1e-6);
      expect(
        new Quaternion()
          .setFromRotationMatrix(later)
          .normalize()
          .angleTo(
            new Quaternion().setFromRotationMatrix(rotation ? expected : initial).normalize(),
          ),
      ).toBeLessThan(1e-6);
      apply(p, 20);
      const reconnect = rig.captureFollowing('head', 20, true, true);
      p.tracks.head.following.push(reconnect);
      apply(p, 20);
      closeMatrix(head().matrixWorld, later);
    });
  it('keeps the bone editable after detaching and supports inverse gizmo transforms', () => {
    const p = project();
    apply(p, 0);
    p.tracks.head.following = [rig.captureFollowing('head', 0, false, false)];
    putKey(p.tracks.head, 20, pose([0.01, 0.02, 0.03], q(0.2)));
    apply(p, 20);
    const input = rig.inputForWorld('head', head().matrixWorld.clone()),
      value = evaluate(p, 20).head,
      rest = rig.rest.get('head')!;
    closeMatrix(
      input,
      new Matrix4().compose(
        rest.p.clone().add(new Vector3(...value.p)),
        rest.q.clone().multiply(new Quaternion(...value.q)),
        rest.s,
      ),
    );
  });
  it('stores switches on the chosen layer, restores them after reload, and edits their timeline keys', () => {
    let p = addAnimationLayer(project(), 'additive');
    apply(p, 4);
    p.tracks.head.following = [rig.captureFollowing('head', 4, true, false)];
    p = validateProject(p);
    expect(boneFollowing(p, 4).head?.rotation).toBe(false);
    expect(boneFollowing(p, 3).head).toBeUndefined();
    expect(trackFrames(p.tracks.head)).toContain(4);
    const moved = moveTimelineKeys(p, [{ id: 'head', frame: 4 }], 3).project;
    expect(boneFollowing(moved, 6).head).toBeUndefined();
    expect(boneFollowing(moved, 7).head?.rotation).toBe(false);
    const pasted = pasteTimelineKeys(
      moved,
      copyTimelineKeys(moved, [{ id: 'head', frame: 7 }])!,
      12,
    ).project;
    expect(pasted.tracks.head.following?.map((k) => k.frame)).toEqual([7, 12]);
    expect(
      deleteTimelineKeys(pasted, [{ id: 'head', frame: 12 }]).project.tracks.head.following?.map(
        (k) => k.frame,
      ),
    ).toEqual([7]);
    moved.layers!.at(-1)!.enabled = false;
    expect(boneFollowing(moved, 7).head).toBeUndefined();
  });
});

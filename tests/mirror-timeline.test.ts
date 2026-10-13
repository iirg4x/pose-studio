import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { Matrix4, Quaternion, Euler } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { mirrorTimelineClipboard } from '../src/core/mirrorTimeline';
import { copyTimelineKeys, pasteTimelineKeys } from '../src/core/timelineKeys';
import { mirrorControlPose } from '../src/core/mirrorPose';
import {
  createProject,
  forLayer,
  putKey,
  pose,
  sample,
  matrix,
  clone,
  switchParent,
  evaluate,
} from '../src/core/model';
import { CONTROLS, isOffsetControl } from '../src/core/controls';
import type { ControlId } from '../src/core/model';
import { ensureCurve } from '../src/core/curves';
let rig: MannyRig;
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
const rest = (id: ControlId) => {
  const r = rig.rest.get(CONTROLS[id].bone!);
  return r
    ? {
        world: r.world,
        parent: r.world.clone().multiply(new Matrix4().compose(r.p, r.q, r.s).invert()),
      }
    : { world: new Matrix4(), parent: new Matrix4() };
};
const near = (a: number[], b: number[], tol = 0.0001) =>
  a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol));
describe('Mirrored timeline clipboard', () => {
  it('mirrors complete keyed poses to opposite controls without changing the clipboard', () => {
    const p = forLayer(createProject(rig.restControls, false), 'body');
    for (const id of ['hand_l', 'toe_l', 'upperarm_l'] as ControlId[]) {
      putKey(
        p.tracks[id],
        0,
        pose([0.1, 0.2, 0.3], new Quaternion().setFromEuler(new Euler(0.2, 0.3, 0.1)).toArray()),
      );
      putKey(
        p.tracks[id],
        10,
        pose([0.2, 0.4, 0.5], new Quaternion().setFromEuler(new Euler(0.5, 0.2, 0.4)).toArray()),
      );
    }
    const clip = copyTimelineKeys(
        p,
        ['hand_l', 'toe_l', 'upperarm_l'].flatMap((id) =>
          [0, 10].map((frame) => ({ id: id as ControlId, frame })),
        ),
      )!,
      before = clone(clip),
      mirrored = mirrorTimelineClipboard(clip, p, rest),
      result = pasteTimelineKeys(p, mirrored, 20);
    expect(clip).toEqual(before);
    expect(result.selection.map((k) => k.id)).toEqual([
      'hand_r',
      'hand_r',
      'toe_r',
      'toe_r',
      'upperarm_r',
      'upperarm_r',
    ]);
    for (const item of clip.items) {
      const target = (item.id.slice(0, -1) + 'r') as ControlId,
        a = rest(item.id),
        b = rest(target);
      for (const frame of [0, 2.5, 5, 10])
        near(
          matrix(sample(result.project.tracks[target], frame + 20)).toArray(),
          matrix(
            mirrorControlPose(
              sample(item.track, frame),
              a.world,
              b.world,
              isOffsetControl(item.id),
              a.parent,
              b.parent,
            ),
          ).toArray(),
        );
    }
  });
  it('keeps sparse Bézier key times and mirrors free handle slopes', () => {
    const p = forLayer(createProject(rig.restControls, false), 'body'),
      t = p.tracks.hand_l;
    t.spaces = [];
    putKey(t, 0, pose([0.1, 0.5, 0.3]));
    putKey(t, 10, pose([0.3, 0.8, 0.6]));
    const curve = ensureCurve(t, 'px');
    curve.keys[0].handle = 'free';
    curve.keys[0].right = [3, 8];
    curve.keys[1].handle = 'free';
    curve.keys[1].left = [-2, -4];
    const clip = copyTimelineKeys(p, [
        { id: 'hand_l', frame: 0 },
        { id: 'hand_l', frame: 10 },
      ])!,
      out = mirrorTimelineClipboard(clip, p, rest),
      result = pasteTimelineKeys(p, out, 20).project.tracks.hand_r;
    expect(result.curves!.px!.keys.filter((k) => k.frame >= 20).map((k) => k.frame)).toEqual([
      20, 30,
    ]);
    expect(result.curves!.px!.keys.at(-1)!.left).toEqual([-2, 4]);
    for (const f of [0, 1.5, 3, 6, 8.5, 10])
      expect(sample(result, f + 20).p[0]).toBeCloseTo(-sample(t, f).p[0], 5);
  });
  it('mirrors captured world-space attachment keys without changing their timing', () => {
    let p = forLayer(createProject(rig.restControls, false), 'body');
    p.tracks.hand_l.spaces = [];
    putKey(p.tracks.hand_l, 0, pose([0.2, 1, 0.3]));
    putKey(p.tracks.hand_l, 10, pose([0.3, 1.2, 0.4]));
    p = switchParent(p, 'hand_l', 'world', 0);
    const clip = copyTimelineKeys(p, [
        { id: 'hand_l', frame: 0 },
        { id: 'hand_l', frame: 10 },
      ])!,
      mirrored = mirrorTimelineClipboard(clip, p, rest),
      next = pasteTimelineKeys(p, mirrored, 20).project,
      a = rest('hand_l'),
      b = rest('hand_r');
    for (const f of [0, 5, 10])
      near(
        matrix(evaluate(next, f + 20).hand_r).toArray(),
        matrix(mirrorControlPose(evaluate(p, f).hand_l, a.world, b.world, false)).toArray(),
      );
  });
  it('preserves quaternion channel interpolation through the mirrored basis', () => {
    const p = forLayer(createProject(rig.restControls, false), 'body'),
      t = p.tracks.hand_l;
    t.spaces = [];
    t.rotationMode = 'quaternion';
    p.tracks.hand_r.rotationMode = 'quaternion';
    putKey(
      t,
      0,
      pose([0, 1, 0], new Quaternion().setFromEuler(new Euler(0.2, 0.1, 0.3)).toArray()),
    );
    putKey(
      t,
      10,
      pose([0, 1, 0], new Quaternion().setFromEuler(new Euler(0.5, 0.4, -0.1)).toArray()),
    );
    ensureCurve(t, 'qx');
    const clip = copyTimelineKeys(p, [
        { id: 'hand_l', frame: 0 },
        { id: 'hand_l', frame: 10 },
      ])!,
      out = mirrorTimelineClipboard(clip, p, rest),
      result = pasteTimelineKeys(p, out, 20).project.tracks.hand_r,
      a = rest('hand_l'),
      b = rest('hand_r');
    for (const f of [0, 2, 5, 8, 10])
      near(
        matrix(sample(result, f + 20)).toArray(),
        matrix(mirrorControlPose(sample(t, f), a.world, b.world, false)).toArray(),
      );
  });
});

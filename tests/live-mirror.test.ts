import { describe, it, expect } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import {
  createProject,
  clone,
  evaluate,
  putKey,
  pose,
  validateProject,
  limbMode,
  matrix,
} from '../src/core/model';
import { makeMirrorLinks, mirrorFrame } from '../src/core/liveMirror';
import { addAnimationLayer, editLayerAllowed, syncLayers } from '../src/core/layers';
import { ensureCurve } from '../src/core/curves';
import { StudioStore } from '../src/core/store';
import { moveTimelineKeys, pasteTimelineKeys, copyTimelineKeys } from '../src/core/timelineKeys';
import { boneFollowing } from '../src/core/boneFollowing';
const rest = () => ({ world: new Matrix4(), parent: new Matrix4() });
const setup = () => {
  const p = createProject({}, false);
  p.editing = 'body';
  p.end = 21;
  p.loop = { enabled: true, start: 0, end: 21 };
  const t = p.tracks.foot_l;
  t.keys = [
    { ...pose([0.2, 0.1, 0]), frame: 0 },
    { ...pose([0.2, 0.35, 0.6]), frame: 10.5 },
    { ...pose([0.2, 0.1, 0]), frame: 21 },
  ];
  t.interpolation = 'smooth';
  p.mirrorLinks = { body: makeMirrorLinks(p, ['foot_l', 'knee_l', 'toe_l'], 0.5, rest) };
  return p;
};
describe('live animation mirror links', () => {
  it('alternates half a cycle at fractional frames without creating keys', () => {
    const p = setup(),
      before = clone(p.tracks),
      original = { ...p, mirrorLinks: undefined };
    for (const f of [0, 0.25, 4.3, 10.5, 15, 20.999, 21]) {
      const source = evaluate(original, mirrorFrame(p, f, 0.5)).foot_l,
        target = evaluate(p, f).foot_r;
      expect(target.p).toEqual([-source.p[0], source.p[1], source.p[2]]);
    }
    expect(p.tracks).toEqual(before);
    expect(mirrorFrame(p, 0, 0.5)).toBe(10.5);
  });
  it('updates immediately when source keys, tangents or modifiers change', () => {
    const p = setup(),
      curve = ensureCurve(p.tracks.foot_l, 'py');
    curve.keys[1].value = 68;
    curve.keys[1].handle = 'free';
    curve.keys[1].left = [-4, 15];
    curve.modifiers = [
      { id: 'bounce', type: 'sine', enabled: true, amplitude: 3, period: 21, phase: 0 },
    ];
    const original = { ...p, mirrorLinks: undefined };
    for (const f of [0, 1.25, 7, 15])
      expect(evaluate(p, f).foot_r.p[1]).toBeCloseTo(
        evaluate(original, mirrorFrame(p, f, 0.5)).foot_l.p[1],
        9,
      );
  });
  it('mirrors evaluated layers and keeps root travel at the current time', () => {
    let p = setup();
    putKey(p.tracks.root, 21, pose([3, 0, 1]));
    p = addAnimationLayer(p, 'pose');
    p.layers!.at(-1)!.space = 'world';
    p.tracks.foot_l.keys[0] = { ...pose([0, -0.1, 0]), frame: 0, layerPosition: true };
    syncLayers(p);
    for (const f of [0, 4, 11, 21]) {
      const at = mirrorFrame(p, f, 0.5),
        source = evaluate({ ...p, mirrorLinks: undefined }, at),
        target = evaluate(p, f),
        local = source.foot_l.p.map((v, i) => v - source.root.p[i]);
      expect(target.foot_r.p[0]).toBeCloseTo(target.root.p[0] - local[0]);
      expect(target.foot_r.p[1]).toBeCloseTo(target.root.p[1] + local[1]);
    }
  });
  it('accounts for asymmetric rest axes for bone rotations', () => {
    const p = setup(),
      a = new Matrix4().makeRotationY(0.6),
      b = new Matrix4().makeRotationZ(-0.3);
    p.tracks.toe_l.keys[0].q = new Quaternion()
      .setFromAxisAngle(new Vector3(1, 0, 0), 0.4)
      .toArray();
    p.mirrorLinks = {
      body: makeMirrorLinks({ ...p, mirrorLinks: undefined }, ['toe_l'], 0, (id) => ({
        world: id === 'toe_l' ? a : b,
        parent: new Matrix4(),
      })),
    };
    const values = evaluate(p, 2),
      ref = new Matrix4().makeScale(-1, 1, 1),
      expected = ref
        .clone()
        .multiply(a)
        .multiply(matrix(values.toe_l))
        .multiply(a.clone().invert())
        .multiply(ref),
      actual = b.clone().multiply(matrix(values.toe_r)).multiply(b.clone().invert());
    expect(
      new Quaternion()
        .setFromRotationMatrix(actual)
        .angleTo(new Quaternion().setFromRotationMatrix(expected)),
    ).toBeLessThan(1e-7);
  });
  it('drives matching IK/FK modes, locks destination edits and rejects cycles', () => {
    const p = setup();
    p.limbModes = {
      body: {
        leg_l: [
          { frame: 0, mode: 'ik' },
          { frame: 10, mode: 'fk' },
        ],
      },
    };
    expect(limbMode(p, 'leg_r', 0)).toBe('fk');
    expect(editLayerAllowed(p, 'foot_r')).toBe(false);
    expect(() => moveTimelineKeys(p, [{ id: 'foot_r', frame: 0 }], 2)).toThrow(/source/);
    const clip = copyTimelineKeys(p, [{ id: 'foot_r', frame: 0 }])!;
    expect(() => pasteTimelineKeys(p, clip, 2)).toThrow(/source/);
    expect(() => makeMirrorLinks(p, ['foot_r'], 0, rest)).toThrow(/opposite direction/);
  });
  it('survives save/reopen and undo; unlink restores the original target', () => {
    const p = setup(),
      s = new StudioStore(),
      target = clone(p.tracks.foot_r);
    s.patch({
      project: validateProject(JSON.parse(JSON.stringify(p))),
      selected: 'foot_r',
      selection: ['foot_r'],
    });
    s.addKey();
    s.editWorld('foot_r', pose([9, 9, 9]));
    expect(s.state.project!.tracks.foot_r).toEqual(target);
    s.setMirrorPhase(['foot_r'], 0);
    expect(evaluate(s.state.project!, 5).foot_r.p[1]).toBeCloseTo(
      evaluate({ ...p, mirrorLinks: undefined }, 5).foot_l.p[1],
    );
    s.unlinkMirrors(['foot_r']);
    expect(s.state.project!.tracks.foot_r).toEqual(target);
    expect(editLayerAllowed(s.state.project!, 'foot_r')).toBe(true);
    s.undo();
    expect(editLayerAllowed(s.state.project!, 'foot_r')).toBe(false);
  });
  it('does not keep stale following constraints from the old destination', () => {
    const p = setup();
    p.tracks.toe_r.following = [
      {
        frame: 0,
        position: false,
        rotation: false,
        world: new Matrix4().toArray(),
        parent: new Matrix4().toArray(),
        local: new Matrix4().toArray(),
      },
    ];
    expect(boneFollowing(p, 0).toe_r).toBeUndefined();
  });
});

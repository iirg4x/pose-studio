import { describe, it, expect } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { StudioStore } from '../src/core/store';
import { createProject, pose, putKey, createBodyAction, sample, clone } from '../src/core/model';
import {
  addAnimationLayer,
  selectAnimationLayer,
  syncLayers,
  keyingFrame,
} from '../src/core/layers';
import { ensureCurve } from '../src/core/curves';
describe('controller rest shortcuts', () => {
  for (const kind of ['location', 'rotation'] as const)
    it(kind + ' reset is a repeatable command, not a toggle or repeated undo entry', () => {
      const p = createProject({}, false),
        s = new StudioStore();
      putKey(
        p.tracks.root,
        12,
        pose(
          [0.2, 0.3, 0.4],
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.6).toArray(),
        ),
      );
      s.open(p);
      s.patch({ selected: 'root', frame: 12 });
      s.resetSelected(kind);
      const once = s.state.project;
      for (let i = 0; i < 3; i++) s.resetSelected(kind);
      expect(s.state.project).toBe(once);
      const value = sample(s.state.project!.tracks.root, 12);
      expect(kind === 'location' ? value.p : value.q).toEqual(
        kind === 'location' ? [0, 0, 0] : [0, 0, 0, 1],
      );
      expect(kind === 'location' ? value.q : value.p).toEqual(
        kind === 'location' ? sample(p.tracks.root, 12).q : sample(p.tracks.root, 12).p,
      );
      s.undo();
      expect(s.state.project!.tracks.root).toEqual(p.tracks.root);
    });
  it('does not create a key or pause for a controller already at rest', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    s.patch({ selected: 'root', frame: 7, playing: true });
    const before = s.state.project;
    s.resetSelected('location');
    s.resetSelected('rotation');
    expect(s.state.project).toBe(before);
    expect(s.state.playing).toBe(true);
    expect(s.state.drafts).toEqual({});
  });
  it('resets imported Blender offsets in their own authoring basis', () => {
    const p = createProject({}, false),
      t = p.tracks.hand_l;
    t.basis = {
      pre: new Matrix4().makeTranslation(0.2, 1, 0.3).toArray(),
      post: new Matrix4().toArray(),
    };
    putKey(
      t,
      12,
      pose([0.2, 0.3, 0.4], new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.6).toArray()),
    );
    ensureCurve(t, 'px');
    ensureCurve(t, 'rx');
    const s = new StudioStore();
    s.patch({ project: p, selected: 'hand_l', frame: 12 });
    s.resetSelected('location');
    expect(sample(s.state.project!.tracks.hand_l, 12).p).toEqual([0, 0, 0]);
    expect(sample(s.state.project!.tracks.hand_l, 12).q).toEqual(sample(t, 12).q);
    s.resetSelected('rotation');
    expect(sample(s.state.project!.tracks.hand_l, 12).q).toEqual([0, 0, 0, 1]);
    expect(s.state.project!.tracks.hand_l.basis).toEqual(t.basis);
    expect(s.state.project!.tracks.hand_l.spaces).toEqual(t.spaces);
  });
  it('clears body corrections without replacing the first-person base', () => {
    const source = createProject({}, false),
      body = createBodyAction(source, 'base'),
      s = new StudioStore();
    putKey(body.tracks.hips, 0, pose([0.1, 0, -0.3]));
    s.patch({ project: body, selected: 'hips' });
    s.resetSelected('location');
    expect(s.state.project!.tracks.hips.keys[0].p).toEqual([0, 0, 0]);
    expect(s.state.project!.bodyBase).toEqual(body.bodyBase);
    s.undo();
    expect(s.state.project).toEqual(body);
  });
  it('keeps resets as drafts with auto key disabled', () => {
    const p = createProject({}, false),
      s = new StudioStore();
    putKey(p.tracks.root, 0, pose([0.1, 0.2, 0.3]));
    s.patch({ project: p, selected: 'root', autoKey: false });
    s.resetSelected('location');
    expect(s.state.drafts.root!.p).toEqual([0, 0, 0]);
    expect(s.state.project).toEqual(p);
  });
  it('copies only selected controls when copying a selection pose', () => {
    const s = new StudioStore(),
      p = createProject({}, false);
    s.patch({ project: p, selected: 'hand_l', selection: ['hand_l', 'hand_r'] });
    s.copySelectedPose();
    expect(Object.keys(s.state.clipboard!.poses)).toEqual(['hand_l', 'hand_r']);
    expect(s.state.clipboard!.scope).toBe('rig');
    expect(s.state.project).toEqual(p);
  });
  it('shows and resets the active body offset independently of its source and upper layers', () => {
    const source = createProject({}, false);
    putKey(source.tracks.shoulder_r, 0, pose([0.01, 0.2268, 0]));
    let body = addAnimationLayer(createBodyAction(source, 'base'), 'pose');
    const poseId = body.activeLayerId!;
    putKey(body.tracks.shoulder_r, 0, pose([0.05, 0.02, 0], [0, 0, 0.1, Math.sqrt(0.99)]));
    syncLayers(body);
    body = addAnimationLayer(body, 'additive');
    putKey(body.tracks.shoulder_r, 12, pose([0, 0.03, 0]));
    syncLayers(body);
    const upper = clone(body.layers!.at(-1));
    selectAnimationLayer(body, poseId);
    const s = new StudioStore();
    s.patch({ project: body, selected: 'shoulder_r', frame: 12 });
    expect(s.currentTransformPose()!.p).toEqual([0.05, 0.02, 0]);
    expect(s.currentPose()!.p).not.toEqual([0.05, 0.02, 0]);
    s.resetSelected('location');
    expect(s.currentTransformPose()!.p).toEqual([0, 0, 0]);
    expect(s.currentPose()!.p).not.toEqual([0, 0, 0]);
    expect(s.currentTransformPose()!.q).toEqual(body.tracks.shoulder_r.keys[0].q);
    expect(s.state.project!.layers!.at(-1)).toEqual(upper);
    expect(s.state.project!.bodyBase).toEqual(body.bodyBase);
    expect(s.state.project!.tracks.shoulder_r.keys.map((k) => k.frame)).toEqual([0]);
    s.undo();
    expect(s.currentTransformPose()!.p).toEqual([0.05, 0.02, 0]);
  });
  it('types layer offsets directly instead of subtracting the inherited pose again', () => {
    const source = createProject({}, false);
    putKey(source.tracks.hips, 0, pose([0.2, 0.3, 0]));
    const body = addAnimationLayer(createBodyAction(source, 'base'), 'pose'),
      s = new StudioStore();
    s.patch({ project: body, selected: 'hips', frame: 17 });
    s.editLayerOffset('hips', { ...s.currentTransformPose()!, p: [0.04, 0.05, 0.06] });
    expect(s.currentTransformPose()!.p).toEqual([0.04, 0.05, 0.06]);
    expect(sample(s.state.project!.tracks.hips, keyingFrame(body, 17)).p).toEqual([
      0.04, 0.05, 0.06,
    ]);
    s.resetSelected('location');
    expect(s.currentTransformPose()!.p).toEqual([0, 0, 0]);
  });
  it('resets layer position and rotation drafts with auto-key off without changing saved tracks', () => {
    const body = addAnimationLayer(createBodyAction(createProject({}, false), 'base'), 'pose'),
      s = new StudioStore();
    putKey(body.tracks.shoulder_l, 0, pose([0.1, 0.2, 0.3], [0, 0, 0.1, Math.sqrt(0.99)]));
    s.patch({ project: body, selected: 'shoulder_l', frame: 10, autoKey: false });
    const saved = clone(body);
    s.resetSelected('location');
    expect(s.currentTransformPose()!.p).toEqual([0, 0, 0]);
    expect(s.currentTransformPose()!.q).toEqual(body.tracks.shoulder_l.keys[0].q);
    s.resetSelected('rotation');
    expect(s.currentTransformPose()!.q).toEqual([0, 0, 0, 1]);
    expect(s.state.project).toEqual(saved);
  });
  it('keeps manipulation orientation out of saved animation data', () => {
    const s = new StudioStore();
    s.patch({ project: createProject({}, false) });
    const before = clone(s.snapshot());
    s.patch({ transformSpace: 'local' });
    expect(s.state.project).toEqual(before!.clips[0].project);
    expect(JSON.stringify(s.state.project)).not.toContain('transformSpace');
  });
});

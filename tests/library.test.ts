import { describe, it, expect } from 'vitest';
import {
  createProject,
  clone,
  evaluate,
  matrix,
  pose,
  putKey,
  switchParent,
} from '../src/core/model';
import { applyPose, capturePose, validateLibrary } from '../src/core/library';
import { StudioStore } from '../src/core/store';
const setup = () => {
  const s = new StudioStore();
  s.open(createProject({}, false));
  return s;
};
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 7));
describe('animator workspace', () => {
  it('migrates legacy projects and saves all open and closed animations', () => {
    const s = setup(),
      first = s.state.workspace!.activeId;
    s.updateProject({ name: 'Idle' });
    s.addAnimation({});
    s.updateProject({ name: 'Reload' });
    const second = s.state.workspace!.activeId;
    s.closeAnimation(first);
    const saved = validateLibrary(JSON.parse(JSON.stringify(s.snapshot())));
    expect(saved.clips.map((c) => c.project.name)).toEqual(['Idle', 'Reload']);
    expect(saved.openIds).toEqual([second]);
    const reopened = new StudioStore();
    reopened.open(saved);
    reopened.activate(first);
    expect(reopened.state.project!.name).toBe('Idle');
  });
  it('restores each animation playhead, rig, selection, drafts, and independent undo history', () => {
    const s = setup(),
      a = s.state.workspace!.activeId;
    s.setLayer('body');
    s.setFrame(17);
    s.patch({ selected: 'rifle' });
    s.editWorld('rifle', pose([1, 2, 3]));
    s.addAnimation({});
    const b = s.state.workspace!.activeId;
    s.setFrame(9);
    s.editWorld('rifle', pose([4, 5, 6]));
    s.patch({ autoKey: false, selected: 'hand_r' });
    s.editWorld('hand_r', pose([0.3, 1.3, 0.2]));
    const drafts = clone(s.state.drafts);
    s.activate(a);
    expect(s.state.frame).toBe(17);
    expect(s.state.project!.editing).toBe('body');
    expect(s.state.selected).toBe('rifle');
    s.undo();
    expect(evaluate(s.state.project!, 17).rifle.p).not.toEqual([1, 2, 3]);
    s.redo();
    near(evaluate(s.state.project!, 17).rifle.p, [1, 2, 3]);
    s.activate(b);
    expect(s.state.frame).toBe(9);
    expect(s.state.project!.editing).toBe('firstPerson');
    expect(s.state.drafts).toEqual(drafts);
    s.undo();
    expect(evaluate(s.state.project!, 9).rifle.p).not.toEqual([4, 5, 6]);
    s.activate(a);
    near(evaluate(s.state.project!, 17).rifle.p, [1, 2, 3]);
  });
  it('duplicates both rigs without sharing tracks and preserves unkeyed poses', () => {
    const s = setup(),
      a = s.state.workspace!.activeId;
    s.setLayer('body');
    s.editWorld('rifle', pose([0.1, 1.4, 0.4]));
    s.patch({ autoKey: false });
    s.editWorld('hand_l', pose([0.2, 1.5, 0.3]));
    s.addAnimation({}, false, true);
    expect(s.state.project!.name).toMatch(/copy/);
    expect(s.state.drafts.hand_l).toBeDefined();
    s.patch({ autoKey: true });
    s.editWorld('rifle', pose([0.6, 1.2, 0.7]));
    s.activate(a);
    near(evaluate(s.state.project!, 0).rifle.p, [0.1, 1.4, 0.4]);
  });
  it('pastes entire rig poses through different destination contacts and leaves camera/body unchanged', () => {
    let source = createProject(),
      target = createProject({}, false);
    target = switchParent(target, 'hand_l', 'world', 0);
    target = switchParent(target, 'magazine', 'hand_l', 0);
    putKey(target.tracks.camera, 0, pose([3, 4, 5], [0, 0, 0, 1], undefined, 90));
    const camera = clone(target.tracks.camera),
      body = clone(target.otherTracks),
      contacts = Object.fromEntries(Object.entries(target.tracks).map(([id, t]) => [id, t.spaces]));
    const stamp = capturePose(source, 48, {}, 'rig', 'hand_l'),
      result = applyPose(target, 12, stamp, 'rifle'),
      values = evaluate(result, 12);
    for (const [id, p] of Object.entries(stamp.poses))
      near(matrix(values[id as keyof typeof values]).toArray(), matrix(p!).toArray());
    expect(result.tracks.camera).toEqual(camera);
    expect(result.otherTracks).toEqual(body);
    expect(
      Object.fromEntries(Object.entries(result.tracks).map(([id, t]) => [id, t.spaces])),
    ).toEqual(contacts);
  });
  it('copies controls between animations and inserts keys even when auto key is off', () => {
    const s = setup();
    s.setFrame(15);
    s.patch({ selected: 'hand_l' });
    s.editWorld('hand_l', pose([0.2, 1.4, 0.7], [0, 0, 0, 1], [0.1, 0.2, 0.3, 0.4, 0.5]));
    s.copyPose('control');
    s.addAnimation({});
    s.patch({ selected: 'hand_r', autoKey: false });
    s.setFrame(20);
    s.pastePose();
    near(evaluate(s.state.project!, 20).hand_r.p, [0.2, 1.4, 0.7]);
    expect(evaluate(s.state.project!, 20).hand_r.grip).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(s.state.project!.tracks.hand_r.keys.some((k) => k.frame === 20)).toBe(true);
  });
  it('keeps FP and body pose libraries distinct and saves reusable poses', () => {
    const s = setup();
    s.savePose('Aim', 'rig');
    s.copyPose('rig');
    s.setLayer('body');
    const before = clone(s.state.project);
    s.pastePose();
    expect(s.state.project).toEqual(before);
    expect(s.state.message).toContain('First person');
    s.savePose('Standing', 'rig');
    const saved = validateLibrary(s.snapshot());
    expect(saved.poses.map((p) => p.layer)).toEqual(['firstPerson', 'body']);
    const t = new StudioStore();
    t.open(saved);
    t.setFrame(30);
    t.pastePose(saved.poses[1]);
    expect(t.state.project!.tracks.hips.keys.some((k) => k.frame === 30)).toBe(true);
  });
  it('imports legacy and multi-clip files without replacing existing animations or duplicating IDs', () => {
    const s = setup();
    s.savePose('Pose A');
    const saved = s.snapshot()!;
    s.importAnimations(saved);
    s.importAnimations(createProject());
    expect(s.state.workspace!.clips).toHaveLength(3);
    expect(new Set(s.state.workspace!.clips.map((c) => c.id)).size).toBe(3);
    expect(s.state.workspace!.poses).toHaveLength(2);
    expect(() => validateLibrary(s.snapshot())).not.toThrow();
  });
  it('rejects invalid libraries atomically, including bad saved poses and active tabs', () => {
    const s = setup(),
      before = s.snapshot()!;
    const bad = clone(before);
    bad.activeId = 'missing';
    expect(() => s.open(bad)).toThrow();
    expect(s.snapshot()).toEqual(before);
    s.savePose('Good');
    const invalid = clone(s.snapshot()!);
    invalid.poses[0].poses.hand_l!.q = [0, 0, 0, 0];
    expect(() => s.importAnimations(invalid)).toThrow();
    expect(s.state.workspace!.clips).toHaveLength(1);
  });
  it('closing the active tab selects another and prevents closing the last tab', () => {
    const s = setup(),
      a = s.state.workspace!.activeId;
    s.addAnimation({});
    const b = s.state.workspace!.activeId;
    s.closeAnimation(b);
    expect(s.state.workspace!.activeId).toBe(a);
    expect(s.state.workspace!.clips).toHaveLength(2);
    s.closeAnimation(a);
    expect(s.state.workspace!.openIds).toEqual([a]);
  });
});

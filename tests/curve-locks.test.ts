import { Quaternion, Euler } from 'three';
import { describe, it, expect } from 'vitest';
import { createProject, clone, putKey, sample, validateProject } from '../src/core/model';
import { ensureCurve, readCurve } from '../src/core/curves';
import { lockControlKeys, lockCurveKeys } from '../src/core/curveLocks';
import { insertChannels } from '../src/core/keying';
import { StudioStore } from '../src/core/store';
import { copyTimelineKeys, pasteTimelineKeys, moveTimelineKeys } from '../src/core/timelineKeys';

const project = () => {
  const p = createProject({}, false);
  p.tracks.hand_l.spaces = [];
  putKey(p.tracks.hand_l, 20, { ...sample(p.tracks.hand_l, 0), p: [0.3, 1.4, 0.5] });
  return p;
};
describe('curve insertion locks', () => {
  it('locking implicit rotation channels leaves quaternion interpolation exactly unchanged', () => {
    const p = project(),
      t = p.tracks.hand_l;
    t.keys[0].q = new Quaternion().setFromEuler(new Euler(0.6, 0.2, 1.1)).toArray();
    t.keys[1].q = new Quaternion().setFromEuler(new Euler(-0.4, 1.2, 0.1)).toArray();
    const before = clone(t);
    lockCurveKeys(t, 'hand_l', 'rx', true);
    for (const f of [0, 0.25, 8, 12, 19.8, 20]) expect(sample(t, f).q).toEqual(sample(before, f).q);
    lockControlKeys(t, 'hand_l', true);
    expect(t.curves).toBeUndefined();
    for (const f of [2, 7, 18]) expect(sample(t, f).q).toEqual(sample(before, f).q);
  });
  it('a blocked Auto Key gesture does not pause playback or create an undo entry', () => {
    const p = project(),
      s = new StudioStore();
    s.patch({ project: p, selected: 'hand_l', frame: 9, playing: true, autoKey: true });
    s.setControlKeyLock(['hand_l'], true);
    const revision = s.state.revision;
    s.editWorld('hand_l', { ...s.currentPose()!, p: [9, 9, 9] });
    expect(s.state.playing).toBe(true);
    expect(s.state.revision).toBe(revision);
    expect(s.state.project!.tracks.hand_l.keys).toHaveLength(2);
  });
  it('Auto Key preserves a locked axis but keys unlocked axes', () => {
    const p = project(),
      t = p.tracks.hand_l;
    lockCurveKeys(t, 'hand_l', 'px', true);
    const old = clone(readCurve(t, 'px')),
      v = sample(t, 8);
    putKey(t, 8, { ...v, p: [9, 2, 3] });
    expect(readCurve(t, 'px')).toEqual(old);
    expect(sample(t, 8).p[0]).toBeCloseTo(v.p[0]);
    expect(sample(t, 8).p.slice(1)).toEqual([2, 3]);
  });
  it('a whole-control lock prevents base and channel key insertion, including keying sets', () => {
    const t = project().tracks.hand_l;
    lockControlKeys(t, 'hand_l', true);
    const before = clone(t);
    for (const set of ['all', 'whole', 'available', 'location', 'rotation'] as const)
      insertChannels(t, 'hand_l', 9, { ...sample(t, 9), p: [9, 9, 9] }, set);
    expect(t).toEqual(before);
  });
  it('existing values and tangents remain editable; retiming is allowed', () => {
    const p = project(),
      s = new StudioStore();
    s.patch({ project: p, selected: 'hand_l' });
    s.setCurveKeyLock('px', true);
    s.addCurveKey('px', 20, 42);
    expect(readCurve(s.state.project!.tracks.hand_l, 'px').keys.at(-1)!.value).toBe(42);
    const c = clone(readCurve(s.state.project!.tracks.hand_l, 'px'));
    c.keys[0] = { ...c.keys[0], handle: 'free', right: [2, 3] };
    s.setCurveKeys('px', c.keys);
    expect(readCurve(s.state.project!.tracks.hand_l, 'px').keys[0].right).toEqual([2, 3]);
    expect(
      moveTimelineKeys(
        s.state.project!,
        [{ id: 'hand_l', frame: 20 }],
        2,
      ).project.tracks.hand_l.curves!.px!.keys.at(-1)!.frame,
    ).toBe(22);
  });
  it('blocks add, paste, bake and Loop key generation, and can undo the lock', () => {
    const p = project(),
      s = new StudioStore();
    s.patch({ project: p, selected: 'hand_l' });
    s.setCurveKeyLock('px', true);
    const before = clone(readCurve(s.state.project!.tracks.hand_l, 'px'));
    s.addCurveKey('px', 5);
    expect(readCurve(s.state.project!.tracks.hand_l, 'px')).toEqual(before);
    s.patch({
      frame: 4,
      curveClipboard: [{ frame: 0, value: 7, interpolation: 'linear', handle: 'flat' }],
    });
    s.pasteCurveKeys('px');
    s.bakeCurve('px');
    s.setCurveLoop('px', true);
    expect(readCurve(s.state.project!.tracks.hand_l, 'px')).toEqual(before);
    s.undo();
    expect(readCurve(s.state.project!.tracks.hand_l, 'px').keyLock).toBeUndefined();
  });
  it('timeline paste cannot bypass per-axis or whole-control locks', () => {
    const p = project(),
      clip = copyTimelineKeys(p, [{ id: 'hand_l', frame: 20 }])!;
    lockCurveKeys(p.tracks.hand_l, 'hand_l', 'px', true);
    expect(() => pasteTimelineKeys(p, clip, 9)).toThrow(/locked/);
    expect(() => pasteTimelineKeys(p, clip, 20)).not.toThrow();
    lockControlKeys(p.tracks.hand_l, 'hand_l', true);
    expect(() => pasteTimelineKeys(p, clip, 10)).toThrow(/locked/);
  });
  it('unlocking a single axis keeps the rest locked and round-trips through save', () => {
    const p = project(),
      t = p.tracks.hand_l;
    lockControlKeys(t, 'hand_l', true);
    lockCurveKeys(t, 'hand_l', 'px', false);
    putKey(t, 9, { ...sample(t, 9), p: [4, 8, 9] });
    expect(readCurve(t, 'px').keys.map((k) => k.frame)).toContain(9);
    expect(readCurve(t, 'py').keys.map((k) => k.frame)).not.toContain(9);
    const saved = validateProject(JSON.parse(JSON.stringify(p)));
    expect(saved.tracks.hand_l.lockedChannels).toContain('py');
  });
});

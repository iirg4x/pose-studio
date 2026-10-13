import { describe, it, expect } from 'vitest';
import { StudioStore } from '../src/core/store';
import { createProject, pose, putKey, sample, clone, validateProject } from '../src/core/model';
import { applyKeySettings, segmentInterpolation } from '../src/core/timelineSettings';
import { readCurve } from '../src/core/curves';
describe('animation tab actions', () => {
  it('renames an inactive animation without changing the current pose, and keeps its undo history', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    const a = s.state.workspace!.activeId,
      old = s.state.project!.name;
    s.addAnimation({});
    const b = s.state.workspace!.activeId;
    s.setFrame(13);
    const p = clone(s.state.project);
    s.renameAnimation(a, 'Walk');
    expect(s.state.workspace!.activeId).toBe(b);
    expect(s.state.frame).toBe(13);
    expect(s.state.project).toEqual(p);
    expect(s.snapshot()!.clips.find((c) => c.id === a)!.project.name).toBe('Walk');
    s.activate(a);
    s.undo();
    expect(s.state.project!.name).toBe(old);
  });
  it('closes other tabs without removing their animations or drafts', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    const a = s.state.workspace!.activeId;
    s.patch({ autoKey: false });
    s.editRaw('root', pose([1, 0, 0]));
    s.addAnimation({});
    s.addAnimation({});
    const c = s.state.workspace!.activeId;
    s.closeOtherAnimations(c);
    expect(s.snapshot()!.clips).toHaveLength(3);
    expect(s.state.workspace!.openIds).toEqual([c]);
    s.activate(a);
    expect(s.state.drafts.root!.p).toEqual([1, 0, 0]);
  });
});
describe('per-key timeline settings', () => {
  const fixture = () => {
    const p = createProject({}, false);
    putKey(p.tracks.root, 0, pose());
    putKey(p.tracks.root, 10, pose([1, 2, 0], [0, 0.5, 0, Math.sqrt(0.75)]));
    putKey(p.tracks.root, 20, pose([3, 2, 0]));
    return p;
  };
  it('changes only the outgoing selected segment and preserves untouched quaternion interpolation', () => {
    const p = fixture(),
      before = sample(p.tracks.root, 3),
      changed = applyKeySettings(p, [{ id: 'root', frame: 10 }], { interpolation: 'step' });
    expect(sample(changed.tracks.root, 3)).toEqual(before);
    expect(sample(changed.tracks.root, 15).p).toEqual([1, 2, 0]);
    expect(changed.tracks.root.curves).toBeUndefined();
    expect(sample(p.tracks.root, 15).p).not.toEqual([1, 2, 0]);
    expect(() => validateProject(changed)).not.toThrow();
    putKey(changed.tracks.root, 10, pose([2, 2, 0]));
    expect(changed.tracks.root.keys[1].interpolation).toBe('step');
  });
  it('reports channel differences and preserves modifiers when editing selected keys', () => {
    const p = fixture(),
      t = p.tracks.root;
    t.curves = { px: readCurve(t, 'px'), py: readCurve(t, 'py') };
    t.curves.px!.keys[0].interpolation = 'linear';
    t.curves.py!.modifiers = [
      { id: 'noise', type: 'noise', enabled: true, amplitude: 1, period: 10, phase: 0, seed: 2 },
    ];
    expect(segmentInterpolation('root', t, 0, 10)).toMatchObject({ kind: 'mixed', modified: true });
    const changed = applyKeySettings(p, [{ id: 'root', frame: 0 }], {
      interpolation: 'bounce',
      bounce: { bounces: 2, height: 0.25, decay: 0.5, impact: 0.4 },
    });
    expect(segmentInterpolation('root', changed.tracks.root, 0, 10).kind).toBe('bounce');
    expect(changed.tracks.root.curves!.py!.modifiers).toEqual(t.curves.py!.modifiers);
    expect(changed.tracks.root.curves!.px!.keys[1]).toEqual(t.curves.px!.keys[1]);
  });
  it('rejects malformed key interpolation on load', () => {
    const p = fixture();
    (p.tracks.root.keys[0] as unknown as { interpolation: string }).interpolation = 'bad';
    expect(() => validateProject(p)).toThrow('Invalid key interpolation');
  });
});

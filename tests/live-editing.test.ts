import { describe, it, expect } from 'vitest';
import { StudioStore } from '../src/core/store';
import { createProject, clone, evaluate, putKey, pose } from '../src/core/model';
import {
  readCurve,
  sampleCurve,
  proceduralValue,
  modifier,
  validateCurves,
} from '../src/core/curves';
import type { Curve, Modifier } from '../src/core/curves';
const store = () => {
  const s = new StudioStore();
  s.open(createProject({}, false));
  s.patch({ playing: true, selected: 'hand_l', frame: 4 });
  return s;
};
describe('Live editing playback', () => {
  it('keeps selection, layers, modifiers, interpolation, and loop edits playing', () => {
    const s = store();
    s.selectControl('hand_r');
    expect(s.state.playing).toBe(true);
    s.addLayer('pose');
    expect(s.state.playing).toBe(true);
    const id = s.state.project!.activeLayerId!;
    s.configureLayer(id, { weight: 0.5 });
    s.selectLayer(id);
    s.addModifier('px', 'noise');
    s.updateModifier('px', readCurve(s.state.project!.tracks.hand_r, 'px').modifiers[0].id, {
      amplitude: 3,
    });
    s.setInterpolation('spring');
    s.setMotionOptions({ easing: 'in' });
    s.setLoop({ start: 2, end: 20 });
    expect(s.state.playing).toBe(true);
    s.undo();
    s.redo();
    expect(s.state.playing).toBe(true);
  });
  it('pauses a changed keyed control at the frame captured at gesture start', () => {
    const s = store();
    s.beginGesture();
    const value = clone(s.currentPose()!);
    value.p[1] -= 0.1;
    s.patch({ frame: 8 });
    s.editWorld('hand_l', value);
    expect(s.state.playing).toBe(false);
    expect(s.state.frame).toBe(4);
    expect(s.state.project!.tracks.hand_l.keys.some((k) => k.frame === 4)).toBe(true);
    s.endGesture();
  });
  it('does not key or pause a no-op control edit', () => {
    const s = store(),
      before = clone(s.state.project);
    s.beginGesture();
    s.editWorld('hand_l', clone(s.currentPose()!));
    s.endGesture();
    expect(s.state.playing).toBe(true);
    expect(s.state.project).toEqual(before);
  });
  it('keeps static pose-layer edits playing and anchored to one pose key', () => {
    const s = store();
    s.addLayer('pose');
    s.beginGesture();
    const value = clone(s.currentPose()!);
    value.p[1] -= 0.1;
    s.patch({ frame: 12 });
    s.editWorld('hand_l', value);
    expect(s.state.playing).toBe(true);
    expect(s.state.frame).toBe(12);
    expect(s.state.project!.tracks.hand_l.keys.map((k) => k.frame)).toEqual([0]);
    s.endGesture();
    const a = evaluate(s.state.project!, 4).hand_l.p;
    s.patch({ frame: 4 });
    s.configureLayer(s.state.project!.activeLayerId!, { enabled: false });
    const b = evaluate(s.state.project!, 4).hand_l.p;
    expect(a[1] - b[1]).toBeCloseTo(-0.1);
  });
  it('leaves playback running for unkeyed controller previews', () => {
    const s = store();
    s.patch({ autoKey: false });
    const before = clone(s.state.project),
      value = clone(s.currentPose()!);
    value.p[0] += 0.1;
    s.editWorld('hand_l', value);
    expect(s.state.playing).toBe(true);
    expect(s.state.project).toEqual(before);
    expect(s.state.drafts.hand_l).toBeDefined();
  });
  it('preserves playback when seeking, and marks a new clock anchor', () => {
    const s = store(),
      token = s.state.playbackSeek;
    s.setFrame(12);
    expect(s.state.playing).toBe(true);
    expect(s.state.frame).toBe(12);
    expect(s.state.playbackSeek).toBe(token + 1);
    s.setFrame(8, false);
    expect(s.state.playing).toBe(false);
  });
});
describe('Modifier clipboard', () => {
  it('copies a stack with fresh IDs, independent settings, and unchanged destination keys', () => {
    const s = store();
    s.addModifier('px', 'cycles');
    s.addModifier('px', 'noise');
    const source = clone(readCurve(s.state.project!.tracks.hand_l, 'px'));
    s.copyModifiers('px');
    s.selectControl('hand_r');
    const keys = clone(readCurve(s.state.project!.tracks.hand_r, 'py').keys);
    s.pasteModifiers('py');
    const dest = readCurve(s.state.project!.tracks.hand_r, 'py');
    expect(dest.keys).toEqual(keys);
    expect(dest.modifiers.map((m) => m.type)).toEqual(['cycles', 'noise']);
    expect(dest.modifiers.map((m) => m.id)).not.toEqual(source.modifiers.map((m) => m.id));
    s.updateModifier('py', dest.modifiers[1].id, { amplitude: 9 });
    expect(readCurve(s.state.project!.tracks.hand_l, 'px')).toEqual(source);
    expect(s.state.modifierClipboard!.modifiers).toEqual(source.modifiers);
    expect(s.state.playing).toBe(true);
  });
  it('copies one modifier and duplicates it without aliasing', () => {
    const s = store();
    s.addModifier('px', 'noise');
    s.addModifier('px', 'scale');
    const first = readCurve(s.state.project!.tracks.hand_l, 'px').modifiers[0];
    s.copyModifiers('px', first.id);
    expect(s.state.modifierClipboard!.modifiers).toHaveLength(1);
    s.duplicateModifier('px', first.id);
    const mods = readCurve(s.state.project!.tracks.hand_l, 'px').modifiers;
    expect(mods.map((m) => m.type)).toEqual(['noise', 'noise', 'scale']);
    expect(mods[0].id).not.toBe(mods[1].id);
    expect(mods[0].loop).not.toBe(mods[1].loop);
  });
  it('replaces only an existing Cycles setting on paste and supports undo', () => {
    const s = store();
    s.addModifier('px', 'cycles');
    s.updateModifier('px', readCurve(s.state.project!.tracks.hand_l, 'px').modifiers[0].id, {
      after: 'mirror',
    });
    s.copyModifiers('px');
    s.addModifier('py', 'cycles');
    s.addModifier('py', 'scale');
    const before = clone(readCurve(s.state.project!.tracks.hand_l, 'py'));
    s.pasteModifiers('py');
    const mods = readCurve(s.state.project!.tracks.hand_l, 'py').modifiers;
    expect(mods.map((m) => m.type)).toEqual(['cycles', 'scale']);
    expect(mods[0]).toMatchObject({ after: 'mirror' });
    s.undo();
    expect(readCurve(s.state.project!.tracks.hand_l, 'py')).toEqual(before);
  });
  it('rejects overflow atomically and preserves the clipboard', () => {
    const s = store();
    for (let i = 0; i < 20; i++) s.addModifier('px', 'scale');
    s.copyModifiers('px');
    const before = clone(s.state.project);
    s.pasteModifiers('px');
    expect(s.state.project).toEqual(before);
    expect(s.state.modifierClipboard!.modifiers).toHaveLength(20);
    expect(s.state.message).toContain('20');
  });
});
describe('Seamless procedural modifiers', () => {
  for (const type of ['noise', 'sine'] as const)
    it(type + ' repeats value and slope at nonzero and negative cycle boundaries', () => {
      const m = modifier(type) as Extract<Modifier, { type: 'noise' | 'sine' }>;
      m.period = 13.7;
      m.phase = 2.3;
      m.loop = { start: 7, end: 51 };
      const e = 0.0001;
      expect(proceduralValue(7, m)).toBeCloseTo(proceduralValue(51, m), 10);
      expect(proceduralValue(6, m)).toBeCloseTo(proceduralValue(50, m), 10);
      expect(proceduralValue(16.25, m)).toBeCloseTo(proceduralValue(60.25, m), 10);
      const incoming = (proceduralValue(51, m) - proceduralValue(51 - e, m)) / e,
        outgoing = (proceduralValue(7 + e, m) - proceduralValue(7, m)) / e;
      expect(incoming).toBeCloseTo(outgoing, 3);
    });
  it('closes a restricted Blender noise envelope even with hard range cuts at the seam', () => {
    const m = {
      ...modifier('noise'),
      type: 'noise' as const,
      algorithm: 'blender' as const,
      phase: 2.3,
      rangeStart: 7,
      rangeEnd: 51,
      blendIn: 0,
      blendOut: 0,
      loop: { start: 7, end: 51 },
    };
    const e = 0.0001;
    expect(proceduralValue(7, m)).toBe(0);
    expect(proceduralValue(51, m)).toBe(0);
    expect(proceduralValue(7 + e, m) / e).toBeCloseTo(-proceduralValue(51 - e, m) / e, 5);
  });
  it('preserves imported modifier evaluation until seamless is enabled', () => {
    const m = modifier('sine') as Extract<Modifier, { type: 'sine' }>;
    m.phase = 15;
    m.period = 13;
    const c: Curve = {
      keys: [
        { frame: 0, value: 3, interpolation: 'linear', handle: 'vector' },
        { frame: 40, value: 3, interpolation: 'linear', handle: 'vector' },
      ],
      modifiers: [m],
    };
    expect(sampleCurve(c, 11)).toBeCloseTo(
      3 + Math.sin((2 * Math.PI * 11) / 13 + (15 * Math.PI) / 180),
      10,
    );
  });
  it('updates linked loop ranges and uses the destination loop on paste', () => {
    const s = store();
    s.addModifier('px', 'noise');
    s.setLoop({ start: 4, end: 24 });
    expect(readCurve(s.state.project!.tracks.hand_l, 'px').modifiers[0].loop).toEqual({
      start: 4,
      end: 24,
    });
    s.copyModifiers('px');
    s.setLoop({ start: 8, end: 32 });
    s.pasteModifiers('py');
    expect(readCurve(s.state.project!.tracks.hand_l, 'py').modifiers[0].loop).toEqual({
      start: 8,
      end: 32,
    });
    s.setModifierLoop('px', readCurve(s.state.project!.tracks.hand_l, 'px').modifiers[0].id, false);
    expect(readCurve(s.state.project!.tracks.hand_l, 'px').modifiers[0].loop).toBeUndefined();
  });
  it('inverts periodic noise when keying a visible pose without double applying it', () => {
    const s = store();
    s.addModifier('px', 'noise');
    s.setFrame(12, false);
    const value = clone(s.currentPose()!);
    value.p[0] += 0.1;
    s.editWorld('hand_l', value);
    expect(evaluate(s.state.project!, 12).hand_l.p[0]).toBeCloseTo(value.p[0], 7);
    expect(() => validateCurves(s.state.project!.tracks.hand_l)).not.toThrow();
  });
});

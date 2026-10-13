import { describe, it, expect } from 'vitest';
import {
  baseCurve,
  closeCurveLoop,
  handles,
  validateCurves,
  ensureCurve,
  explicitLoopCurve,
} from '../src/core/curves';
import type { Curve } from '../src/core/curves';
import { syncLoopSeam } from '../src/core/loopInterpolation';
import { createProject, clone } from '../src/core/model';
import { applyKeySettings, segmentInterpolation } from '../src/core/timelineSettings';
import { StudioStore } from '../src/core/store';
const curve = (): Curve => ({
  keys: [
    { frame: 0, value: 2, interpolation: 'bezier', handle: 'flat' },
    { frame: 7, value: 8, interpolation: 'bezier', handle: 'flat' },
    { frame: 19, value: -3, interpolation: 'bezier', handle: 'flat' },
    { frame: 30, value: 12, interpolation: 'bezier', handle: 'flat' },
  ],
  modifiers: [],
});
describe('periodic loop interpolation', () => {
  it('preserves interior modes, manual handles and every sample between interior keys', () => {
    const c = curve();
    c.keys[1] = { ...c.keys[1], handle: 'free', left: [-6, -4], right: [5, -2] };
    c.keys[2] = { ...c.keys[2], handle: 'free', left: [-4, 3], right: [8, 2] };
    const original = clone(c),
      before = c.keys.slice(1, -1).map((k) => clone(k));
    closeCurveLoop(c, 0, 30);
    expect(c.keys.slice(1, -1)).toEqual(before);
    for (let f = 7; f <= 19; f += 0.25)
      expect(baseCurve(c, f)).toBeCloseTo(baseCurve(original, f), 12);
    const boundary = (index: number, end: boolean) => {
      const a = c.keys[index],
        b = c.keys[index + 1],
        r = handles(c, index).right,
        l = handles(c, index + 1).left,
        scale = Math.min(1, (b.frame - a.frame) / (r[0] - l[0]));
      r[0] *= scale;
      r[1] *= scale;
      l[0] *= scale;
      l[1] *= scale;
      const dx = end ? -l[0] : r[0],
        dy = end ? -l[1] : r[1],
        ddx = end ? a.frame + r[0] - b.frame - 2 * l[0] : b.frame + l[0] - a.frame - 2 * r[0],
        ddy = end ? a.value + r[1] - b.value - 2 * l[1] : b.value + l[1] - a.value - 2 * r[1];
      return [dy / dx, (2 * (ddy * dx - dy * ddx)) / (3 * dx ** 3)];
    };
    const start = boundary(0, false),
      end = boundary(c.keys.length - 2, true);
    expect(start[0]).toBeCloseTo(end[0], 10);
    expect(start[1]).toBeCloseTo(end[1], 10);
  });
  it('retains mixed interior segment settings and disables the seam without changing its shape', () => {
    const c = curve();
    c.keys[1].interpolation = 'step';
    c.keys[2].interpolation = 'linear';
    const before = clone(c.keys.slice(1, -1));
    closeCurveLoop(c, 0, 30);
    expect(c.keys.slice(1, -1)).toEqual(before);
    const materialized = explicitLoopCurve(c);
    expect(materialized.loop).toBeUndefined();
    for (let f = 0; f <= 30; f += 0.25)
      expect(baseCurve(materialized, f)).toBeCloseTo(baseCurve(c, f), 8);
  });
  it('cleans legacy interior Loop labels on load while preserving their values and handles', () => {
    const p = createProject({}, false),
      c = ensureCurve(p.tracks.hand_l, 'px');
    c.keys = curve().keys;
    c.loop = { start: 0, end: 30 };
    for (const k of c.keys) k.interpolation = 'loop';
    validateCurves(p.tracks.hand_l);
    expect(c.keys.map((k) => k.interpolation)).toEqual(['loop', 'bezier', 'bezier', 'loop']);
  });

  it('closes value, velocity and curvature without changing interior keys', () => {
    const c = curve();
    closeCurveLoop(c, 0, 30);
    expect(c.keys.map((k) => [k.frame, k.value])).toEqual([
      [0, 2],
      [7, 8],
      [19, -3],
      [30, 2],
    ]);
    const h = 0.001,
      f = (x: number) => baseCurve(c, x),
      v0 = (-3 * f(0) + 4 * f(h) - f(2 * h)) / (2 * h),
      v1 = (3 * f(30) - 4 * f(30 - h) + f(30 - 2 * h)) / (2 * h),
      a0 = (2 * f(0) - 5 * f(h) + 4 * f(2 * h) - f(3 * h)) / (h * h),
      a1 = (2 * f(30) - 5 * f(30 - h) + 4 * f(30 - 2 * h) - f(30 - 3 * h)) / (h * h);
    expect(f(0)).toBe(f(30));
    expect(v0).toBeCloseTo(v1, 6);
    expect(a0).toBeCloseTo(a1, 6);
    expect(Math.abs(v0)).toBeGreaterThan(0.1);
  });
  it('is smooth at every interior knot with uneven timing', () => {
    const c = curve();
    closeCurveLoop(c, 0, 30);
    for (const frame of [7, 19]) {
      const h = 0.0001,
        f = (x: number) => baseCurve(c, x);
      expect((f(frame) - f(frame - h)) / h).toBeCloseTo((f(frame + h) - f(frame)) / h, 3);
    }
  });
  it('handles constant and two-pose loops', () => {
    for (const count of [1, 2]) {
      const c = curve();
      c.keys = c.keys.slice(0, count);
      closeCurveLoop(c, 0, 30);
      for (const frame of [0, 0.1, 5, 16, 29.9, 30])
        expect(Number.isFinite(baseCurve(c, frame))).toBe(true);
      const left = handles(c, 0).right,
        right = handles(c, c.keys.length - 1).left;
      expect(left[1] / left[0]).toBeCloseTo(right[1] / right[0], 8);
    }
  });
  it('links edits to either end and pairs edited seam tangents', () => {
    const c = curve();
    closeCurveLoop(c, 0, 30);
    let prev = clone(c.keys);
    c.keys = clone(c.keys);
    c.keys.at(-1)!.value = 4;
    syncLoopSeam(c, prev);
    expect(c.keys[0].value).toBe(4);
    prev = clone(c.keys);
    c.keys = clone(c.keys);
    c.keys[0].handle = 'free';
    c.keys[0].right = [2, 3];
    syncLoopSeam(c, prev);
    const a = handles(c, 0).right,
      b = handles(c, c.keys.length - 1).left;
    expect(a[1] / a[0]).toBeCloseTo(b[1] / b[0], 8);
  });
  it('persists and samples the same loop after saving; timeline selection closes its controls only', () => {
    const p = createProject({}, false);
    p.end = 30;
    ensureCurve(p.tracks.hand_l, 'px').keys = curve().keys;
    const next = applyKeySettings(p, [{ id: 'hand_l', frame: 7 }], { interpolation: 'loop' }),
      c = next.tracks.hand_l.curves!.px!;
    expect(c.loop).toEqual({ start: 0, end: 30 });
    expect(next.tracks.hand_r).toEqual(p.tracks.hand_r);
    validateCurves(next.tracks.hand_l);
    const saved = JSON.parse(JSON.stringify(c));
    for (const f of [0, 0.1, 6, 15, 29.9, 30]) expect(baseCurve(saved, f)).toBe(baseCurve(c, f));
    expect(segmentInterpolation('hand_l', next.tracks.hand_l, 7, 19).kind).toBe('bezier');
  });
  it('uses the chosen playback range and leaves outside keys alone', () => {
    const c = curve(),
      before = baseCurve(c, 5);
    closeCurveLoop(c, 5, 25);
    expect(c.keys[0].interpolation).toBe('bezier');
    expect(c.keys.at(-1)!.value).toBe(12);
    expect(baseCurve(c, 5)).toBe(before);
    expect(baseCurve(c, 25)).toBe(before);
  });
  it('links flat, automatic and manually directed boundary handles', () => {
    const c = curve();
    closeCurveLoop(c, 0, 30);
    for (const mode of ['flat', 'auto', 'vector'] as const) {
      const previous = clone(c.keys);
      c.keys = clone(c.keys);
      c.keys[0].handle = mode;
      syncLoopSeam(c, previous);
      const first = handles(c, 0).right,
        last = handles(c, c.keys.length - 1).left;
      expect(first[1] / first[0]).toBeCloseTo(last[1] / last[0], 8);
      if (mode === 'flat') expect(first[1]).toBe(0);
    }
  });
  it('turns off the seam through the store without changing sampled motion', () => {
    const s = new StudioStore(),
      p = createProject({}, false);
    p.end = 30;
    ensureCurve(p.tracks.hand_l, 'px').keys = curve().keys;
    s.patch({ project: p, selected: 'hand_l' });
    s.setCurveLoop('px', true);
    const before = clone(s.state.project!.tracks.hand_l.curves!.px!);
    s.setCurveLoop('px', false);
    const after = s.state.project!.tracks.hand_l.curves!.px!;
    expect(after.loop).toBeUndefined();
    for (let f = 0; f <= 30; f += 0.5)
      expect(baseCurve(after, f)).toBeCloseTo(baseCurve(before, f), 10);
    s.undo();
    expect(s.state.project!.tracks.hand_l.curves!.px!.loop).toEqual({ start: 0, end: 30 });
  });
  it('authoring one channel leaves unrelated channel interpolation unchanged', () => {
    const s = new StudioStore(),
      p = createProject({}, false);
    p.end = 30;
    ensureCurve(p.tracks.hand_l, 'px').keys = curve().keys;
    s.patch({ project: p, selected: 'hand_l' });
    s.setCurveInterpolation('px', [7], 'loop');
    expect(s.state.project!.tracks.hand_l.curves!.px!.loop).toEqual({ start: 0, end: 30 });
    expect(s.state.project!.tracks.hand_l.curves?.py).toBeUndefined();
    s.undo();
    expect(s.state.project!.tracks.hand_l.curves!.px!.loop).toBeUndefined();
  });
});

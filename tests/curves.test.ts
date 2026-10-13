import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  createProject,
  clone,
  evaluate,
  putKey,
  pose,
  sample,
  validateProject,
} from '../src/core/model';
import {
  baseCurve,
  ensureCurve,
  handles,
  modifier,
  sampleCurve,
  validateCurves,
} from '../src/core/curves';
import type { Curve } from '../src/core/curves';
import { loopRange, matchLoopEnd, playbackFrame, seamReport } from '../src/core/loops';
import { StudioStore } from '../src/core/store';
const simple = (): Curve => ({
  keys: [
    { frame: 0, value: 0, interpolation: 'linear', handle: 'vector' },
    { frame: 10, value: 10, interpolation: 'linear', handle: 'vector' },
  ],
  modifiers: [],
});
describe('channel curves and cyclic animation', () => {
  it('pastes to another channel, reports the selected frames and preserves tangent data', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    s.patch({ selected: 'hand_l' });
    const keys: Curve['keys'] = [
      {
        frame: 2,
        value: 3,
        interpolation: 'bezier',
        handle: 'free',
        left: [-1, -2],
        right: [2, 4],
      },
      { frame: 8, value: 7, interpolation: 'linear', handle: 'vector' },
    ];
    s.setCurveKeys('px', keys);
    s.copyCurveKeys('px', [2, 8]);
    s.patch({ selected: 'hand_r' });
    s.setFrame(20);
    expect(s.pasteCurveKeys('py')).toEqual([20, 26]);
    const pasted = s.state.project!.tracks.hand_r.curves!.py!.keys.filter((k) => k.frame >= 20);
    expect(pasted).toEqual(keys.map((k) => ({ ...k, frame: k.frame + 18 })));
    expect(s.state.curveClipboard![0].right).toEqual([2, 4]);
    const before = s.state.project;
    s.setFrame(before!.end);
    expect(s.pasteCurveKeys('py')).toBeUndefined();
    expect(s.state.project).toBe(before);
  });
  it('evaluates exact keys, flat Bézier, vector tangents, and constant boundaries', () => {
    const c = simple();
    expect(baseCurve(c, 5)).toBe(5);
    c.keys[0].interpolation = 'bezier';
    c.keys.forEach((k) => (k.handle = 'flat'));
    expect(baseCurve(c, 2.5)).toBeCloseTo(1.5625, 5);
    c.keys.forEach((k) => (k.handle = 'vector'));
    expect(baseCurve(c, 2.5)).toBeCloseTo(2.5, 5);
    c.keys.splice(1, 0, { frame: 5, value: 8, interpolation: 'step', handle: 'flat' });
    c.keys[0].interpolation = 'step';
    expect(baseCurve(c, 4.99)).toBe(0);
    expect(baseCurve(c, 5)).toBe(8);
    expect(baseCurve(c, 9.99)).toBe(8);
    expect(baseCurve(c, 10)).toBe(10);
  });
  it('keeps auto-clamped extrema from overshooting and handles monotonic in time', () => {
    const c = simple();
    c.keys = [
      { frame: 0, value: 0, interpolation: 'bezier', handle: 'clamped' },
      { frame: 5, value: 10, interpolation: 'bezier', handle: 'clamped' },
      { frame: 10, value: 0, interpolation: 'bezier', handle: 'clamped' },
    ];
    expect(handles(c, 1).left[1]).toBeCloseTo(0);
    for (let f = 0; f <= 10; f += 0.1) {
      expect(baseCurve(c, f)).toBeGreaterThanOrEqual(-1e-5);
      expect(baseCurve(c, f)).toBeLessThanOrEqual(10.00001);
    }
    c.keys[1].handle = 'free';
    c.keys[1].left = [-100, 300];
    expect(Math.abs(handles(c, 1).left[0])).toBeLessThanOrEqual(5);
    expect(Number.isFinite(baseCurve(c, 2.5))).toBe(true);
  });
  it('repeats, offsets, and ping-pongs on both sides of the key interval', () => {
    const c = simple(),
      m = modifier('cycles');
    if (m.type !== 'cycles') throw Error();
    c.modifiers = [m];
    expect(sampleCurve(c, 12)).toBe(2);
    expect(sampleCurve(c, -2)).toBe(8);
    expect(sampleCurve(c, 10)).toBe(10);
    m.before = m.after = 'offset';
    expect(sampleCurve(c, 12)).toBe(12);
    expect(sampleCurve(c, -2)).toBe(-2);
    m.before = m.after = 'mirror';
    expect(sampleCurve(c, 12)).toBe(8);
    expect(sampleCurve(c, -2)).toBe(2);
    m.after = 'none';
    expect(sampleCurve(c, 25)).toBe(10);
  });
  it('uses cyclic neighbors for matching automatic seam tangents', () => {
    const c = simple();
    c.keys = [
      { frame: 0, value: 0, interpolation: 'bezier', handle: 'auto' },
      { frame: 3, value: 4, interpolation: 'bezier', handle: 'auto' },
      { frame: 7, value: -4, interpolation: 'bezier', handle: 'auto' },
      { frame: 10, value: 0, interpolation: 'bezier', handle: 'auto' },
    ];
    c.modifiers = [modifier('cycles')];
    const a = handles(c, 0).right,
      b = handles(c, 3).left;
    expect(a[1] / a[0]).toBeCloseTo(b[1] / b[0]);
    expect(sampleCurve(c, 10.01)).toBeCloseTo(sampleCurve(c, 0.01), 7);
  });
  it('applies a deterministic modifier stack in order, with mute and limits', () => {
    const c = simple(),
      sine = modifier('sine'),
      scale = modifier('scale'),
      limits = modifier('limits'),
      noise = modifier('noise');
    if (
      sine.type !== 'sine' ||
      scale.type !== 'scale' ||
      limits.type !== 'limits' ||
      noise.type !== 'noise'
    )
      throw Error();
    sine.amplitude = 2;
    sine.period = 20;
    scale.factor = 3;
    scale.offset = 1;
    c.modifiers = [sine, scale];
    expect(sampleCurve(c, 5)).toBeCloseTo(22);
    c.modifiers = [scale, sine];
    expect(sampleCurve(c, 5)).toBeCloseTo(18);
    limits.max = 12;
    c.modifiers.push(limits);
    expect(sampleCurve(c, 5)).toBe(12);
    limits.enabled = false;
    expect(sampleCurve(c, 5)).toBe(18);
    noise.algorithm = 'smooth';
    c.modifiers = [noise];
    const v = sampleCurve(c, 4);
    expect(sampleCurve(clone(c), 4)).toBe(v);
    noise.seed = 8;
    expect(sampleCurve(c, 4)).not.toBe(v);
  });
  it('drives actual pose channels, preserves quaternion normalization, and clamps grip/FOV', () => {
    const p = createProject({}, false),
      t = p.tracks.rifle,
      c = ensureCurve(t, 'px');
    c.keys = [{ frame: 0, value: 100, interpolation: 'linear', handle: 'vector' }];
    expect(evaluate(p, 0).rifle.p[0]).toBe(1);
    const rot = ensureCurve(t, 'rx');
    rot.keys = [{ frame: 0, value: 720 + 90, interpolation: 'linear', handle: 'vector' }];
    expect(new Quaternion(...sample(t, 0).q).length()).toBeCloseTo(1);
    expect(new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...sample(t, 0).q)).z).toBeCloseTo(
      1,
    );
    ensureCurve(t, 'index').keys[0].value = 200;
    ensureCurve(t, 'fov').keys[0].value = 200;
    expect(sample(t, 0).grip[1]).toBe(1);
    expect(sample(t, 0).fov).toBe(120);
  });
  it('inverts additive modifiers when inserting a visible pose key', () => {
    const p = createProject({}, false),
      t = p.tracks.rifle,
      c = ensureCurve(t, 'px'),
      m = modifier('sine');
    if (m.type !== 'sine') throw Error();
    m.amplitude = 10;
    m.period = 24;
    c.modifiers = [m];
    putKey(t, 6, pose([0.5, 1, 1]));
    expect(sample(t, 6).p[0]).toBeCloseTo(0.5, 7);
    expect(c.keys.find((k) => k.frame === 6)!.value).toBeCloseTo(40);
  });
  it('preserves curves/modifiers/loop metadata through save validation and rejects malformed data', () => {
    const p = createProject({}, false);
    p.loop = { enabled: true, start: 5, end: 20 };
    ensureCurve(p.tracks.rifle, 'py').modifiers = [modifier('noise')];
    expect(validateProject(clone(p))).toEqual(p);
    const bad = clone(p);
    bad.tracks.rifle.curves!.py!.modifiers[0] = { ...modifier('sine'), period: 0 } as never;
    expect(() => validateProject(bad)).toThrow();
    const bad2 = clone(p);
    bad2.loop!.end = 1000;
    expect(() => validateProject(bad2)).toThrow();
  });
  it('wraps preview over frame intervals without a duplicate endpoint hold and plays once when disabled', () => {
    const p = createProject({}, false);
    p.loop = { enabled: true, start: 10, end: 34 };
    expect(playbackFrame(p, 10, 23.5).frame).toBe(33.5);
    expect(playbackFrame(p, 10, 24).frame).toBe(10);
    expect(playbackFrame(p, 34, 0).frame).toBe(10);
    p.loop.enabled = false;
    expect(playbackFrame(p, 90, 10)).toEqual({ frame: 96, finished: true });
  });
  it('matches endpoint poses on both independent rigs through existing contacts', () => {
    const p = createProject();
    p.loop = { enabled: true, start: 22, end: 58 };
    const after = matchLoopEnd(p);
    for (const report of seamReport(after)) {
      expect(report.position).toBeLessThan(1e-5);
      expect(report.rotation).toBeLessThan(1e-4);
      expect(report.grip).toBeLessThan(1e-5);
    }
  });
  it('matching an already repeating pose preserves the source cycle interval', () => {
    const p = createProject({}, false),
      c = ensureCurve(p.tracks.rifle, 'py');
    c.keys = [
      { frame: 0, value: 157, interpolation: 'linear', handle: 'vector' },
      { frame: 12, value: 159, interpolation: 'linear', handle: 'vector' },
      { frame: 24, value: 157, interpolation: 'linear', handle: 'vector' },
    ];
    c.modifiers = [modifier('cycles')];
    p.loop = { enabled: true, start: 0, end: 48 };
    const after = matchLoopEnd(p);
    expect(after.tracks.rifle.curves!.py!.keys.map((k) => k.frame)).toEqual([0, 12, 24]);
  });
  it('bakes modifier samples without changing motion and makes curve edits undoable', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    s.patch({ selected: 'rifle' });
    s.addModifier('py', 'sine');
    const before = clone(s.state.project!);
    s.bakeCurve('py');
    for (let f = 0; f <= 96; f++)
      expect(evaluate(s.state.project!, f).rifle.p[1]).toBeCloseTo(
        evaluate(before, f).rifle.p[1],
        7,
      );
    expect(s.state.project!.tracks.rifle.curves!.py!.modifiers).toHaveLength(0);
    s.undo();
    expect(s.state.project!.tracks.rifle.curves!.py!.modifiers).toHaveLength(1);
  });
  it('copies scalar keys between animations and retimes channel keys from the timeline', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    s.patch({ selected: 'rifle' });
    s.addCurveKey('px', 0, 5);
    s.addCurveKey('px', 12, 20);
    s.copyCurveKeys('px', [0, 12]);
    s.addAnimation({});
    s.patch({ selected: 'rifle' });
    s.setFrame(24);
    s.pasteCurveKeys('px');
    expect(s.state.project!.tracks.rifle.curves!.px!.keys.map((k) => k.frame)).toEqual([0, 24, 36]);
    s.moveKey('rifle', 36, 40);
    expect(evaluate(s.state.project!, 40).rifle.p[0]).toBeCloseTo(0.2, 7);
    s.removeKey('rifle', 40);
    expect(s.state.project!.tracks.rifle.curves!.px!.keys.some((k) => k.frame === 40)).toBe(false);
  });
});

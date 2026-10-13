import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  DEFAULT_BOUNCE,
  DEFAULT_SPRING,
  motionProgress,
  validateMotionOptions,
} from '../src/core/interpolation';
import type { MotionMode, EaseDirection } from '../src/core/interpolation';
import {
  createProject,
  evaluate,
  sample,
  putKey,
  pose,
  validateProject,
  forLayer,
  clone,
} from '../src/core/model';
import { baseCurve, ensureCurve, readCurve, modifier, sampleCurve } from '../src/core/curves';
import { StudioStore } from '../src/core/store';
import { capturePose, applyPose, library, validateLibrary } from '../src/core/library';
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 7));
describe('spring and bounce interpolation', () => {
  it('has exact endpoints and stays finite for every allowed extreme and direction', () => {
    for (const mode of ['spring', 'bounce'] as MotionMode[])
      for (const easing of ['in', 'out', 'inOut'] as EaseDirection[]) {
        for (const options of [
          {
            easing,
            spring: { oscillations: 0.5, damping: 0, strength: 0 },
            bounce: { bounces: 1, height: 0, decay: 0.1, impact: 0.1 },
          },
          {
            easing,
            spring: { oscillations: 8, damping: 20, strength: 2 },
            bounce: { bounces: 8, height: 1, decay: 0.95, impact: 0.8 },
          },
          { easing, spring: DEFAULT_SPRING, bounce: DEFAULT_BOUNCE },
        ]) {
          expect(motionProgress(mode, -1, options)).toBe(0);
          expect(motionProgress(mode, 0, options)).toBe(0);
          expect(motionProgress(mode, 1, options)).toBe(1);
          expect(motionProgress(mode, 2, options)).toBe(1);
          for (let i = 0; i <= 1000; i++)
            expect(Number.isFinite(motionProgress(mode, i / 1000, options))).toBe(true);
        }
      }
  });
  it('produces spring overshoot and lets damping, oscillations and strength change the motion', () => {
    const values = Array.from({ length: 1001 }, (_, i) => motionProgress('spring', i / 1000));
    expect(Math.max(...values)).toBeGreaterThan(1.1);
    const peak = (damping: number) =>
      Math.max(
        ...values.map((_, i) =>
          motionProgress('spring', i / 1000, { spring: { ...DEFAULT_SPRING, damping } }),
        ),
      );
    expect(peak(14)).toBeLessThan(peak(3));
    expect(
      motionProgress('spring', 0.2, { spring: { ...DEFAULT_SPRING, oscillations: 4 } }),
    ).not.toBeCloseTo(motionProgress('spring', 0.2), 3);
    expect(
      motionProgress('spring', 0.25, { spring: { ...DEFAULT_SPRING, strength: 0 } }),
    ).toBeCloseTo(0.25 * 0.25 * (3 - 2 * 0.25));
    expect((motionProgress('spring', 1) - motionProgress('spring', 1 - 1e-5)) / 1e-5).toBeCloseTo(
      0,
      3,
    );
  });
  it('places the first bounce impact precisely and decreases bounce heights', () => {
    const b = { ...DEFAULT_BOUNCE },
      durations = Array.from({ length: b.bounces }, (_, i) => Math.sqrt(b.decay) ** i),
      sum = durations.reduce((a, b) => a + b, 0);
    expect(motionProgress('bounce', b.impact, { bounce: b })).toBe(1);
    let time = b.impact;
    for (let i = 0; i < b.bounces; i++) {
      const duration = ((0.98 - b.impact) * durations[i]) / sum;
      expect(motionProgress('bounce', time + duration / 2, { bounce: b })).toBeCloseTo(
        1 - b.height * b.decay ** i,
        8,
      );
      time += duration;
    }
    expect(motionProgress('bounce', 0.99, { bounce: b })).toBe(1);
    expect(motionProgress('bounce', 0.2, { bounce: { ...b, impact: 0.2 } })).toBe(1);
    expect(motionProgress('bounce', 0.2, { bounce: { ...b, impact: 0.6 } })).toBeLessThan(0.2);
  });
  it('mirrors ease-in and keeps both halves of ease-in/out continuous', () => {
    for (const mode of ['spring', 'bounce'] as MotionMode[]) {
      expect(motionProgress(mode, 0.23, { easing: 'in' })).toBeCloseTo(
        1 - motionProgress(mode, 0.77),
        10,
      );
      expect(motionProgress(mode, 0.5, { easing: 'inOut' })).toBe(0.5);
      expect(motionProgress(mode, 0.5 - 1e-7, { easing: 'inOut' })).toBeCloseTo(0.5, 5);
    }
  });
  it('samples pose positions and scalar curves identically, including negative movement', () => {
    for (const mode of ['spring', 'bounce'] as const) {
      const p = createProject({}, false),
        t = p.tracks.root;
      t.interpolation = mode;
      t.spring = { ...DEFAULT_SPRING, damping: 4 };
      t.bounce = { ...DEFAULT_BOUNCE, height: 0.6 };
      t.easing = 'inOut';
      putKey(t, 0, pose([1, 0, 0]));
      putKey(t, 24, pose([-0.5, 0, 0]));
      const curve = readCurve(t, 'px');
      for (let f = 0; f <= 24; f += 0.125)
        expect(baseCurve(curve, f) / 100).toBeCloseTo(sample(t, f).p[0], 8);
      ensureCurve(t, 'px');
      near(sample(t, 24).p, [-0.5, 0, 0]);
    }
  });
  it('keeps quaternion rotations normalized and limits finger and camera overshoot', () => {
    const t = createProject({}, false).tracks.camera;
    t.interpolation = 'spring';
    t.spring = { ...DEFAULT_SPRING, strength: 2 };
    putKey(t, 0, pose([0, 0, 0], [0, 0, 0, 1], [0, 0, 0, 0, 0], 20));
    putKey(
      t,
      24,
      pose(
        [1, 0, 0],
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4).toArray(),
        [1, 1, 1, 1, 1],
        120,
      ),
    );
    let overshot = false;
    for (let f = 0; f < 24; f += 0.1) {
      const p = sample(t, f);
      expect(new Quaternion(...p.q).length()).toBeCloseTo(1, 10);
      expect(p.fov).toBeGreaterThanOrEqual(20);
      expect(p.fov).toBeLessThanOrEqual(120);
      expect(p.grip.every((v) => v >= -1 && v <= 1)).toBe(true);
      if (p.p[0] > 1) overshot = true;
    }
    expect(overshot).toBe(true);
  });
  it('repeats spring segments with cycle offsets and composes modifiers in order', () => {
    const t = createProject({}, false).tracks.root;
    t.interpolation = 'spring';
    putKey(t, 24, pose([1, 0, 0]));
    const curve = ensureCurve(t, 'px');
    curve.modifiers = [
      { ...modifier('cycles'), type: 'cycles', before: 'offset', after: 'offset' },
      { ...modifier('scale'), type: 'scale', factor: 2, offset: 3 },
    ];
    expect(sampleCurve(curve, 30)).toBeCloseTo(sampleCurve(curve, 6) + 200, 7);
    expect(sampleCurve(curve, -18)).toBeCloseTo(sampleCurve(curve, 6) - 200, 7);
  });
  it('applies control settings to existing channel curves, preserves modifiers, and undoes a gesture', () => {
    const s = new StudioStore(),
      p = createProject({}, false);
    putKey(p.tracks.root, 24, pose([1, 0, 0]));
    const curve = ensureCurve(p.tracks.root, 'px');
    curve.modifiers = [modifier('noise')];
    s.patch({ project: p, ready: true, selected: 'root' });
    s.setInterpolation('spring');
    s.beginGesture();
    s.setMotionOptions({ spring: { ...DEFAULT_SPRING, damping: 3 } });
    s.setMotionOptions({ spring: { ...DEFAULT_SPRING, damping: 8 } });
    s.endGesture();
    expect(
      s.state.project!.tracks.root.curves!.px!.keys.every(
        (k) => k.interpolation === 'spring' && k.spring?.damping === 8,
      ),
    ).toBe(true);
    expect(s.state.project!.tracks.root.curves!.px!.modifiers[0].type).toBe('noise');
    s.undo();
    expect(s.state.project!.tracks.root.spring).toBeUndefined();
    s.redo();
    expect(s.state.project!.tracks.root.spring?.damping).toBe(8);
    s.addCurveKey('px', 12);
    expect(
      s.state.project!.tracks.root.curves!.px!.keys.find((k) => k.frame === 12)?.interpolation,
    ).toBe('spring');
  });
  it('keeps base-key autokey and pose paste compatible with spring curves', () => {
    const p = createProject({}, false),
      t = p.tracks.root;
    t.interpolation = 'spring';
    putKey(t, 24, pose([0.4, 0, 0]));
    ensureCurve(t, 'px');
    putKey(t, 12, pose([0.2, 0, 0]));
    expect(t.curves!.px!.keys.find((k) => k.frame === 12)?.interpolation).toBe('spring');
    near(evaluate(p, 12).root.p, [0.2, 0, 0]);
    const stamp = capturePose(p, 12, {}, 'control', 'root'),
      next = applyPose(p, 18, stamp, 'root');
    near(evaluate(next, 18).root.p, [0.2, 0, 0]);
  });
  it('saves settings on both rigs and independent segments while rejecting malformed settings', () => {
    const p = createProject({}, false);
    p.tracks.rifle.interpolation = 'spring';
    p.tracks.rifle.spring = { ...DEFAULT_SPRING, damping: 4 };
    const body = forLayer(p, 'body');
    body.tracks.root.interpolation = 'bounce';
    body.tracks.root.bounce = { ...DEFAULT_BOUNCE, bounces: 5 };
    body.tracks.root.easing = 'inOut';
    putKey(p.tracks.rifle, 24, pose([0, 1, 0.5]));
    const c = ensureCurve(p.tracks.rifle, 'py');
    c.keys[0].interpolation = 'bounce';
    c.keys[0].bounce = { ...DEFAULT_BOUNCE, height: 0.2 };
    expect(validateLibrary(JSON.parse(JSON.stringify(library(p)))).clips[0].project).toEqual(p);
    for (const invalid of [
      { spring: { ...DEFAULT_SPRING, damping: Infinity } },
      { bounce: { ...DEFAULT_BOUNCE, bounces: 2.5 } },
      { bounce: { ...DEFAULT_BOUNCE, impact: 1 } },
      { easing: 'bad' },
    ])
      expect(() => validateMotionOptions(invalid as any)).toThrow();
    const bad = clone(p);
    bad.tracks.rifle.curves!.py!.keys[0].bounce!.decay = -1;
    expect(() => validateProject(bad)).toThrow(/bounce/);
    const untouched = forLayer(p, 'body').tracks;
    const s = new StudioStore();
    s.patch({ project: p, selected: 'rifle' });
    s.setInterpolation('bounce');
    expect(forLayer(s.state.project!, 'body').tracks).toEqual(untouched);
  });
});

import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { reduceCurve, reduceTrack, DEFAULT_REDUCTION } from '../src/core/curveReduction';
import { baseCurve, sampleCurve, readCurve, handles } from '../src/core/curves';
import type { Curve, CurveKey, Channel } from '../src/core/curves';
import { pose, sample, clone, createProject, validateProject } from '../src/core/model';
import type { Track } from '../src/core/model';
import { StudioStore } from '../src/core/store';
const options = { ...DEFAULT_REDUCTION, preserveExtrema: false };
const polynomial = (count = 61): Curve => ({
  keys: Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1),
      value = 10 * t ** 3 - 14 * t * t + 6 * t,
      slope = (30 * t * t - 28 * t + 6) / (count - 1);
    return {
      frame: i,
      value,
      handle: 'free',
      interpolation: 'bezier',
      left: [-1 / 3, -slope / 3],
      right: [1 / 3, slope / 3],
    } as CurveKey;
  }),
  modifiers: [],
});
const track = (curve: Curve): Track => ({
  keys: curve.keys.map((k) => ({ ...pose([k.value / 100, 0, 0]), frame: k.frame })),
  spaces: [],
  interpolation: 'linear',
  curves: { px: curve },
});
const error = (a: Curve, b: Curve, end: number) =>
  Math.max(
    ...Array.from({ length: 2001 }, (_, i) =>
      Math.abs(sampleCurve(a, (end * i) / 2000) - sampleCurve(b, (end * i) / 2000)),
    ),
  );

describe('curve-aware keyframe reduction', () => {
  it('collapses exact constant channels without erasing cyclic timing or overshoot', () => {
    const source: Curve = {
      keys: Array.from({ length: 20 }, (_, frame) => ({
        frame,
        value: 4,
        interpolation: 'bezier',
        handle: 'flat',
      })),
      modifiers: [],
    };
    expect(reduceCurve(source, 0.01, options).curve.keys).toHaveLength(1);
    source.modifiers = [
      { id: 'cycles', type: 'cycles', enabled: true, before: 'repeat', after: 'repeat' },
    ];
    const cycle = reduceCurve(source, 0.01, options).curve;
    expect(cycle.keys[0].frame).toBe(0);
    expect(cycle.keys.at(-1)!.frame).toBe(19);
  });
  it('reconstructs an exact cubic with two editable keys and unequal per-axis counts', () => {
    const original = polynomial(),
      before = clone(original),
      result = reduceCurve(original, 0.0001, options);
    expect(result.curve.keys).toHaveLength(2);
    expect(result.curve.keys[0].interpolation).toBe('bezier');
    expect(result.curve.keys[0].right![1]).not.toBe(0);
    expect(error(original, result.curve, 60)).toBeLessThan(0.0001);
    expect(result.bound).toBeLessThanOrEqual(0.0001);
    expect(original).toEqual(before);
    const t = track(original);
    t.curves!.py = {
      keys: [{ frame: 0, value: 3, handle: 'flat', interpolation: 'linear' }],
      modifiers: [],
    };
    t.curves!.pz = {
      keys: Array.from({ length: 61 }, (_, frame) => ({
        frame,
        value: frame,
        interpolation: 'linear',
        handle: 'vector',
      })),
      modifiers: [],
    };
    const reduced = reduceTrack(
      { id: 'rifle', label: 'Weapon', track: t, channels: ['px', 'py', 'pz'] },
      options,
      60,
    );
    expect(reduced.rows.map((r) => r.after)).toEqual([2, 1, 2]);
    expect(reduced.track.curves!.pz!.keys[0].interpolation).toBe('linear');
  });
  it('checks subframe overshoot that integer-frame-only reducers miss', () => {
    const source: Curve = {
      keys: Array.from({ length: 7 }, (_, frame) => ({
        frame,
        value: 0,
        interpolation: 'bezier',
        handle: 'free',
        left: [-1 / 3, frame === 3 ? 2 : 0],
        right: [1 / 3, frame === 2 ? 2 : 0],
      })),
      modifiers: [],
    };
    const result = reduceCurve(source, 0.01, options);
    expect(result.curve.keys.length).toBeGreaterThan(2);
    expect(baseCurve(result.curve, 2.5)).toBeGreaterThan(1);
    expect(error(source, result.curve, 6)).toBeLessThan(0.01);
  });
  it('skims horizontal handle lengths to recover time-warped easing with fewer keys', () => {
    type P = [number, number];
    type C = [P, P, P, P];
    const mix = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const divide = (p: C, t: number): [C, C] => {
      const a = mix(p[0], p[1], t),
        b = mix(p[1], p[2], t),
        c = mix(p[2], p[3], t),
        d = mix(a, b, t),
        e = mix(b, c, t),
        f = mix(d, e, t);
      return [
        [p[0], a, d, f],
        [f, e, c, p[3]],
      ];
    };
    let rest: C = [
      [0, 0],
      [5, 8],
      [16, -3],
      [60, 5],
    ];
    const segments: C[] = [];
    for (let i = 0; i < 29; i++) {
      const [a, b] = divide(rest, 1 / (30 - i));
      segments.push(a);
      rest = b;
    }
    segments.push(rest);
    const source: Curve = {
      keys: segments.map((p, i) => ({
        frame: p[0][0],
        value: p[0][1],
        interpolation: 'bezier',
        handle: 'free',
        right: [p[1][0] - p[0][0], p[1][1] - p[0][1]],
        left: i ? [segments[i - 1][2][0] - p[0][0], segments[i - 1][2][1] - p[0][1]] : undefined,
      })),
      modifiers: [],
    };
    source.keys.push({
      frame: 60,
      value: 5,
      interpolation: 'bezier',
      handle: 'free',
      left: [rest[2][0] - 60, rest[2][1] - 5],
    });
    const skim = reduceCurve(source, 0.03, { ...options, fit: 'bezier', skimHandles: true }),
      fixed = reduceCurve(source, 0.03, { ...options, fit: 'bezier', skimHandles: false });
    expect(skim.curve.keys.length).toBeLessThan(fixed.curve.keys.length);
    expect(error(source, skim.curve, 60)).toBeLessThan(0.03);
  });
  it('keeps procedural modifiers, bounds amplified error and preserves primitive segments', () => {
    const source = polynomial();
    source.modifiers = [
      { id: 'scale', type: 'scale', enabled: true, factor: 15, offset: 2 },
      { id: 'sine', type: 'sine', enabled: true, amplitude: 5, period: 12, phase: 13 },
    ];
    source.keys[20].interpolation = 'step';
    source.keys[30].interpolation = 'spring';
    source.keys[40].interpolation = 'bounce';
    const reduced = reduceCurve(source, 0.01, options).curve;
    expect(reduced.modifiers).toEqual(source.modifiers);
    expect(reduced.keys.length).toBeLessThan(source.keys.length);
    for (const frame of [20, 30, 40]) {
      expect(reduced.keys.find((k) => k.frame === frame)?.interpolation).toBe(
        source.keys[frame].interpolation,
      );
      expect(reduced.keys.some((k) => k.frame === frame + 1)).toBe(true);
    }
    expect(error(source, reduced, 60)).toBeLessThan(0.01);
  });
  it('preserves peaks, hold boundaries, switch neighborhoods and excluded ranges', () => {
    const source: Curve = {
      keys: Array.from({ length: 31 }, (_, frame) => ({
        frame,
        value: frame < 5 ? 0 : frame < 15 ? frame - 5 : frame < 25 ? 25 - frame : 0,
        interpolation: 'linear',
        handle: 'vector',
      })),
      modifiers: [],
    };
    const reduced = reduceCurve(
      source,
      0.01,
      { ...options, preserveExtrema: true, range: [4, 27] },
      [18],
    ).curve;
    for (const frame of [0, 1, 2, 3, 4, 5, 15, 16, 17, 18, 19, 25, 27, 28, 29, 30])
      expect(reduced.keys.some((k) => k.frame === frame)).toBe(true);
    expect(error(source, reduced, 30)).toBeLessThan(0.01);
  });
  it('keeps cyclic endpoint timing and tangent slopes while removing interior samples', () => {
    const source = polynomial();
    source.modifiers = [
      { id: 'loop', type: 'cycles', enabled: true, before: 'offset', after: 'offset' },
    ];
    const result = reduceCurve(source, 0.0001, options).curve;
    expect(result.keys.length).toBeLessThan(source.keys.length);
    expect(result.keys[0].frame).toBe(0);
    expect(result.keys.at(-1)!.frame).toBe(60);
    for (const [a, b, side] of [
      [0, 0, 'right'],
      [source.keys.length - 1, result.keys.length - 1, 'left'],
    ] as const) {
      const x = handles(source, a)[side],
        y = handles(result, b)[side];
      expect(x[1] / x[0]).toBeCloseTo(y[1] / y[0], 7);
    }
    for (let f = -120; f < 180; f += 0.137)
      expect(Math.abs(sampleCurve(source, f) - sampleCurve(result, f))).toBeLessThan(0.0001);
  });
  it('validates combined quaternion rotation and preserves unselected axes', () => {
    const keys = Array.from({ length: 41 }, (_, frame) => ({
      ...pose(
        [0, 0, 0],
        new Quaternion()
          .setFromAxisAngle(new Vector3(0, 1, 0), 0.3 * Math.sin((frame / 40) * Math.PI))
          .toArray(),
      ),
      frame,
    }));
    const t: Track = {
      keys,
      spaces: [],
      interpolation: 'linear',
      rotationMode: 'quaternion',
      curves: {},
    };
    for (const [i, c] of ['qx', 'qy', 'qz', 'qw'].entries())
      t.curves![c as Channel] = {
        keys: keys.map((k) => ({
          frame: k.frame,
          value: k.q[i],
          interpolation: 'linear',
          handle: 'vector',
        })),
        modifiers: [],
      };
    const result = reduceTrack(
      { id: 'hand_l', label: 'Left hand', track: t, channels: ['qy', 'qw'] },
      options,
      40,
    );
    expect(result.after).toBeLessThan(result.before);
    expect(result.track.curves!.qx).toEqual(t.curves!.qx);
    expect(result.track.curves!.qz).toEqual(t.curves!.qz);
    for (let f = 0; f < 40; f += 0.037)
      expect(
        (new Quaternion(...sample(t, f).q).angleTo(new Quaternion(...sample(result.track, f).q)) *
          180) /
          Math.PI,
      ).toBeLessThan(options.rotation);
  });
  it('does not change coupled implicit rotation when a scalar approximation would exceed tolerance', () => {
    const t: Track = {
      keys: Array.from({ length: 5 }, (_, frame) => ({
        ...pose(
          [0, 0, 0],
          new Quaternion()
            .setFromAxisAngle(new Vector3(1, 1, 0).normalize(), frame * 0.35)
            .toArray(),
        ),
        frame,
      })),
      spaces: [],
      interpolation: 'linear',
    };
    const result = reduceTrack(
      { id: 'hand_l', label: 'Left hand', track: t, channels: ['rx'] },
      { ...options, rotation: 0.001 },
      4,
    );
    for (let f = 0; f < 4; f += 0.013)
      expect(
        (new Quaternion(...sample(t, f).q).angleTo(new Quaternion(...sample(result.track, f).q)) *
          180) /
          Math.PI,
      ).toBeLessThan(0.0011);
  });
  it('prunes redundant fallback keys only when all changing channels remain covered', () => {
    const t = track(polynomial());
    for (const c of ['py', 'pz', 'rx', 'ry', 'rz'] as Channel[])
      t.curves![c] = {
        keys: [{ frame: 0, value: 0, interpolation: 'linear', handle: 'vector' }],
        modifiers: [],
      };
    const result = reduceTrack(
      { id: 'rifle', label: 'Weapon', track: t, channels: ['px'] },
      options,
      60,
    );
    expect(result.track.keys).toHaveLength(2);
    expect(result.track.spaces).toEqual(t.spaces);
    const uncaptured = clone(t);
    uncaptured.keys[20].grip[0] = 0.9;
    expect(
      reduceTrack(
        { id: 'rifle', label: 'Weapon', track: uncaptured, channels: ['px'] },
        options,
        60,
      ).track.keys,
    ).toHaveLength(61);
  });
  it('applies once, stays undoable during playback, and rejects stale analysis', () => {
    const store = new StudioStore(),
      p = createProject({}, false);
    p.end = 60;
    p.tracks.rifle = track(polynomial());
    store.open(p);
    store.patch({ playing: true });
    const original = store.state.project!,
      reduced = reduceTrack(
        { id: 'rifle', label: 'Weapon', track: original.tracks.rifle, channels: ['px'] },
        options,
        60,
      );
    expect(store.applyCurveReduction(original, { rifle: reduced.track })).toBe(true);
    expect(store.state.playing).toBe(true);
    expect(readCurve(store.state.project!.tracks.rifle, 'px').keys).toHaveLength(2);
    validateProject(clone(store.state.project));
    store.undo();
    expect(store.state.project!.tracks.rifle).toEqual(original.tracks.rifle);
    store.redo();
    expect(store.state.project!.tracks.rifle).toEqual(reduced.track);
    expect(store.applyCurveReduction(original, { rifle: reduced.track })).toBe(false);
  });
});

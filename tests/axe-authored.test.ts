import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { validateLibrary } from '../src/core/library';
import {
  clone,
  evaluate,
  forLayer,
  matrix,
  putKey,
  rawForWorld,
  sample,
  switchParent,
  validateProject,
} from '../src/core/model';
import { sampleCurve, channelsFor } from '../src/core/curves';
import type { Channel } from '../src/core/curves';
import { StudioStore } from '../src/core/store';
const lib = validateLibrary(
  JSON.parse(fs.readFileSync('tests/fixtures/axe-equip-idle.manny.json', 'utf8')),
);
const source = JSON.parse(fs.readFileSync('tests/fixtures/axe-blender-curves.json', 'utf8'));
const equip = lib.clips[0].project,
  idle = lib.clips[1].project;
const distance = (a: number[], b: number[]) => new Vector3(...a).distanceTo(new Vector3(...b));
describe('source-authored axe animation', () => {
  it('approaches the frame 13 contact continuously in the incoming space without adding keys', () => {
    const saved = JSON.stringify(equip);
    let previous = evaluate(equip, 12).hand_l;
    for (let i = 1; i <= 1000; i++) {
      const next = evaluate(equip, 12 + i / 1000).hand_l;
      expect(distance(previous.p, next.p)).toBeLessThan(0.001);
      expect(new Quaternion(...previous.q).angleTo(new Quaternion(...next.q))).toBeLessThan(0.02);
      previous = next;
    }
    expect(distance(evaluate(equip, 12.99999).hand_l.p, evaluate(equip, 13).hand_l.p)).toBeLessThan(
      0.000001,
    );
    expect(JSON.stringify(equip)).toBe(saved);
  });
  it('keeps only the two authored times throughout Idle, with seven editable noise modifiers on the weapon', () => {
    for (const tracks of [idle.tracks, idle.otherTracks])
      for (const track of Object.values(tracks)) {
        expect(track.keys.every((k) => k.frame === 0 || k.frame === 80)).toBe(true);
        expect(track.keys.length).toBeLessThanOrEqual(2);
        for (const c of Object.values(track.curves ?? {}))
          expect(c!.keys.every((k) => k.frame === 0 || k.frame === 80)).toBe(true);
      }
    const mods = Object.values(idle.tracks.rifle.curves!).flatMap((c) => c!.modifiers);
    expect(mods).toHaveLength(7);
    expect(idle.tracks.rifle.keys.map((k) => k.frame)).toEqual([0, 80]);
    for (const m of mods) {
      expect(m.type).toBe('noise');
      if (m.type !== 'noise') continue;
      expect(m.algorithm).toBe('blender');
      expect(m.rangeStart).toBe(0);
      expect(m.rangeEnd).toBe(80);
      expect(m.blendIn).toBe(10);
      expect(m.blendOut).toBe(10);
    }
    expect(channelsFor('rifle', idle.tracks.rifle)).toEqual([
      'px',
      'py',
      'pz',
      'qw',
      'qx',
      'qy',
      'qz',
    ]);
  });
  it('retains the Equip weapon keys and sparse hand/contact timing', () => {
    for (const tracks of [equip.tracks, equip.otherTracks]) {
      expect(tracks.rifle.keys.map((k) => k.frame)).toEqual([0, 6, 13, 14, 20]);
      expect(tracks.hand_l.keys.map((k) => k.frame)).toEqual([0, 10, 12, 13]);
      expect(tracks.hand_l.spaces.map((s) => [s.frame, s.parent])).toEqual([[13, 'rifle']]);
      for (const track of Object.values(tracks)) expect(track.keys.length).toBeLessThanOrEqual(5);
    }
  });
  it('matches Blender curve values at independent source samples, including fractional frames', () => {
    for (const [name, p] of [
      ['Equip', equip],
      ['Idle', idle],
    ] as const)
      for (const c of source[name]) {
        const position = c.path.endsWith('.location'),
          channel = (position ? ['px', 'py', 'pz'] : ['qw', 'qx', 'qy', 'qz'])[c.index] as Channel;
        for (const [frame, value] of c.samples)
          expect(
            Math.abs(
              sampleCurve(p.tracks.rifle.curves![channel]!, frame) / (position ? 100 : 1) - value,
            ),
          ).toBeLessThan(5e-7);
      }
  });
  it('stops idle motion when noise is muted and changes motion when strength is edited, without extra keys', () => {
    const p = clone(idle),
      before = evaluate(p, 39.5).rifle;
    for (const c of Object.values(p.tracks.rifle.curves!))
      for (const m of c!.modifiers) m.enabled = false;
    for (const f of [0, 5.5, 40, 79.5, 80])
      for (const id of ['rifle', 'hand_l', 'hand_r'] as const)
        expect(distance(evaluate(p, f)[id].p, evaluate(p, 0)[id].p)).toBeLessThan(1e-7);
    expect(distance(before.p, evaluate(p, 39.5).rifle.p)).toBeGreaterThan(0.0001);
    const edited = clone(idle),
      m = edited.tracks.rifle.curves!.px!.modifiers[0];
    if (m.type !== 'noise') throw Error();
    m.amplitude *= 2;
    expect(distance(evaluate(edited, 39.5).rifle.p, before.p)).toBeGreaterThan(0.00001);
    expect(edited.tracks.rifle.keys).toHaveLength(2);
    expect(evaluate(edited, 0).rifle).toEqual(evaluate(idle, 0).rifle);
    expect(evaluate(edited, 80).rifle).toEqual(evaluate(idle, 80).rifle);
  });
  it('holds hand-to-prop contacts while the weapon is procedurally animated', () => {
    for (const p of [idle, forLayer(idle, 'body')]) {
      const relative = (f: number, id: 'hand_l' | 'hand_r') => {
        const v = evaluate(p, f);
        return matrix(v.rifle).invert().multiply(matrix(v[id]));
      };
      for (const id of ['hand_l', 'hand_r'] as const)
        for (const f of [0, 7.25, 40, 73.5, 80])
          expect(
            Math.max(
              ...relative(f, id).elements.map((v, i) => Math.abs(v - relative(0, id).elements[i])),
            ),
          ).toBeLessThan(1e-6);
    }
  });
  it('supports viewport keying, release and save/load of native basis controls', () => {
    const p = clone(equip),
      f = 10.5,
      id = 'hand_l',
      value = evaluate(p, f)[id];
    value.p[0] += 0.03;
    const raw = rawForWorld(p, id, f, value),
      moved = evaluate(p, f, { [id]: raw })[id];
    expect(distance(value.p, moved.p)).toBeLessThan(1e-7);
    expect(new Quaternion(...value.q).angleTo(new Quaternion(...moved.q))).toBeLessThan(1e-7);
    const at = evaluate(p, 15).hand_l,
      released = switchParent(p, 'hand_l', 'world', 15);
    expect(distance(evaluate(released, 15).hand_l.p, at.p)).toBeLessThan(1e-7);
    const n = clone(idle),
      r = sample(n.tracks.rifle, 40);
    putKey(n.tracks.rifle, 40, r);
    expect(new Quaternion(...sample(n.tracks.rifle, 40).q).length()).toBeCloseTo(1, 9);
    expect(validateProject(JSON.parse(JSON.stringify(n)))).toEqual(n);
    const bad = clone(n);
    bad.tracks.rifle.basis!.pre = new Matrix4().makeScale(0, 1, 1).toArray();
    expect(() => validateProject(bad)).toThrow();
  });
  it('inserts graph keys under noise without applying the modifier twice, and supports undo', () => {
    const s = new StudioStore();
    s.open(clone(idle));
    s.patch({ selected: 'rifle' });
    const before = evaluate(s.state.project!, 40).rifle;
    s.addCurveKey('px', 40);
    expect(distance(evaluate(s.state.project!, 40).rifle.p, before.p)).toBeLessThan(1e-7);
    expect(s.state.project!.tracks.rifle.curves!.px!.keys).toHaveLength(3);
    s.undo();
    expect(s.state.project!.tracks.rifle.curves!.px!.keys).toHaveLength(2);
  });
});

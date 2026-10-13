import { describe, expect, it } from 'vitest';
import { Matrix4 } from 'three';
import { blankProject } from '../src/core/assets';
import { clone } from '../src/core/model';
import { registerPropControl } from '../src/core/controls';
import type { ControlId } from '../src/core/controls';
import {
  runtimePropSteps,
  sharedRuntimePropLayout,
  sharedRuntimeProps,
} from '../src/core/sharedRuntimeProps';
const eye = new Matrix4().toArray(),
  prop = {
    name: 'Test',
    asset: 'builtin-rifle',
    scale: 1,
    rotation: [0, 0, 0] as [number, number, number],
    offset: [0, 0, 0] as [number, number, number],
    visible: true,
  };
const follow = (
  frame: number,
  target: ControlId | 'world' | 'native',
  position = true,
  rotation = true,
) => ({ frame, target, position, rotation, world: eye, local: eye, parent: eye });
const setup = () => {
  for (const id of ['prop:scope', 'prop:bolt'] as const) registerPropControl(id);
  const p = blankProject();
  p.end = 30;
  p.props = {
    rifle: { ...prop },
    magazine: { ...prop },
    'prop:scope': { ...prop },
    'prop:bolt': { ...prop },
  };
  for (const id of ['prop:scope', 'prop:bolt'] as const) p.tracks[id] = clone(p.tracks.rifle);
  return p;
};
const slots: ControlId[] = ['magazine', 'rifle', 'prop:scope', 'prop:bolt'];
describe('shared runtime prop dependency states', () => {
  it('orders nested props before their children and retains the final magazine override', () => {
    const p = setup();
    p.tracks['prop:scope'].following = [follow(0, 'prop:bolt')];
    p.tracks['prop:bolt'].following = [follow(0, 'rifle')];
    p.tracks.magazine.spaces = [{ frame: 0, parent: 'rifle', offset: eye }];
    const plan = runtimePropSteps(p, 0);
    expect(plan.steps.map((s) => s.control)).toEqual(['prop:bolt', 'prop:scope', 'magazine']);
    expect(plan.steps[0].parent).toEqual({ kind: 'prop', control: 'rifle' });
  });
  it('preserves source-frame cycle fallback rather than iterating a cyclic dependency', () => {
    const p = setup();
    p.tracks['prop:scope'].following = [follow(0, 'prop:bolt')];
    p.tracks['prop:bolt'].following = [follow(0, 'prop:scope')];
    const plan = runtimePropSteps(p, 0);
    expect(plan.steps[0]).toMatchObject({ control: 'prop:bolt', parent: { kind: 'source' } });
    expect(plan.steps[1]).toMatchObject({
      control: 'prop:scope',
      parent: { kind: 'prop', control: 'prop:bolt' },
    });
  });
  it('carries fractional switches and independent position/rotation following', () => {
    const p = setup();
    p.tracks.rifle.following = [
      follow(0, 'hand_r', true, false),
      follow(4.25, 'world'),
      follow(9.5, 'shoulder_l', false, true),
    ];
    const before = clone(p),
      layout = sharedRuntimePropLayout(slots);
    const sample = (f: number) => {
      const values = sharedRuntimeProps(p, f, layout),
        curves = layout.steps[0];
      return {
        slot: values[curves.slot],
        parent: layout.parents[values[curves.parent]],
        p: values[curves.position],
        r: values[curves.rotation],
      };
    };
    expect(sample(4.249)).toEqual({ slot: 2, parent: { kind: 'grip', side: 'r' }, p: 1, r: 0 });
    expect(sample(4.25).parent).toEqual({ kind: 'source' });
    expect(sample(9.5)).toEqual({
      slot: 2,
      parent: { kind: 'bone', bone: 'clavicle_l' },
      p: 0,
      r: 1,
    });
    expect(p).toEqual(before);
  });
  it('uses physical bones for bone-backed controllers and identity for camera/world', () => {
    const p = setup();
    for (const [parent, basis] of [
      ['elbow_l', { kind: 'bone', bone: 'lowerarm_l' }],
      ['ball_r', { kind: 'bone', bone: 'ball_r' }],
      ['camera', { kind: 'source' }],
      ['native', { kind: 'source' }],
    ] as const) {
      p.tracks.rifle.following = [follow(0, parent)];
      expect(runtimePropSteps(p, 0).steps[0].parent).toEqual(basis);
    }
  });
  it('supports projects without props and rejects missing referenced slots', () => {
    const p = setup();
    p.props = {};
    expect(() => sharedRuntimeProps(p, 0, sharedRuntimePropLayout([]))).not.toThrow();
    p.props = { 'prop:scope': { ...prop } };
    p.tracks['prop:scope'].following = [follow(0, 'rifle')];
    expect(() => sharedRuntimeProps(p, 0, sharedRuntimePropLayout(['prop:scope']))).toThrow(
      /parent frame/,
    );
    expect(() => sharedRuntimeProps(p, -1, sharedRuntimePropLayout(slots))).toThrow(/frame/);
    expect(() => sharedRuntimePropLayout(['rifle', 'rifle'])).toThrow(/slots/);
  });
});

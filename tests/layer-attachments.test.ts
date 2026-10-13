import { describe, it, expect } from 'vitest';
import { Matrix4 } from 'three';
import {
  createProject,
  createBodyAction,
  switchParent,
  evaluate,
  controlParent,
  putKey,
  pose,
  matrix,
  rawForWorld,
  validateProject,
} from '../src/core/model';
import { addAnimationLayer } from '../src/core/layers';
const gap = (a: Matrix4, b: Matrix4) =>
  Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));
describe('attachments on body layers', () => {
  it('keys attachment and release on the active adjustment without changing the source', () => {
    const source = createProject({}, false);
    let p = addAnimationLayer(createBodyAction(source, 'fp'), 'additive');
    const original = JSON.stringify(p.bodyBase!.source),
      before = evaluate(p, 10);
    p = switchParent(p, 'hand_l', 'rifle', 10);
    expect(gap(matrix(evaluate(p, 10).hand_l), matrix(before.hand_l))).toBeLessThan(1e-6);
    expect(controlParent(p, 'hand_l', 9)).toBe(controlParent(source, 'hand_l', 9));
    expect(controlParent(p, 'hand_l', 10)).toBe('rifle');
    const bound = matrix(evaluate(p, 10).rifle)
      .invert()
      .multiply(matrix(evaluate(p, 10).hand_l));
    putKey(p.tracks.rifle, 20, pose([0.2, 0, 0]));
    const moved = evaluate(p, 20);
    expect(gap(matrix(moved.rifle).invert().multiply(matrix(moved.hand_l)), bound)).toBeLessThan(
      1e-6,
    );
    p = switchParent(p, 'hand_l', 'world', 20);
    expect(gap(matrix(evaluate(p, 20).hand_l), matrix(moved.hand_l))).toBeLessThan(1e-6);
    expect(controlParent(validateProject(p), 'hand_l', 20)).toBe('world');
    expect(JSON.stringify(p.bodyBase!.source)).toBe(original);
  });
  it('keeps attached offsets editable and rejects cycles across layer events', () => {
    let p = addAnimationLayer(createBodyAction(createProject({}, false), 'fp'), 'additive');
    p = switchParent(p, 'hand_l', 'rifle', 0);
    const target = evaluate(p, 8).hand_l;
    target.p[1] += 0.03;
    putKey(p.tracks.hand_l, 8, rawForWorld(p, 'hand_l', 8, target));
    expect(gap(matrix(evaluate(p, 8).hand_l), matrix(target))).toBeLessThan(1e-6);
    expect(() => switchParent(p, 'rifle', 'hand_l', 9)).toThrow('cycle');
  });
  it('removes inherited contact movement on release and does not double it when attached', () => {
    const source = createProject({}, false),
      initial = evaluate(source, 0).rifle;
    putKey(source.tracks.rifle, 20, {
      ...initial,
      p: [initial.p[0] + 0.3, initial.p[1], initial.p[2]],
    });
    let p = addAnimationLayer(createBodyAction(source, 'fp'), 'additive');
    p = switchParent(p, 'hand_l', 'rifle', 0);
    const relative = matrix(evaluate(p, 0).rifle)
        .invert()
        .multiply(matrix(evaluate(p, 0).hand_l)),
      at20 = evaluate(p, 20);
    expect(gap(matrix(at20.rifle).invert().multiply(matrix(at20.hand_l)), relative)).toBeLessThan(
      1e-6,
    );
    p = switchParent(p, 'hand_l', 'world', 0);
    expect(gap(matrix(evaluate(p, 20).hand_l), matrix(evaluate(p, 0).hand_l))).toBeLessThan(1e-6);
  });
});

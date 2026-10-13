import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createProject, createBodyAction, evaluate } from '../src/core/model';
import { addAnimationLayer } from '../src/core/layers';
import { layerDelta, removeLayerDelta } from '../src/core/layerSpaces';
import { pose } from '../src/core/model';
describe('per-bone pose layer spaces', () => {
  it('maintains one world offset across hand attachment changes', () => {
    let base = createProject({}, true);
    base = createBodyAction(base, 'source');
    const p = addAnimationLayer(base, 'pose');
    p.tracks.hand_l.keys[0].p = [0, -0.2, 0];
    for (const f of [0, 12, 34, 36, 70, 86]) {
      const a = evaluate(base, f).hand_l,
        b = evaluate(p, f).hand_l;
      expect(b.p[0] - a.p[0]).toBeCloseTo(0, 5);
      expect(b.p[1] - a.p[1]).toBeCloseTo(-0.2, 5);
      expect(b.p[2] - a.p[2]).toBeCloseTo(0, 5);
    }
  });
  it('inverts edits and independently chooses local, parent and world axes', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.6),
      value = pose([0.2, 0.3, 0.4], q.toArray()),
      delta = pose(
        [0.1, -0.2, 0.3],
        new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.3).toArray(),
      ),
      basis = {
        parent: q,
        rest: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7),
        local: q,
      };
    for (const id of ['hips', 'hand_l'] as const)
      for (const space of ['local', 'parent', 'world'] as const) {
        const result = layerDelta(value, delta, space, basis, pose(), pose(), id),
          offset = layerDelta(value, result, space, basis, pose(), pose(), id, true),
          back = removeLayerDelta(result, delta, space, basis, pose(), pose(), id);
        expect(new Vector3(...offset.p).distanceTo(new Vector3(...delta.p))).toBeLessThan(1e-7);
        expect(new Quaternion(...offset.q).angleTo(new Quaternion(...delta.q))).toBeLessThan(1e-7);
        expect(new Vector3(...back.p).distanceTo(new Vector3(...value.p))).toBeLessThan(1e-7);
        expect(new Quaternion(...back.q).angleTo(new Quaternion(...value.q))).toBeLessThan(1e-7);
      }
  });
});

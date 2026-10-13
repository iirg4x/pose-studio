import { describe, it, expect } from 'vitest';
import { createProject, createBodyAction, pose, putKey, clone } from '../src/core/model';
import { addAnimationLayer, syncLayers } from '../src/core/layers';
import { firstPersonKeyReferences } from '../src/core/timelineReferences';
import { ensureCurve, modifier } from '../src/core/curves';
describe('first-person timing ghosts', () => {
  it('maps sparse authored key and contact times across frame rates without modifying the source', () => {
    const source = createProject({}, false);
    source.fps = 24;
    source.end = 24;
    putKey(source.tracks.hand_l, 13, pose());
    putKey(source.tracks.hand_l, 24, pose());
    const curve = ensureCurve(source.tracks.hand_l, 'px');
    curve.modifiers.push(modifier('noise'));
    const body = createBodyAction(source, 'source');
    body.fps = 30;
    body.end = 30;
    const before = clone(body),
      keys = firstPersonKeyReferences(body);
    expect(keys.hand_l).toEqual([0, 16.25, 30]);
    expect(keys.camera).toEqual([]);
    expect(body).toEqual(before);
  });
  it('omits disabled or excluded source motion and clips ghosts to the body duration', () => {
    const source = createProject({}, false);
    putKey(source.tracks.hand_r, 20, pose());
    const body = createBodyAction(source, 'source');
    body.end = 10;
    body.bodyBase!.excluded.push('hand_l');
    let keys = firstPersonKeyReferences(body);
    expect(keys.hand_l).toEqual([]);
    expect(keys.hand_r).toEqual([0]);
    body.bodyBase!.enabled = false;
    expect(Object.values(firstPersonKeyReferences(body)).flat()).toEqual([]);
    expect(Object.values(firstPersonKeyReferences(source)).flat()).toEqual([]);
  });
  it('includes contributing source layers but omits muted layer keys', () => {
    let source = addAnimationLayer(createProject({}, false), 'additive');
    putKey(source.tracks.hand_l, 8, pose());
    syncLayers(source);
    source = addAnimationLayer(source, 'additive');
    putKey(source.tracks.hand_l, 16, pose());
    syncLayers(source);
    source.layers!.at(-1)!.enabled = false;
    const body = createBodyAction(source, 'source');
    expect(firstPersonKeyReferences(body).hand_l).toEqual([0, 8]);
    body.bodyBase!.source.layers!.at(-1)!.enabled = true;
    expect(firstPersonKeyReferences(body).hand_l).toEqual([0, 8, 16]);
  });
});

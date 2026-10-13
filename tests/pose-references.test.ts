import { describe, it, expect } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  clone,
  createProject,
  evaluate,
  matrix,
  pose,
  putKey,
  validateProject,
} from '../src/core/model';
import { addAnimationLayer, ensureLayers, syncLayers } from '../src/core/layers';
import { entry, library, refreshBases, validateLibrary } from '../src/core/library';
import { snapshotPoseTracks } from '../src/core/poseReferences';
import { StudioStore } from '../src/core/store';
import { projectSaveSignature } from '../src/core/projectSaving';
import { inferPoseLinks } from '../shared/pose-links.mjs';

const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 7));
function fixture() {
  const source = ensureLayers(createProject({}, false));
  source.layers![0].static = true;
  const data = library(source),
    base = data.clips[0];
  const target = entry(addAnimationLayer(clone(source), 'additive'));
  target.project.layers![0].poseLinks = [{ clipId: base.id, frame: 0 }];
  target.project.tracks.rifle.keys[0].p = [0.05, 0, 0];
  putKey(target.project.tracks.rifle, 20, pose([0.15, 0, 0]));
  syncLayers(target.project);
  data.clips.push(target);
  return { data, base, target };
}
describe('linked base poses', () => {
  it('updates all dependent animations and leaves their motion tracks intact', () => {
    const { data, base, target } = fixture(),
      second = entry(clone(target.project));
    data.clips.push(second);
    refreshBases(data);
    const frames = [0, 7.5, 20],
      before = frames.map((f) => evaluate(target.project, f)),
      motion = JSON.stringify(target.project.layers![1]);
    base.project.tracks.rifle.keys[0].p[1] -= 0.2;
    refreshBases(data);
    for (const c of [target, second])
      for (const [i, f] of frames.entries())
        expect(evaluate(c.project, f).rifle.p[1] - before[i].rifle.p[1]).toBeCloseTo(-0.2, 7);
    expect(JSON.stringify(target.project.layers![1])).toBe(motion);
  });
  it('samples the complete source stack, with root motion and attachments applied exactly once', () => {
    let source = ensureLayers(createProject({}, false));
    source.layers![0].static = true;
    source = addAnimationLayer(source, 'pose');
    source.tracks.rifle.keys[0].p = [0.1, 0.2, 0];
    source.tracks.root.keys[0].p = [0.2, 0, 0.1];
    source.tracks.root.keys[0].q = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), 0.6)
      .toArray();
    syncLayers(source);
    const cached = {
      ...clone(source),
      layers: undefined,
      activeLayerId: undefined,
      tracks: snapshotPoseTracks(source, 12),
    };
    for (const id of ['root', 'rifle', 'hand_l', 'hand_r', 'camera', 'index_01_l'] as const)
      near(matrix(evaluate(cached, 0)[id]).elements, matrix(evaluate(source, 12)[id]).elements);
    expect(() => validateProject(cached)).not.toThrow();
  });
  it('allows separate character and magazine references with control masks', () => {
    const { data, base, target } = fixture(),
      weapon = entry(clone(base.project));
    data.clips.push(weapon);
    target.project.layers![0].poseLinks = [
      { clipId: base.id, frame: 0, controls: ['rifle', 'hand_l'] },
      { clipId: weapon.id, frame: 0, controls: ['magazine'] },
    ];
    base.project.tracks.rifle.keys[0].p[0] += 0.2;
    weapon.project.tracks.magazine.keys[0].p[1] -= 0.1;
    refreshBases(data);
    const cache = target.project.layers![0].tracks;
    expect(cache.rifle).toEqual(snapshotPoseTracks(base.project, 0).rifle);
    expect(cache.magazine).toEqual(snapshotPoseTracks(weapon.project, 0).magazine);
    expect(cache.hand_r).toEqual(base.project.layers![0].tracks.hand_r);
  });
  it('shares parent-local weapon-part poses across views without changing the body or weapon transform', () => {
    const { data, base, target } = fixture();
    target.project.editing = 'body';
    target.project.actionType = 'body';
    target.project.layers![0].poseLinks = [{ clipId: base.id, frame: 0, controls: ['magazine'] }];
    const identity = matrix(pose()).toArray();
    base.project.tracks.magazine.spaces = [
      { frame: 0, parent: 'rifle', offset: identity, base: identity },
    ];
    base.project.tracks.magazine.keys[0].p = [0.05, -0.2, 0.03];
    base.project.tracks.rifle.keys[0].p = [2, 3, 4];
    base.project.tracks.rifle.keys[0].q = new Quaternion()
      .setFromAxisAngle(new Vector3(0, 1, 0), 1.1)
      .toArray();
    const before = evaluate(target.project, 0),
      motion = JSON.stringify(target.project.layers![1]);
    const restored = validateLibrary(data),
      body = restored.clips.find((c) => c.id === target.id)!;
    const result = evaluate(body.project, 0),
      relative = matrix(result.rifle).invert().multiply(matrix(result.magazine));
    near(relative.elements, matrix(pose([0.05, -0.2, 0.03])).elements);
    for (const id of ['rifle', 'hand_l', 'hips'] as const)
      near(matrix(result[id]).elements, matrix(before[id]).elements);
    expect(JSON.stringify(body.project.layers![1])).toBe(motion);
    restored.clips[0].project.tracks.magazine.keys[0].p[1] -= 0.1;
    refreshBases(restored);
    const edited = evaluate(body.project, 0);
    expect(
      matrix(edited.rifle).invert().multiply(matrix(edited.magazine)).elements[13],
    ).toBeCloseTo(-0.3, 7);
  });
  it('still rejects cross-view character references and mixed character/prop masks', () => {
    const { data, target } = fixture();
    target.project.editing = 'body';
    target.project.actionType = 'body';
    expect(() => refreshBases(data)).toThrow(/character base pose/);
    target.project.layers![0].poseLinks![0].controls = ['magazine', 'hand_l'];
    expect(() => refreshBases(data)).toThrow(/character base pose/);
  });
  it('resolves nested references, rejects cycles, and keeps a portable cache when a source is missing', () => {
    const { data, base, target } = fixture(),
      third = entry(clone(target.project));
    third.project.layers![0].poseLinks = [{ clipId: target.id, frame: 10 }];
    data.clips.push(third);
    refreshBases(data);
    expect(third.project.layers![0].tracks.rifle).toEqual(
      snapshotPoseTracks(target.project, 10).rifle,
    );
    const missing = clone(data);
    missing.clips = missing.clips.filter((c) => c.id !== base.id);
    const saved = JSON.stringify(missing.clips[0].project.layers![0].tracks);
    refreshBases(missing);
    expect(JSON.stringify(missing.clips[0].project.layers![0].tracks)).toBe(saved);
    base.project.layers![0].poseLinks = [{ clipId: third.id, frame: 0 }];
    expect(() => refreshBases(data)).toThrow(/cycle/);
  });
  it('persists links through validation, source renaming and importing with new clip identities', () => {
    const { data, base } = fixture();
    base.project.name = 'Renamed pose';
    const restored = validateLibrary(JSON.parse(JSON.stringify(data)));
    const store = new StudioStore();
    store.open(createProject({}, false));
    store.importAnimations(restored);
    const added = store.snapshot()!.clips.slice(1);
    expect(added[1].project.layers![0].poseLinks![0].clipId).toBe(added[0].id);
    expect(added[0].id).not.toBe(base.id);
  });
  it('opens the source when selecting a linked base and updates clips when revisiting them', () => {
    const { data, base, target } = fixture(),
      store = new StudioStore();
    store.open(data);
    store.activate(target.id);
    store.selectLayer(target.project.layers![0].id);
    expect(store.state.workspace!.activeId).toBe(base.id);
    const desired = clone(evaluate(store.state.project!, 0).rifle);
    desired.p[1] -= 0.15;
    store.editWorld('rifle', desired);
    store.activate(target.id);
    const updated = evaluate(store.state.project!, 5).rifle;
    store.activate(base.id);
    store.undo();
    store.activate(target.id);
    expect(evaluate(store.state.project!, 5).rifle.p[1] - updated.p[1]).toBeCloseTo(0.15, 7);
    store.activate(base.id);
    store.redo();
    store.activate(target.id);
    near(evaluate(store.state.project!, 5).rifle.p, updated.p);
  });
  it('does not restore an obsolete base through a dependent animation undo', () => {
    const { data, base, target } = fixture(),
      store = new StudioStore();
    store.open(data);
    store.activate(target.id);
    store.updateProject({ name: 'Changed motion' });
    store.activate(base.id);
    const desired = clone(evaluate(store.state.project!, 0).rifle);
    desired.p[1] -= 0.2;
    store.editWorld('rifle', desired);
    store.activate(target.id);
    const current = evaluate(store.state.project!, 0).rifle.p;
    store.undo();
    near(evaluate(store.state.project!, 0).rifle.p, current);
  });
  it('counts source edits as unsaved while ignoring derived cache updates', () => {
    const { data, base, target } = fixture();
    refreshBases(data);
    const saved = projectSaveSignature(data);
    target.project.layers![0].tracks.rifle.keys[0].p[1] += 0.4;
    expect(projectSaveSignature(data)).toBe(saved);
    base.project.tracks.rifle.keys[0].p[1] -= 0.2;
    expect(projectSaveSignature(data)).not.toBe(saved);
  });
  it('rejects malformed reference metadata', () => {
    const { target } = fixture();
    target.project.layers![0].poseLinks![0].frame = NaN;
    expect(() => validateProject(target.project)).toThrow(/pose link/);
  });
  it('upgrades legacy provenance by asset identity without treating an edited source pose as its own dependency', () => {
    const { data, base, target } = fixture();
    delete target.project.layers![0].poseLinks;
    base.project.layers![0].source = { asset: '/Game/IdlePose.IdlePose', frame: 0 };
    base.project = addAnimationLayer(base.project, 'pose');
    target.project.layers![0].source = { asset: '/Game/IdlePose.IdlePose', frame: 0 };
    target.project.layers![1].source = { asset: '/Game/Reload.Reload', frame: 0 };
    const upgraded = inferPoseLinks(data);
    expect(upgraded.clips[0].project.layers![0].poseLinks).toBeUndefined();
    expect(upgraded.clips[1].project.layers![0].poseLinks![0].clipId).toBe(base.id);
    expect(upgraded.clips[1].project.layers![0].poseLinks![0].controls).not.toContain('magazine');
  });
});

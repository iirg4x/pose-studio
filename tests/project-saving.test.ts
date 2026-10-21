import { describe, it, expect } from 'vitest';
import {
  projectMatchesSaveSignature,
  projectMatchesSaveSignatureAsync,
  projectSaveSignature,
  projectSaveSignatureAsync,
  projectSaveSignatureV3,
} from '../src/core/projectSaving';
import { createBodyAction } from '../src/core/model';
import { library, entry } from '../src/core/library';
import { createProject, clone, pose, putKey } from '../src/core/model';
import { addAnimationLayer, selectAnimationLayer, syncLayers } from '../src/core/layers';
describe('unsaved project detection', () => {
  it('ignores playback, selection, tabs and active-layer navigation', () => {
    const project = addAnimationLayer(createProject({}, false), 'pose'),
      data = library(project);
    data.clips.push(entry(createProject({}, false)));
    const saved = projectSaveSignature(data);
    data.clips[0].frame = 12;
    data.clips[0].selected = 'shoulder_l';
    data.activeId = data.clips[1].id;
    data.openIds.push(data.activeId);
    selectAnimationLayer(data.clips[0].project, project.layers![0].id);
    expect(projectSaveSignature(data)).toBe(saved);
  });
  it('detects keys, masks, drafts and project names, and becomes clean after undo', () => {
    const data = library(addAnimationLayer(createProject({}, false), 'pose')),
      saved = projectSaveSignature(data),
      copy = clone(data);
    putKey(copy.clips[0].project.tracks.shoulder_l, 0, pose([0.1, 0, 0]));
    syncLayers(copy.clips[0].project);
    expect(projectSaveSignature(copy)).not.toBe(saved);
    expect(projectSaveSignature(data)).toBe(saved);
    const mask = clone(data);
    mask.clips[0].project.layers!.at(-1)!.excluded.push('shoulder_r');
    expect(projectSaveSignature(mask)).not.toBe(saved);
    const draft = clone(data);
    draft.clips[0].drafts.shoulder_r = pose([0.1, 0, 0]);
    expect(projectSaveSignature(draft)).not.toBe(saved);
    const at0 = projectSaveSignature(draft);
    draft.clips[0].frame = 8;
    expect(projectSaveSignature(draft)).not.toBe(at0);
    const named = clone(data);
    named.name = 'Changed';
    expect(projectSaveSignature(named)).not.toBe(saved);
  });
  it('omits only the redundant layered track alias', () => {
    const project = addAnimationLayer(createProject({}, false), 'pose');
    const data = library(project);
    const saved = projectSaveSignature(data);

    // The active layer is canonicalized from project.tracks. A stale copy on
    // the layer itself is therefore redundant and should not become a second
    // source of dirty state.
    const staleActiveLayer = clone(data);
    staleActiveLayer.clips[0].project.layers!.at(-1)!.tracks = clone(
      staleActiveLayer.clips[0].project.layers!.at(-1)!.tracks,
    );
    putKey(
      staleActiveLayer.clips[0].project.layers!.at(-1)!.tracks.shoulder_l,
      12,
      pose([0.2, 0, 0]),
    );
    expect(projectSaveSignature(staleActiveLayer)).toBe(saved);

    // Edits through the live top-level alias are active-layer edits and must
    // remain visible after synchronization.
    const activeEdit = clone(data);
    putKey(activeEdit.clips[0].project.tracks.shoulder_l, 12, pose([0.2, 0, 0]));
    expect(projectSaveSignature(activeEdit)).not.toBe(saved);

    // Inactive layers have no top-level alias and remain independently
    // editable.
    const inactiveEdit = clone(data);
    putKey(inactiveEdit.clips[0].project.layers![0].tracks.shoulder_l, 12, pose([0.2, 0, 0]));
    expect(projectSaveSignature(inactiveEdit)).not.toBe(saved);
  });
  it('retains linked base source edits and supports legacy baselines', () => {
    const source = createProject({}, false);
    const project = createBodyAction(source, 'source');
    const data = library(project);
    const current = projectSaveSignature(data);
    const legacy = projectSaveSignatureV3(data);
    expect(projectMatchesSaveSignature(data, current)).toBe(true);
    expect(projectMatchesSaveSignature(data, legacy)).toBe(true);

    const sourceEdit = clone(data);
    sourceEdit.clips[0].project.bodyBase!.source.tracks.shoulder_l.keys[0].p[0] += 0.2;
    expect(projectSaveSignature(sourceEdit)).not.toBe(current);
    expect(projectMatchesSaveSignature(sourceEdit, legacy)).toBe(false);
  });
  it('omits resolved body-base caches while retaining source and manual data semantics', () => {
    const source = createProject({}, false);
    const sourceEntry = entry(source);
    const targetEntry = entry(createBodyAction(source, sourceEntry.id));
    const data = library(source);
    data.clips = [sourceEntry, targetEntry];
    const saved = projectSaveSignature(data);

    // refreshBases stores a clone of the source project and a second track
    // cache on the derived action. Neither cache is an editable source when
    // the link resolves to the opposite-view clip in this library.
    const cacheEdit = clone(data);
    cacheEdit.clips[1].project.bodyBase!.source.tracks.shoulder_l.keys[0].p[0] += 0.2;
    cacheEdit.clips[1].project.otherTracks.shoulder_l.keys[0].p[0] += 0.2;
    expect(projectSaveSignature(cacheEdit)).toBe(saved);

    // The actual source clip remains authoritative and must still affect the
    // dirty signature.
    const sourceEdit = clone(data);
    sourceEdit.clips[0].project.tracks.shoulder_l.keys[0].p[0] += 0.2;
    expect(projectSaveSignature(sourceEdit)).not.toBe(saved);

    // Detaching or deleting the source leaves an embedded/manual base. Its
    // source and other tracks must return to the signature and remain tracked.
    const detached = clone(data);
    detached.clips[1].project.bodyBase!.sourceId = 'missing-source';
    const detachedSaved = projectSaveSignature(detached);
    detached.clips[1].project.bodyBase!.source.tracks.shoulder_l.keys[0].p[0] += 0.2;
    expect(projectSaveSignature(detached)).not.toBe(detachedSaved);

    const deleted = clone(data);
    deleted.clips = deleted.clips.filter((clip) => clip.id !== sourceEntry.id);
    const deletedSaved = projectSaveSignature(deleted);
    deleted.clips[0].project.otherTracks.shoulder_l.keys[0].p[0] += 0.2;
    expect(projectSaveSignature(deleted)).not.toBe(deletedSaved);
  });
  it('produces the same v4 signature asynchronously without mutating input', async () => {
    const data = library(addAnimationLayer(createProject({}, false), 'pose'));
    const before = clone(data);
    expect(await projectSaveSignatureAsync(data)).toBe(projectSaveSignature(data));
    expect(data).toEqual(before);
  });
  it('compares current and legacy baselines asynchronously', async () => {
    const data = library(addAnimationLayer(createProject({}, false), 'pose'));
    const legacy = projectSaveSignatureV3(data);
    expect(await projectMatchesSaveSignatureAsync(data, legacy)).toBe(true);
    expect(await projectMatchesSaveSignatureAsync(data, projectSaveSignature(data))).toBe(true);
    data.name = 'Edited';
    expect(await projectMatchesSaveSignatureAsync(data, legacy)).toBe(false);
  });
  it('cancels asynchronous signature work with an AbortError', async () => {
    const data = library(addAnimationLayer(createProject({}, false), 'pose'));
    await expect(projectSaveSignatureAsync(data, () => true)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

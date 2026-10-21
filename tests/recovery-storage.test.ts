import { IDBDatabase as FakeIDBDatabase, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeProject } from '../shared/project-codec.mjs';
import { blankProject } from '../src/core/assets';
import { validateLibrary } from '../src/core/library';
import type { AnimationEntry, AnimationLibrary } from '../src/core/library';
import { addAnimationLayer } from '../src/core/layers';
import { clone, createBodyAction, createProject, pose, putKey } from '../src/core/model';
import type { Project } from '../src/core/model';
import type { RecoveryManifest } from '../src/platform/recoveryGenerations';
import { decode64 } from '../src/platform/portableAssets';

const sessionKey = 'manny-studio-library-v3:session:v2';
const manifestKey = 'manny-studio-library-v3:manifest:v2';
const sharedLocal = new Map<string, string>();

function webStorage(values: Map<string, string>) {
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

async function deleteDatabase(name: string) {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Test database deletion was blocked.'));
  });
}

async function deleteStoredValue(key: string) {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.open('pose-offline', 1);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('files', 'readwrite');
      transaction.objectStore('files').delete(key);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function loadTab(token: string) {
  vi.resetModules();
  const session = new Map([[sessionKey, token]]);
  vi.stubGlobal('sessionStorage', webStorage(session));
  return import('../src/platform/storage');
}

function project(name: string, tracks: object): Project {
  return { name, tracks } as unknown as Project;
}

function entry(id: string, value: Project): AnimationEntry {
  return { id, project: value, frame: 0, selected: 'root', drafts: {} } as AnimationEntry;
}

function library(name: string, clips: AnimationEntry[], activeId: string): AnimationLibrary {
  return {
    version: 3,
    rig: 'ue5-manny-simple',
    name,
    clips,
    activeId,
    openIds: [activeId],
    poses: [],
  };
}

describe('IndexedDB recovery persistence', () => {
  beforeAll(async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB);
    vi.stubGlobal('localStorage', webStorage(sharedLocal));
    vi.stubGlobal('BroadcastChannel', undefined);
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('navigator', { storage: { persist: async () => true } });
    await deleteDatabase('pose-offline');
  });

  afterAll(() => vi.unstubAllGlobals());

  it('commits asset batches in one transaction and rolls back a synchronous put failure', async () => {
    const tab = await loadTab('asset-batch');
    await tab.initializeStorage();
    const transactionSpy = vi.spyOn(FakeIDBDatabase.prototype, 'transaction');
    transactionSpy.mockClear();
    await tab.writeAssets([]);
    expect(transactionSpy).not.toHaveBeenCalled();
    await tab.writeAssets([
      ['asset:batch-first', new Uint8Array([1, 2, 3])],
      ['asset:batch-second', new Uint8Array([4, 5, 6])],
    ]);
    expect(transactionSpy.mock.calls.filter(([, mode]) => mode === 'readwrite')).toHaveLength(1);
    expect(await tab.readAsset('asset:batch-first')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await tab.readAsset('asset:batch-second')).toEqual(new Uint8Array([4, 5, 6]));
    transactionSpy.mockRestore();

    await expect(
      tab.writeAssets([
        ['asset:batch-rollback', { value: 'must not remain' }],
        ['asset:batch-invalid', () => {}],
      ]),
    ).rejects.toThrow();
    expect(await tab.readAsset('asset:batch-rollback')).toBeUndefined();
  });

  it('merges tab writes, reuses unchanged clips, and archives failed bytes across pruning', async () => {
    const tabA = await loadTab('tab-a');
    await tabA.initializeStorage();
    const tracksA = { root: [1] };
    const tracksB = { root: [2] };
    const tracksC = { root: [3] };
    const first = library(
      'Document A',
      [
        entry('first', project('First', tracksA)),
        entry('b', project('B', tracksB)),
        entry('c', project('C', tracksC)),
      ],
      'c',
    );
    await tabA.writeRecovery(first);
    const afterFirst = (await tabA.readAsset(manifestKey)) as RecoveryManifest;
    const firstGeneration = afterFirst.sessions[0].generations[0];

    const afterDelete = library(
      'Document A renamed',
      [
        { ...first.clips[1], project: project('B', tracksB) },
        { ...first.clips[2], project: project('C', tracksC) },
      ],
      'c',
    );
    await tabA.writeRecovery(afterDelete);
    const afterSecond = (await tabA.readAsset(manifestKey)) as RecoveryManifest;
    const [secondGeneration, olderGeneration] = afterSecond.sessions[0].generations;
    expect(secondGeneration.documentId).toBe(firstGeneration.documentId);
    expect(secondGeneration.clips.find((clip) => clip.id === 'b')?.key).toBe(
      olderGeneration.clips.find((clip) => clip.id === 'b')?.key,
    );
    expect(secondGeneration.clips.find((clip) => clip.id === 'c')?.key).not.toBe(
      olderGeneration.clips.find((clip) => clip.id === 'c')?.key,
    );

    const changedInactive = library(
      'Document A renamed again',
      [
        entry('b', project('B changed', { root: [4] })),
        { ...first.clips[2], project: project('C', tracksC) },
      ],
      'c',
    );
    await tabA.writeRecovery(changedInactive);
    const beforeCorruption = (await tabA.readAsset(manifestKey)) as RecoveryManifest;
    const corruptGeneration = beforeCorruption.sessions[0].generations[0];
    const missingReference = corruptGeneration.clips.find((clip) => clip.id === 'b');
    expect(missingReference).toBeTruthy();
    await deleteStoredValue(missingReference!.key);

    const missingTab = await loadTab('tab-a');
    await missingTab.initializeStorage();
    const missingCandidates = missingTab.readRecoveryCandidates();
    await expect(missingTab.readRecoveryCandidate(missingCandidates[0])).rejects.toThrow(
      'missing stored animation data',
    );
    expect(missingTab.getRecoveryState().writeHeld).toBe(true);
    const completeFallback = await missingTab.readRecoveryCandidate(missingCandidates[1]);
    expect((completeFallback as AnimationLibrary).clips).toHaveLength(2);
    await missingTab.resolveFailedRecovery('discard');
    expect(missingTab.getRecoveryState().writeHeld).toBe(false);

    const recoveryTab = await loadTab('tab-a');
    await recoveryTab.initializeStorage();

    const tabs = [recoveryTab];
    for (let index = 1; index < 8; index++) {
      const tab = await loadTab(`tab-${index}`);
      await tab.initializeStorage();
      await tab.writeRecovery(
        library(
          `Document ${index}`,
          [entry(`clip-${index}`, project('Clip', {}))],
          `clip-${index}`,
        ),
      );
      tabs.push(tab);
    }
    await Promise.all([
      tabs[6].writeRecovery(
        library('Concurrent 6', [entry('clip-6', project('Clip 6', {}))], 'clip-6'),
      ),
      tabs[7].writeRecovery(
        library('Concurrent 7', [entry('clip-7', project('Clip 7', {}))], 'clip-7'),
      ),
    ]);
    const afterConcurrent = (await tabA.readAsset(manifestKey)) as RecoveryManifest;
    expect(
      afterConcurrent.sessions.find((session) => session.id === 'tab-6')?.generations[0].metadata
        .name,
    ).toBe('Concurrent 6');
    expect(
      afterConcurrent.sessions.find((session) => session.id === 'tab-7')?.generations[0].metadata
        .name,
    ).toBe('Concurrent 7');
    const waitingTab = await loadTab('tab-waiting');
    await waitingTab.initializeStorage();
    const observerTab = await loadTab('tab-observer');
    await observerTab.initializeStorage();

    const candidate = recoveryTab.readRecoveryCandidates()[0];
    const waitingCandidate = waitingTab.readRecoveryCandidates()[0];
    await recoveryTab.rejectRecoveryCandidate(candidate, Error('controlled invalid recovery'));
    await waitingTab.rejectRecoveryCandidate(waitingCandidate, Error('second controlled failure'));
    expect(recoveryTab.getRecoveryState().writeHeld).toBe(true);
    await expect(recoveryTab.writeRecovery(afterDelete)).rejects.toBeInstanceOf(
      recoveryTab.RecoveryWriteHeldError,
    );

    await expect(
      waitingTab.writeRecovery(
        library('Waiting tab', [entry('waiting', project('Waiting', {}))], 'waiting'),
      ),
    ).rejects.toBeInstanceOf(waitingTab.RecoveryWriteHeldError);
    await expect(
      observerTab.writeRecovery(
        library('Observer tab', [entry('observer', project('Observer', {}))], 'observer'),
      ),
    ).rejects.toBeInstanceOf(observerTab.RecoveryWriteHeldError);
    expect(observerTab.getRecoveryState().writeHeld).toBe(true);
    expect(await observerTab.readFailedRecovery()).not.toBeNull();

    const restarted = await loadTab('tab-restarted');
    await restarted.initializeStorage();
    expect(restarted.getRecoveryState().writeHeld).toBe(true);
    const firstProblemId = restarted.getRecoveryState().problem?.id;
    const failed = await restarted.readFailedRecovery();
    expect(failed?.content).toContain('"version": 3');
    await restarted.resolveFailedRecovery('preserve');
    expect(restarted.getRecoveryState().writeHeld).toBe(true);
    expect(restarted.getRecoveryState().problem?.id).not.toBe(firstProblemId);
    await restarted.resolveFailedRecovery('preserve');
    expect(restarted.getRecoveryState().writeHeld).toBe(false);
    await observerTab.writeRecovery(
      library('Observer tab', [entry('observer', project('Observer', {}))], 'observer'),
    );
    expect(observerTab.getRecoveryState().writeHeld).toBe(false);
    const archives = restarted
      .listRecoveryGenerations()
      .filter((item) => item.source === 'quarantine');
    expect(archives).toHaveLength(2);
    expect(await restarted.readRecoveryGeneration(archives[0].id)).toBeTruthy();

    await restarted.writeRecovery(
      library('Waiting tab', [entry('waiting', project('Waiting', {}))], 'waiting'),
    );
    const afterPrune = (await restarted.readAsset(manifestKey)) as RecoveryManifest;
    expect(afterPrune.sessions.some((session) => session.id === 'tab-a')).toBe(false);
    expect(await restarted.readRecoveryGeneration(archives[0].id)).toBeTruthy();

    const transactionFailureCandidate = restarted.readRecoveryCandidates()[0];
    transactionFailureCandidate.data = {
      ...((await restarted.readRecoveryCandidate(transactionFailureCandidate)) as object),
      nonCloneable: () => undefined,
    };
    await restarted.rejectRecoveryCandidate(
      transactionFailureCandidate,
      Error('quarantine transaction failure'),
    );
    expect(restarted.getRecoveryState().problem?.archiveDurable).toBe(false);
    const manifestBeforeFailedPreserve = (await restarted.readAsset(
      manifestKey,
    )) as RecoveryManifest;
    await expect(restarted.resolveFailedRecovery('preserve')).rejects.toBeTruthy();
    expect(restarted.getRecoveryState().writeHeld).toBe(true);
    const manifestAfterFailedPreserve = (await restarted.readAsset(
      manifestKey,
    )) as RecoveryManifest;
    expect(manifestAfterFailedPreserve).toEqual(manifestBeforeFailedPreserve);
    const heldRestart = await loadTab('held-restart');
    await heldRestart.initializeStorage();
    expect(heldRestart.getRecoveryState().writeHeld).toBe(true);
    await heldRestart.resolveFailedRecovery('discard');

    await heldRestart.writeRecovery(
      library('Archive integrity', [entry('integrity', project('Integrity', {}))], 'integrity'),
    );
    const missingArchiveCandidate = heldRestart.readRecoveryCandidates()[0];
    await heldRestart.rejectRecoveryCandidate(
      missingArchiveCandidate,
      Error('archive payload removed'),
    );
    const missingArchiveProblem = heldRestart.getRecoveryState().problem!;
    expect(missingArchiveProblem.archiveDurable).toBe(true);
    await deleteStoredValue(
      `manny-studio-library-v3:quarantine:${missingArchiveProblem.archiveId}`,
    );
    const missingArchiveTab = await loadTab('missing-archive-restart');
    await missingArchiveTab.initializeStorage();
    expect(missingArchiveTab.getRecoveryState().problem?.archiveDurable).toBe(false);
    const fallbackDownload = await missingArchiveTab.readFailedRecovery();
    expect(fallbackDownload?.content).toContain('"version": 3');
    await missingArchiveTab.resolveFailedRecovery('preserve');
    expect(missingArchiveTab.getRecoveryState().writeHeld).toBe(false);

    const legacyIndexKey = 'manny-studio-library-v3:index';
    const legacyClipKey = 'manny-studio-library-v3:clip:legacy-clip';
    await restarted.writeAsset(legacyClipKey, entry('legacy-clip', project('Legacy', {})));
    await restarted.writeAsset(legacyIndexKey, {
      version: 3,
      rig: 'ue5-manny-simple',
      name: 'Legacy project',
      activeId: 'legacy-clip',
      openIds: ['legacy-clip'],
      poses: [],
      clipIds: ['legacy-clip'],
    });
    const migrationTab = await loadTab('migration-tab');
    await migrationTab.initializeStorage();
    await migrationTab.writeRecovery(
      library('Migrated', [entry('migrated', project('Migrated', {}))], 'migrated'),
    );
    expect(await migrationTab.readAsset(legacyClipKey)).toBeUndefined();
    expect(await migrationTab.readAsset(legacyIndexKey)).toBeUndefined();

    await migrationTab.writeAsset(legacyIndexKey, { clipIds: 'not-an-array', raw: 'preserve-me' });
    const malformedTab = await loadTab('malformed-tab');
    await expect(malformedTab.initializeStorage()).resolves.toBeUndefined();
    const malformed = await malformedTab.readStoredRecovery('legacy-index');
    expect(malformed?.content).toContain('preserve-me');

    const batchPrefix = 'manny-studio-library-v3:clip:';
    const batchFirstKey = `${batchPrefix}batch-first`;
    const batchLastKey = `${batchPrefix}batch-last`;
    await restarted.writeAsset(
      batchFirstKey,
      entry('batch-first', project('First in order', { root: [1] })),
    );
    await restarted.writeAsset(
      batchLastKey,
      entry('batch-last', project('Last in order', { root: [3] })),
    );
    await restarted.writeAsset(legacyIndexKey, {
      version: 3,
      rig: 'ue5-manny-simple',
      name: 'Batched legacy project',
      activeId: 'batch-first',
      openIds: ['batch-first', 'batch-missing', 'batch-last'],
      poses: [],
      clipIds: ['batch-first', 'batch-missing', 'batch-last'],
    });
    const batchTab = await loadTab('batch-tab');
    await batchTab.initializeStorage();
    const transactionSpy = vi.spyOn(FakeIDBDatabase.prototype, 'transaction');
    transactionSpy.mockClear();
    const batched = await batchTab.readStoredRecovery('legacy-index');
    const batchedPayload = JSON.parse(batched!.content) as {
      recovery: AnimationLibrary;
      missingClipIds: string[];
    };
    expect(batchedPayload.recovery.clips.map((clip) => clip.id)).toEqual([
      'batch-first',
      'batch-last',
    ]);
    expect(batchedPayload.missingClipIds).toEqual(['batch-missing']);
    expect(transactionSpy.mock.calls.filter(([, mode]) => mode === 'readonly')).toHaveLength(1);
    transactionSpy.mockRestore();
  });

  it('transfers fresh recovery ownership without losing the original on validation failure', async () => {
    const writer = await loadTab('ownership-writer');
    await writer.initializeStorage();
    const firstProject = blankProject();
    firstProject.name = 'Original project';
    await writer.writeRecovery(library('Owned success', [entry('owned', firstProject)], 'owned'));

    const successfulReader = await loadTab('ownership-success-reader');
    await successfulReader.initializeStorage();
    const successfulCandidate = successfulReader.readRecoveryCandidates()[0];
    const owned = (await successfulReader.readOwnedRecoveryCandidate(
      successfulCandidate,
    )) as AnimationLibrary;
    const validated = validateLibrary(owned, { takeOwnership: true });
    expect(validated.clips[0].project).toBe(owned.clips[0].project);
    expect(successfulReader.readRecoveryCandidates()[0].data).toBeUndefined();
    successfulReader.acceptRecoveryCandidate(successfulCandidate, validated);
    expect(successfulReader.readRecovery()).toBe(validated);

    const cachedOriginal = library(
      'Cached quarantine original',
      [entry('cached', blankProject())],
      'cached',
    );
    const cachedCandidate = {
      id: 'cached-quarantine',
      sessionId: 'cached',
      documentId: 'cached',
      createdAt: 0,
      missingClipIds: [],
      autoRestore: false,
      source: 'quarantine' as const,
      data: cachedOriginal,
    };
    const cachedPayload = (await successfulReader.readOwnedRecoveryCandidate(
      cachedCandidate,
    )) as AnimationLibrary;
    cachedPayload.name = 'Mutated cached quarantine';
    (cachedPayload.clips[0].project as unknown as { version: number }).version = 999;
    expect(() => validateLibrary(cachedPayload, { takeOwnership: true })).toThrow();
    expect((cachedCandidate.data as AnimationLibrary).name).toBe('Cached quarantine original');
    expect((cachedCandidate.data as AnimationLibrary).clips[0].project.version).toBe(2);

    const secondProject = blankProject();
    secondProject.name = 'Original failure project';
    await writer.writeRecovery(
      library('Owned failure original', [entry('owned', secondProject)], 'owned'),
    );
    const failingReader = await loadTab('ownership-failure-reader');
    await failingReader.initializeStorage();
    const failingCandidate = failingReader.readRecoveryCandidates()[0];
    const failingPayload = (await failingReader.readOwnedRecoveryCandidate(
      failingCandidate,
    )) as AnimationLibrary;
    failingPayload.name = 'Mutated by failed validation';
    (failingPayload.clips[0].project as unknown as { version: number }).version = 999;
    expect(() => validateLibrary(failingPayload, { takeOwnership: true })).toThrow();
    await failingReader.rejectRecoveryCandidate(
      failingCandidate,
      Error('controlled validation failure'),
    );

    const failed = await failingReader.readFailedRecovery();
    expect(failed?.content).toContain('Owned failure original');
    expect(failed?.content).toContain('Original failure project');
    expect(failed?.content).not.toContain('Mutated by failed validation');
    expect(failed?.content).not.toContain('"version": 999');
    await failingReader.resolveFailedRecovery('discard');
  });

  it('canonicalizes active layered tracks for recovery without mutating the live clip', async () => {
    const writer = await loadTab('canonical-writer');
    await writer.initializeStorage();
    const source = addAnimationLayer(createProject({}, false), 'pose');
    const active = source.layers!.find((layer) => layer.id === source.activeLayerId)!;
    const stale = clone(active.tracks);
    stale.shoulder_l.keys[0].p[0] += 1;
    active.tracks = stale;
    putKey(source.tracks.shoulder_l, 12, pose([0.25, 0, 0]));
    const liveActiveTracks = source.tracks;
    const originalStaleTracks = clone(active.tracks);
    const data = library('Canonical recovery', [entry('canonical', source)], 'canonical');

    await writer.writeRecovery(data);
    const manifest = (await writer.readAsset(manifestKey)) as RecoveryManifest;
    const generation = manifest.sessions
      .flatMap((session) => session.generations)
      .find((item) => item.sessionId === 'canonical-writer')!;
    const stored = (await writer.readAsset(generation.clips[0].key)) as AnimationEntry;
    const storedActive = stored.project.layers!.find(
      (layer) => layer.id === stored.project.activeLayerId,
    )!;

    expect(stored.project.tracks).toEqual(liveActiveTracks);
    expect(storedActive.tracks).toBe(stored.project.tracks);
    expect(active.tracks).toEqual(originalStaleTracks);
    expect(active.tracks).not.toBe(source.tracks);
  });

  it('canonicalizes nested body-base aliases and preserves unresolved caches', async () => {
    const writer = await loadTab('nested-canonical-writer');
    await writer.initializeStorage();

    const source = addAnimationLayer(createProject({}, false), 'pose');
    const sourceEntry = entry('source', source);
    const resolvedBody = createBodyAction(source, sourceEntry.id);
    const nestedSource = resolvedBody.bodyBase!.source;
    const nestedActive = nestedSource.layers!.find(
      (layer) => layer.id === nestedSource.activeLayerId,
    )!;
    const staleNestedTracks = clone(nestedActive.tracks);
    nestedActive.tracks = staleNestedTracks;
    putKey(nestedSource.tracks.shoulder_l, 12, pose([0.25, 0, 0]));
    const nestedLatestTracks = clone(nestedSource.tracks);
    const originalResolvedOtherTracks = clone(resolvedBody.otherTracks);

    const unresolvedBody = createBodyAction(source, 'missing-source');
    const unresolvedSource = unresolvedBody.bodyBase!.source;
    const originalUnresolvedOtherTracks = clone(unresolvedBody.otherTracks);
    const originalUnresolvedSourceTracks = clone(unresolvedSource.tracks);
    const data = library(
      'Nested canonical recovery',
      [sourceEntry, entry('resolved-body', resolvedBody), entry('unresolved-body', unresolvedBody)],
      'resolved-body',
    );

    await writer.writeRecovery(data);
    const manifest = (await writer.readAsset(manifestKey)) as RecoveryManifest;
    const generation = manifest.sessions
      .flatMap((session) => session.generations)
      .find((item) => item.sessionId === 'nested-canonical-writer')!;
    const storedById = new Map(
      await Promise.all(
        generation.clips.map(
          async (reference) =>
            [reference.id, (await writer.readAsset(reference.key)) as AnimationEntry] as const,
        ),
      ),
    );
    const storedSource = storedById.get('source')!;
    const storedResolved = storedById.get('resolved-body')!;
    const storedUnresolved = storedById.get('unresolved-body')!;
    const storedNestedSource = storedResolved.project.bodyBase!.source;
    const storedNestedActive = storedNestedSource.layers!.find(
      (layer) => layer.id === storedNestedSource.activeLayerId,
    )!;
    const storedUnresolvedSource = storedUnresolved.project.bodyBase!.source;

    expect(
      storedSource.project.layers!.find((layer) => layer.id === storedSource.project.activeLayerId)
        ?.tracks,
    ).toBe(storedSource.project.tracks);
    expect(storedNestedSource.tracks).toEqual(nestedLatestTracks);
    expect(storedNestedActive.tracks).toBe(storedNestedSource.tracks);
    expect(storedResolved.project.otherTracks).toBe(storedNestedSource.tracks);
    expect(
      resolvedBody.bodyBase!.source.layers!.find((layer) => layer.id === nestedSource.activeLayerId)
        ?.tracks,
    ).toEqual(staleNestedTracks);
    expect(resolvedBody.otherTracks).toEqual(originalResolvedOtherTracks);

    expect(storedUnresolvedSource.tracks).toEqual(originalUnresolvedSourceTracks);
    expect(storedUnresolved.project.otherTracks).toEqual(originalUnresolvedOtherTracks);
    expect(storedUnresolved.project.otherTracks).not.toBe(storedUnresolvedSource.tracks);
    expect(unresolvedBody.bodyBase!.source.tracks).toEqual(originalUnresolvedSourceTracks);
    expect(unresolvedBody.otherTracks).toEqual(originalUnresolvedOtherTracks);
    const restored = validateLibrary({ ...data, clips: [...storedById.values()] });
    expect(restored).toEqual(validateLibrary(data));
  });

  it('stores eligible fresh source bytes once and overlays recovery views on expansion', async () => {
    const writer = await loadTab('compact-source-writer');
    await writer.initializeStorage();
    const sourceData = library(
      'Compact source',
      [entry('raw-a', blankProject()), entry('raw-b', blankProject())],
      'raw-a',
    );
    const data = clone(sourceData) as AnimationLibrary;
    data.clips[0].frame = 19;
    data.clips[0].folder = ['Weapons', 'Axe'];
    data.clips[1].frame = 7;
    data.clips[1].selected = 'hand_l';
    const bytes = await encodeProject(sourceData);
    await writer.writeRecovery(data, {
      bytes,
      clipIds: new Set(data.clips.map((clip) => clip.id)),
    });

    const manifest = (await writer.readAsset(manifestKey)) as RecoveryManifest;
    const generation = manifest.sessions
      .flatMap((session) => session.generations)
      .find((item) => item.sessionId === 'compact-source-writer')!;
    expect(new Set(generation.clips.map((clip) => clip.key)).size).toBe(1);
    const sourceReference = generation.clips[0];
    const stored = (await writer.readAsset(sourceReference.key)) as {
      poseRecoverySourceFormat: number;
      bytes: Uint8Array;
    };
    expect(stored.poseRecoverySourceFormat).toBe(1);
    expect(stored.bytes).toEqual(bytes);

    const reader = await loadTab('compact-source-reader');
    await reader.initializeStorage();
    const candidate = reader.readRecoveryCandidates()[0];
    candidate.data = undefined;
    const restored = (await reader.readRecoveryCandidate(candidate)) as AnimationLibrary;
    expect(restored.clips.map((clip) => [clip.id, clip.frame])).toEqual([
      ['raw-a', 19],
      ['raw-b', 7],
    ]);
    expect(restored.clips[0].folder).toEqual(['Weapons', 'Axe']);
    expect(restored.clips[1].selected).toBe('hand_l');
    expect(validateLibrary(restored)).toEqual(validateLibrary(data));
  });

  it('reuses trusted source references across navigation saves and replaces edited clips natively', async () => {
    const writer = await loadTab('compact-source-reuse-writer');
    await writer.initializeStorage();
    const authored = library(
      'Compact source reuse',
      [entry('raw', blankProject()), entry('native', blankProject())],
      'native',
    );
    const sourceBytes = await encodeProject(authored);
    await writer.writeRecovery(authored, {
      bytes: sourceBytes,
      clipIds: new Set(['raw']),
    });

    const firstManifest = (await writer.readAsset(manifestKey)) as RecoveryManifest;
    const first = firstManifest.sessions.find(
      (session) => session.id === 'compact-source-reuse-writer',
    )!.generations[0];
    const firstRawKey = first.clips.find((clip) => clip.id === 'raw')!.key;
    const firstNativeKey = first.clips.find((clip) => clip.id === 'native')!.key;
    expect(firstRawKey.startsWith('manny-studio-library-v3:source:')).toBe(true);
    expect(firstNativeKey.startsWith('manny-studio-library-v3:source:')).toBe(false);

    const navigation = clone(authored) as AnimationLibrary;
    navigation.activeId = 'raw';
    navigation.clips[0].frame = 19;
    navigation.clips[0].selected = 'hand_l';
    navigation.clips[0].folder = ['Weapons', 'Axe'];
    await writer.writeRecovery(navigation, undefined, { reuseSourceClips: true });

    const secondManifest = (await writer.readAsset(manifestKey)) as RecoveryManifest;
    const second = secondManifest.sessions.find(
      (session) => session.id === 'compact-source-reuse-writer',
    )!.generations[0];
    expect(second.clips.find((clip) => clip.id === 'raw')!.key).toBe(firstRawKey);
    // Native records keep the normal copy-on-write path; only packed sources
    // use the trusted view-only reference optimization.
    expect(second.clips.find((clip) => clip.id === 'native')!.key).not.toBe(firstNativeKey);

    const reader = await loadTab('compact-source-reuse-reader');
    await reader.initializeStorage();
    const restoredNavigation = (await reader.readRecoveryCandidate(
      reader.readRecoveryCandidates()[0],
    )) as AnimationLibrary;
    const restoredRaw = restoredNavigation.clips.find((clip) => clip.id === 'raw')!;
    expect(restoredNavigation.activeId).toBe('raw');
    expect(restoredRaw.frame).toBe(19);
    expect(restoredRaw.selected).toBe('hand_l');
    expect(restoredRaw.folder).toEqual(['Weapons', 'Axe']);
    expect(restoredRaw.project).toEqual(authored.clips[0].project);

    const edited: AnimationLibrary = {
      ...navigation,
      clips: [
        {
          ...navigation.clips[0],
          project: { ...navigation.clips[0].project, name: 'Edited authored clip' },
        },
        navigation.clips[1],
      ],
    };
    await writer.writeRecovery(edited);
    const thirdManifest = (await writer.readAsset(manifestKey)) as RecoveryManifest;
    const third = thirdManifest.sessions.find(
      (session) => session.id === 'compact-source-reuse-writer',
    )!.generations[0];
    const thirdRawKey = third.clips.find((clip) => clip.id === 'raw')!.key;
    expect(thirdRawKey).not.toBe(firstRawKey);
    expect(thirdRawKey.startsWith('manny-studio-library-v3:source:')).toBe(false);

    const editedReader = await loadTab('compact-source-reuse-edited-reader');
    await editedReader.initializeStorage();
    const restoredEdit = (await editedReader.readRecoveryCandidate(
      editedReader.readRecoveryCandidates()[0],
    )) as AnimationLibrary;
    expect(restoredEdit.clips.find((clip) => clip.id === 'raw')?.project.name).toBe(
      'Edited authored clip',
    );
    expect(restoredEdit.clips.find((clip) => clip.id === 'raw')?.frame).toBe(19);
  });

  it('stores and expands a Blob recovery source without copying it per clip', async () => {
    const writer = await loadTab('compact-source-blob-writer');
    await writer.initializeStorage();
    const sourceData = library('Compact Blob source', [entry('blob', blankProject())], 'blob');
    const data = clone(sourceData) as AnimationLibrary;
    data.clips[0].frame = 23;
    const bytes = await encodeProject(sourceData);
    const compressed = new Blob([bytes], { type: 'application/gzip' });
    const compressedBytes = new Uint8Array(await compressed.arrayBuffer());
    await writer.writeRecovery(data, {
      bytes: compressed,
      clipIds: new Set(['blob']),
    });

    const manifest = (await writer.readAsset(manifestKey)) as RecoveryManifest;
    const generation = manifest.sessions
      .flatMap((session) => session.generations)
      .find((item) => item.sessionId === 'compact-source-blob-writer')!;
    const stored = (await writer.readAsset(generation.clips[0].key)) as {
      poseRecoverySourceFormat: number;
      bytes: Blob;
    };
    expect(stored.poseRecoverySourceFormat).toBe(1);
    expect(stored.bytes).toBeInstanceOf(Blob);
    expect(new Uint8Array(await stored.bytes.arrayBuffer())).toEqual(compressedBytes);

    const reader = await loadTab('compact-source-blob-reader');
    await reader.initializeStorage();
    const restored = (await reader.readRecoveryCandidate(reader.readRecoveryCandidates()[0])) as
      | AnimationLibrary
      | undefined;
    expect(restored?.clips[0].id).toBe('blob');
    expect(restored?.clips[0].frame).toBe(23);
    expect(validateLibrary(restored!)).toEqual(validateLibrary(data));
  });

  it('retains malformed recovery view metadata as an invalid clip instead of throwing', async () => {
    const writer = await loadTab('compact-source-invalid-view-writer');
    await writer.initializeStorage();
    const data = library('Invalid recovery view', [entry('view', blankProject())], 'view');
    const bytes = await encodeProject(data);
    await writer.writeRecovery(data, { bytes, clipIds: new Set(['view']) });
    const manifest = (await writer.readAsset(manifestKey)) as RecoveryManifest;
    const generation = manifest.sessions
      .flatMap((session) => session.generations)
      .find((item) => item.sessionId === 'compact-source-invalid-view-writer')!;
    (generation.metadata as unknown as Record<string, unknown>).poseRecoveryClipViews = {
      view: { frame: 0, selected: 'root', drafts: {}, folder: 7 },
    };
    await writer.writeAsset(manifestKey, manifest);

    const reader = await loadTab('compact-source-invalid-view-reader');
    await reader.initializeStorage();
    const candidate = reader.readRecoveryCandidates()[0];
    const payload = (await reader.readRecoveryCandidate(candidate)) as AnimationLibrary & {
      poseRecoveryClipViews?: Record<string, unknown>;
    };
    expect(payload.clips[0].project.version).toBe(0);
    const sources = (
      payload as unknown as { poseRecoverySources: Record<string, { bytes: Uint8Array }> }
    ).poseRecoverySources;
    expect(sources[generation.clips[0].key].bytes).toEqual(bytes);
    expect(payload.poseRecoveryClipViews?.view).toEqual({
      frame: 0,
      selected: 'root',
      drafts: {},
      folder: 7,
    });
  });

  it('replaces edited source clips natively while retaining unchanged source references', async () => {
    const writer = await loadTab('compact-source-edits');
    await writer.initializeStorage();
    const initial = library(
      'Compact source edits',
      [entry('raw', blankProject()), entry('native', blankProject())],
      'native',
    );
    const sourceBytes = await encodeProject(initial);
    await writer.writeRecovery(initial, {
      bytes: sourceBytes,
      clipIds: new Set(['raw']),
    });
    const firstManifest = (await writer.readAsset(manifestKey)) as RecoveryManifest;
    const first = firstManifest.sessions.find((session) => session.id === 'compact-source-edits')!
      .generations[0];
    const sourceKey = first.clips.find((clip) => clip.id === 'raw')!.key;
    const firstNativeKey = first.clips.find((clip) => clip.id === 'native')!.key;
    expect(firstNativeKey).not.toBe(sourceKey);

    const edited: AnimationLibrary = {
      ...initial,
      clips: [
        initial.clips[0],
        {
          ...initial.clips[1],
          project: { ...initial.clips[1].project, name: 'Edited native clip' },
        },
      ],
    };
    await writer.writeRecovery(edited);
    const secondManifest = (await writer.readAsset(manifestKey)) as RecoveryManifest;
    const second = secondManifest.sessions.find((session) => session.id === 'compact-source-edits')!
      .generations[0];
    expect(second.clips.find((clip) => clip.id === 'raw')!.key).toBe(sourceKey);
    expect(second.clips.find((clip) => clip.id === 'native')!.key).not.toBe(firstNativeKey);
    expect(second.clips.find((clip) => clip.id === 'native')!.key).not.toBe(sourceKey);

    const reader = await loadTab('compact-source-edits-reader');
    await reader.initializeStorage();
    const restored = (await reader.readRecoveryCandidate(reader.readRecoveryCandidates()[0])) as
      | AnimationLibrary
      | undefined;
    expect(restored?.clips.find((clip) => clip.id === 'raw')?.project.name).toBe(
      initial.clips[0].project.name,
    );
    expect(restored?.clips.find((clip) => clip.id === 'native')?.project.name).toBe(
      'Edited native clip',
    );
  });

  it('keeps linked body-base clips native when their source clip is edited', async () => {
    const writer = await loadTab('compact-source-linked-writer');
    await writer.initializeStorage();
    const sourceProject = addAnimationLayer(createProject({}, false), 'pose');
    const sourceClip = entry('source', sourceProject);
    const linkedClip = entry('linked', createBodyAction(sourceProject, sourceClip.id));
    const initial = library('Compact linked source', [sourceClip, linkedClip], 'linked');
    const bytes = await encodeProject(initial);
    await writer.writeRecovery(initial, {
      bytes,
      clipIds: new Set(['source']),
    });
    const firstManifest = (await writer.readAsset(manifestKey)) as RecoveryManifest;
    const first = firstManifest.sessions.find(
      (session) => session.id === 'compact-source-linked-writer',
    )!.generations[0];
    const firstSourceKey = first.clips.find((clip) => clip.id === 'source')!.key;
    expect(first.clips.find((clip) => clip.id === 'linked')!.key).not.toBe(firstSourceKey);

    const editedSourceProject = { ...sourceProject, name: 'Edited source' };
    const editedLinkedProject = {
      ...linkedClip.project,
      bodyBase: {
        ...linkedClip.project.bodyBase!,
        source: editedSourceProject,
      },
      otherTracks: editedSourceProject.tracks,
    };
    const edited: AnimationLibrary = {
      ...initial,
      clips: [
        { ...sourceClip, project: editedSourceProject },
        { ...linkedClip, project: editedLinkedProject },
      ],
    };
    await writer.writeRecovery(edited);
    const secondManifest = (await writer.readAsset(manifestKey)) as RecoveryManifest;
    const second = secondManifest.sessions.find(
      (session) => session.id === 'compact-source-linked-writer',
    )!.generations[0];
    expect(second.clips.find((clip) => clip.id === 'source')!.key).not.toBe(firstSourceKey);
    expect(second.clips.find((clip) => clip.id === 'linked')!.key).not.toBe(firstSourceKey);

    const reader = await loadTab('compact-source-linked-reader');
    await reader.initializeStorage();
    const restored = (await reader.readRecoveryCandidate(
      reader.readRecoveryCandidates()[0],
    )) as AnimationLibrary;
    expect(restored.clips.find((clip) => clip.id === 'source')?.project.name).toBe('Edited source');
    expect(restored.clips.find((clip) => clip.id === 'linked')?.project.bodyBase?.source.name).toBe(
      'Edited source',
    );
  });

  it('keeps an invalid compact source as one quarantine payload', async () => {
    const writer = await loadTab('compact-source-invalid-writer');
    await writer.initializeStorage();
    const sourceKey = 'manny-studio-library-v3:source:compact-source-invalid-writer:bad';
    const badBytes = new Uint8Array([0, 1, 2]);
    const source = {
      poseRecoverySourceFormat: 2,
      bytes: new Blob([badBytes], { type: 'application/gzip' }),
    };
    await writer.writeAsset(sourceKey, source);
    const sourceMetadata = library('Invalid compact source', [entry('bad', blankProject())], 'bad');
    const { clips: _clips, ...metadata } = sourceMetadata;
    await writer.writeAsset(manifestKey, {
      format: 2,
      sessions: [
        {
          id: 'compact-source-invalid-writer',
          updatedAt: Date.now(),
          generations: [
            {
              id: 'bad-generation',
              sessionId: 'compact-source-invalid-writer',
              documentId: 'bad-document',
              createdAt: Date.now(),
              metadata,
              clips: [{ id: 'bad', key: sourceKey }],
            },
          ],
        },
      ],
    } satisfies RecoveryManifest);
    const reader = await loadTab('compact-source-invalid-reader');
    await reader.initializeStorage();
    const candidate = reader.readRecoveryCandidates()[0];
    const payload = (await reader.readRecoveryCandidate(candidate)) as AnimationLibrary & {
      poseRecoverySources?: Record<string, unknown>;
    };
    expect(payload.clips[0].project.version).toBe(0);
    const storedSource = payload.poseRecoverySources?.[sourceKey] as {
      poseRecoverySourceFormat: number;
      bytes: Blob;
    };
    expect(storedSource.poseRecoverySourceFormat).toBe(2);
    expect(new Uint8Array(await storedSource.bytes.arrayBuffer())).toEqual(badBytes);
    await reader.rejectRecoveryCandidate(candidate, Error('invalid compact source'));
    const failed = await reader.readFailedRecovery();
    expect(failed).not.toBeNull();
    const failedPayload = JSON.parse(failed!.content) as {
      poseRecoverySources?: Record<string, { bytes?: { encoding?: string; data?: string } }>;
    };
    const encoded = failedPayload.poseRecoverySources?.[sourceKey]?.bytes;
    expect(encoded?.encoding).toBe('base64');
    expect(decode64(encoded!.data!)).toEqual(badBytes);
    await reader.resolveFailedRecovery('discard');
  });

  it('batches recovery clip writes and rolls back a later batch failure', async () => {
    const tab = await loadTab('recovery-batch-failure');
    await tab.initializeStorage();
    const clipCount = 17;
    const baseline = library(
      'Batch baseline',
      Array.from({ length: clipCount }, (_, index) =>
        entry(`clip-${index}`, project(`Baseline ${index}`, { root: [index] })),
      ),
      'clip-0',
    );
    await tab.writeRecovery(baseline);
    const beforeManifest = (await tab.readAsset(manifestKey)) as RecoveryManifest;
    const beforeGeneration = beforeManifest.sessions
      .flatMap((session) => session.generations)
      .find((item) => item.sessionId === 'recovery-batch-failure')!;

    const changed = baseline.clips.map((clip, index) => {
      const next = project(`Changed ${index}`, { root: [index + 1] });
      if (index === clipCount - 1)
        (next as unknown as { nonCloneable: () => undefined }).nonCloneable = () => undefined;
      return entry(clip.id, next);
    });
    await expect(tab.writeRecovery(library('Batch failure', changed, 'clip-0'))).rejects.toThrow();

    const afterManifest = (await tab.readAsset(manifestKey)) as RecoveryManifest;
    expect(afterManifest).toEqual(beforeManifest);
    const afterGeneration = afterManifest.sessions
      .flatMap((session) => session.generations)
      .find((item) => item.sessionId === 'recovery-batch-failure')!;
    expect(afterGeneration.id).toBe(beforeGeneration.id);
    const preserved = (await tab.readAsset(beforeGeneration.clips[0].key)) as AnimationEntry;
    expect(preserved.project.name).toBe('Baseline 0');
  });

  it('keeps recovery held when reloading the original candidate fails', async () => {
    const writer = await loadTab('reload-failure-writer');
    await writer.initializeStorage();
    const source = blankProject();
    source.name = 'Reloadable original';
    await writer.writeRecovery(
      library('Reload failure original', [entry('reloadable', source)], 'reloadable'),
    );

    const reader = await loadTab('reload-failure-reader');
    await reader.initializeStorage();
    const candidate = reader.readRecoveryCandidates()[0];
    await reader.readOwnedRecoveryCandidate(candidate);
    expect(candidate.data).toBeUndefined();
    expect(candidate.clipReferences).toBeDefined();

    const originalTransaction = FakeIDBDatabase.prototype.transaction;
    const transactionSpy = vi.spyOn(FakeIDBDatabase.prototype, 'transaction');
    transactionSpy.mockImplementation(function (this: any, storeNames: any, mode?: any) {
      if (mode === 'readonly') throw Error('Injected recovery reload failure');
      return originalTransaction.call(this, storeNames, mode);
    });
    try {
      await expect(
        reader.rejectRecoveryCandidate(candidate, Error('validation failed')),
      ).resolves.toBeUndefined();
      expect(reader.getRecoveryState().writeHeld).toBe(true);
      expect(reader.getRecoveryState().problem?.archiveDurable).toBe(false);
      expect(reader.getRecoveryState().problem?.message).toContain(
        'could not be reloaded for preservation',
      );
      expect(await reader.readFailedRecovery()).toBeNull();
      await expect(
        reader.writeRecovery(
          library('Blocked write', [entry('blocked', blankProject())], 'blocked'),
        ),
      ).rejects.toBeInstanceOf(reader.RecoveryWriteHeldError);
    } finally {
      transactionSpy.mockRestore();
    }

    const manifest = (await reader.readAsset(manifestKey)) as RecoveryManifest;
    const generation = manifest.sessions
      .flatMap((session) => session.generations)
      .find((item) => item.sessionId === 'reload-failure-writer')!;
    const stored = (await reader.readAsset(generation.clips[0].key)) as AnimationEntry;
    expect(stored.project.name).toBe('Reloadable original');
    const retry = await reader.readFailedRecovery();
    expect(retry?.content).toContain('Reload failure original');
    await reader.resolveFailedRecovery('discard');
  });
});

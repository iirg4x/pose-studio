import { IDBDatabase as FakeIDBDatabase, indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AnimationEntry, AnimationLibrary } from '../src/core/library';
import type { Project } from '../src/core/model';
import type { RecoveryManifest } from '../src/platform/recoveryGenerations';

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
    expect(missingTab.getRecoveryState().writeHeld).toBe(true);
    const missingCandidates = missingTab.readRecoveryCandidates();
    await expect(missingTab.readRecoveryCandidate(missingCandidates[0])).rejects.toThrow(
      'missing stored animation data',
    );
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
});

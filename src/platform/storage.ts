import type { AnimationEntry, AnimationLibrary } from '../core/library';
import { Capacitor } from '@capacitor/core';
import {
  addRecoveryGeneration,
  documentRecoveryId,
  emptyRecoveryManifest,
  normalizeRecoveryManifest,
  orderedRecoveryGenerations,
  referencedRecoveryClips,
} from './recoveryGenerations';
import type {
  RecoveryClipReference,
  RecoveryGeneration,
  RecoveryManifest,
} from './recoveryGenerations';

export const isAndroid = Capacitor.getPlatform() === 'android';
export const isTouch =
  isAndroid || (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
export const portablePlatform =
  isAndroid ||
  (Capacitor.getPlatform() === 'web' && (typeof window === 'undefined' || !window.studioDesktop));
export const RECOVERY = 'manny-studio-library-v3';
export const BASELINE = 'pose-last-file-save';

const MAX_ARCHIVES = 8;
const recoveryIndex = RECOVERY + ':index';
const recoveryManifestKey = RECOVERY + ':manifest:v2';
const recoverySessionKey = RECOVERY + ':session:v2';
const recoveryArchiveCatalogKey = RECOVERY + ':quarantine:index';
const recoveryHoldKey = RECOVERY + ':quarantine:hold';
const clipKey = (session: string, generation: string, clip: string) =>
  `${RECOVERY}:clip:${session}:${generation}:${clip}`;
const legacyClipKey = (clip: string) => `${RECOVERY}:clip:${clip}`;
const archiveKey = (archive: string) => `${RECOVERY}:quarantine:${archive}`;

type LegacyIndex = Omit<AnimationLibrary, 'clips'> & { clipIds: string[] };

export interface RecoveryCandidate {
  id: string;
  sessionId: string;
  documentId: string;
  createdAt: number;
  missingClipIds: string[];
  autoRestore: boolean;
  source: 'generation' | 'legacy-index' | 'legacy-value' | 'quarantine';
  data?: unknown;
  metadata?: Omit<AnimationLibrary, 'clips'>;
  clipReferences?: RecoveryClipReference[];
  legacyClipIds?: string[];
  archiveKey?: string;
  archiveProblemId?: string;
}

export interface RecoveryProblem {
  id: string;
  archiveId: string;
  candidateId: string;
  createdAt: number;
  message: string;
  downloadName: string;
  hasOlderGeneration: boolean;
  archiveDurable: boolean;
}

export interface RecoveryDownload {
  name: string;
  type: 'application/json';
  content: string;
}

export interface RecoveryGenerationSummary {
  id: string;
  sessionId: string;
  documentId: string;
  createdAt: number;
  source: RecoveryCandidate['source'];
  name: string;
}

export interface RecoveryState {
  writeHeld: boolean;
  problem: RecoveryProblem | null;
  generations: RecoveryGenerationSummary[];
}

interface RecoveryArchiveItem {
  id: string;
  key: string;
  createdAt: number;
  resolved: boolean;
  problem: RecoveryProblem;
  candidate: Omit<RecoveryCandidate, 'data'>;
}

interface RecoveryArchiveCatalog {
  format: 1;
  items: RecoveryArchiveItem[];
}

let database: IDBDatabase;
let recovery: AnimationLibrary | null = null;
let previousClips = new Map<string, AnimationEntry>();
let recoveryQueue = Promise.resolve();
let recoveryManifest: RecoveryManifest = emptyRecoveryManifest();
let recoveryCandidates: RecoveryCandidate[] = [];
let recoveryProblem: RecoveryProblem | null = null;
let recoveryWriteHeld = false;
let recoveryState: RecoveryState = { writeHeld: false, problem: null, generations: [] };
let legacyClipIdsForCleanup: string[] = [];
const values = new Map<string, string>();
const recoveryListeners = new Set<() => void>();

export class RecoveryWriteHeldError extends Error {
  constructor() {
    super('Autosave is paused until the failed recovery copy is preserved or discarded.');
    this.name = 'RecoveryWriteHeldError';
  }
}

function id() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

let sessionId = id();
const instanceId = id();
const recoveryChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(RECOVERY + ':sessions');
try {
  sessionId = sessionStorage.getItem(recoverySessionKey) ?? sessionId;
  sessionStorage.setItem(recoverySessionKey, sessionId);
} catch {}
recoveryChannel?.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data as { type?: unknown; sessionId?: unknown; instanceId?: unknown };
  if (
    message.type === 'probe' &&
    message.sessionId === sessionId &&
    message.instanceId !== instanceId
  )
    recoveryChannel.postMessage({
      type: 'present',
      sessionId,
      instanceId,
      target: message.instanceId,
    });
});

async function isolateDuplicatedSession() {
  if (!recoveryChannel) return;
  const duplicated = await new Promise<boolean>((resolve) => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data as { type?: unknown; sessionId?: unknown; target?: unknown };
      if (
        message.type !== 'present' ||
        message.sessionId !== sessionId ||
        message.target !== instanceId
      )
        return;
      clearTimeout(timeout);
      recoveryChannel.removeEventListener('message', onMessage);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      recoveryChannel.removeEventListener('message', onMessage);
      resolve(false);
    }, 40);
    recoveryChannel.addEventListener('message', onMessage);
    recoveryChannel.postMessage({ type: 'probe', sessionId, instanceId });
  });
  if (!duplicated) return;
  sessionId = id();
  try {
    sessionStorage.setItem(recoverySessionKey, sessionId);
  } catch {}
}

function normalizeArchiveCatalog(value: unknown): RecoveryArchiveCatalog {
  if (!value || typeof value !== 'object') return { format: 1, items: [] };
  const raw = value as Partial<RecoveryArchiveCatalog>;
  if (raw.format !== 1 || !Array.isArray(raw.items)) return { format: 1, items: [] };
  return {
    format: 1,
    items: raw.items.filter(
      (item): item is RecoveryArchiveItem =>
        !!item &&
        typeof item.id === 'string' &&
        typeof item.key === 'string' &&
        Number.isFinite(item.createdAt) &&
        typeof item.resolved === 'boolean' &&
        !!item.problem &&
        !!item.candidate,
    ),
  };
}

function legacyIndex(value: unknown): LegacyIndex | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<LegacyIndex>;
  if (
    !Array.isArray(raw.clipIds) ||
    !raw.clipIds.length ||
    raw.clipIds.length > 500 ||
    !raw.clipIds.every((clip) => typeof clip === 'string' && clip.length > 0 && clip.length <= 100)
  )
    return null;
  const { clipIds, ...metadata } = raw as LegacyIndex;
  return { ...(metadata as Omit<AnimationLibrary, 'clips'>), clipIds: [...clipIds] };
}

function candidateName(candidate: RecoveryCandidate) {
  const source = candidate.data ?? candidate.metadata;
  return source &&
    typeof source === 'object' &&
    typeof (source as { name?: unknown }).name === 'string'
    ? (source as { name: string }).name
    : 'Unknown project';
}

function recoverySummaries(): RecoveryGenerationSummary[] {
  return recoveryCandidates
    .filter(
      (candidate) =>
        candidate.source !== 'quarantine' || candidate.archiveProblemId !== recoveryProblem?.id,
    )
    .map((candidate) => ({
      id: candidate.id,
      sessionId: candidate.sessionId,
      documentId: candidate.documentId,
      createdAt: candidate.createdAt,
      source: candidate.source,
      name: candidateName(candidate),
    }));
}

function publishRecoveryState() {
  recoveryState = {
    writeHeld: recoveryWriteHeld,
    problem: recoveryProblem,
    generations: recoverySummaries(),
  };
  for (const listener of recoveryListeners) listener();
}

async function loadCandidate(candidate: RecoveryCandidate): Promise<unknown> {
  if (candidate.data !== undefined) return candidate.data;
  if (candidate.source === 'quarantine' && candidate.archiveKey) {
    const archived = (await readAsset(candidate.archiveKey)) as
      | { candidate?: RecoveryCandidate }
      | undefined;
    candidate.data = archived?.candidate?.data;
    candidate.missingClipIds = archived?.candidate?.missingClipIds ?? [];
    return candidate.data;
  }
  const references = candidate.clipReferences;
  if (references) {
    const stored = (await readAssets(references.map((reference) => reference.key))) as Array<
      AnimationEntry | undefined
    >;
    candidate.missingClipIds = references
      .filter((_, position) => !stored[position])
      .map((reference) => reference.id);
    candidate.data = {
      ...candidate.metadata,
      clips: stored.filter((clip): clip is AnimationEntry => !!clip),
    };
    return candidate.data;
  }
  if (candidate.legacyClipIds && candidate.metadata) {
    const stored = (await readAssets(candidate.legacyClipIds.map(legacyClipKey))) as Array<
      AnimationEntry | undefined
    >;
    candidate.missingClipIds = candidate.legacyClipIds.filter((_, position) => !stored[position]);
    candidate.data = {
      ...candidate.metadata,
      clips: stored.filter((clip): clip is AnimationEntry => !!clip),
    };
  }
  return candidate.data;
}

export async function initializeStorage() {
  await isolateDuplicatedSession();
  database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pose-offline', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  for (const key of [RECOVERY, BASELINE]) {
    const stored = await readAsset(key);
    const legacy = localStorage.getItem(key);
    const value = typeof stored === 'string' ? stored : legacy;
    if (value !== null) {
      values.set(key, value);
      if (stored === undefined) await writeAsset(key, value);
    }
  }

  recoveryManifest = normalizeRecoveryManifest(await readAsset(recoveryManifestKey));
  recoveryCandidates = [];
  recoveryProblem = null;
  recoveryWriteHeld = false;
  const primarySessionId = recoveryManifest.sessions.some((session) => session.id === sessionId)
    ? sessionId
    : recoveryManifest.sessions[0]?.id;
  const primaryDocumentId = recoveryManifest.sessions.find(
    (session) => session.id === primarySessionId,
  )?.generations[0]?.documentId;
  for (const generation of orderedRecoveryGenerations(recoveryManifest, sessionId))
    recoveryCandidates.push({
      id: generation.id,
      sessionId: generation.sessionId,
      documentId: generation.documentId,
      createdAt: generation.createdAt,
      metadata: generation.metadata,
      clipReferences: generation.clips,
      missingClipIds: [],
      autoRestore:
        generation.sessionId === primarySessionId && generation.documentId === primaryDocumentId,
      source: 'generation',
    });

  const rawLegacyIndex = await readAsset(recoveryIndex);
  const parsedLegacyIndex = legacyIndex(rawLegacyIndex);
  if (rawLegacyIndex !== undefined) {
    legacyClipIdsForCleanup = parsedLegacyIndex?.clipIds ?? [];
    const { clipIds, ...metadata } = parsedLegacyIndex ?? { clipIds: [] };
    recoveryCandidates.push({
      id: 'legacy-index',
      sessionId: 'legacy',
      documentId: clipIds[0] ?? 'legacy',
      createdAt: 0,
      metadata: parsedLegacyIndex ? (metadata as Omit<AnimationLibrary, 'clips'>) : undefined,
      legacyClipIds: parsedLegacyIndex ? clipIds : undefined,
      data: parsedLegacyIndex ? undefined : rawLegacyIndex,
      missingClipIds: [],
      autoRestore: recoveryManifest.sessions.length === 0,
      source: 'legacy-index',
    });
  }
  const legacyValue = values.get(RECOVERY);
  if (legacyValue)
    recoveryCandidates.push({
      id: 'legacy-value',
      sessionId: 'legacy',
      documentId: 'legacy',
      createdAt: 0,
      data: legacyValue,
      missingClipIds: [],
      autoRestore: recoveryManifest.sessions.length === 0 && rawLegacyIndex === undefined,
      source: 'legacy-value',
    });

  const archiveCatalog = normalizeArchiveCatalog(await readAsset(recoveryArchiveCatalogKey));
  for (const item of archiveCatalog.items)
    recoveryCandidates.push({
      ...item.candidate,
      id: `quarantine:${item.id}`,
      archiveKey: item.key,
      archiveProblemId: item.problem.id,
      autoRestore: false,
      source: 'quarantine',
    });
  await refreshRecoveryHoldState(archiveCatalog);

  const primary = recoveryCandidates.find((candidate) => candidate.autoRestore);
  if (primary) {
    await loadCandidate(primary);
    let malformedJson = false;
    if (primary.source === 'legacy-value' && typeof primary.data === 'string')
      try {
        JSON.parse(primary.data);
      } catch {
        malformedJson = true;
      }
    if (
      !recoveryProblem &&
      (primary.missingClipIds.length ||
        malformedJson ||
        (!parsedLegacyIndex && primary.source === 'legacy-index'))
    )
      await rejectRecoveryCandidate(
        primary,
        primary.missingClipIds.length
          ? Error('Recovery is missing stored animation data.')
          : malformedJson
            ? Error('Recovery contains invalid JSON.')
            : Error('Recovery index is malformed.'),
      );
  }
  publishRecoveryState();
  void navigator.storage?.persist?.().catch(() => false);
}

export function readPreference(key: string) {
  return values.get(key) ?? localStorage.getItem(key);
}

function readAssets(keys: readonly string[]): Promise<unknown[]> {
  if (!keys.length) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction | undefined;
    let settled = false;
    const values = new Array<unknown>(keys.length);
    let completedRequests = 0;
    const fail = (error: unknown, fallback: string) => {
      if (settled) return;
      settled = true;
      reject(error ?? Error(fallback));
    };

    try {
      transaction = database.transaction('files', 'readonly');
      const store = transaction.objectStore('files');
      transaction.oncomplete = () => {
        if (settled) return;
        if (completedRequests !== keys.length) {
          fail(
            Error('Storage read completed before all requests finished.'),
            'Storage read failed.',
          );
          return;
        }
        settled = true;
        resolve(values);
      };
      transaction.onerror = () => fail(transaction?.error, 'Storage read failed.');
      transaction.onabort = () => fail(transaction?.error, 'Storage read was interrupted.');
      keys.forEach((key, position) => {
        const request = store.get(key);
        request.onsuccess = () => {
          values[position] = request.result;
          completedRequests += 1;
        };
        request.onerror = () => fail(request.error, 'Storage read failed.');
      });
    } catch (error) {
      fail(error, 'Storage read failed.');
    }
  });
}

export async function writePreference(key: string, value: string) {
  if (database) {
    await writeAsset(key, value);
    values.set(key, value);
  } else localStorage.setItem(key, value);
}
export function readAsset(key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = database.transaction('files').objectStore('files').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function writeAsset(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('files', 'readwrite');
    transaction.objectStore('files').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? Error('Storage write was interrupted.'));
  });
}

export function readRecovery() {
  return recovery;
}
export function readRecoveryCandidates() {
  return recoveryCandidates.filter((candidate) => candidate.autoRestore);
}
export async function readRecoveryCandidate(candidate: RecoveryCandidate) {
  const data = await loadCandidate(candidate);
  if (data === undefined) throw Error('The stored recovery payload is unavailable.');
  if (candidate.missingClipIds.length)
    throw Error(
      'Recovery is missing stored animation data: ' + candidate.missingClipIds.join(', '),
    );
  return data;
}
export function getRecoveryState() {
  return recoveryState;
}
export function subscribeRecoveryState(listener: () => void) {
  recoveryListeners.add(listener);
  return () => recoveryListeners.delete(listener);
}
export function acceptRecoveryCandidate(candidate: RecoveryCandidate, data: AnimationLibrary) {
  recovery = data;
  candidate.data = data;
  if (candidate.source === 'generation')
    previousClips = new Map(data.clips.map((clip) => [clip.id, clip]));
}

async function archiveRecoveryProblem(problem: RecoveryProblem, candidate: RecoveryCandidate) {
  let durable = false;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('files', 'readwrite');
    const store = transaction.objectStore('files');
    const request = store.get(recoveryArchiveCatalogKey);
    request.onsuccess = () => {
      try {
        const current = normalizeArchiveCatalog(request.result);
        const existing = current.items.some((item) => item.id === problem.archiveId);
        if (!existing && current.items.length >= MAX_ARCHIVES) {
          store.put({ format: 1, problem: withArchiveLimitMessage(problem) }, recoveryHoldKey);
          return;
        }
        durable = true;
        const durableProblem = { ...problem, archiveDurable: true };
        const { data: _data, ...candidateSummary } = candidate;
        const summary: RecoveryArchiveItem = {
          id: problem.archiveId,
          key: archiveKey(problem.archiveId),
          createdAt: problem.createdAt,
          resolved: false,
          problem: durableProblem,
          candidate: candidateSummary,
        };
        const items = [summary, ...current.items.filter((item) => item.id !== summary.id)].sort(
          (left, right) => right.createdAt - left.createdAt,
        );
        store.put({ format: 1, items }, recoveryArchiveCatalogKey);
        store.put({ format: 1, problem: durableProblem, candidate }, summary.key);
        store.delete(recoveryHoldKey);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? Error('Recovery quarantine was interrupted.'));
  });
  return durable;
}

function addArchiveCandidate(problem: RecoveryProblem, candidate: RecoveryCandidate) {
  if (
    recoveryCandidates.some(
      (item) => item.source === 'quarantine' && item.archiveProblemId === problem.id,
    )
  )
    return;
  recoveryCandidates.push({
    ...candidate,
    id: `quarantine:${problem.archiveId}`,
    archiveKey: archiveKey(problem.archiveId),
    archiveProblemId: problem.id,
    autoRestore: false,
    source: 'quarantine',
  });
}

async function refreshRecoveryHoldState(catalogValue?: RecoveryArchiveCatalog) {
  const catalog =
    catalogValue ?? normalizeArchiveCatalog(await readAsset(recoveryArchiveCatalogKey));
  const held = (await readAsset(recoveryHoldKey)) as { problem?: RecoveryProblem } | undefined;
  const unresolved = catalog.items.find((item) => !item.resolved);
  let problem = unresolved?.problem ?? held?.problem ?? null;
  if (unresolved) {
    const archived = (await readAsset(unresolved.key)) as
      | { candidate?: RecoveryCandidate }
      | undefined;
    const archiveDurable = archived?.candidate?.data !== undefined;
    problem = { ...unresolved.problem, archiveDurable };
    if (!archiveDurable && (!held?.problem || held.problem.id === problem.id))
      await writeAsset(recoveryHoldKey, { format: 1, problem });
    addArchiveCandidate(problem, unresolved.candidate);
  }
  recoveryProblem = problem;
  recoveryWriteHeld = problem !== null;
  publishRecoveryState();
}

function withArchiveLimitMessage(problem: RecoveryProblem): RecoveryProblem {
  if (problem.message.includes('Recovery archive limit')) return problem;
  return {
    ...problem,
    message:
      problem.message +
      ` Recovery archive limit (${MAX_ARCHIVES}) reached; download this copy and explicitly discard it before continuing.`,
  };
}

export async function rejectRecoveryCandidate(candidate: RecoveryCandidate, reason: unknown) {
  if (recoveryProblem) return;
  await loadCandidate(candidate);
  const problem: RecoveryProblem = {
    id: id(),
    archiveId: id(),
    candidateId: candidate.id,
    createdAt: Date.now(),
    message: reason instanceof Error ? reason.message : String(reason),
    downloadName: `pose-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    hasOlderGeneration: recoveryCandidates.some(
      (item) =>
        item.id !== candidate.id &&
        item.sessionId === candidate.sessionId &&
        item.documentId === candidate.documentId &&
        item.createdAt < candidate.createdAt,
    ),
    archiveDurable: false,
  };
  recoveryProblem = problem;
  recoveryWriteHeld = true;
  publishRecoveryState();
  const storedCandidate = { ...candidate, clipReferences: undefined, legacyClipIds: undefined };
  try {
    await writeAsset(recoveryHoldKey, { format: 1, problem });
    if (await archiveRecoveryProblem(problem, storedCandidate)) {
      recoveryProblem = { ...problem, archiveDurable: true };
      addArchiveCandidate(recoveryProblem, storedCandidate);
    } else {
      recoveryProblem = withArchiveLimitMessage(problem);
    }
    publishRecoveryState();
  } catch (error) {
    recoveryProblem = {
      ...problem,
      message: `${problem.message} The recovery archive could not be written: ${(error as Error).message}`,
    };
    publishRecoveryState();
  }
}

export function readRecoveryProblem() {
  return recoveryProblem;
}

function recoveryDownload(candidate: RecoveryCandidate, name?: string): RecoveryDownload {
  const content = candidate.missingClipIds.length
    ? JSON.stringify(
        {
          recovery: candidate.data,
          missingClipIds: candidate.missingClipIds,
          source: candidate.source,
        },
        null,
        2,
      )
    : typeof candidate.data === 'string'
      ? candidate.data
      : JSON.stringify(candidate.data, null, 2);
  return {
    name: name ?? `pose-recovery-${new Date(candidate.createdAt || Date.now()).toISOString()}.json`,
    type: 'application/json',
    content,
  };
}

export async function readFailedRecovery(): Promise<RecoveryDownload | null> {
  if (!recoveryProblem) return null;
  const candidates = [
    recoveryCandidates.find(
      (item) => item.source === 'quarantine' && item.archiveProblemId === recoveryProblem?.id,
    ),
    recoveryCandidates.find((item) => item.id === recoveryProblem?.candidateId),
  ].filter((candidate): candidate is RecoveryCandidate => !!candidate);
  for (const candidate of candidates) {
    const data = await loadCandidate(candidate);
    if (data !== undefined) return recoveryDownload(candidate, recoveryProblem.downloadName);
  }
  return null;
}

function removeGeneration(manifest: RecoveryManifest, candidateId: string): RecoveryManifest {
  return {
    ...manifest,
    sessions: manifest.sessions
      .map((session) => ({
        ...session,
        generations: session.generations.filter((generation) => generation.id !== candidateId),
      }))
      .filter((session) => session.generations.length > 0),
  };
}

export async function resolveFailedRecovery(choice: 'preserve' | 'discard') {
  if (!recoveryProblem) return;
  let problem = recoveryProblem;
  if (choice === 'preserve' && problem.archiveDurable) {
    const archived = (await readAsset(archiveKey(problem.archiveId))) as
      | { candidate?: RecoveryCandidate }
      | undefined;
    if (archived?.candidate?.data === undefined) {
      problem = { ...problem, archiveDurable: false };
      recoveryProblem = problem;
      recoveryWriteHeld = true;
      await writeAsset(recoveryHoldKey, { format: 1, problem });
      publishRecoveryState();
    }
  }
  if (choice === 'preserve' && !problem.archiveDurable) {
    const original = recoveryCandidates.find((candidate) => candidate.id === problem.candidateId);
    if (!original) throw Error('The failed recovery copy is no longer available to preserve.');
    if ((await loadCandidate(original)) === undefined)
      throw Error('The failed recovery copy is no longer available to preserve.');
    const storedCandidate = { ...original, clipReferences: undefined, legacyClipIds: undefined };
    if (!(await archiveRecoveryProblem(problem, storedCandidate)))
      throw Error(
        `Recovery archive limit (${MAX_ARCHIVES}) reached. Download this copy and explicitly discard it before continuing.`,
      );
    problem = { ...problem, archiveDurable: true };
    recoveryProblem = problem;
    addArchiveCandidate(problem, storedCandidate);
  }
  let nextProblem: RecoveryProblem | null = null;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('files', 'readwrite');
    const store = transaction.objectStore('files');
    const manifestRequest = store.get(recoveryManifestKey);
    const archiveRequest = store.get(recoveryArchiveCatalogKey);
    const holdRequest = store.get(recoveryHoldKey);
    let manifest: RecoveryManifest | undefined;
    const update = () => {
      if (
        manifestRequest.readyState !== 'done' ||
        archiveRequest.readyState !== 'done' ||
        holdRequest.readyState !== 'done'
      )
        return;
      try {
        const current = normalizeRecoveryManifest(manifestRequest.result);
        manifest = removeGeneration(current, problem.candidateId);
        const retained = referencedRecoveryClips(manifest);
        for (const key of referencedRecoveryClips(current))
          if (!retained.has(key)) store.delete(key);
        store.put(manifest, recoveryManifestKey);
        const catalog = normalizeArchiveCatalog(archiveRequest.result);
        const items =
          choice === 'preserve'
            ? catalog.items.map((item) =>
                item.id === problem.archiveId ? { ...item, resolved: true } : item,
              )
            : catalog.items.filter((item) => item.id !== problem.archiveId);
        store.put({ format: 1, items }, recoveryArchiveCatalogKey);
        if (choice === 'discard') store.delete(archiveKey(problem.archiveId));
        const held = holdRequest.result as { problem?: RecoveryProblem } | undefined;
        if (held?.problem?.id === problem.id) store.delete(recoveryHoldKey);
        nextProblem =
          items.find((item) => !item.resolved)?.problem ??
          (held?.problem?.id !== problem.id ? (held?.problem ?? null) : null);
        const original = recoveryCandidates.find((item) => item.id === problem.candidateId);
        if (original?.source === 'legacy-index') {
          store.delete(recoveryIndex);
          for (const clip of original.legacyClipIds ?? []) store.delete(legacyClipKey(clip));
        }
        if (original?.source === 'legacy-value') store.delete(RECOVERY);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    };
    manifestRequest.onsuccess = update;
    archiveRequest.onsuccess = update;
    holdRequest.onsuccess = update;
    manifestRequest.onerror = () => reject(manifestRequest.error);
    archiveRequest.onerror = () => reject(archiveRequest.error);
    holdRequest.onerror = () => reject(holdRequest.error);
    transaction.oncomplete = () => {
      recoveryManifest = manifest ?? recoveryManifest;
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? Error('Recovery cleanup was interrupted.'));
  });
  recoveryCandidates = recoveryCandidates.filter(
    (candidate) =>
      candidate.id !== problem.candidateId &&
      !(choice === 'discard' && candidate.archiveProblemId === problem.id),
  );
  values.delete(RECOVERY);
  try {
    localStorage.removeItem(RECOVERY);
  } catch {}
  recoveryProblem = nextProblem;
  recoveryWriteHeld = nextProblem !== null;
  publishRecoveryState();
}

export function listRecoveryGenerations() {
  return recoverySummaries();
}
export async function readRecoveryGeneration(candidateId: string) {
  const candidate = recoveryCandidates.find((item) => item.id === candidateId);
  return candidate ? readRecoveryCandidate(candidate) : undefined;
}
export async function readStoredRecovery(candidateId?: string): Promise<RecoveryDownload | null> {
  const candidate = candidateId
    ? recoveryCandidates.find((item) => item.id === candidateId)
    : (recoveryCandidates.find((item) => item.autoRestore) ?? recoveryCandidates[0]);
  if (!candidate) return null;
  await loadCandidate(candidate);
  return recoveryDownload(candidate);
}

function sameShallowRecord(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
) {
  if (left === right) return true;
  if (!left || !right) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (!Object.is(left[key], right[key])) return false;
  return true;
}

function sameProject(left: AnimationEntry['project'], right: AnimationEntry['project']) {
  if (left === right) return true;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    const a = (left as unknown as Record<string, unknown>)[key];
    const b = (right as unknown as Record<string, unknown>)[key];
    if (key === 'bodyBase') {
      if (!sameShallowRecord(a as Record<string, unknown>, b as Record<string, unknown>))
        return false;
    } else if (!Object.is(a, b)) return false;
  }
  return true;
}

function clipChanged(previous: AnimationEntry | undefined, next: AnimationEntry, activeId: string) {
  if (!previous || next.id === activeId || !sameProject(previous.project, next.project))
    return true;
  return (
    previous.frame !== next.frame ||
    previous.selected !== next.selected ||
    previous.drafts !== next.drafts ||
    previous.previewId !== next.previewId ||
    previous.previewSync !== next.previewSync ||
    previous.folder !== next.folder
  );
}

/** Commit a bounded immutable generation; the transaction merges other tabs' latest manifest. */
export function writeRecovery(data: AnimationLibrary): Promise<void> {
  const run = () =>
    new Promise<void>((resolve, reject) => {
      if (!database) {
        reject(Error('Project storage is not ready.'));
        return;
      }
      const { clips, ...metadata } = data;
      const generationId = id();
      const createdAt = Date.now();
      const transaction = database.transaction('files', 'readwrite');
      const store = transaction.objectStore('files');
      const manifestRequest = store.get(recoveryManifestKey);
      const archiveRequest = store.get(recoveryArchiveCatalogKey);
      const holdRequest = store.get(recoveryHoldKey);
      let committedManifest: RecoveryManifest | undefined;
      let committedDocumentId = id();
      let blockedError: RecoveryWriteHeldError | undefined;
      let blockedCatalog: RecoveryArchiveCatalog | undefined;
      const commit = () => {
        if (
          manifestRequest.readyState !== 'done' ||
          archiveRequest.readyState !== 'done' ||
          holdRequest.readyState !== 'done'
        )
          return;
        try {
          const catalog = normalizeArchiveCatalog(archiveRequest.result);
          if (catalog.items.some((item) => !item.resolved) || holdRequest.result !== undefined) {
            blockedError = new RecoveryWriteHeldError();
            blockedCatalog = catalog;
            transaction.abort();
            return;
          }
          const current = normalizeRecoveryManifest(manifestRequest.result);
          const latest = current.sessions.find((item) => item.id === sessionId)?.generations[0];
          committedDocumentId = documentRecoveryId(clips, latest, committedDocumentId);
          const oldReferences = new Map(latest?.clips.map((clip) => [clip.id, clip.key]) ?? []);
          const references = clips.map((clip) => {
            const changed = clipChanged(previousClips.get(clip.id), clip, data.activeId);
            const key = changed
              ? clipKey(sessionId, generationId, clip.id)
              : (oldReferences.get(clip.id) ?? clipKey(sessionId, generationId, clip.id));
            if (changed || !oldReferences.has(clip.id)) store.put(clip, key);
            return { id: clip.id, key };
          });
          const generation: RecoveryGeneration = {
            id: generationId,
            sessionId,
            documentId: committedDocumentId,
            createdAt,
            metadata,
            clips: references,
          };
          const next = addRecoveryGeneration(current, generation);
          const retained = referencedRecoveryClips(next);
          for (const key of referencedRecoveryClips(current))
            if (!retained.has(key)) store.delete(key);
          store.put(next, recoveryManifestKey);
          for (const clip of legacyClipIdsForCleanup) store.delete(legacyClipKey(clip));
          store.delete(recoveryIndex);
          store.delete(RECOVERY);
          committedManifest = next;
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      manifestRequest.onsuccess = commit;
      archiveRequest.onsuccess = commit;
      holdRequest.onsuccess = commit;
      manifestRequest.onerror = () => reject(manifestRequest.error);
      archiveRequest.onerror = () => reject(archiveRequest.error);
      holdRequest.onerror = () => reject(holdRequest.error);
      transaction.oncomplete = () => {
        recoveryManifest = committedManifest ?? recoveryManifest;
        recoveryProblem = null;
        recoveryWriteHeld = false;
        legacyClipIdsForCleanup = [];
        previousClips = new Map(clips.map((clip) => [clip.id, clip]));
        recovery = data;
        const retainedIds = new Set(
          orderedRecoveryGenerations(recoveryManifest, sessionId).map((item) => item.id),
        );
        for (const candidate of recoveryCandidates)
          if (candidate.source === 'generation' && candidate.id !== generationId)
            candidate.data = undefined;
        recoveryCandidates = [
          {
            id: generationId,
            sessionId,
            documentId: committedDocumentId,
            createdAt,
            data,
            metadata,
            missingClipIds: [],
            autoRestore: true,
            source: 'generation',
          },
          ...recoveryCandidates.filter(
            (candidate) =>
              candidate.source === 'quarantine' ||
              (candidate.source === 'generation' && retainedIds.has(candidate.id)),
          ),
        ];
        values.delete(RECOVERY);
        try {
          localStorage.removeItem(RECOVERY);
        } catch {}
        publishRecoveryState();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => {
        if (blockedError)
          void refreshRecoveryHoldState(blockedCatalog).then(
            () => reject(blockedError),
            () => reject(blockedError),
          );
        else reject(transaction.error ?? Error('Recovery write was interrupted.'));
      };
    });
  const next = recoveryQueue.then(run);
  recoveryQueue = next.catch(() => {});
  return next;
}

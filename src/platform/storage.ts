import type { AnimationLibrary, AnimationEntry } from '../core/library';
import { Capacitor } from '@capacitor/core';
export const isAndroid = Capacitor.getPlatform() === 'android';
export const isTouch =
  isAndroid || (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches);
export const portablePlatform =
  isAndroid ||
  (Capacitor.getPlatform() === 'web' && (typeof window === 'undefined' || !window.studioDesktop));
export const RECOVERY = 'manny-studio-library-v3';
export const BASELINE = 'pose-last-file-save';
let database: IDBDatabase;
let recovery: AnimationLibrary | null = null;
let previousClips = new Map<string, AnimationEntry>();
let recoveryQueue = Promise.resolve();
const recoveryIndex = RECOVERY + ':index',
  clipKey = (id: string) => RECOVERY + ':clip:' + id;
const values = new Map<string, string>();
export async function initializeStorage() {
  database = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('pose-offline', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  for (const key of [RECOVERY, BASELINE]) {
    const stored = await readAsset(key),
      legacy = localStorage.getItem(key),
      v = typeof stored === 'string' ? stored : legacy;
    if (v !== null) {
      values.set(key, v);
      if (stored === undefined) await writeAsset(key, v);
    }
  }
  const index = (await readAsset(recoveryIndex)) as
    | (Omit<AnimationLibrary, 'clips'> & { clipIds: string[] })
    | undefined;
  if (index) {
    const { clipIds, ...metadata } = index,
      clips = await Promise.all(
        clipIds.map((id) => readAsset(clipKey(id)) as Promise<AnimationEntry>),
      );
    if (clips.every(Boolean)) recovery = { ...metadata, clips };
  }
  // Request protection against automatic eviction; user-cleared app data is still removable.
  void navigator.storage?.persist?.().catch(() => false);
}
export function readPreference(key: string) {
  return values.get(key) ?? localStorage.getItem(key);
}
export async function writePreference(key: string, value: string) {
  if (database) {
    await writeAsset(key, value);
    values.set(key, value);
  } else localStorage.setItem(key, value);
}
export function readAsset(key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const r = database.transaction('files').objectStore('files').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export function writeAsset(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction('files', 'readwrite');
    tx.objectStore('files').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? Error('Storage write was interrupted.'));
  });
}

export function readRecovery() {
  return recovery;
}
/** Commit changed clips and their index atomically; avoid encoding the whole library after each edit. */
export function writeRecovery(data: AnimationLibrary): Promise<void> {
  const run = () =>
    new Promise<void>((resolve, reject) => {
      if (!database) {
        reject(Error('Project storage is not ready.'));
        return;
      }
      const { clips, ...metadata } = data,
        tx = database.transaction('files', 'readwrite'),
        store = tx.objectStore('files'),
        ids = new Set(clips.map((c) => c.id));
      for (const clip of clips) {
        const old = previousClips.get(clip.id);
        if (
          clip.id === data.activeId ||
          !old ||
          old.project !== clip.project ||
          old.frame !== clip.frame ||
          old.selected !== clip.selected ||
          old.drafts !== clip.drafts ||
          old.previewId !== clip.previewId ||
          old.previewSync !== clip.previewSync
        )
          store.put(clip, clipKey(clip.id));
      }
      for (const id of previousClips.keys()) if (!ids.has(id)) store.delete(clipKey(id));
      store.put({ ...metadata, clipIds: clips.map((c) => c.id) }, recoveryIndex);
      store.delete(RECOVERY);
      tx.oncomplete = () => {
        previousClips = new Map(clips.map((c) => [c.id, c]));
        recovery = data;
        values.delete(RECOVERY);
        try {
          localStorage.removeItem(RECOVERY);
        } catch {}
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? Error('Recovery write was interrupted.'));
    });
  const next = recoveryQueue.then(run);
  recoveryQueue = next.catch(() => {});
  return next;
}

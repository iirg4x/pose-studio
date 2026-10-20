import type { Track } from './model';
import type { MotionTolerance } from './sparseMotion';
import type {
  ImportedMotionResult,
  ImportMotionReply,
  ImportMotionRequest,
} from './importMotion.worker';

const abortError = () => {
  const error = Error('Import cancelled.');
  error.name = 'AbortError';
  return error;
};

/**
 * Fit imported dense tracks away from the React event loop. The worker uses
 * sparseMotion directly so quaternion cleanup, transform validation and
 * baked-noise detection remain identical to the synchronous import path.
 */
export function reduceImportedMotion(
  tracks: Record<string, Track>,
  tolerance: MotionTolerance,
  onProgress?: (completed: number, total: number, id: string) => void,
  signal?: AbortSignal,
): Promise<Record<string, ImportedMotionResult>> {
  const entries: ImportMotionRequest['entries'] = Object.entries(tracks)
    .filter(([, track]) => track.keys.length > 1)
    .map(([id, track]) => ({ id, keys: track.keys }));

  if (signal?.aborted) return Promise.reject(abortError());
  if (!entries.length) return Promise.resolve({});

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./importMotion.worker.ts', import.meta.url), {
      type: 'module',
    });
    let settled = false;
    let onAbort: (() => void) | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      callback();
    };
    worker.onmessage = (event: MessageEvent<ImportMotionReply>) => {
      const data = event.data;
      if ('error' in data) {
        finish(() => reject(Error(data.error)));
      } else if ('results' in data) {
        finish(() => resolve(data.results));
      } else {
        const completed = Math.min(entries.length, Math.round(data.progress * entries.length));
        onProgress?.(completed, entries.length, data.id);
      }
    };
    worker.onerror = (event) => {
      finish(() => reject(Error(event.message || 'Imported curve fitting could not finish.')));
    };
    onAbort = () => finish(() => reject(abortError()));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    try {
      worker.postMessage({ entries, tolerance } satisfies ImportMotionRequest);
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : Error(String(error))));
    }
  });
}

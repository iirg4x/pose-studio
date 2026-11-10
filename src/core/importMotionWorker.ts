import type { Track } from './model';
import type { MotionReduction, MotionTolerance } from './sparseMotion';
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
  options: MotionReduction = {},
): Promise<Record<string, ImportedMotionResult>> {
  const entries: ImportMotionRequest['entries'] = Object.entries(tracks)
    .filter(([, track]) => track.keys.length > 1)
    .map(([id, track]) => ({ id, keys: track.keys }));

  if (signal?.aborted) return Promise.reject(abortError());
  if (!entries.length) return Promise.resolve({});

  // Bones are independent, so spread them over the spare cores. One core is
  // left for the interface; the cap keeps memory bounded on large machines.
  const cores = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency || 2,
    count = Math.max(1, Math.min(entries.length, cores - 1, 8)),
    shares = Array.from({ length: count }, (_, share) =>
      entries.filter((_, index) => index % count === share),
    );

  return new Promise((resolve, reject) => {
    const workers: Worker[] = [],
      results: Record<string, ImportedMotionResult> = {};
    let settled = false,
      completed = 0,
      remaining = count;
    let onAbort: (() => void) | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      for (const worker of workers) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
      }
      callback();
    };
    onAbort = () => finish(() => reject(abortError()));
    signal?.addEventListener('abort', onAbort, { once: true });
    for (const share of shares) {
      if (settled) break;
      const worker = new Worker(new URL('./importMotion.worker.ts', import.meta.url), {
        type: 'module',
      });
      workers.push(worker);
      worker.onmessage = (event: MessageEvent<ImportMotionReply>) => {
        const data = event.data;
        if ('error' in data) {
          finish(() => reject(Error(data.error)));
        } else if ('results' in data) {
          Object.assign(results, data.results);
          if (--remaining === 0) finish(() => resolve(results));
        } else {
          completed = Math.min(entries.length, completed + 1);
          onProgress?.(completed, entries.length, data.id);
        }
      };
      worker.onerror = (event) => {
        finish(() => reject(Error(event.message || 'Imported curve fitting could not finish.')));
      };
      try {
        worker.postMessage({ entries: share, tolerance, options } satisfies ImportMotionRequest);
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : Error(String(error))));
      }
    }
  });
}

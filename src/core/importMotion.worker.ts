import { sparseMotion } from './sparseMotion';
import type { MotionReduction, MotionTolerance } from './sparseMotion';
import type { Key, Track } from './model';

export interface ImportMotionRequest {
  entries: { id: string; keys: Key[] }[];
  tolerance: MotionTolerance;
  options?: MotionReduction;
}

export type ImportedMotionResult = Pick<
  Track,
  'keys' | 'curves' | 'rotationMode' | 'interpolation'
>;

export type ImportMotionReply =
  | { progress: number; id: string }
  | { results: Record<string, ImportedMotionResult> }
  | { error: string };

self.onmessage = (event: MessageEvent<ImportMotionRequest>) => {
  try {
    const { entries, tolerance, options } = event.data;
    const results: Record<string, ImportedMotionResult> = {};
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      results[entry.id] = sparseMotion(entry.keys, tolerance, options);
      self.postMessage({
        progress: (i + 1) / entries.length,
        id: entry.id,
      } satisfies ImportMotionReply);
    }
    self.postMessage({ results } satisfies ImportMotionReply);
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    } satisfies ImportMotionReply);
  }
};

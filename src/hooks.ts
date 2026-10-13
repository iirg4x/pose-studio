import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { studio } from './core/store';
import type { StudioState } from './core/store';
/** Playback cursor redraws at display cadence without waking panels or tracks. */
export function useDisplayFrame() {
  const playing = useStudioSelector((s) => s.playing),
    frame = useStudioSelector((s) => s.frame);
  const smooth = useSyncExternalStore(
    studio.displayClock.subscribe,
    studio.displayClock.getSnapshot,
  );
  return playing ? smooth : frame;
}
export const useStudio = () => useSyncExternalStore(studio.subscribe, studio.getSnapshot);
// Chrome and inspectors have no playback cursor to paint. Keep their snapshot
// stable during frame-only notifications; transport/timeline subscribe normally.
export function useStudioChrome({
  frame = 'playback',
  edits = 'deferred',
}: { frame?: 'playback' | 'none'; edits?: 'live' | 'deferred' } = {}) {
  const cached = useRef(studio.state);
  const snapshot = useCallback(() => {
    const next = studio.state,
      old = cached.current;
    const transient =
      next.interacting && edits === 'deferred'
        ? new Set(['project', 'drafts', 'revision', 'message'])
        : new Set<string>();
    if (next.playing || frame === 'none') transient.add('frame');
    if (
      next !== old &&
      Object.keys(next).some(
        (k) => !transient.has(k) && next[k as keyof StudioState] !== old[k as keyof StudioState],
      )
    )
      cached.current = next;
    return cached.current;
  }, [frame, edits]);
  return useSyncExternalStore(studio.subscribe, snapshot);
}

// Subscribe only to values a tool displays, keeping pose data out of its renders.
export function useStudioSelector<T>(
  select: (state: StudioState) => T,
  equal: (a: T, b: T) => boolean = Object.is,
) {
  const selectRef = useRef(select),
    equalRef = useRef(equal),
    cache = useRef<{ value: T } | null>(null);
  selectRef.current = select;
  equalRef.current = equal;
  const snapshot = useCallback(() => {
    const value = selectRef.current(studio.state);
    if (!cache.current || !equalRef.current(cache.current.value, value)) cache.current = { value };
    return cache.current.value;
  }, []);
  return useSyncExternalStore(studio.subscribe, snapshot);
}
export function usePresence<T>(value: T | null, duration = 220) {
  const retained = useRef(value),
    [, refresh] = useState(0),
    visible = value !== null;
  if (visible) retained.current = value;
  useEffect(() => {
    if (visible || retained.current === null) return;
    const timer = setTimeout(
      () => {
        retained.current = null;
        refresh((n) => n + 1);
      },
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration,
    );
    return () => clearTimeout(timer);
  }, [visible, duration]);
  return { value: value ?? retained.current, exiting: !visible && retained.current !== null };
}

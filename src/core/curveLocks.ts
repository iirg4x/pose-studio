import type { Channel } from './curves';
import type { Track, Project, ControlId } from './model';
import { channelsFor, readCurve } from './curves';

/** This is an insertion lock. Existing keys and their tangents remain editable. */
export const curveKeyLocked = (track: Track, channel: Channel) =>
  !!(track.keyLock || track.lockedChannels?.includes(channel) || track.curves?.[channel]?.keyLock);
export const canInsertCurveKey = (track: Track, channel: Channel, frame: number) =>
  !curveKeyLocked(track, channel) ||
  readCurve(track, channel).keys.some((k) => Math.abs(k.frame - frame) < 1e-7);
export function lockCurveKeys(track: Track, id: ControlId, channel: Channel, locked: boolean) {
  const locks = new Set(track.lockedChannels ?? []);
  if (!locked && track.keyLock) {
    for (const c of channelsFor(id, track)) locks.add(c);
    delete track.keyLock;
  }
  locked ? locks.add(channel) : locks.delete(channel);
  track.lockedChannels = [...locks];
  if (track.curves?.[channel]) track.curves[channel]!.keyLock = locked;
}
export function lockControlKeys(track: Track, _id: ControlId, locked: boolean) {
  track.keyLock = locked;
  delete track.lockedChannels;
  for (const curve of Object.values(track.curves ?? {})) if (curve) curve.keyLock = locked;
}
/** Backstop for tools that replace a curve (Loop, cleanup, modifiers, etc.).
 * Retiming and deleting existing keys are allowed; key-generating tools are not. */
export function curveLockViolation(before: Project, after: Project): string | undefined {
  const stacks = (p: Project) =>
    p.layers?.map((l) => ({
      id: l.id,
      tracks: l.id === p.activeLayerId ? p.tracks : l.tracks,
    })) ?? [{ id: 'base', tracks: p.tracks }];
  for (const next of stacks(after)) {
    const old = stacks(before).find((l) => l.id === next.id);
    if (!old) continue;
    for (const id of Object.keys(next.tracks) as ControlId[]) {
      const a = old.tracks[id],
        b = next.tracks[id];
      if (!a || a === b) continue;
      if (a.keyLock && b.keyLock && b.keys.length > a.keys.length)
        return 'Keys are locked on this control. Edit an existing key or unlock it first.';
      for (const c of new Set([
        ...Object.keys(a.curves ?? {}),
        ...(a.lockedChannels ?? []),
      ]) as Set<Channel>) {
        if (!curveKeyLocked(a, c) || !curveKeyLocked(b, c)) continue;
        const ac = readCurve(a, c),
          bc = readCurve(b, c);
        if (bc.keys.length > ac.keys.length)
          return 'New keys are locked on this curve. Edit an existing key or unlock it first.';
      }
    }
  }
}

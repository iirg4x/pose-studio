import { canInsertCurveKey } from './curveLocks';
import { channelsFor, ensureCurve, keyCurveFromPose } from './curves';
import type { Channel } from './curves';
import { putKey } from './model';
import type { ControlId, Pose, Track } from './model';
export type KeyingSet =
  | 'available'
  | 'location'
  | 'rotation'
  | 'locrot'
  | 'properties'
  | 'all'
  | 'whole';
export const KEYING_SETS: { id: KeyingSet; label: string; key: string }[] = [
  { id: 'available', label: 'Available', key: 'A' },
  { id: 'location', label: 'Location', key: 'L' },
  { id: 'rotation', label: 'Rotation', key: 'R' },
  { id: 'locrot', label: 'Location & Rotation', key: 'O' },
  { id: 'properties', label: 'Custom Properties', key: 'C' },
  { id: 'all', label: 'All Channels', key: 'I' },
  { id: 'whole', label: 'Whole Rig', key: 'W' },
];
export function insertChannels(
  track: Track,
  id: ControlId,
  frame: number,
  value: Pose,
  set: KeyingSet,
) {
  if (set === 'all' || set === 'whole') {
    if (!channelsFor(id, track).some((c) => canInsertCurveKey(track, c, frame))) return false;
    putKey(track, frame, value);
    return true;
  }
  const available = channelsFor(id, track);
  let channels: Channel[];
  if (set === 'available') channels = Object.keys(track.curves ?? {}) as Channel[];
  else
    channels = available.filter((c) =>
      set === 'location'
        ? ['px', 'py', 'pz'].includes(c)
        : set === 'rotation'
          ? ['rx', 'ry', 'rz', 'qx', 'qy', 'qz', 'qw'].includes(c)
          : set === 'locrot'
            ? ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'qx', 'qy', 'qz', 'qw'].includes(c)
            : ['thumb', 'index', 'middle', 'ring', 'pinky', 'fov'].includes(c),
    );
  if (set === 'available' && !channels.length && track.keys.length > 1) channels = available;
  channels = channels.filter((c) => canInsertCurveKey(track, c, frame));
  for (const c of channels) ensureCurve(track, c);
  keyCurveFromPose(track, frame, value, channels);
  return channels.length > 0;
}

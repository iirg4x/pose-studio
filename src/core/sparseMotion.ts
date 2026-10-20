import { Quaternion, Vector3 } from 'three';
import { reduceTrack } from './curveReduction';
import { sample } from './model';
import type { ControlId, Key, Track } from './model';
import type { Channel, Curve } from './curves';

export interface MotionTolerance {
  /** Position error in metres. */
  position: number;
  /** Rotation error in radians. */
  rotation: number;
}

const IMPORT_TOLERANCE: MotionTolerance = {
  position: 0.0002,
  rotation: (Math.PI / 180) * 0.25,
};
const channels: Channel[] = ['px', 'py', 'pz', 'qx', 'qy', 'qz', 'qw'];

const copyKey = (key: Key): Key => ({
  ...key,
  p: [...key.p] as Key['p'],
  q: [...key.q] as Key['q'],
  grip: [...key.grip],
});

/** Keep imported bakes editable without making every channel share one set of
 * split times. Position and quaternion channels are reduced independently by
 * the same continuous curve fitter used by the in-app curve reducer. */
export function sparseMotion(
  keys: Key[],
  tolerance: MotionTolerance = IMPORT_TOLERANCE,
): Pick<Track, 'keys' | 'curves' | 'rotationMode' | 'interpolation'> {
  if (!keys.length) throw Error('Motion has no samples.');
  if (
    !(
      tolerance.position > 0 &&
      Number.isFinite(tolerance.position) &&
      tolerance.rotation > 0 &&
      Number.isFinite(tolerance.rotation)
    )
  )
    throw Error('Invalid key reduction tolerance.');

  const samples = keys.map(copyKey);
  for (const key of samples) {
    const q = new Quaternion(...key.q).normalize();
    key.q = q.toArray() as Key['q'];
  }
  // Quaternion channels represent one hemisphere. Unwrapping before creating
  // scalar curves prevents alternating signs from looking like giant turns.
  for (let i = 1; i < samples.length; i++) {
    if (new Quaternion(...samples[i - 1].q).dot(new Quaternion(...samples[i].q)) < 0)
      samples[i].q = samples[i].q.map((v) => -v) as Key['q'];
  }
  for (let i = 1; i < samples.length; i++)
    if (samples[i].frame <= samples[i - 1].frame) throw Error('Motion samples must be ordered.');

  const first = samples[0];
  const fallbackFlat = samples.every(
    (key) =>
      key.layerPosition === first.layerPosition &&
      key.fov === first.fov &&
      key.grip.every((value, index) => value === first.grip[index]),
  );

  // Imported skeletons contain many unchanged bones. Exact static transforms
  // need no curve fitting or repeated subframe scans; preserve any animated
  // fallback fields independently.
  if (
    samples.every(
      (key) =>
        key.p.every((value, index) => value === first.p[index]) &&
        key.q.every((value, index) => value === first.q[index]),
    )
  )
    return {
      keys: fallbackFlat ? [copyKey(first)] : samples,
      curves: Object.fromEntries(
        channels.map((channel, index) => [
          channel,
          {
            keys: [
              {
                frame: first.frame,
                value: index < 3 ? first.p[index] * 100 : first.q[index - 3],
                interpolation: 'linear',
                handle: 'free',
              },
            ],
            modifiers: [],
          },
        ]),
      ),
      rotationMode: 'quaternion',
      interpolation: 'linear',
    };

  const source: Track = {
    keys: samples,
    spaces: [],
    interpolation: 'linear',
    rotationMode: 'quaternion',
  };
  const end = samples.at(-1)!.frame;
  const positionTolerance = tolerance.position * 100;
  // Leave half the angular budget for quaternion normalization and the
  // assembled-transform validation. reduceTrack maps this to a conservative
  // per-component sin(theta / 4) bound.
  const rotationTolerance = (tolerance.rotation * 180 * 0.5) / Math.PI;
  const reduced = reduceTrack(
    {
      id: 'root' as ControlId,
      label: 'Imported motion',
      track: source,
      channels,
    },
    {
      position: positionTolerance,
      rotation: rotationTolerance,
      scalar: positionTolerance,
      fit: 'auto',
      skimHandles: true,
      preserveExtrema: true,
      detectNoise: true,
    },
    end,
  ).track;

  // Keep a snapshot of the reduced result so any cleanup remains immutable to
  // the caller's source keys and to the reduction implementation.
  const candidate: Track = {
    ...reduced,
    keys: reduced.keys.map(copyKey),
    curves: reduced.curves ? { ...reduced.curves } : undefined,
  };
  for (const channel of channels) {
    const curve = candidate.curves?.[channel];
    if (!curve || curve.keys.length <= 1) continue;
    const values = samples.map((key) =>
      channel.startsWith('q')
        ? key.q[['qx', 'qy', 'qz', 'qw'].indexOf(channel)]
        : key.p[['px', 'py', 'pz'].indexOf(channel)] * 100,
    );
    const limit = channel.startsWith('q')
      ? Math.sin((rotationTolerance * Math.PI) / 180 / 4) / 2
      : positionTolerance / Math.sqrt(3);
    // A tiny channel can still leave two endpoint keys after curve reduction.
    // Collapse only when its excursion is inside the per-channel budget and
    // the final value is exactly the authored start. A one-key curve replaces
    // the fallback at every frame, so never use it to erase a real endpoint.
    const firstValue = values[0],
      lastValue = values.at(-1)!;
    if (
      lastValue === firstValue &&
      Math.max(...values.map((value) => Math.abs(value - firstValue))) <= limit
    ) {
      const first = curve.keys[0];
      candidate.curves![channel] = {
        ...curve,
        keys: [{ ...first }],
      } as Curve;
    }
  }

  // Use the reduced track only when its complete transform remains within the
  // requested tolerance. This catches cross-channel quaternion normalization
  // effects and protects against an over-aggressive scalar flattening pass.
  const check = (track: Track) => {
    let position = 0;
    let rotation = 0;
    for (let frame = samples[0].frame; frame <= end; frame += 0.25) {
      const a = sample(source, frame);
      const b = sample(track, frame);
      position = Math.max(position, new Vector3(...a.p).distanceTo(new Vector3(...b.p)));
      rotation = Math.max(rotation, new Quaternion(...a.q).angleTo(new Quaternion(...b.q)));
      if (position > tolerance.position || rotation > tolerance.rotation) return false;
    }
    const a = sample(source, end);
    const b = sample(track, end);
    return (
      new Vector3(...a.p).distanceTo(new Vector3(...b.p)) <= tolerance.position &&
      new Quaternion(...a.q).angleTo(new Quaternion(...b.q)) <= tolerance.rotation
    );
  };
  if (!check(candidate)) {
    // A failed cleanup should not discard the independent fits that already
    // passed reduceTrack's transform check. If the unflattened reduction is
    // also invalid, retaining the original dense keys is safer than silently
    // changing imported motion.
    if (check(reduced))
      return {
        keys: reduced.keys,
        curves: reduced.curves,
        rotationMode: 'quaternion',
        interpolation: 'linear',
      };
    return {
      keys: samples,
      rotationMode: 'quaternion',
      interpolation: 'linear',
    };
  }

  const allFlat =
    fallbackFlat && channels.every((channel) => candidate.curves?.[channel]?.keys.length === 1);
  if (allFlat) candidate.keys = [copyKey(samples[0])];
  return {
    keys: candidate.keys,
    curves: candidate.curves,
    rotationMode: 'quaternion',
    interpolation: 'linear',
  };
}

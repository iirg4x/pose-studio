import { Quaternion, Vector3 } from 'three';
import { reduceTrack } from './curveReduction';
import { sample } from './model';
import { readCurve } from './curves';
import type { ControlId, Key, Track } from './model';
import type { Channel, Curve, CurveKey } from './curves';

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

const rotationChannels: Channel[] = ['qx', 'qy', 'qz', 'qw'];
/** Below this turn per sample, per-component interpolation and slerp agree to
 * well under a thousandth of a degree, so plain linear segments are exact
 * enough to describe the bake. */
const LINEAR_TURN = (12 * Math.PI) / 180;
/** A cubic follows a slerp arc of this size to within a hundredth of a degree. */
const CUBIC_TURN = (45 * Math.PI) / 180;
/** Channels whose whole excursion is below these floors carry only retarget
 * rounding, not motion. Units match the curves: centimetres and quaternion
 * components. */
const POSITION_NOISE = 1e-4;
const ROTATION_NOISE = 1e-6;

/**
 * Describe baked rotation as scalar curves that follow the same great-circle
 * path the keys do. Pose keys interpolate with slerp while curves interpolate
 * each component; for a slow turn the two agree, but a pose snap between two
 * samples does not. Fast spans therefore become cubic segments (subdivided for
 * very large turns) so the fitter and its validation see one consistent source.
 */
function rotationCurves(samples: Key[]): Record<string, Curve> {
  type Node = { frame: number; q: Quaternion; left?: number[]; right?: number[]; third?: number };
  const nodes: Node[] = [];
  for (let i = 0; i < samples.length; i++) {
    const a = new Quaternion(...samples[i].q),
      node: Node =
        nodes.at(-1)?.frame === samples[i].frame
          ? nodes.at(-1)!
          : { frame: samples[i].frame, q: a };
    if (nodes.at(-1) !== node) nodes.push(node);
    const next = samples[i + 1];
    if (!next) break;
    const b = new Quaternion(...next.q),
      half = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
    if (half * 2 <= LINEAR_TURN) continue;
    const parts = Math.max(1, Math.ceil((half * 2) / CUBIC_TURN)),
      length = (next.frame - samples[i].frame) / parts,
      angle = half / parts,
      cos = Math.cos(angle),
      rate = angle / (length * Math.sin(angle)),
      third = length / 3;
    let from = node;
    for (let part = 1; part <= parts; part++) {
      const to: Node =
        part === parts
          ? { frame: next.frame, q: b }
          : { frame: samples[i].frame + length * part, q: a.clone().slerp(b, part / parts) };
      from.third = third;
      from.right = [0, 1, 2, 3].map(
        (c) => rate * (to.q.toArray()[c] - from.q.toArray()[c] * cos) * third,
      );
      to.left = [0, 1, 2, 3].map(
        (c) => -rate * (to.q.toArray()[c] * cos - from.q.toArray()[c]) * third,
      );
      nodes.push(to);
      from = to;
    }
  }
  return Object.fromEntries(
    rotationChannels.map((channel, c) => [
      channel,
      {
        keys: nodes.map((node, i): CurveKey => {
          const before = nodes[i - 1]?.third;
          return {
            frame: node.frame,
            value: node.q.toArray()[c],
            interpolation: node.right ? 'bezier' : 'linear',
            handle: 'free',
            ...(node.left && before ? { left: [-before, node.left[c]] as [number, number] } : {}),
            ...(node.right ? { right: [node.third!, node.right[c]] as [number, number] } : {}),
          };
        }),
        modifiers: [],
      },
    ]),
  );
}

const copyKey = (key: Key): Key => ({
  ...key,
  p: [...key.p] as Key['p'],
  q: [...key.q] as Key['q'],
  grip: [...key.grip],
});

/** Keep imported bakes editable without making every channel share one set of
 * split times. Position and quaternion channels are reduced independently by
 * the same continuous curve fitter used by the in-app curve reducer. */
export interface MotionReduction {
  detectMotion?: boolean;
  /**
   * Give every channel of a control the same few keys, as an animator would set
   * poses, instead of fitting each channel with its own keys.
   */
  shared?: boolean;
}

/**
 * Pick the fewest sampled poses that reproduce the motion within tolerance when
 * every moving channel is keyed on them with automatic handles. Fitting each
 * channel alone needs fewer keys per curve, but they fall on different frames:
 * a control then shows a key on almost every frame and no single key is a pose.
 */
function sharedPoseKeys(
  samples: Key[],
  tolerance: MotionTolerance,
): Pick<Track, 'keys' | 'curves' | 'rotationMode' | 'interpolation'> {
  const value = (key: Key, index: number) => (index < 3 ? key.p[index] * 100 : key.q[index - 3]),
    moving = channels.map((_, index) => {
      let low = Infinity,
        high = -Infinity;
      for (const key of samples) {
        const v = value(key, index);
        low = Math.min(low, v);
        high = Math.max(high, v);
      }
      return high - low > (index < 3 ? POSITION_NOISE : ROTATION_NOISE);
    });
  const build = (chosen: number[]): Track => ({
    keys: chosen.map((i) => ({ ...copyKey(samples[i]), interpolation: undefined })),
    spaces: [],
    interpolation: 'smooth',
    rotationMode: 'quaternion',
    curves: Object.fromEntries(
      channels.map((channel, index) => [
        channel,
        {
          keys: (moving[index] ? chosen : [0]).map(
            (i): CurveKey => ({
              frame: samples[i].frame,
              value: value(samples[i], index),
              interpolation: 'bezier',
              handle: 'auto',
            }),
          ),
          modifiers: [],
        },
      ]),
    ),
  });
  const error = (track: Track, i: number) => {
    const fitted = sample(track, samples[i].frame);
    return Math.max(
      new Vector3(...samples[i].p).distanceTo(new Vector3(...fitted.p)) / tolerance.position,
      new Quaternion(...samples[i].q).angleTo(new Quaternion(...fitted.q)) / tolerance.rotation,
    );
  };
  /** The sample furthest outside tolerance between two of the chosen keys, if any. */
  const worst = (chosen: number[], from = 0, to = samples.length - 1) => {
    const track = build(chosen);
    let most = 1,
      at = -1;
    for (let i = from; i <= to; i++) {
      const e = error(track, i);
      if (e > most) {
        most = e;
        at = i;
      }
    }
    return at;
  };
  // Add the single worst sample until everything fits, so no key is spent on a
  // stretch its neighbours already describe.
  let chosen = [0, samples.length - 1];
  for (let at = worst(chosen); at >= 0; at = worst(chosen))
    chosen = [...chosen, at].sort((a, b) => a - b);
  // Keys added early can become redundant once later ones surround them. A key's
  // handles reach two keys to either side, so only that stretch needs rechecking.
  for (let k = 1; k < chosen.length - 1; ) {
    const without = chosen.filter((_, index) => index !== k);
    if (worst(without, chosen[Math.max(0, k - 2)], chosen[Math.min(chosen.length - 1, k + 2)]) < 0)
      chosen = without;
    else k++;
  }
  const track = build(chosen);
  return {
    keys: track.keys,
    curves: track.curves,
    rotationMode: 'quaternion',
    interpolation: 'smooth',
  };
}

export function sparseMotion(
  keys: Key[],
  tolerance: MotionTolerance = IMPORT_TOLERANCE,
  options: MotionReduction = {},
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

  if (options.shared) return sharedPoseKeys(samples, tolerance);

  const source: Track = {
    keys: samples,
    spaces: [],
    interpolation: 'linear',
    rotationMode: 'quaternion',
  };
  const end = samples.at(-1)!.frame;
  const positionTolerance = tolerance.position * 100;
  // reduceTrack maps this to a per-component sin(theta / 4) bound, which keeps
  // the assembled rotation within half of the value passed here. Passing 1.6
  // times the requested tolerance therefore spends at most 80% of it and
  // leaves the rest for the difference between curve and slerp evaluation.
  const rotationTolerance = (tolerance.rotation * 180 * 1.6) / Math.PI;
  // Fit from explicit curves rather than from the pose keys. Pose keys slerp
  // and curves interpolate per component, so a track that is only partly
  // converted would be judged against a different interpolation than the one
  // it will finally use and good fits would be rejected channel by channel.
  const fitSource: Track = {
    ...source,
    curves: {
      ...Object.fromEntries(
        (['px', 'py', 'pz'] as Channel[]).map((channel) => [channel, readCurve(source, channel)]),
      ),
      ...rotationCurves(samples),
    },
  };
  const dense = (): Pick<Track, 'keys' | 'curves' | 'rotationMode' | 'interpolation'> => ({
    keys: samples,
    rotationMode: 'quaternion',
    interpolation: 'linear',
  });
  let reduced: Track;
  try {
    reduced = reduceTrack(
      {
        id: 'root' as ControlId,
        label: 'Imported motion',
        track: fitSource,
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
        // Spring, bounce and elastic inference is an exhaustive search that
        // dominates import time and has nothing to find in sampled skeletal
        // animation. It stays available in the curve reducer.
        detectMotion: options.detectMotion === true,
      },
      end,
    ).track;
  } catch {
    // One bone that cannot be fitted must not cancel the whole import.
    return dense();
  }

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
      lastValue = values.at(-1)!,
      excursion = Math.max(...values.map((value) => Math.abs(value - firstValue)));
    if (
      (lastValue === firstValue && excursion <= limit) ||
      // Retargeting leaves rounding noise on channels that never move. It is
      // far below anything visible, so it must not become a pair of keys.
      excursion <= Math.min(limit, channel.startsWith('q') ? ROTATION_NOISE : POSITION_NOISE)
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
    return dense();
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

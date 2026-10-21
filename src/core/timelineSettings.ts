import {
  channelsFor,
  readCurve,
  closeCurveLoop,
  explicitLoopCurve,
  CHANNEL_LABELS,
} from './curves';
import type { Channel, CurveKey, HandleMode } from './curves';
import { clone } from './model';
import type { ControlId, Project, Track } from './model';
import { motionOptions } from './interpolation';
import type { MotionOptions } from './interpolation';
import type { TimelineKey } from './timelineKeys';

const DISPLAY_UNIT_CHANNELS = new Set([
  'px',
  'py',
  'pz',
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
]);
const channelUnitScale = (channel: Channel) => (DISPLAY_UNIT_CHANNELS.has(channel) ? 100 : 1);

/**
 * Curve keys use the graph's display units (cm/percent), while pose keys and
 * track settings use native pose units (metres/fractions). Keep this boundary
 * explicit when a shared interpolation setting is copied between them.
 */
export function curveMotionOptions(options: MotionOptions, channel: Channel): MotionOptions {
  const next = motionOptions(options),
    scale = channelUnitScale(channel);
  if (next.elastic && scale !== 1)
    next.elastic = { ...next.elastic, amplitude: next.elastic.amplitude * scale };
  return next;
}

function poseMotionOptions(options: MotionOptions, channel: Channel): MotionOptions {
  const next = motionOptions(options),
    scale = channelUnitScale(channel);
  if (next.elastic && scale !== 1)
    next.elastic = { ...next.elastic, amplitude: next.elastic.amplitude / scale };
  return next;
}

export type KeySettings = MotionOptions & {
  interpolation?: CurveKey['interpolation'];
  handle?: HandleMode;
  loop?: boolean;
};
export type SegmentKind = CurveKey['interpolation'] | 'hold' | 'mixed';
export const INTERPOLATION_NAMES: Record<SegmentKind, string> = {
  loop: 'Loop',
  bezier: 'Bézier',
  linear: 'Linear',
  step: 'Constant',
  sine: 'Sinusoidal',
  quad: 'Quadratic',
  cubic: 'Cubic',
  quart: 'Quartic',
  quint: 'Quintic',
  expo: 'Exponential',
  circ: 'Circular',
  back: 'Back',
  blenderBounce: 'Bounce',
  elastic: 'Elastic',
  spring: 'Spring',
  bounce: 'Bounce (legacy)',
  hold: 'Hold',
  mixed: 'Mixed channels',
};
export function selectedCurveKeys(project: Project, selection: TimelineKey[]) {
  return selection.flatMap(({ id, frame }) =>
    channelsFor(id, project.tracks[id]).flatMap((c) =>
      readCurve(project.tracks[id], c).keys.filter((k) => k.frame === frame),
    ),
  );
}
export function applyKeySettings(
  project: Project,
  selection: TimelineKey[],
  settings: KeySettings,
) {
  const next = clone(project);
  for (const id of new Set(selection.map((k) => k.id))) {
    const track = next.tracks[id],
      frames = new Set(selection.filter((k) => k.id === id).map((k) => k.frame)),
      channels = channelsFor(id, track),
      poseChannel = channels.find((channel) =>
        readCurve(track, channel).keys.some((key) => frames.has(key.frame)),
      );
    const { handle, interpolation, loop, ...motion } = settings,
      closing = interpolation === 'loop' || loop === true;
    // Motion options are interpreted in the display units of the first
    // selected curve (for example, centimetres for a position curve). The
    // pose key and each destination curve may use different native units, so
    // keep only the non-motion key settings here and project the motion
    // options separately for every channel below.
    const keySettings = {
      ...(handle !== undefined ? { handle } : {}),
      ...(interpolation !== undefined ? { interpolation } : {}),
    };
    const nativeMotion = poseChannel
      ? poseMotionOptions(motion, poseChannel)
      : motionOptions(motion);
    for (const key of track.keys)
      if (frames.has(key.frame)) {
        Object.assign(key, clone(nativeMotion));
        if (interpolation && interpolation !== 'loop')
          key.interpolation = interpolation === 'bezier' ? 'smooth' : interpolation;
      }
    for (const channel of channels) {
      // Pose interpolation stays on the pose key, retaining quaternion slerp on
      // untouched segments. Only explicit tangent edits create new channel curves.
      if (!track.curves?.[channel] && !handle && !closing) continue;
      const curve = readCurve(track, channel);
      if (!curve.keys.some((k) => frames.has(k.frame))) continue;
      track.curves ??= {};
      track.curves[channel] = curve;
      if (closing) {
        const range = project.loop ?? { start: 0, end: project.end };
        closeCurveLoop(curve, range.start, range.end);
      } else {
        if (
          curve.loop &&
          (loop === false ||
            (interpolation && (frames.has(curve.loop.start) || frames.has(curve.loop.end))))
        ) {
          curve.keys = explicitLoopCurve(curve).keys;
          delete curve.loop;
        }
        const projectedMotion = curveMotionOptions(nativeMotion, channel);
        for (const key of curve.keys)
          if (frames.has(key.frame))
            Object.assign(key, clone({ ...projectedMotion, ...keySettings }));
      }
    }
  }
  return next;
}
export function segmentInterpolation(id: ControlId, track: Track, from: number, to: number) {
  const kinds = new Set<SegmentKind>(),
    details: string[] = [],
    modifiers = new Set<string>();
  for (const channel of channelsFor(id, track)) {
    const curve = readCurve(track, channel);
    let frame = (from + to) / 2;
    for (const modifier of curve.modifiers) if (modifier.enabled) modifiers.add(modifier.type);
    const first = curve.keys[0],
      last = curve.keys.at(-1)!;
    const cycle = curve.modifiers.find((m) => m.type === 'cycles' && m.enabled);
    if (cycle?.type === 'cycles' && last.frame > first.frame) {
      const mode = frame < first.frame ? cycle.before : frame > last.frame ? cycle.after : 'none';
      if (mode !== 'none') {
        const span = last.frame - first.frame,
          n = Math.floor((frame - first.frame) / span),
          fraction = frame - first.frame - n * span;
        frame =
          first.frame + (mode === 'mirror' && Math.abs(n) % 2 === 1 ? span - fraction : fraction);
      }
    }
    const index = curve.keys.findIndex(
      (k, i) => k.frame <= frame && i < curve.keys.length - 1 && curve.keys[i + 1].frame > frame,
    );
    if (index < 0) continue;
    const kind = curve.keys[index].interpolation;
    kinds.add(kind);
    details.push(CHANNEL_LABELS[channel] + ': ' + INTERPOLATION_NAMES[kind]);
  }
  const kind: SegmentKind = kinds.size > 1 ? 'mixed' : (kinds.values().next().value ?? 'hold');
  return {
    kind,
    modified: modifiers.size > 0,
    title: `${INTERPOLATION_NAMES[kind]} · frames ${from}–${to}${details.length ? '\n' + details.join('\n') : ''}${modifiers.size ? '\nModifiers: ' + [...modifiers].join(', ') : ''}`,
  };
}

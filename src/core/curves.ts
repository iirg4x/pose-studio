import { copyPose } from './poseCopy';
import { loopBoundarySlope, normalizeLoopKeys, syncLoopSeam } from './loopInterpolation';
import { randomId } from './crypto';
import { motionProgress, motionOptions, validateMotionOptions } from './interpolation';
import type { MotionOptions } from './interpolation';
import { Euler, Quaternion } from 'three';
import type { EulerOrder } from 'three';
import type { Pose, Track, ControlId } from './model';
import { blenderNoise } from './blenderNoise';
import type { BlenderNoiseSettings } from './blenderNoise';
import { BLEND_CHANNELS, BLEND_LABELS, isBlendChannel, blendDefault } from './blendChannels';
const POSE_CHANNELS = [
  'px',
  'py',
  'pz',
  'rx',
  'ry',
  'rz',
  'thumb',
  'index',
  'middle',
  'ring',
  'pinky',
  'fov',
  'qw',
  'qx',
  'qy',
  'qz',
] as const;
export const CHANNELS = [...POSE_CHANNELS, ...BLEND_CHANNELS] as const;
export type Channel = (typeof CHANNELS)[number];
export type HandleMode = 'flat' | 'auto' | 'clamped' | 'vector' | 'aligned' | 'free';
export interface CurveKey extends MotionOptions {
  frame: number;
  value: number;
  interpolation: 'bezier' | 'linear' | 'step' | 'spring' | 'bounce' | 'loop';
  handle: HandleMode;
  left?: [number, number];
  right?: [number, number];
}
type CycleMode = 'none' | 'repeat' | 'offset' | 'mirror';
export type Modifier = (
  | { id: string; type: 'cycles'; enabled: boolean; before: CycleMode; after: CycleMode }
  | ({
      id: string;
      type: 'noise';
      enabled: boolean;
      amplitude: number;
      period: number;
      phase: number;
      seed: number;
      algorithm?: 'smooth' | 'blender';
    } & BlenderNoiseSettings)
  | { id: string; type: 'sine'; enabled: boolean; amplitude: number; period: number; phase: number }
  | { id: string; type: 'scale'; enabled: boolean; factor: number; offset: number }
  | { id: string; type: 'limits'; enabled: boolean; min: number; max: number }
) & { loop?: { start: number; end: number } };
export interface Curve {
  keyLock?: boolean;
  keys: CurveKey[];
  modifiers: Modifier[];
  loop?: { start: number; end: number };
}
export const CHANNEL_LABELS: Record<Channel, string> = {
  ...BLEND_LABELS,
  px: 'Position X',
  py: 'Position Y',
  pz: 'Position Z',
  rx: 'Rotation X',
  ry: 'Rotation Y',
  rz: 'Rotation Z',
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  pinky: 'Pinky',
  fov: 'Field of view',
  qw: 'Quaternion W',
  qx: 'Quaternion X',
  qy: 'Quaternion Y',
  qz: 'Quaternion Z',
};
export const channelUnit = (c: Channel) =>
  c.startsWith('q')
    ? ''
    : c.startsWith('p') && c !== 'pinky'
      ? 'cm'
      : (c.startsWith('r') && c !== 'ring') || c === 'fov'
        ? '°'
        : '%';
export const channelColor = (c: Channel) =>
  c.endsWith('x')
    ? '#df7a77'
    : c.endsWith('y')
      ? '#83bb89'
      : c.endsWith('z')
        ? '#75a9df'
        : '#d2aa70';
export function channelsFor(id: ControlId, track?: Track): Channel[] {
  return [
    ...CHANNELS.slice(0, 3),
    ...(track?.rotationMode === 'quaternion' ? POSE_CHANNELS.slice(12) : CHANNELS.slice(3, 6)),
    ...(id.startsWith('hand') ? CHANNELS.slice(6, 11) : []),
    ...(id === 'camera' ? ['fov' as Channel] : []),
    ...BLEND_CHANNELS.filter((c) => !!track?.curves?.[c]),
  ];
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function channelValue(p: Pose, c: Channel, order: EulerOrder = 'XYZ'): number {
  if (isBlendChannel(c)) return blendDefault(c);
  if (['px', 'py', 'pz'].includes(c)) return p.p[['px', 'py', 'pz'].indexOf(c)] * 100;
  if (['rx', 'ry', 'rz'].includes(c)) {
    const e = new Euler().setFromQuaternion(new Quaternion(...p.q), order);
    return ([e.x, e.y, e.z][['rx', 'ry', 'rz'].indexOf(c)] * 180) / Math.PI;
  }
  if (c.startsWith('q')) return p.q[['qx', 'qy', 'qz', 'qw'].indexOf(c)];
  if (c === 'fov') return p.fov;
  return p.grip[CHANNELS.indexOf(c) - 6] * 100;
}
export function baseSample(track: Track, frame: number): Pose {
  const ks = track.keys;
  let a = ks[0],
    b = a;
  for (let i = 0; i < ks.length; i++) {
    if (ks[i].frame <= frame) a = ks[i];
    else {
      b = ks[i];
      break;
    }
    b = a;
  }
  const mode = a.interpolation ?? track.interpolation;
  if (a === b || frame <= a.frame || mode === 'step') return copyPose(a);
  let t = clamp((frame - a.frame) / (b.frame - a.frame), 0, 1);
  if (mode === 'smooth') t = t * t * (3 - 2 * t);
  else if (mode === 'spring' || mode === 'bounce') t = motionProgress(mode, t, { ...track, ...a });
  return {
    p: a.p.map((v, i) => v + (b.p[i] - v) * t) as Pose['p'],
    q: new Quaternion(...a.q)
      .slerp(new Quaternion(...b.q), t)
      .normalize()
      .toArray() as Pose['q'],
    grip: a.grip.map((v, i) =>
      clamp(v + (b.grip[i] - v) * t, track.additive ? -2 : -1, track.additive ? 2 : 1),
    ),
    fov: track.additive ? a.fov + (b.fov - a.fov) * t : clamp(a.fov + (b.fov - a.fov) * t, 20, 120),
  };
}
export function readCurve(track: Track, c: Channel): Curve {
  if (track.curves?.[c]) return track.curves[c]!;
  if (isBlendChannel(c))
    return {
      keys: [{ frame: 0, value: blendDefault(c), interpolation: 'bezier', handle: 'flat' }],
      modifiers: [],
    };
  let previous: number | undefined;
  return {
    keys: track.keys.map((k) => {
      let value = channelValue(k, c, track.rotationOrder);
      if (['rx', 'ry', 'rz'].includes(c) && previous !== undefined)
        value += Math.round((previous - value) / 360) * 360;
      previous = value;
      const mode = k.interpolation ?? track.interpolation;
      return {
        ...motionOptions({ ...track, ...k }),
        frame: k.frame,
        value,
        interpolation: mode === 'smooth' ? 'bezier' : mode,
        handle: 'flat',
      };
    }),
    modifiers: [],
  };
}
export function ensureCurve(track: Track, c: Channel): Curve {
  const ids: Channel[] = ['rx', 'ry', 'rz'].includes(c)
    ? ['rx', 'ry', 'rz']
    : c.startsWith('q')
      ? ['qx', 'qy', 'qz', 'qw']
      : [c];
  for (const id of ids) {
    const curve = structuredClone(readCurve(track, id));
    track.curves ??= {};
    track.curves[id] ??= curve;
  }
  return track.curves![c]!;
}
function slope(curve: Curve, i: number): number {
  const ks = curve.keys,
    k = ks[i];
  let a = ks[i - 1],
    b = ks[i + 1];
  const cycle = curve.modifiers.find((m) => m.type === 'cycles' && m.enabled);
  if (
    cycle?.type === 'cycles' &&
    ks.length > 2 &&
    ['repeat', 'offset'].includes(cycle.before) &&
    cycle.before === cycle.after
  ) {
    const length = ks.at(-1)!.frame - ks[0].frame,
      delta = cycle.before === 'offset' ? ks.at(-1)!.value - ks[0].value : 0;
    if (i === 0)
      a = {
        ...ks[ks.length - 2],
        frame: ks[ks.length - 2].frame - length,
        value: ks[ks.length - 2].value - delta,
      };
    if (i === ks.length - 1)
      b = { ...ks[1], frame: ks[1].frame + length, value: ks[1].value + delta };
  }
  if (!a && !b) return 0;
  if (!a) return (b.value - k.value) / (b.frame - k.frame);
  if (!b) return (k.value - a.value) / (k.frame - a.frame);
  const left = (k.value - a.value) / (k.frame - a.frame),
    right = (b.value - k.value) / (b.frame - k.frame);
  let s = (b.value - a.value) / (b.frame - a.frame);
  if (k.handle === 'clamped') {
    if (left * right <= 0) return 0;
    s = Math.sign(s) * Math.min(Math.abs(s), 3 * Math.abs(left), 3 * Math.abs(right));
  }
  return s;
}
export function handles(
  curve: Curve,
  i: number,
  ordinary = false,
): { left: [number, number]; right: [number, number] } {
  const ks = curve.keys,
    k = ks[i],
    a = ks[i - 1],
    b = ks[i + 1],
    ld = (k.frame - (a?.frame ?? k.frame - 12)) / 3,
    rd = ((b?.frame ?? k.frame + 12) - k.frame) / 3;
  if (k.handle === 'free' || k.handle === 'aligned') {
    const limit = (v: [number, number] | undefined, dx: number, max: number): [number, number] => {
      const raw = v ?? [dx, 0],
        x = Math.sign(dx) * clamp(Math.abs(raw[0]), 0.001, max);
      return [x, raw[1] * (raw[0] === 0 ? 1 : x / raw[0])];
    };
    return { left: limit(k.left, -ld, ld * 3), right: limit(k.right, rd, rd * 3) };
  }
  if (k.handle === 'vector')
    return {
      left: [-ld, a ? (a.value - k.value) / 3 : 0],
      right: [rd, b ? (b.value - k.value) / 3 : 0],
    };
  const seam =
    !ordinary &&
    k.interpolation === 'loop' &&
    (k.frame === curve.loop?.start || k.frame === curve.loop?.end);
  const s =
    k.handle === 'flat'
      ? 0
      : seam
        ? loopBoundarySlope(curve, (index) => handles(curve, index, true))
        : slope(curve, i);
  return { left: [-ld, -s * ld], right: [rd, s * rd] };
}
const bez = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};
export function baseCurve(curve: Curve, frame: number): number {
  const ks = curve.keys;
  if (frame <= ks[0].frame) return ks[0].value;
  if (frame >= ks.at(-1)!.frame) return ks.at(-1)!.value;
  let i = 0;
  while (ks[i + 1].frame <= frame) i++;
  const a = ks[i],
    b = ks[i + 1];
  if (a.interpolation === 'step') return a.value;
  if (a.interpolation === 'linear')
    return a.value + ((b.value - a.value) * (frame - a.frame)) / (b.frame - a.frame);
  if (a.interpolation === 'spring' || a.interpolation === 'bounce')
    return (
      a.value +
      (b.value - a.value) *
        motionProgress(a.interpolation, (frame - a.frame) / (b.frame - a.frame), a)
    );
  const h1 = handles(curve, i).right,
    h2 = handles(curve, i + 1).left;
  // Blender shortens overlapping handles proportionally before evaluating Bezier time.
  const span = b.frame - a.frame,
    total = h1[0] - h2[0];
  if (total > span) {
    const ratio = span / total;
    h1[0] *= ratio;
    h1[1] *= ratio;
    h2[0] *= ratio;
    h2[1] *= ratio;
  }
  if (Math.abs(h1[0] - span / 3) < 1e-10 && Math.abs(h2[0] + span / 3) < 1e-10)
    return bez(a.value, a.value + h1[1], b.value + h2[1], b.value, (frame - a.frame) / span);
  let lo = 0,
    hi = 1;
  for (let n = 0; n < 24; n++) {
    const t = (lo + hi) / 2;
    if (bez(a.frame, a.frame + h1[0], b.frame + h2[0], b.frame, t) < frame) lo = t;
    else hi = t;
  }
  return bez(a.value, a.value + h1[1], b.value + h2[1], b.value, (lo + hi) / 2);
}
function noise(frame: number, period: number, phase: number, seed: number) {
  const x = (frame + phase) / period,
    i = Math.floor(x),
    t = x - i,
    u = t * t * (3 - 2 * t);
  const hash = (n: number) => {
    const v = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453123;
    return (v - Math.floor(v)) * 2 - 1;
  };
  return hash(i) + (hash(i + 1) - hash(i)) * u;
}
const noiseValue = (frame: number, m: Extract<Modifier, { type: 'noise' }>) =>
  m.amplitude *
  (m.algorithm === 'blender' ? blenderNoise(frame, m) : noise(frame, m.period, m.phase, m.seed));
/** Periodic crossfade matches both value and slope, without changing imported noise. */
export function proceduralValue(
  frame: number,
  m: Extract<Modifier, { type: 'noise' | 'sine' }>,
): number {
  const value = (f: number) =>
    m.type === 'noise'
      ? noiseValue(f, m)
      : m.amplitude * Math.sin((2 * Math.PI * f) / m.period + (m.phase * Math.PI) / 180);
  if (!m.loop) return value(frame);
  const { start, end } = m.loop,
    span = end - start;
  if (span <= 0) return value(frame);
  const t = (((frame - start) % span) + span) % span,
    u = t / span,
    blend = u * u * u * (u * (u * 6 - 15) + 10);
  const result = value(start + t) * (1 - blend) + value(start + t - span) * blend;
  // A restricted Blender modifier can have a hard cut exactly at the seam.
  // Close that envelope too; wrapping the noise alone would retain its jump.
  if (m.type === 'noise' && m.rangeStart !== undefined) {
    const edge = Math.min(5, span * 0.1),
      smooth = (x: number) => {
        x = Math.max(0, Math.min(1, x));
        return x * x * x * (x * (x * 6 - 15) + 10);
      };
    return result * smooth(t / edge) * smooth((span - t) / edge);
  }
  return result;
}
export function sampleCurve(curve: Curve, frame: number): number {
  let f = frame,
    offset = 0;
  const cycle = curve.modifiers.find((m) => m.type === 'cycles' && m.enabled);
  if (cycle?.type === 'cycles' && curve.keys.length > 1) {
    const first = curve.keys[0],
      last = curve.keys.at(-1)!,
      span = last.frame - first.frame,
      mode = frame < first.frame ? cycle.before : frame > last.frame ? cycle.after : 'none';
    if (mode !== 'none' && span > 0) {
      const n = Math.floor((frame - first.frame) / span),
        fraction = frame - first.frame - n * span;
      f = first.frame + (mode === 'mirror' && Math.abs(n) % 2 === 1 ? span - fraction : fraction);
      if (mode === 'offset') offset = n * (last.value - first.value);
    }
  }
  let value = baseCurve(curve, f) + offset;
  for (const m of curve.modifiers) {
    if (!m.enabled) continue;
    if (m.type === 'noise' || m.type === 'sine') value += proceduralValue(frame, m);
    if (m.type === 'scale') value = value * m.factor + m.offset;
    if (m.type === 'limits') value = clamp(value, m.min, m.max);
  }
  return value;
}
export function sampleChannels(track: Track, frame: number, base: Pose): Pose {
  if (!track.curves || !Object.keys(track.curves).length) return base;
  const p = copyPose(base),
    angles = new Euler().setFromQuaternion(new Quaternion(...p.q), track.rotationOrder ?? 'XYZ'),
    rotation = [angles.x, angles.y, angles.z];
  let rotated = false,
    quaternion = false;
  for (const c of POSE_CHANNELS) {
    const curve = track.curves[c];
    if (!curve) continue;
    const v = sampleCurve(curve, frame);
    if (['px', 'py', 'pz'].includes(c)) p.p[['px', 'py', 'pz'].indexOf(c)] = v / 100;
    else if (['rx', 'ry', 'rz'].includes(c)) {
      rotation[['rx', 'ry', 'rz'].indexOf(c)] = (v * Math.PI) / 180;
      rotated = true;
    } else if (c.startsWith('q')) {
      p.q[['qx', 'qy', 'qz', 'qw'].indexOf(c)] = v;
      quaternion = true;
    } else if (c === 'fov') p.fov = track.additive ? v : clamp(v, 20, 120);
    else
      p.grip[CHANNELS.indexOf(c) - 6] = clamp(
        v / 100,
        track.additive ? -2 : -1,
        track.additive ? 2 : 1,
      );
  }
  if (quaternion && track.rotationMode === 'quaternion')
    p.q = new Quaternion(...p.q).normalize().toArray() as Pose['q'];
  else if (rotated)
    p.q = new Quaternion()
      .setFromEuler(
        new Euler(...(rotation as [number, number, number]), track.rotationOrder ?? 'XYZ'),
      )
      .normalize()
      .toArray() as Pose['q'];
  return p;
}
export function channelSample(track: Track, c: Channel, frame: number) {
  if (track.curves?.[c]) return sampleCurve(track.curves[c]!, frame);
  let v = channelValue(baseSample(track, frame), c, track.rotationOrder);
  if (['rx', 'ry', 'rz'].includes(c))
    v += Math.round((baseCurve(readCurve(track, c), frame) - v) / 360) * 360;
  return v;
}
/** Sample the incoming segment in its current attachment space. The actual boundary
 * key stays in the new space; only its incoming endpoint and tangents are converted. */
export function sampleIncoming(
  track: Track,
  frame: number,
  boundary: number,
  incoming: Pose,
): Pose {
  const next: Track = {
    ...track,
    keys: track.keys.map((k) => (k.frame === boundary ? { ...incoming, frame: boundary } : k)),
    curves: { ...track.curves },
  };
  for (const c of Object.keys(track.curves ?? {}) as Channel[]) {
    if (isBlendChannel(c)) continue;
    const curve = track.curves![c]!,
      i = curve.keys.findIndex((k) => k.frame === boundary);
    if (i < 1 || frame < curve.keys[i - 1].frame) continue;
    const a = curve.keys[i - 1],
      b = curve.keys[i];
    let value = channelValue(incoming, c, track.rotationOrder);
    if (['rx', 'ry', 'rz'].includes(c)) value += Math.round((b.value - value) / 360) * 360;
    // Keep the authored easing profile, expressed between endpoints in one space.
    const ratio = Math.abs(b.value - a.value) > 1e-8 ? (value - a.value) / (b.value - a.value) : 0;
    const ha = handles(curve, i - 1),
      hb = handles(curve, i),
      keys = curve.keys.map((k) => ({ ...k }));
    keys[i - 1] = {
      ...a,
      handle: 'free',
      left: ha.left,
      right: [ha.right[0], ha.right[1] * ratio],
    };
    keys[i] = {
      ...b,
      value,
      handle: 'free',
      left: [hb.left[0], hb.left[1] * ratio],
      right: hb.right,
    };
    next.curves![c] = { ...curve, keys };
  }
  return sampleChannels(next, frame, baseSample(next, frame));
}
export function keyCurveFromPose(
  track: Track,
  frame: number,
  value: Pose,
  channels: readonly Channel[] = CHANNELS,
) {
  for (const c of channels) {
    if (isBlendChannel(c)) continue;
    const curve = track.curves?.[c];
    if (!curve) continue;
    let v = channelValue(value, c, track.rotationOrder);
    if (['rx', 'ry', 'rz'].includes(c))
      v += Math.round((sampleCurve(curve, frame) - v) / 360) * 360;
    // Invert additive modifiers so a viewport edit keys the visible pose once.
    for (const m of [...curve.modifiers].reverse()) {
      if (!m.enabled) continue;
      if (m.type === 'noise' || m.type === 'sine') v -= proceduralValue(frame, m);
      if (m.type === 'scale')
        v = m.factor === 0 ? baseCurve(curve, frame) : (v - m.offset) / m.factor;
    }
    const previousKeys = curve.keys;
    const existing = curve.keys.find((k) => k.frame === frame);
    if ((track.keyLock || track.lockedChannels?.includes(c) || curve.keyLock) && !existing)
      continue;
    const previous = curve.keys.filter((k) => k.frame < frame).at(-1) ?? curve.keys[0];
    const k: CurveKey = existing
      ? { ...existing, value: v }
      : {
          ...motionOptions(previous ?? track),
          frame,
          value: v,
          interpolation:
            previous?.interpolation ??
            (track.interpolation === 'smooth' ? 'bezier' : track.interpolation),
          handle: 'clamped',
        };
    curve.keys = curve.keys
      .filter((k) => k.frame !== frame)
      .concat(k)
      .sort((a, b) => a.frame - b.frame);
    syncLoopSeam(curve, previousKeys);
  }
}
export function modifier(type: Modifier['type']): Modifier {
  const base = { id: randomId(), enabled: true };
  if (type === 'cycles') return { ...base, type, before: 'repeat', after: 'repeat' };
  if (type === 'noise')
    return {
      ...base,
      type,
      algorithm: 'blender',
      amplitude: 1,
      period: 12,
      phase: 1,
      seed: 1,
      offset: 0,
      depth: 1,
      roughness: 0.5,
      lacunarity: 2,
      blendIn: 0,
      blendOut: 0,
    };
  if (type === 'sine') return { ...base, type, amplitude: 1, period: 24, phase: 0 };
  if (type === 'scale') return { ...base, type, factor: 1, offset: 0 };
  return { ...base, type, min: -100, max: 100 };
}
export function validateCurves(track: Track) {
  if (track.curves === undefined) return;
  if (!track.curves || typeof track.curves !== 'object' || Array.isArray(track.curves))
    throw Error('Invalid channel curves.');
  const finite = (n: unknown, limit = 1e7) =>
    typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit;
  for (const [c, curve] of Object.entries(track.curves)) {
    if (
      !CHANNELS.includes(c as Channel) ||
      !curve ||
      !Array.isArray(curve.keys) ||
      !curve.keys.length ||
      curve.keys.length > 5000 ||
      !Array.isArray(curve.modifiers) ||
      curve.modifiers.length > 20
    )
      throw Error('Invalid channel curve.');
    if (
      curve.loop &&
      (!Number.isFinite(curve.loop.start) ||
        !Number.isFinite(curve.loop.end) ||
        curve.loop.start < 0 ||
        curve.loop.end > 2400 ||
        curve.loop.end <= curve.loop.start ||
        !curve.keys.some((k) => k.frame === curve.loop!.start) ||
        !curve.keys.some((k) => k.frame === curve.loop!.end))
    )
      throw Error('Invalid curve loop.');
    if (curve.keyLock !== undefined && typeof curve.keyLock !== 'boolean')
      throw Error('Invalid curve key lock.');
    normalizeLoopKeys(curve);
    let last = -1;
    for (const k of curve.keys) {
      if (
        !Number.isFinite(k.frame) ||
        k.frame < 0 ||
        k.frame > 2400 ||
        k.frame <= last ||
        !finite(k.value) ||
        !['bezier', 'linear', 'step', 'spring', 'bounce', 'loop'].includes(k.interpolation) ||
        !['flat', 'auto', 'clamped', 'vector', 'aligned', 'free'].includes(k.handle)
      )
        throw Error('Invalid curve key.');
      last = k.frame;
      validateMotionOptions(k);
      for (const h of [k.left, k.right])
        if (h !== undefined && (!Array.isArray(h) || h.length !== 2 || !h.every((n) => finite(n))))
          throw Error('Invalid tangent.');
    }
    const ids = new Set<string>();
    let cycles = 0;
    for (const m of curve.modifiers) {
      if (
        !m ||
        typeof m.id !== 'string' ||
        m.id.length > 100 ||
        ids.has(m.id) ||
        typeof m.enabled !== 'boolean'
      )
        throw Error('Invalid curve modifier.');
      ids.add(m.id);
      if (
        m.loop &&
        (!['noise', 'sine'].includes(m.type) ||
          !Number.isInteger(m.loop.start) ||
          !Number.isInteger(m.loop.end) ||
          m.loop.start < 0 ||
          m.loop.end > 2400 ||
          m.loop.end <= m.loop.start)
      )
        throw Error('Invalid modifier loop range.');
      if (m.type === 'cycles') {
        cycles++;
        if (
          cycles > 1 ||
          curve.modifiers[0] !== m ||
          ![m.before, m.after].every((v) => ['none', 'repeat', 'offset', 'mirror'].includes(v))
        )
          throw Error('Invalid cycle modifier.');
      } else if (m.type === 'noise' || m.type === 'sine') {
        if (
          !finite(m.amplitude, 1e5) ||
          !finite(m.period, 1e5) ||
          m.period < 0.01 ||
          !finite(m.phase) ||
          (m.type === 'noise' && (!Number.isInteger(m.seed) || !finite(m.seed)))
        )
          throw Error('Invalid procedural modifier.');
        if (m.type === 'noise') {
          if (m.algorithm !== undefined && !['smooth', 'blender'].includes(m.algorithm))
            throw Error('Invalid noise algorithm.');
          for (const key of [
            'offset',
            'depth',
            'roughness',
            'lacunarity',
            'rangeStart',
            'rangeEnd',
            'blendIn',
            'blendOut',
          ] as const)
            if (m[key] !== undefined && !finite(m[key])) throw Error('Invalid noise setting.');
          if (
            (m.depth !== undefined &&
              (!Number.isInteger(m.depth) || m.depth < 0 || m.depth > 16)) ||
            (m.roughness !== undefined && (m.roughness < 0 || m.roughness > 10)) ||
            (m.lacunarity !== undefined && (m.lacunarity < 0.01 || m.lacunarity > 10))
          )
            throw Error('Invalid noise detail.');
          if (
            (m.rangeStart === undefined) !== (m.rangeEnd === undefined) ||
            (m.rangeStart !== undefined && m.rangeEnd! < m.rangeStart) ||
            (m.blendIn !== undefined && m.blendIn < 0) ||
            (m.blendOut !== undefined && m.blendOut < 0)
          )
            throw Error('Invalid noise range.');
        }
      } else if (m.type === 'scale') {
        if (!finite(m.factor, 100) || !finite(m.offset, 1e5))
          throw Error('Invalid scale modifier.');
      } else if (m.type === 'limits') {
        if (!finite(m.min) || !finite(m.max) || m.min > m.max) throw Error('Invalid curve limits.');
      } else throw Error('Unknown curve modifier.');
    }
  }
}

/** Link the playback endpoints; retain every interior key and handle. */
export function closeCurveLoop(curve: Curve, start: number, end: number) {
  const value = baseCurve(curve, start),
    boundary = (frame: number): CurveKey => ({
      ...curve.keys[0],
      frame,
      value,
      interpolation: 'loop',
      handle: 'auto',
      left: undefined,
      right: undefined,
    });
  curve.keys = curve.keys
    .filter((k) => k.frame !== start && k.frame !== end)
    .map((k) => (k.interpolation === 'loop' ? { ...k, interpolation: 'bezier' as const } : k))
    .concat(boundary(start), boundary(end))
    .sort((a, b) => a.frame - b.frame);
  curve.loop = { start, end };
}

/** A copied fragment carries explicit tangents instead of depending on keys
 * outside the clipboard. Its motion is unchanged. */
export function explicitLoopCurve(curve: Curve): Curve {
  if (!curve.keys.some((k) => k.interpolation === 'loop')) return structuredClone(curve);
  const keys = curve.keys.map((k, i) =>
    k.interpolation === 'loop'
      ? {
          ...structuredClone(k),
          interpolation: 'bezier' as const,
          handle: 'free' as const,
          ...handles(curve, i),
        }
      : structuredClone(k),
  );
  const out = { ...structuredClone(curve), keys };
  delete out.loop;
  return out;
}

/*
 * Blender-compatible easing formulas.
 *
 * The easing equations in this file are adapted from Blender's
 * source/blender/blenlib/intern/easing.cc and its F-Curve interpolation
 * dispatch in source/blender/blenkernel/intern/fcurve.cc. The upstream file
 * credits Robert Penner and is distributed under the BSD-3-Clause license:
 * https://github.com/blender/blender/blob/main/source/blender/blenlib/intern/easing.cc
 *
 * Copyright (c) 2001 Robert Penner. All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 */

export type MotionMode = 'spring' | 'bounce';
export type EaseDirection = 'auto' | 'in' | 'out' | 'inOut';

/** Blender's Easing (by strength) interpolation family. */
const BLENDER_EASING_MODES = ['sine', 'quad', 'cubic', 'quart', 'quint', 'expo', 'circ'] as const;
type BlenderEasingMode = (typeof BLENDER_EASING_MODES)[number];

/** Blender's Dynamic Effects family. */
const BLENDER_DYNAMIC_MODES = ['back', 'blenderBounce', 'elastic'] as const;

/** Blender interpolation modes that need a scalar easing evaluator. */
export const BLENDER_INTERPOLATION_MODES = [
  ...BLENDER_EASING_MODES,
  ...BLENDER_DYNAMIC_MODES,
] as const;
export type BlenderInterpolationMode = (typeof BLENDER_INTERPOLATION_MODES)[number];

export type InterpolationMode = MotionMode | BlenderInterpolationMode;

export const INTERPOLATION_MODES = [
  'smooth',
  'linear',
  'step',
  ...(['spring', 'bounce'] as const),
  ...BLENDER_INTERPOLATION_MODES,
] as const;
export type InterpolationName = (typeof INTERPOLATION_MODES)[number];

export interface SpringSettings {
  oscillations: number;
  damping: number;
  strength: number;
}
export interface BounceSettings {
  bounces: number;
  height: number;
  decay: number;
  impact: number;
}
export interface BackSettings {
  /** Blender's back-curve overshoot value. */
  overshoot: number;
}
export interface ElasticSettings {
  /** Absolute channel units, matching Blender's F-Curve amplitude. */
  amplitude: number;
  /** Period in frames, matching Blender's F-Curve period. */
  period: number;
}
export interface MotionOptions {
  spring?: SpringSettings;
  bounce?: BounceSettings;
  back?: BackSettings;
  elastic?: ElasticSettings;
  easing?: EaseDirection;
}
export const DEFAULT_SPRING: SpringSettings = { oscillations: 2.5, damping: 6, strength: 1 };
export const DEFAULT_BOUNCE: BounceSettings = {
  bounces: 3,
  height: 0.35,
  decay: 0.5,
  impact: 0.35,
};
/** Blender defaults used when a key does not carry explicit Dynamic Effect settings. */
export const DEFAULT_BACK: BackSettings = { overshoot: 1.70158 };
export const DEFAULT_ELASTIC: ElasticSettings = { amplitude: 0.8, period: 4.1 };

export function isBlenderInterpolation(value: unknown): value is BlenderInterpolationMode {
  return (
    typeof value === 'string' && (BLENDER_INTERPOLATION_MODES as readonly string[]).includes(value)
  );
}
function isBlenderEasing(value: unknown): value is BlenderEasingMode {
  return typeof value === 'string' && (BLENDER_EASING_MODES as readonly string[]).includes(value);
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (t: number) => t * t * (3 - 2 * t);

function springOut(t: number, settings: SpringSettings) {
  const w = 2 * Math.PI * settings.oscillations,
    d = settings.damping;
  const response = 1 - Math.exp(-d * t) * (Math.cos(w * t) + (d / w) * Math.sin(w * t));
  // Fade the residual smoothly to zero, so the next pose is exact and at rest.
  const settle = smooth(clamp((t - 0.65) / 0.35, 0, 1));
  const spring = response + (1 - response) * settle;
  return smooth(t) + (spring - smooth(t)) * settings.strength;
}
function bounceOut(t: number, settings: BounceSettings) {
  if (t <= settings.impact) return (t / settings.impact) ** 2;
  const durations = Array.from(
    { length: settings.bounces },
    (_, i) => Math.sqrt(settings.decay) ** i,
  );
  const total = durations.reduce((a, b) => a + b, 0);
  // Leave a short rest after the final impact. Height and duration decrease together.
  const span = 0.98 - settings.impact;
  let start = settings.impact;
  for (let i = 0; i < durations.length; i++) {
    const duration = (span * durations[i]) / total,
      end = start + duration;
    if (t < end) {
      const u = (t - start) / duration;
      return 1 - settings.height * settings.decay ** i * 4 * u * (1 - u);
    }
    start = end;
  }
  return 1;
}

/** Existing Pose Studio dynamic interpolation, kept for old project data. */
export function motionProgress(mode: MotionMode, t: number, options: MotionOptions = {}): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const out = (u: number) =>
    mode === 'spring'
      ? springOut(u, options.spring ?? DEFAULT_SPRING)
      : bounceOut(u, options.bounce ?? DEFAULT_BOUNCE);
  const direction = resolveEaseDirection(mode, options.easing);
  if (direction === 'in') return 1 - out(1 - t);
  if (direction === 'inOut') return t < 0.5 ? (1 - out(1 - 2 * t)) / 2 : (1 + out(2 * t - 1)) / 2;
  return out(t);
}

/**
 * Blender's default direction is mode-specific. The Easing family defaults to
 * ease-in, while Dynamic Effects (and the legacy Pose Studio modes) default to
 * ease-out. This is also what Blender's F-Curve dispatch does for an omitted
 * easing selection.
 */
export function resolveEaseDirection(
  mode: InterpolationMode,
  direction: EaseDirection | undefined,
): Exclude<EaseDirection, 'auto'> {
  if (direction && direction !== 'auto') return direction;
  return isBlenderEasing(mode) ? 'in' : 'out';
}

/* The following helpers intentionally mirror BLI_easing.cc. Keeping the
 * begin/change/duration form avoids losing effects when begin === end. */
function backEaseIn(
  time: number,
  begin: number,
  change: number,
  duration: number,
  overshoot: number,
) {
  time /= duration;
  return change * time * time * ((overshoot + 1) * time - overshoot) + begin;
}
function backEaseOut(
  time: number,
  begin: number,
  change: number,
  duration: number,
  overshoot: number,
) {
  time = time / duration - 1;
  return change * (time * time * ((overshoot + 1) * time + overshoot) + 1) + begin;
}
function backEaseInOut(
  time: number,
  begin: number,
  change: number,
  duration: number,
  overshoot: number,
) {
  overshoot *= 1.525;
  if ((time /= duration / 2) < 1) {
    return (change / 2) * (time * time * ((overshoot + 1) * time - overshoot)) + begin;
  }
  time -= 2;
  return (change / 2) * (time * time * ((overshoot + 1) * time + overshoot) + 2) + begin;
}

function blenderBounceEaseOut(time: number, begin: number, change: number, duration: number) {
  time /= duration;
  if (time < 1 / 2.75) return change * (7.5625 * time * time) + begin;
  if (time < 2 / 2.75) {
    time -= 1.5 / 2.75;
    return change * (7.5625 * time * time + 0.75) + begin;
  }
  if (time < 2.5 / 2.75) {
    time -= 2.25 / 2.75;
    return change * (7.5625 * time * time + 0.9375) + begin;
  }
  time -= 2.625 / 2.75;
  return change * (7.5625 * time * time + 0.984375) + begin;
}
function blenderBounceEaseIn(time: number, begin: number, change: number, duration: number) {
  return change - blenderBounceEaseOut(duration - time, 0, change, duration) + begin;
}
function blenderBounceEaseInOut(time: number, begin: number, change: number, duration: number) {
  if (time < duration / 2) return blenderBounceEaseIn(time * 2, 0, change, duration) * 0.5 + begin;
  return (
    blenderBounceEaseOut(time * 2 - duration, 0, change, duration) * 0.5 + change * 0.5 + begin
  );
}

function elasticBlend(
  time: number,
  change: number,
  duration: number,
  amplitude: number,
  s: number,
  f: number,
) {
  if (change) {
    const threshold = Math.abs(s);
    if (amplitude) f *= amplitude / Math.abs(change);
    else f = 0;
    if (Math.abs(time * duration) < threshold) {
      const l = Math.abs(time * duration) / threshold;
      f = f * l + (1 - l);
    }
  }
  return f;
}

function elasticEaseIn(
  time: number,
  begin: number,
  change: number,
  duration: number,
  amplitude: number,
  period: number,
) {
  let s: number;
  let f = 1;
  if (time === 0) return begin;
  if ((time /= duration) === 1) return begin + change;
  time -= 1;
  if (!period) period = duration * 0.3;
  if (!amplitude || amplitude < Math.abs(change)) {
    s = period / 4;
    f = elasticBlend(time, change, duration, amplitude, s, f);
    amplitude = change;
  } else {
    s = (period / (2 * Math.PI)) * Math.asin(change / amplitude);
  }
  return (
    -f *
      (amplitude * 2 ** (10 * time) * Math.sin(((time * duration - s) * (2 * Math.PI)) / period)) +
    begin
  );
}
function elasticEaseOut(
  time: number,
  begin: number,
  change: number,
  duration: number,
  amplitude: number,
  period: number,
) {
  let s: number;
  let f = 1;
  if (time === 0) return begin;
  if ((time /= duration) === 1) return begin + change;
  time = -time;
  if (!period) period = duration * 0.3;
  if (!amplitude || amplitude < Math.abs(change)) {
    s = period / 4;
    f = elasticBlend(time, change, duration, amplitude, s, f);
    amplitude = change;
  } else {
    s = (period / (2 * Math.PI)) * Math.asin(change / amplitude);
  }
  return (
    f *
      (amplitude * 2 ** (10 * time) * Math.sin(((time * duration - s) * (2 * Math.PI)) / period)) +
    change +
    begin
  );
}
function elasticEaseInOut(
  time: number,
  begin: number,
  change: number,
  duration: number,
  amplitude: number,
  period: number,
) {
  let s: number;
  let f = 1;
  if (time === 0) return begin;
  if ((time /= duration / 2) === 2) return begin + change;
  time -= 1;
  if (!period) period = duration * (0.3 * 1.5);
  if (!amplitude || amplitude < Math.abs(change)) {
    s = period / 4;
    f = elasticBlend(time, change, duration, amplitude, s, f);
    amplitude = change;
  } else {
    s = (period / (2 * Math.PI)) * Math.asin(change / amplitude);
  }
  if (time < 0) {
    f *= -0.5;
    return (
      f *
        (amplitude *
          2 ** (10 * time) *
          Math.sin(((time * duration - s) * (2 * Math.PI)) / period)) +
      begin
    );
  }
  time = -time;
  f *= 0.5;
  return (
    f *
      (amplitude * 2 ** (10 * time) * Math.sin(((time * duration - s) * (2 * Math.PI)) / period)) +
    change +
    begin
  );
}

function easeIn(
  mode: BlenderEasingMode,
  time: number,
  begin: number,
  change: number,
  duration: number,
) {
  const t = time / duration;
  switch (mode) {
    case 'sine':
      return -change * Math.cos(t * (Math.PI / 2)) + change + begin;
    case 'quad':
      return change * t * t + begin;
    case 'cubic':
      return change * t * t * t + begin;
    case 'quart':
      return change * t ** 4 + begin;
    case 'quint':
      return change * t ** 5 + begin;
    case 'expo': {
      if (time === 0) return begin;
      const min = 0.0009765625;
      return change * (2 ** (10 * (t - 1)) - min) * (1 / (1 - min)) + begin;
    }
    case 'circ':
      return -change * (Math.sqrt(Math.max(0, 1 - t * t)) - 1) + begin;
  }
}
function easeOut(
  mode: BlenderEasingMode,
  time: number,
  begin: number,
  change: number,
  duration: number,
) {
  const t = time / duration;
  switch (mode) {
    case 'sine':
      return change * Math.sin(t * (Math.PI / 2)) + begin;
    case 'quad':
      return -change * t * (t - 2) + begin;
    case 'cubic': {
      const u = t - 1;
      return change * (u ** 3 + 1) + begin;
    }
    case 'quart': {
      const u = t - 1;
      return -change * (u ** 4 - 1) + begin;
    }
    case 'quint': {
      const u = t - 1;
      return change * (u ** 5 + 1) + begin;
    }
    case 'expo': {
      if (time === 0) return begin;
      const min = 0.0009765625;
      return change * (1 - (2 ** (-10 * t) - min) * (1 / (1 - min))) + begin;
    }
    case 'circ': {
      const u = t - 1;
      return change * Math.sqrt(Math.max(0, 1 - u * u)) + begin;
    }
  }
}
function easeInOut(
  mode: BlenderEasingMode,
  time: number,
  begin: number,
  change: number,
  duration: number,
) {
  const half = duration / 2;
  if (time <= half) return easeIn(mode, time, begin, change / 2, half);
  return easeOut(mode, time - half, begin + change / 2, change / 2, half);
}

/**
 * Evaluate a Blender interpolation span in scalar channel units.
 *
 * `time` and `duration` are frame values, while `begin` and `change` remain
 * in the channel's native units. This is deliberately not expressed as a
 * normalized progress multiplied by `change`: Blender elastic curves can
 * oscillate even when both endpoint values are equal.
 */
export function blenderInterpolationValue(
  mode: InterpolationName,
  time: number,
  begin: number,
  change: number,
  duration: number,
  options: MotionOptions = {},
): number {
  if (!Number.isFinite(time) || !Number.isFinite(begin) || !Number.isFinite(change)) return begin;
  if (!Number.isFinite(duration) || duration <= 0) return time >= duration ? begin + change : begin;
  if (time <= 0) return begin;
  if (time >= duration) return begin + change;
  if (mode === 'step') return begin;
  if (mode === 'linear') return begin + change * (time / duration);
  if (mode === 'smooth') {
    const t = time / duration;
    return begin + change * smooth(t);
  }
  if (mode === 'spring' || mode === 'bounce')
    return begin + change * motionProgress(mode, time / duration, options);

  const direction = resolveEaseDirection(mode, options.easing),
    overshoot = options.back?.overshoot ?? DEFAULT_BACK.overshoot,
    amplitude = options.elastic?.amplitude ?? DEFAULT_ELASTIC.amplitude,
    period = options.elastic?.period ?? DEFAULT_ELASTIC.period;
  if (mode === 'back') {
    if (direction === 'in') return backEaseIn(time, begin, change, duration, overshoot);
    if (direction === 'inOut') return backEaseInOut(time, begin, change, duration, overshoot);
    return backEaseOut(time, begin, change, duration, overshoot);
  }
  if (mode === 'blenderBounce') {
    if (direction === 'in') return blenderBounceEaseIn(time, begin, change, duration);
    if (direction === 'inOut') return blenderBounceEaseInOut(time, begin, change, duration);
    return blenderBounceEaseOut(time, begin, change, duration);
  }
  if (mode === 'elastic') {
    if (direction === 'in') return elasticEaseIn(time, begin, change, duration, amplitude, period);
    if (direction === 'inOut')
      return elasticEaseInOut(time, begin, change, duration, amplitude, period);
    return elasticEaseOut(time, begin, change, duration, amplitude, period);
  }
  if (direction === 'in') return easeIn(mode, time, begin, change, duration);
  if (direction === 'inOut') return easeInOut(mode, time, begin, change, duration);
  return easeOut(mode, time, begin, change, duration);
}

export function motionOptions(options: MotionOptions): MotionOptions {
  return {
    ...(options.spring ? { spring: { ...options.spring } } : {}),
    ...(options.bounce ? { bounce: { ...options.bounce } } : {}),
    ...(options.back ? { back: { ...options.back } } : {}),
    ...(options.elastic ? { elastic: { ...options.elastic } } : {}),
    ...(options.easing ? { easing: options.easing } : {}),
  };
}
export function validateMotionOptions(options: MotionOptions) {
  const range = (v: unknown, a: number, b: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
  if (options.easing !== undefined && !['auto', 'in', 'out', 'inOut'].includes(options.easing))
    throw Error('Invalid easing direction.');
  if (options.spring !== undefined) {
    const s = options.spring;
    if (
      !s ||
      typeof s !== 'object' ||
      !range(s.oscillations, 0.5, 8) ||
      !range(s.damping, 0, 20) ||
      !range(s.strength, 0, 2)
    )
      throw Error('Invalid spring settings.');
  }
  if (options.bounce !== undefined) {
    const s = options.bounce;
    if (
      !s ||
      typeof s !== 'object' ||
      !Number.isInteger(s.bounces) ||
      !range(s.bounces, 1, 8) ||
      !range(s.height, 0, 1) ||
      !range(s.decay, 0.1, 0.95) ||
      !range(s.impact, 0.1, 0.8)
    )
      throw Error('Invalid bounce settings.');
  }
  if (options.back !== undefined) {
    const s = options.back;
    if (!s || typeof s !== 'object' || !range(s.overshoot, 0, 100))
      throw Error('Invalid back settings.');
  }
  if (options.elastic !== undefined) {
    const s = options.elastic;
    if (!s || typeof s !== 'object' || !range(s.amplitude, 0, 1e7) || !range(s.period, 0, 1e7))
      throw Error('Invalid elastic settings.');
  }
}

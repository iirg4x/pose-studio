// Blender-compatible 2D Perlin fBM for editable F-Curve noise.
// Algorithm reference: Blender blenlib/intern/noise.cc and blenkernel/intern/fmodifier.cc.
// SPDX-FileCopyrightText: 2009-2010 Sony Pictures Imageworks Inc., et al.
// SPDX-FileCopyrightText: 2011 Blender Authors
// SPDX-License-Identifier: GPL-2.0-or-later AND BSD-3-Clause
const rot = (x: number, k: number) => (x << k) | (x >>> (32 - k));
function hash(x: number, y: number) {
  let a = (0xdeadbeef + 21 + x) | 0,
    b = (0xdeadbeef + 21 + y) | 0,
    c = (0xdeadbeef + 21) | 0;
  c = ((c ^ b) - rot(b, 14)) | 0;
  a = ((a ^ c) - rot(c, 11)) | 0;
  b = ((b ^ a) - rot(a, 25)) | 0;
  c = ((c ^ b) - rot(b, 16)) | 0;
  a = ((a ^ c) - rot(c, 4)) | 0;
  b = ((b ^ a) - rot(a, 14)) | 0;
  return ((c ^ b) - rot(b, 24)) >>> 0;
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function gradient(h: number, x: number, y: number) {
  h &= 7;
  const u = h < 4 ? x : y,
    v = 2 * (h < 4 ? y : x);
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}
function perlin(x: number, y: number) {
  x = (x % 100000) + (Math.abs(x) >= 1000000 ? 0.5 : 0);
  y = (y % 100000) + (Math.abs(y) >= 1000000 ? 0.5 : 0);
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy,
    u = fade(fx),
    v = fade(fy);
  return (
    mix(
      mix(gradient(hash(ix, iy), fx, fy), gradient(hash(ix + 1, iy), fx - 1, fy), u),
      mix(
        gradient(hash(ix, iy + 1), fx, fy - 1),
        gradient(hash(ix + 1, iy + 1), fx - 1, fy - 1),
        u,
      ),
      v,
    ) * 0.6616
  );
}
export interface BlenderNoiseSettings {
  period: number;
  phase: number;
  offset?: number;
  depth?: number;
  roughness?: number;
  lacunarity?: number;
  rangeStart?: number;
  rangeEnd?: number;
  blendIn?: number;
  blendOut?: number;
}
/** Returns centered noise, before strength. No sampled animation is stored. */
export function blenderNoise(frame: number, m: BlenderNoiseSettings) {
  let influence = 1;
  if (m.rangeStart !== undefined && m.rangeEnd !== undefined) {
    if (frame < m.rangeStart || frame > m.rangeEnd) return 0;
    if (m.blendIn && frame <= m.rangeStart + m.blendIn)
      influence = (frame - m.rangeStart) / m.blendIn;
    else if (m.blendOut && frame >= m.rangeEnd - m.blendOut)
      influence = (m.rangeEnd - frame) / m.blendOut;
  }
  // Blender evaluates the coordinates as floats before entering the noise function.
  const f = Math.fround,
    x = f(f(f(frame - (m.offset ?? 0)) * f(1 / m.period)) + f(0.61803398874)),
    y = f(m.phase);
  let scale = 1,
    amp = 1,
    total = 0,
    weights = 0;
  for (let i = 0; i <= (m.depth ?? 0); i++) {
    total += perlin(f(x * scale), f(y * scale)) * amp;
    weights += amp;
    amp *= m.roughness ?? 0.5;
    scale *= m.lacunarity ?? 2;
  }
  return ((0.5 * total) / weights) * influence;
}

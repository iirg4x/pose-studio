// Blender-compatible 2D Perlin fBM for editable F-Curve noise.
// Algorithm reference: Blender blenlib/intern/noise.cc and blenkernel/intern/fmodifier.cc.
// SPDX-FileCopyrightText: 2009-2010 Sony Pictures Imageworks Inc., et al.
// SPDX-FileCopyrightText: 2011 Blender Authors
// SPDX-License-Identifier: GPL-2.0-or-later AND BSD-3-Clause
import { legacyBlenderNoise } from './blenderLegacyNoise';
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
  /** Blender's legacy noise field, retained by older animation files. */
  legacy?: boolean;
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
  if (m.legacy) return legacyBlenderNoise(frame, m) * influence;
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

const latticeRows = new Map<number, (x: number) => number>();
function latticeRow(y0: number): (x: number) => number {
  const cached = latticeRows.get(y0);
  if (cached) return cached;
  const y = (y0 % 100000) + (Math.abs(y0) >= 1000000 ? 0.5 : 0),
    iy = Math.floor(y),
    fy = y - iy,
    v = fade(fy);
  const cells = new Map<number, [number, number, number, number]>();
  const sample = (input: number) => {
    const x = (input % 100000) + (Math.abs(input) >= 1000000 ? 0.5 : 0),
      ix = Math.floor(x),
      fx = x - ix;
    let c = cells.get(ix);
    if (!c) {
      const h00 = hash(ix, iy),
        h01 = hash(ix, iy + 1),
        h10 = hash(ix + 1, iy),
        h11 = hash(ix + 1, iy + 1);
      const l0 = mix(gradient(h00, 0, fy), gradient(h01, 0, fy - 1), v);
      const l1 = mix(gradient(h00, 1, fy), gradient(h01, 1, fy - 1), v);
      const r0 = mix(gradient(h10, -1, fy), gradient(h11, -1, fy - 1), v);
      const r1 = mix(gradient(h10, 0, fy), gradient(h11, 0, fy - 1), v);
      c = [l0, l1 - l0, r0, r1 - r0];
      if (cells.size >= 512) cells.clear();
      cells.set(ix, c);
    }
    return mix(c[0] + c[1] * fx, c[2] + c[3] * fx, fade(fx)) * 0.6616;
  };

  if (latticeRows.size >= 512) latticeRows.delete(latticeRows.keys().next().value!);
  latticeRows.set(y0, sample);
  return sample;
}

/** Compile the fixed phase of a modern field for repeated fitting samples.
 * Cache only lattice coefficients, never observed animation values. */
export function blenderNoiseSampler(m: BlenderNoiseSettings): (frame: number) => number {
  if (m.legacy) return (frame) => blenderNoise(frame, m);
  const layers: { scale: number; weight: number; sample: (x: number) => number }[] = [];
  let scale = 1,
    weight = 1,
    weights = 0;
  for (let layer = 0; layer <= (m.depth ?? 0); layer++) {
    const y0 = Math.fround(Math.fround(m.phase) * scale);
    const sample = latticeRow(y0);
    layers.push({ scale, weight, sample });
    weights += weight;
    weight *= m.roughness ?? 0.5;
    scale *= m.lacunarity ?? 2;
  }
  return (frame) => {
    let influence = 1;
    if (m.rangeStart !== undefined && m.rangeEnd !== undefined) {
      if (frame < m.rangeStart || frame > m.rangeEnd) return 0;
      if (m.blendIn && frame <= m.rangeStart + m.blendIn)
        influence = (frame - m.rangeStart) / m.blendIn;
      else if (m.blendOut && frame >= m.rangeEnd - m.blendOut)
        influence = (m.rangeEnd - frame) / m.blendOut;
    }
    const x = Math.fround(
      Math.fround(Math.fround(frame - (m.offset ?? 0)) * Math.fround(1 / m.period)) +
        Math.fround(0.61803398874),
    );
    let total = 0;
    for (const layer of layers) total += layer.sample(Math.fround(x * layer.scale)) * layer.weight;
    return ((0.5 * total) / weights) * influence;
  };
}

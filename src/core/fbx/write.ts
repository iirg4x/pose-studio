import { zlibSync } from 'three/addons/libs/fflate.module.js';

/** A typed FBX value. Plain numbers are ambiguous on disk, so scalars carry their type. */
export type Out =
  | ['I', number]
  | ['D', number]
  | ['L', number | bigint]
  | ['S', string]
  | ['R', Uint8Array]
  | ['C', boolean]
  | Int32Array
  | Float32Array
  | Float64Array
  | BigInt64Array;
export interface OutNode {
  name: string;
  props: Out[];
  children: OutNode[];
}
export const I = (v: number): Out => ['I', v];
export const D = (v: number): Out => ['D', v];
export const L = (v: number | bigint): Out => ['L', v];
export const S = (v: string): Out => ['S', v];
export const node = (name: string, props: Out[] = [], children: OutNode[] = []): OutNode => ({
  name,
  props,
  children,
});
/** Object names are stored with their class after a two-byte separator. */
export const named = (name: string, type: string): Out => ['S', name + '\0\x01' + type];

const INTEGER = new Set(['int', 'enum', 'bool', 'Integer']),
  LONG = new Set(['KTime', 'ULongLong']),
  TEXT = new Set(['KString', 'object', 'Compound', 'DateTime']);
/** One `Properties70` row; values are encoded by the declared FBX type. */
export function P(
  name: string,
  type: string,
  label: string,
  flags: string,
  ...values: (number | string | bigint)[]
) {
  return node('P', [
    S(name),
    S(type),
    S(label),
    S(flags),
    ...values.map(
      (v): Out =>
        typeof v === 'string' || TEXT.has(type)
          ? S(String(v))
          : LONG.has(type)
            ? L(v)
            : INTEGER.has(type)
              ? I(Number(v))
              : D(Number(v)),
    ),
  ]);
}

const encoder = new TextEncoder();
const HEAD = encoder.encode('Kaydara FBX Binary  \0\x1a\0'),
  FOOT = Uint8Array.of(
    0xfa,
    0xbc,
    0xab,
    0x09,
    0xd0,
    0xc8,
    0xd4,
    0x66,
    0xb1,
    0x76,
    0xfb,
    0x83,
    0x1c,
    0xf7,
    0x26,
    0x7e,
  ),
  TAIL = Uint8Array.of(
    0xf8,
    0x5a,
    0x8c,
    0x6a,
    0xde,
    0xf5,
    0xd9,
    0x7e,
    0xec,
    0xe9,
    0x0c,
    0xe3,
    0x75,
    0x8f,
    0x29,
    0x0b,
  ),
  SENTINEL = 13;
// These must end with an empty block even when they hold nothing nested.
const ALWAYS_BLOCK = new Set(['AnimationStack', 'AnimationLayer']);

function scalar(type: string, size: number, set: (view: DataView) => void) {
  const bytes = new Uint8Array(1 + size);
  bytes[0] = type.charCodeAt(0);
  set(new DataView(bytes.buffer, 1));
  return bytes;
}
function blob(type: string, data: Uint8Array) {
  const bytes = new Uint8Array(5 + data.length);
  bytes[0] = type.charCodeAt(0);
  new DataView(bytes.buffer).setUint32(1, data.length, true);
  bytes.set(data, 5);
  return bytes;
}
function array(type: string, values: Int32Array | Float32Array | Float64Array | BigInt64Array) {
  // Typed arrays are little-endian on every platform this app runs on.
  const raw = new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
    packed = raw.length > 128 ? zlibSync(raw, { level: 1 }) : raw,
    bytes = new Uint8Array(13 + packed.length),
    view = new DataView(bytes.buffer);
  bytes[0] = type.charCodeAt(0);
  view.setUint32(1, values.length, true);
  view.setUint32(5, packed === raw ? 0 : 1, true);
  view.setUint32(9, packed.length, true);
  bytes.set(packed, 13);
  return bytes;
}
function encode(value: Out) {
  if (value instanceof Int32Array) return array('i', value);
  if (value instanceof Float32Array) return array('f', value);
  if (value instanceof Float64Array) return array('d', value);
  if (value instanceof BigInt64Array) return array('l', value);
  const [type, v] = value;
  switch (type) {
    case 'I':
      return scalar('I', 4, (d) => d.setInt32(0, v, true));
    case 'D':
      return scalar('D', 8, (d) => d.setFloat64(0, v, true));
    case 'L':
      return scalar('L', 8, (d) => d.setBigInt64(0, BigInt(v), true));
    case 'C':
      return scalar('C', 1, (d) => d.setUint8(0, v ? 1 : 0));
    case 'S':
      return blob('S', encoder.encode(v));
    case 'R':
      return blob('R', v);
  }
}

interface Packed {
  name: Uint8Array;
  props: Uint8Array[];
  size: number;
  children: Packed[];
  block: boolean;
  end: number;
}
function pack(n: OutNode, last: boolean): Packed {
  const props = n.props.map(encode),
    children = n.children.map((c, i) => pack(c, i === n.children.length - 1));
  return {
    name: encoder.encode(n.name),
    props,
    size: props.reduce((sum, p) => sum + p.length, 0),
    children,
    block: children.length > 0 || (!props.length && !last) || ALWAYS_BLOCK.has(n.name),
    end: 0,
  };
}
function measure(p: Packed, offset: number): number {
  offset += 13 + p.name.length + p.size;
  for (const c of p.children) offset = measure(c, offset);
  if (p.block) offset += SENTINEL;
  return (p.end = offset);
}

/** Encode a record tree as a binary FBX 7.4 file. */
export function encodeFbx(top: OutNode[], version = 7400): Uint8Array {
  const records = top.map((n, i) => pack(n, i === top.length - 1));
  let offset = HEAD.length + 4;
  for (const r of records) offset = measure(r, offset);
  const body = offset + SENTINEL,
    padding = ((body + FOOT.length + 4 + 15) & ~15) - (body + FOOT.length + 4) || 16,
    out = new Uint8Array(body + FOOT.length + 4 + padding + 4 + 120 + TAIL.length),
    view = new DataView(out.buffer);
  out.set(HEAD);
  view.setUint32(HEAD.length, version, true);
  let at = HEAD.length + 4;
  const write = (p: Packed) => {
    view.setUint32(at, p.end, true);
    view.setUint32(at + 4, p.props.length, true);
    view.setUint32(at + 8, p.size, true);
    out[at + 12] = p.name.length;
    out.set(p.name, at + 13);
    at += 13 + p.name.length;
    for (const prop of p.props) {
      out.set(prop, at);
      at += prop.length;
    }
    for (const c of p.children) write(c);
    if (p.block) at += SENTINEL;
  };
  for (const r of records) write(r);
  at += SENTINEL;
  out.set(FOOT, at);
  at += FOOT.length + 4 + padding;
  view.setUint32(at, version, true);
  out.set(TAIL, at + 4 + 120);
  return out;
}

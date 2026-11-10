import { unzlibSync } from 'three/addons/libs/fflate.module.js';

/** One FBX record: `Name: prop, prop { children }`. */
export interface FbxNode {
  name: string;
  props: FbxValue[];
  children: FbxNode[];
}
type FbxArray = Float64Array | Float32Array | Int32Array | Uint8Array;
export type FbxValue = number | bigint | string | boolean | Uint8Array | FbxArray;

const MAGIC = 'Kaydara FBX Binary  \0';
const text = new TextDecoder();

function isBinaryFbx(data: Uint8Array) {
  if (data.length < 27) return false;
  for (let i = 0; i < MAGIC.length; i++) if (data[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

/** Read a binary or text FBX file into its record tree. */
export function parseFbx(data: Uint8Array): { version: number; root: FbxNode } {
  return isBinaryFbx(data) ? parseBinary(data) : parseText(text.decode(data));
}

function parseBinary(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint32(23, true),
    wide = version >= 7500,
    root: FbxNode = { name: '', props: [], children: [] };
  let at = 27;
  const word = () => {
    const v = wide ? Number(view.getBigUint64(at, true)) : view.getUint32(at, true);
    at += wide ? 8 : 4;
    return v;
  };
  const array = (type: string): FbxArray => {
    const count = view.getUint32(at, true),
      encoding = view.getUint32(at + 4, true),
      stored = view.getUint32(at + 8, true);
    at += 12;
    const size = type === 'd' || type === 'l' ? 8 : type === 'b' || type === 'c' ? 1 : 4;
    let bytes = data.subarray(at, at + stored);
    at += stored;
    if (encoding === 1) bytes = unzlibSync(bytes);
    else if (encoding !== 0) throw Error('Unsupported FBX array encoding.');
    if (bytes.length < count * size) throw Error('The FBX file is cut short.');
    const v = new DataView(bytes.buffer, bytes.byteOffset, count * size);
    if (type === 'b' || type === 'c') return bytes.slice(0, count);
    if (type === 'i') {
      const out = new Int32Array(count);
      for (let i = 0; i < count; i++) out[i] = v.getInt32(i * 4, true);
      return out;
    }
    if (type === 'f') {
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = v.getFloat32(i * 4, true);
      return out;
    }
    // Times and 64-bit indices stay exact in a double up to 2^53.
    const out = new Float64Array(count);
    for (let i = 0; i < count; i++)
      out[i] = type === 'd' ? v.getFloat64(i * 8, true) : Number(v.getBigInt64(i * 8, true));
    return out;
  };
  const value = (): FbxValue => {
    const type = String.fromCharCode(data[at++]);
    switch (type) {
      case 'Y':
        at += 2;
        return view.getInt16(at - 2, true);
      case 'C':
        return data[at++] !== 0;
      case 'I':
        at += 4;
        return view.getInt32(at - 4, true);
      case 'F':
        at += 4;
        return view.getFloat32(at - 4, true);
      case 'D':
        at += 8;
        return view.getFloat64(at - 8, true);
      case 'L':
        at += 8;
        return view.getBigInt64(at - 8, true);
      case 'S':
      case 'R': {
        const length = view.getUint32(at, true);
        at += 4 + length;
        const bytes = data.subarray(at - length, at);
        return type === 'S' ? text.decode(bytes) : bytes.slice();
      }
      case 'f':
      case 'd':
      case 'l':
      case 'i':
      case 'b':
      case 'c':
        return array(type);
    }
    throw Error('Unknown FBX value type: ' + type);
  };
  const record = (): FbxNode | null => {
    const end = word(),
      count = word();
    word();
    const length = data[at++];
    if (end === 0) return null;
    if (end > data.length) throw Error('The FBX file is cut short.');
    const node: FbxNode = {
      name: text.decode(data.subarray(at, at + length)),
      props: [],
      children: [],
    };
    at += length;
    for (let i = 0; i < count; i++) node.props.push(value());
    while (at < end) {
      const child = record();
      if (child) node.children.push(child);
    }
    at = end;
    return node;
  };
  const sentinel = wide ? 25 : 13;
  while (at + sentinel <= data.length) {
    const node = record();
    if (!node) break;
    root.children.push(node);
  }
  return { version, root };
}

function parseText(source: string) {
  const root: FbxNode = { name: '', props: [], children: [] },
    stack = [root];
  let at = 0,
    version = 0;
  const length = source.length;
  const space = (lines: boolean) => {
    for (;;) {
      const c = source[at];
      if (c === ' ' || c === '\t' || c === '\r' || (lines && c === '\n')) at++;
      else if (c === ';') while (at < length && source[at] !== '\n') at++;
      else return;
    }
  };
  const scalar = (): FbxValue => {
    if (source[at] === '"') {
      const end = source.indexOf('"', at + 1);
      if (end < 0) throw Error('The FBX file is cut short.');
      const s = source.slice(at + 1, end);
      at = end + 1;
      return s;
    }
    const start = at;
    while (at < length && !',{}\n\r \t'.includes(source[at])) at++;
    const token = source.slice(start, at);
    if (/^-?\d+$/.test(token)) {
      const n = Number(token);
      return Number.isSafeInteger(n) ? n : BigInt(token);
    }
    const n = Number(token);
    return Number.isNaN(n) ? token : n;
  };
  while (at < length) {
    space(true);
    if (at >= length) break;
    if (source[at] === '}') {
      at++;
      if (stack.length > 1) stack.pop();
      continue;
    }
    const colon = source.indexOf(':', at);
    if (colon < 0) break;
    const node: FbxNode = { name: source.slice(at, colon).trim(), props: [], children: [] };
    at = colon + 1;
    stack[stack.length - 1].children.push(node);
    for (;;) {
      space(false);
      const c = source[at];
      if (at >= length || c === '\n') {
        // A value list may continue on the next line after a trailing comma.
        const last = source.slice(0, at).trimEnd();
        if (last.endsWith(',')) {
          at++;
          continue;
        }
        break;
      }
      if (c === '{') {
        at++;
        stack.push(node);
        break;
      }
      if (c === '}') break;
      if (c === ',') {
        at++;
        continue;
      }
      if (c === '*') {
        // `*count { a: v, v, ... }`
        const open = source.indexOf('{', at),
          close = source.indexOf('}', open),
          body = source.slice(source.indexOf(':', open) + 1, close);
        const values = body.split(',').map(Number);
        node.props.push(Float64Array.from(values[0] === undefined ? [] : values));
        at = close + 1;
        continue;
      }
      node.props.push(scalar());
    }
    if (node.name === 'FBXVersion' && stack.length === 2) version = Number(node.props[0]);
  }
  for (const node of walk(root)) {
    // Text files write `Model: 1, "Model::Name", "Type"`; binary files store the name first.
    for (let i = 0; i < node.props.length; i++) {
      const p = node.props[i];
      if (typeof p === 'string' && i < 2 && /^[A-Za-z]+::/.test(p))
        node.props[i] = p.slice(p.indexOf('::') + 2) + '\0\x01' + p.slice(0, p.indexOf('::'));
    }
  }
  return { version, root };
}

function* walk(node: FbxNode): Generator<FbxNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

export const child = (node: FbxNode | undefined, name: string) =>
  node?.children.find((c) => c.name === name);
export const children = (node: FbxNode | undefined, name: string) =>
  node?.children.filter((c) => c.name === name) ?? [];
/** `Name\0\x01Class` as stored in binary files; returns the name alone. */
export const objectName = (value: FbxValue | undefined) =>
  typeof value === 'string' ? value.split('\0')[0] : '';
export const numbers = (value: FbxValue | undefined): ArrayLike<number> =>
  value instanceof Float64Array ||
  value instanceof Float32Array ||
  value instanceof Int32Array ||
  value instanceof Uint8Array
    ? value
    : [];

/** `Properties70` as a name → values map. Each `P` holds name, type, label, flags, values. */
export function properties(node: FbxNode | undefined) {
  const out = new Map<string, FbxValue[]>();
  for (const p of children(child(node, 'Properties70'), 'P'))
    if (typeof p.props[0] === 'string') out.set(p.props[0], p.props.slice(4));
  return out;
}

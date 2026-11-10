import { Matrix4, Quaternion, Vector3 } from 'three';

/** The parts of a glTF document the FBX writer reads. */
export interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  skin?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfTextureRef {
  index: number;
}
interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: GltfTextureRef;
    metallicRoughnessTexture?: GltfTextureRef;
    metallicFactor?: number;
    roughnessFactor?: number;
  };
  normalTexture?: GltfTextureRef;
  emissiveTexture?: GltfTextureRef;
  emissiveFactor?: number[];
  extensions?: Record<string, unknown>;
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  extensions?: Record<string, unknown>;
}
interface GltfJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives: GltfPrimitive[] }[];
  skins?: { name?: string; joints: number[]; skeleton?: number; inverseBindMatrices?: number }[];
  materials?: GltfMaterial[];
  textures?: { source?: number }[];
  images?: { name?: string; mimeType?: string; bufferView?: number; uri?: string }[];
  accessors?: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    normalized?: boolean;
    count: number;
    type: string;
    sparse?: unknown;
  }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  animations?: {
    name?: string;
    channels: { sampler: number; target: { node?: number; path: string } }[];
    samplers: { input: number; output: number; interpolation?: string }[];
  }[];
  extensionsRequired?: string[];
}
export interface Gltf {
  json: GltfJson;
  buffers: Uint8Array[];
}

function inline(uri: string | undefined) {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(uri ?? '');
  if (!match) throw Error('This model keeps its data in separate files. Save it as one .glb file.');
  return Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
}

/** Read a binary glTF file. Buffers must be embedded. */
export function readGlb(data: Uint8Array): Gltf {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2)
    throw Error('This is not a GLB file.');
  let json: GltfJson | undefined, chunk: Uint8Array | undefined;
  for (let at = 12; at + 8 <= data.length; ) {
    const length = view.getUint32(at, true),
      type = view.getUint32(at + 4, true),
      body = data.subarray(at + 8, at + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body)) as GltfJson;
    else if (type === 0x004e4942) chunk ??= body;
    at += 8 + length;
  }
  if (!json) throw Error('This GLB file has no scene.');
  const packed = (json.extensionsRequired ?? []).find((e) =>
    /draco|meshopt|EXT_mesh_gpu_instancing/i.test(e),
  );
  if (packed) throw Error(`This model uses ${packed}, which cannot be written to FBX.`);
  const buffers = (json.buffers ?? []).map((b, i) =>
    b.uri === undefined && i === 0 && chunk ? chunk : inline(b.uri),
  );
  return { json, buffers };
}

const SIZES: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};
/** Accessor values as numbers; normalised integers become fractions. */
export function accessor(gltf: Gltf, index: number) {
  const a = gltf.json.accessors?.[index];
  if (!a) throw Error('The model refers to data it does not contain.');
  if (a.sparse) throw Error('Sparse accessors cannot be written to FBX.');
  const size = SIZES[a.type] ?? 1,
    float = a.componentType === 5126 || !!a.normalized,
    values = float ? new Float32Array(a.count * size) : new Uint32Array(a.count * size);
  const bufferView = a.bufferView === undefined ? undefined : gltf.json.bufferViews?.[a.bufferView];
  if (!bufferView) return { values, size, count: a.count };
  const bytes = gltf.buffers[bufferView.buffer],
    width = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType] ?? 4,
    stride = bufferView.byteStride || width * size,
    start = (bufferView.byteOffset ?? 0) + (a.byteOffset ?? 0),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (start + stride * (a.count - 1) + width * size > bytes.length)
    throw Error('The model data is cut short.');
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < size; k++) {
      const at = start + i * stride + k * width;
      let v: number;
      switch (a.componentType) {
        case 5120:
          v = view.getInt8(at);
          if (a.normalized) v = Math.max(v / 127, -1);
          break;
        case 5121:
          v = view.getUint8(at);
          if (a.normalized) v /= 255;
          break;
        case 5122:
          v = view.getInt16(at, true);
          if (a.normalized) v = Math.max(v / 32767, -1);
          break;
        case 5123:
          v = view.getUint16(at, true);
          if (a.normalized) v /= 65535;
          break;
        case 5125:
          v = view.getUint32(at, true);
          break;
        default:
          v = view.getFloat32(at, true);
      }
      values[i * size + k] = v;
    }
  return { values, size, count: a.count };
}

/** The bytes of an embedded image. */
export function imageBytes(gltf: Gltf, index: number) {
  const image = gltf.json.images?.[index];
  if (!image) return null;
  if (image.bufferView === undefined)
    return image.uri?.startsWith('data:') ? inline(image.uri) : null;
  const view = gltf.json.bufferViews?.[image.bufferView];
  if (!view) return null;
  const start = view.byteOffset ?? 0;
  return gltf.buffers[view.buffer].subarray(start, start + view.byteLength);
}

/** A node's own transform, with animated values replacing the stored ones. */
export function nodeMatrix(
  node: GltfNode,
  animated?: {
    translation?: ArrayLike<number>;
    rotation?: ArrayLike<number>;
    scale?: ArrayLike<number>;
  },
) {
  if (node.matrix && !animated) return new Matrix4().fromArray(node.matrix);
  let t = node.translation ?? [0, 0, 0],
    r = node.rotation ?? [0, 0, 0, 1],
    s = node.scale ?? [1, 1, 1];
  if (node.matrix) {
    const p = new Vector3(),
      q = new Quaternion(),
      k = new Vector3();
    new Matrix4().fromArray(node.matrix).decompose(p, q, k);
    t = p.toArray();
    r = q.toArray();
    s = k.toArray();
  }
  const translation = animated?.translation ?? t,
    rotation = animated?.rotation ?? r,
    scale = animated?.scale ?? s;
  return new Matrix4().compose(
    new Vector3(translation[0], translation[1], translation[2]),
    new Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]).normalize(),
    new Vector3(scale[0], scale[1], scale[2]),
  );
}

type Track = { times: Float32Array; values: Float32Array; size: number; step: boolean };
/** Samples the keyed node transforms of one animation. */
export class GltfAnimation {
  readonly name: string;
  readonly duration: number;
  private tracks = new Map<number, Record<string, Track>>();
  constructor(gltf: Gltf, index: number) {
    const source = gltf.json.animations?.[index];
    if (!source) throw Error('The model has no animation.');
    this.name = source.name ?? '';
    let duration = 0;
    for (const channel of source.channels) {
      const sampler = source.samplers[channel.sampler],
        node = channel.target.node,
        path = channel.target.path;
      if (node === undefined || !['translation', 'rotation', 'scale'].includes(path)) continue;
      if (sampler.interpolation === 'CUBICSPLINE')
        throw Error('Spline animation cannot be written to FBX.');
      const times = accessor(gltf, sampler.input).values as Float32Array,
        output = accessor(gltf, sampler.output);
      if (!times.length) continue;
      duration = Math.max(duration, times[times.length - 1]);
      const tracks = this.tracks.get(node) ?? this.tracks.set(node, {}).get(node)!;
      tracks[path] = {
        times,
        values: output.values as Float32Array,
        size: output.size,
        step: sampler.interpolation === 'STEP',
      };
    }
    this.duration = duration;
  }
  /** Keyed values of one node at a time in seconds, or nothing when it is not animated. */
  at(node: number, time: number) {
    const tracks = this.tracks.get(node);
    if (!tracks) return undefined;
    const out: Record<string, number[]> = {};
    for (const [path, track] of Object.entries(tracks)) {
      const { times, values, size } = track;
      let hi = 0;
      while (hi < times.length && times[hi] <= time) hi++;
      const lo = Math.max(0, hi - 1);
      hi = Math.min(times.length - 1, hi);
      const span = times[hi] - times[lo],
        f = track.step || span <= 0 ? 0 : Math.min(1, Math.max(0, (time - times[lo]) / span)),
        a = lo * size,
        b = hi * size,
        value: number[] = [];
      // Quaternions take the short way round, as animation tools do when they import keys.
      let sign = 1;
      if (path === 'rotation') {
        let dot = 0;
        for (let k = 0; k < 4; k++) dot += values[a + k] * values[b + k];
        if (dot < 0) sign = -1;
      }
      for (let k = 0; k < size; k++) value.push(values[a + k] * (1 - f) + values[b + k] * f * sign);
      out[path] = value;
    }
    return out;
  }
}

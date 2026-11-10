import { Matrix3, Matrix4, Vector3 } from 'three';
import { child, numbers, objectName, properties } from './parse';
import type { FbxNode } from './parse';
import { matrix, staticWorld } from './scene';
import type { FbxModel, FbxScene } from './scene';

export interface FbxMaterial {
  name: string;
  color: [number, number, number];
  opacity: number;
  roughness: number;
  emissive: [number, number, number];
  /** Texture slots by FBX property name, for example `DiffuseColor` or `NormalMap`. */
  textures: Map<string, FbxTexture>;
}
interface FbxTexture {
  /** File name as written by the exporting tool; often an absolute path on another machine. */
  filename: string;
  /** Image bytes when the file embeds its media. */
  content: Uint8Array | null;
}
/** One mesh node, triangulated and split so every corner is its own vertex. */
export interface FbxMesh {
  model: FbxModel;
  name: string;
  /** Corner data in world space (metres, Y up) at the bind pose. */
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  colors: Float32Array | null;
  /** Triangle ranges per material slot, in corner counts. */
  groups: { start: number; count: number; material: number }[];
  materials: FbxMaterial[];
  /** Up to four bone influences per corner; absent on rigid meshes. */
  skin: { bones: FbxModel[]; indices: Uint16Array; weights: Float32Array } | null;
}

interface Layer {
  values: ArrayLike<number>;
  index: ArrayLike<number> | null;
  mapping: string;
  size: number;
}
function layer(geometry: FbxNode, name: string, data: string, size: number): Layer | null {
  const element = child(geometry, name),
    values = numbers(child(element, data)?.props[0]);
  if (!element || !values.length) return null;
  const reference = String(child(element, 'ReferenceInformationType')?.props[0] ?? 'Direct'),
    index = numbers(child(element, data + 'Index')?.props[0]);
  return {
    values,
    index: reference !== 'Direct' && index.length ? index : null,
    mapping: String(child(element, 'MappingInformationType')?.props[0] ?? ''),
    size,
  };
}
/** Element index for one corner under the FBX mapping modes. */
function lookup(l: Layer, corner: number, point: number, polygon: number) {
  const at =
    l.mapping === 'ByPolygonVertex'
      ? corner
      : l.mapping === 'ByVertice' || l.mapping === 'ByVertex' || l.mapping === 'ByControlPoint'
        ? point
        : l.mapping === 'ByPolygon'
          ? polygon
          : 0;
  return l.index ? l.index[at] : at;
}

function readMaterial(scene: FbxScene, node: FbxNode): FbxMaterial {
  const p = properties(node),
    rgb = (name: string, fallback: [number, number, number]): [number, number, number] => {
      const v = p.get(name);
      return v && v.length >= 3 ? [Number(v[0]), Number(v[1]), Number(v[2])] : fallback;
    },
    scalar = (name: string, fallback: number) => Number(p.get(name)?.[0] ?? fallback);
  const textures = new Map<string, FbxTexture>();
  for (const [from, slot] of scene.links.get(String(node.props[0])) ?? []) {
    const texture = scene.objects.get(from);
    if (texture?.name !== 'Texture' || !slot) continue;
    let filename = String(
        child(texture, 'RelativeFilename')?.props[0] ?? child(texture, 'FileName')?.props[0] ?? '',
      ),
      content: Uint8Array | null = null;
    for (const [videoId] of scene.links.get(from) ?? []) {
      const video = scene.objects.get(videoId);
      if (video?.name !== 'Video') continue;
      const bytes = child(video, 'Content')?.props[0];
      if (bytes instanceof Uint8Array && bytes.length) content = bytes;
      filename ||= String(
        child(video, 'RelativeFilename')?.props[0] ?? child(video, 'FileName')?.props[0] ?? '',
      );
    }
    if (!textures.has(slot)) textures.set(slot, { filename, content });
  }
  const emissive = rgb('EmissiveColor', rgb('Emissive', [0, 0, 0])),
    strength = scalar('EmissiveFactor', 1);
  // Legacy Phong shininess maps to roughness the way Blender's importer does.
  const shininess = scalar('Shininess', scalar('ShininessExponent', 20));
  return {
    name: objectName(node.props[1]) || 'Material',
    color: rgb('DiffuseColor', rgb('Diffuse', [0.8, 0.8, 0.8])),
    opacity: 1 - scalar('TransparencyFactor', 0),
    roughness: Math.min(1, Math.max(0, 1 - Math.sqrt(Math.max(0, shininess)) / 10)),
    emissive: [emissive[0] * strength, emissive[1] * strength, emissive[2] * strength],
    textures,
  };
}

/** Read every mesh in the file, placed where it stands at the bind pose. */
export function readFbxMeshes(scene: FbxScene): FbxMesh[] {
  const meshes: FbxMesh[] = [];
  for (const model of scene.models.values()) {
    const attached = (scene.links.get(model.id) ?? []).map(([from]) => scene.objects.get(from));
    const geometry = attached.find((n) => n?.name === 'Geometry' && n.props[2] === 'Mesh');
    if (!geometry) continue;
    const points = numbers(child(geometry, 'Vertices')?.props[0]),
      polygons = numbers(child(geometry, 'PolygonVertexIndex')?.props[0]);
    if (!points.length || !polygons.length) continue;
    const normal = layer(geometry, 'LayerElementNormal', 'Normals', 3),
      uv = layer(geometry, 'LayerElementUV', 'UV', 2),
      color = layer(geometry, 'LayerElementColor', 'Colors', 4),
      slot = child(geometry, 'LayerElementMaterial'),
      slots = numbers(child(slot, 'Materials')?.props[0]),
      slotMapping = String(child(slot, 'MappingInformationType')?.props[0] ?? 'AllSame');
    const materials = attached
      .filter((n): n is FbxNode => n?.name === 'Material')
      .map((n) => readMaterial(scene, n));

    // Skin: every cluster names one bone and the control points it moves.
    let place: Matrix4 | null = null;
    const bones: FbxModel[] = [],
      influences: [number, number][][] = [];
    for (const [skinId] of scene.links.get(String(geometry.props[0])) ?? []) {
      const skin = scene.objects.get(skinId);
      if (skin?.name !== 'Deformer' || skin.props[2] !== 'Skin') continue;
      for (const [clusterId] of scene.links.get(skinId) ?? []) {
        const cluster = scene.objects.get(clusterId);
        if (cluster?.name !== 'Deformer' || cluster.props[2] !== 'Cluster') continue;
        const bone = (scene.links.get(clusterId) ?? [])
          .map(([from]) => scene.models.get(from))
          .find(Boolean);
        if (!bone) continue;
        // `Transform` is the mesh in the bone's space; with the bone's own bind matrix
        // (`TransformLink`) it gives where the mesh stood when it was bound.
        const link = matrix(child(cluster, 'TransformLink')),
          local = matrix(child(cluster, 'Transform'));
        if (!place && link && local) place = link.multiply(local).multiply(model.geometric);
        const at = numbers(child(cluster, 'Indexes')?.props[0]),
          weight = numbers(child(cluster, 'Weights')?.props[0]);
        const b = bones.push(bone) - 1;
        for (let i = 0; i < at.length; i++)
          if (weight[i] > 0) (influences[at[i]] ??= []).push([b, weight[i]]);
      }
    }
    const skinned = bones.length > 0;
    // A skinned mesh sits where its clusters say it was bound; a rigid one where its node is.
    const world = scene.global
      .clone()
      .multiply(skinned && place ? place : staticWorld(model).multiply(model.geometric));
    const normalMatrix = new Matrix3().getNormalMatrix(world);

    // Fan-triangulate, bucketed by material slot.
    const buckets = new Map<number, number[]>();
    let start = 0,
      polygon = 0;
    for (let i = 0; i < polygons.length; i++) {
      if (polygons[i] >= 0) continue;
      const material =
        slotMapping === 'ByPolygon' && slots.length > polygon ? slots[polygon] : (slots[0] ?? 0);
      const bucket = buckets.get(material) ?? buckets.set(material, []).get(material)!;
      for (let k = start + 1; k < i; k++) bucket.push(start, polygon, k, polygon, k + 1, polygon);
      start = i + 1;
      polygon++;
    }
    const total = [...buckets.values()].reduce((n, b) => n + b.length / 2, 0);
    if (!total) continue;
    const mesh: FbxMesh = {
      model,
      name: model.name,
      positions: new Float32Array(total * 3),
      normals: normal ? new Float32Array(total * 3) : null,
      uvs: uv ? new Float32Array(total * 2) : null,
      colors: color ? new Float32Array(total * 4) : null,
      groups: [],
      materials,
      skin: skinned
        ? { bones, indices: new Uint16Array(total * 4), weights: new Float32Array(total * 4) }
        : null,
    };
    const v = new Vector3();
    let out = 0;
    for (const [material, bucket] of [...buckets].sort((a, b) => a[0] - b[0])) {
      mesh.groups.push({ start: out, count: bucket.length / 2, material });
      for (let i = 0; i < bucket.length; i += 2, out++) {
        const corner = bucket[i],
          raw = polygons[corner],
          point = raw < 0 ? ~raw : raw;
        v.set(points[point * 3], points[point * 3 + 1], points[point * 3 + 2]).applyMatrix4(world);
        mesh.positions.set([v.x, v.y, v.z], out * 3);
        if (normal && mesh.normals) {
          const n = lookup(normal, corner, point, bucket[i + 1]) * 3;
          v.set(normal.values[n], normal.values[n + 1], normal.values[n + 2])
            .applyMatrix3(normalMatrix)
            .normalize();
          mesh.normals.set([v.x, v.y, v.z], out * 3);
        }
        if (uv && mesh.uvs) {
          const n = lookup(uv, corner, point, bucket[i + 1]) * 2;
          // FBX measures V upwards; glTF measures it downwards.
          mesh.uvs.set([uv.values[n] ?? 0, 1 - (uv.values[n + 1] ?? 0)], out * 2);
        }
        if (color && mesh.colors) {
          const n = lookup(color, corner, point, bucket[i + 1]) * 4;
          for (let c = 0; c < 4; c++) mesh.colors[out * 4 + c] = color.values[n + c] ?? 1;
        }
        if (mesh.skin) {
          const list = (influences[point] ?? []).sort((a, b) => b[1] - a[1]).slice(0, 4),
            sum = list.reduce((n, [, w]) => n + w, 0) || 1;
          list.forEach(([b, w], k) => {
            mesh.skin!.indices[out * 4 + k] = b;
            mesh.skin!.weights[out * 4 + k] = w / sum;
          });
          if (!list.length) mesh.skin.weights[out * 4] = 1;
        }
      }
    }
    meshes.push(mesh);
  }
  return meshes;
}

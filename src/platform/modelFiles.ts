import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  LinearSRGBColorSpace,
  LoadingManager,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Skeleton,
  SkinnedMesh,
  Texture,
  Vector3,
} from 'three';
import type { Object3D } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { readFbxMeshes } from '../core/fbx/mesh';
import type { FbxMaterial, FbxMesh } from '../core/fbx/mesh';
import { readFbxScene, restRig, rigBase } from '../core/fbx/scene';
import type { FbxModel } from '../core/fbx/scene';
import { decodePsd } from './psd';
import { CHARACTER_EXTENSIONS, MAX_SOURCE_BYTES, PROP_EXTENSIONS } from './sourceFiles';

/** Looks for a file that sits next to the chosen model, such as a texture. */
export type Sidecar = (filename: string) => Promise<Uint8Array | null>;
const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
const basename = (name: string) => name.replace(/\\/g, '/').split('/').pop() ?? name;

/** Decode image bytes the browser cannot always read itself (TGA, PSD) as well as the ones it can. */
async function decodeImage(bytes: Uint8Array, name: string): Promise<Texture | null> {
  try {
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    if (magic === '8BPS') {
      const image = decodePsd(bytes);
      return image ? new DataTexture(image.data, image.width, image.height) : null;
    }
    if (extension(name) === 'tga') {
      const image = new TGALoader().parse(bytes.slice().buffer) as unknown as {
        data: Uint8Array;
        width: number;
        height: number;
      };
      return new DataTexture(image.data, image.width, image.height);
    }
    return new Texture(await createImageBitmap(new Blob([bytes.slice().buffer])));
  } catch {
    return null;
  }
}

class Textures {
  private cache = new Map<string, Promise<Texture | null>>();
  missing = new Set<string>();
  constructor(private sidecar: Sidecar) {}
  get(material: FbxMaterial, slots: string[], color: boolean) {
    const source = slots.map((s) => material.textures.get(s)).find(Boolean);
    if (!source) return Promise.resolve(null);
    const key = source.filename + '|' + color;
    let texture = this.cache.get(key);
    if (!texture) {
      texture = (async () => {
        const name = basename(source.filename);
        const bytes = source.content ?? (name ? await this.sidecar(name) : null);
        const result = bytes ? await decodeImage(bytes, name) : null;
        if (!result) {
          if (name) this.missing.add(name);
          return null;
        }
        result.flipY = false;
        result.wrapS = result.wrapT = RepeatWrapping;
        result.colorSpace = color ? SRGBColorSpace : LinearSRGBColorSpace;
        result.name = name.replace(/\.[^.]+$/, '');
        result.needsUpdate = true;
        return result;
      })();
      this.cache.set(key, texture);
    }
    return texture;
  }
}

async function material(source: FbxMaterial | undefined, textures: Textures, colors: boolean) {
  const result = new MeshStandardMaterial({ metalness: 0, roughness: 0.5, vertexColors: colors });
  if (!source) return result;
  result.name = source.name;
  result.roughness = source.roughness;
  result.map = await textures.get(source, ['DiffuseColor', 'Diffuse', 'BaseColor'], true);
  // A diffuse texture replaces the flat colour, as it does in DCC tools.
  if (!result.map) result.color.setRGB(...source.color, SRGBColorSpace);
  result.normalMap = await textures.get(source, ['NormalMap'], false);
  result.emissiveMap = await textures.get(source, ['EmissiveColor', 'Emissive'], true);
  if (result.emissiveMap) result.emissive.setRGB(1, 1, 1);
  else result.emissive.setRGB(...source.emissive, SRGBColorSpace);
  if (source.opacity < 1) {
    result.opacity = Math.max(0, source.opacity);
    result.transparent = true;
  }
  return result;
}

/** One buffer geometry per material slot, with shared corners welded back together. */
function geometries(mesh: FbxMesh, skin: Map<FbxModel, number> | null) {
  return mesh.groups.map(({ start, count, material }) => {
    const g = new BufferGeometry(),
      cut = (a: Float32Array | Uint16Array, size: number) =>
        a.slice(start * size, (start + count) * size);
    g.setAttribute('position', new BufferAttribute(cut(mesh.positions, 3), 3));
    if (mesh.normals) g.setAttribute('normal', new BufferAttribute(cut(mesh.normals, 3), 3));
    if (mesh.uvs) g.setAttribute('uv', new BufferAttribute(cut(mesh.uvs, 2), 2));
    if (mesh.colors) g.setAttribute('color', new BufferAttribute(cut(mesh.colors, 4), 4));
    if (mesh.skin && skin) {
      const indices = cut(mesh.skin.indices, 4),
        weights = cut(mesh.skin.weights, 4);
      for (let i = 0; i < indices.length; i++)
        indices[i] = weights[i] > 0 ? (skin.get(mesh.skin.bones[indices[i]]) ?? 0) : 0;
      g.setAttribute('skinIndex', new BufferAttribute(indices, 4));
      g.setAttribute('skinWeight', new BufferAttribute(weights, 4));
    }
    const welded = mergeVertices(g, 1e-6);
    if (!mesh.normals) welded.computeVertexNormals();
    return { geometry: welded, material };
  });
}

async function fbxModel(data: Uint8Array, kind: 'character' | 'prop', sidecar: Sidecar) {
  const scene = readFbxScene(data),
    meshes = readFbxMeshes(scene),
    textures = new Textures(sidecar),
    root = new Group();
  if (kind === 'prop') {
    if (!meshes.length) throw Error('No meshes found in this file.');
    for (const mesh of meshes)
      for (const part of geometries(mesh, null)) {
        const m = new Mesh(
          part.geometry,
          await material(mesh.materials[part.material], textures, !!mesh.colors),
        );
        m.name = mesh.name;
        root.add(m);
      }
    return { root, missing: textures.missing };
  }
  if (scene.rigs.length !== 1)
    throw Error(`Choose a character with one armature (found ${scene.rigs.length}).`);
  const rig = scene.rigs[0],
    skinned = meshes.filter((m) => m.skin?.bones.some((b) => rig.bones.includes(b)));
  if (!skinned.length) throw Error('The character has no skinned mesh.');
  // Rest matrices carry the file's unit scale on their axes. Dividing it out leaves
  // unit-scale bones positioned in metres, so nothing downstream inherits a 0.01 scale.
  const unit = Math.cbrt(Math.abs(scene.global.determinant())) || 1,
    plain = (m: Matrix4) => m.clone().scale(new Vector3(1 / unit, 1 / unit, 1 / unit));
  const rest = restRig(scene, rig).map(plain),
    offset = rig.top ? 1 : 0,
    base = plain(rigBase(scene, rig));
  const armature = new Group();
  armature.name = rig.name;
  if (rig.armature) base.decompose(armature.position, armature.quaternion, armature.scale);
  root.add(armature);
  const bones = rig.bones.map((b) => Object.assign(new Bone(), { name: b.name })),
    index = new Map(rig.bones.map((b, i) => [b, i]));
  rig.bones.forEach((b, i) => {
    const parent = b.parent ? index.get(b.parent) : undefined,
      parentWorld =
        parent === undefined ? (rig.armature ? base : new Matrix4()) : rest[parent + offset];
    parentWorld
      .clone()
      .invert()
      .multiply(rest[i + offset])
      .decompose(bones[i].position, bones[i].quaternion, bones[i].scale);
    (parent === undefined ? armature : bones[parent]).add(bones[i]);
  });
  root.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones);
  for (const mesh of skinned)
    for (const part of geometries(mesh, index)) {
      const m = new SkinnedMesh(
        part.geometry,
        await material(mesh.materials[part.material], textures, !!mesh.colors),
      );
      m.name = mesh.name;
      root.add(m);
      m.bind(skeleton, new Matrix4());
    }
  return { root, missing: textures.missing };
}

/** Load a .gltf whose buffers and images sit beside it, fetching each through `sidecar`. */
async function gltfModel(data: Uint8Array, sidecar: Sidecar) {
  const json = JSON.parse(new TextDecoder().decode(data)) as {
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
  };
  const urls = new Map<string, string>();
  try {
    for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) {
      if (!item.uri || item.uri.startsWith('data:') || urls.has(item.uri)) continue;
      const bytes = await sidecar(decodeURIComponent(item.uri));
      if (!bytes)
        throw Error(
          `This glTF needs "${item.uri}", which is not available here. Save it as one self-contained .glb file.`,
        );
      urls.set(item.uri, URL.createObjectURL(new Blob([bytes.slice().buffer])));
    }
    const manager = new LoadingManager();
    manager.setURLModifier((url) => urls.get(url) ?? url);
    return (await new GLTFLoader(manager).parseAsync(data.slice().buffer, '')).scene;
  } finally {
    for (const url of urls.values()) URL.revokeObjectURL(url);
  }
}

function strip(root: Object3D, kind: 'character' | 'prop') {
  // Props are plain geometry: a skinned prop keeps its rest shape and loses its skeleton.
  if (kind !== 'prop') return root;
  root.updateMatrixWorld(true);
  const out = new Group();
  root.traverse((o) => {
    const source = o as Mesh;
    if (!source.isMesh) return;
    const m = new Mesh(source.geometry, source.material);
    m.name = source.name;
    m.applyMatrix4(source.matrixWorld);
    out.add(m);
  });
  if (!out.children.length) throw Error('No meshes found in this file.');
  return out;
}

/**
 * Turn a character or prop file into one self-contained GLB, inside the app.
 * GLB input is returned untouched.
 */
export async function convertModel(
  name: string,
  data: Uint8Array,
  kind: 'character' | 'prop',
  sidecar: Sidecar = async () => null,
): Promise<{ data: Uint8Array; missing: string[] }> {
  const type = extension(name);
  if (type === 'glb') return { data, missing: [] };
  if (!(kind === 'prop' ? PROP_EXTENSIONS : CHARACTER_EXTENSIONS).includes(type))
    throw Error(
      type === 'blend'
        ? 'Blender files cannot be read directly. Export the model from Blender as GLB or FBX.'
        : kind === 'prop'
          ? 'Choose a GLB, glTF, FBX or OBJ prop.'
          : 'Choose an FBX, GLB or glTF character.',
    );
  if (data.length > MAX_SOURCE_BYTES) throw Error('Choose a model below 256 MB.');
  let root: Object3D,
    missing = new Set<string>();
  if (type === 'fbx') ({ root, missing } = await fbxModel(data, kind, sidecar));
  else if (type === 'gltf') root = strip(await gltfModel(data, sidecar), kind);
  else {
    root = new OBJLoader().parse(new TextDecoder().decode(data));
    root.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.material = new MeshStandardMaterial({ metalness: 0, roughness: 0.5 });
    });
    root = strip(root, kind);
  }
  const output = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false });
  return { data: new Uint8Array(output as ArrayBuffer), missing: [...missing] };
}

import { Euler, Matrix4, Vector3 } from 'three';
import { writeFbx } from './export';
import type {
  ExportArmature,
  ExportMaterial,
  ExportMesh,
  ExportPose,
  ExportTexture,
} from './export';
import { GltfAnimation, imageBytes, readGlb } from './gltf';
import type { Gltf } from './gltf';
import { GltfScene, joinMeshes, transformMesh } from './gltfScene';
import type { SceneMaterial, SceneMesh } from './gltfScene';

export const CREATOR = 'Pose Studio';
/** Scene Z up, X forward: the axes Unreal's FBX importer is set up for here. */
export const FORWARD_X = new Matrix4().makeRotationZ(-Math.PI / 2);
/** Centimetre scenes are written with the unit factor earlier exports carried. */
const CENTIMETRES = 0.9999999776482582;
const BONE_SIZE = 3.300000049173832;

export const safeName = (value: string, fallback = 'Asset') =>
  value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || fallback;

export interface TextureFile {
  /** Path inside the export folder. */
  path: string;
  data: Uint8Array;
}
/** Turns glTF materials into FBX ones, collecting the image files they use. */
export class Materials {
  readonly files = new Map<string, TextureFile>();
  private cache = new Map<string, ExportMaterial>();
  constructor(
    private gltf: Gltf,
    /** Put in front of every image file name, so packages can hold several models. */
    private prefix = '',
  ) {}
  private texture(slot: string, ref: { index: number } | undefined): ExportTexture[] {
    const source = ref === undefined ? undefined : this.gltf.json.textures?.[ref.index]?.source,
      content = source === undefined ? null : imageBytes(this.gltf, source);
    if (source === undefined || !content) return [];
    const image = this.gltf.json.images![source].name || 'Image_' + source,
      type = content[0] === 0xff && content[1] === 0xd8 ? 'jpg' : 'png',
      file = this.prefix + safeName(image) + '.' + type;
    this.files.set(file, { path: 'Textures/' + file, data: content });
    return [{ slot, image, file, content }];
  }
  get({ index, tinted }: SceneMaterial): ExportMaterial {
    const key = index + (tinted ? 't' : '');
    let out = this.cache.get(key);
    if (out) return out;
    const m = this.gltf.json.materials?.[index],
      pbr = m?.pbrMetallicRoughness,
      base = this.texture('DiffuseColor', pbr?.baseColorTexture),
      // A packed roughness and metal image is saved with the others; FBX has no slot for it,
      // and the flat values then keep their neutral defaults.
      packed = this.texture('', pbr?.metallicRoughnessTexture).length > 0,
      normal = this.texture('NormalMap', m?.normalTexture),
      emissive = this.texture('EmissiveColor', m?.emissiveTexture),
      factor = m?.emissiveFactor ?? [0, 0, 0],
      strength = (m?.extensions?.KHR_materials_emissive_strength as { emissiveStrength?: number })
        ?.emissiveStrength;
    out = {
      name: m?.name || (m ? 'Material_' + index : 'DefaultMaterial'),
      // Vertex colours take over the flat colour, which then keeps its neutral default.
      color: tinted
        ? [0.8, 0.8, 0.8]
        : ((pbr?.baseColorFactor?.slice(0, 3) as [number, number, number]) ?? [1, 1, 1]),
      emissive: emissive.length ? [1, 1, 1] : (factor as [number, number, number]),
      emissiveStrength: strength ?? 1,
      roughness: packed ? 0.5 : (pbr?.roughnessFactor ?? 1),
      metallic: packed ? 0 : (pbr?.metallicFactor ?? 1),
      textures: [...base, ...emissive, ...normal],
    };
    this.cache.set(key, out);
    return out;
  }
}

const srgb = (v: number) =>
  Math.round(
    255 * Math.min(1, Math.max(0, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)),
  ) / 255;
export function exportMesh(
  mesh: SceneMesh,
  armature: ExportArmature | null,
  materials: Materials,
  smoothing: boolean,
  names = { uv: 'UVMap', color: 'Color' },
): ExportMesh {
  let color: Float32Array | null = null;
  if (mesh.color) {
    // Colours are stored as display values, eight bits each, as vertex paint is.
    color = mesh.color.slice();
    for (let i = 0; i < color.length; i++)
      color[i] = i % 4 === 3 ? Math.round(color[i] * 255) / 255 : srgb(color[i]);
  }
  return {
    kind: 'mesh',
    name: mesh.name,
    data: mesh.data,
    world: mesh.world,
    points: Float64Array.from(mesh.points),
    triangles: mesh.corners,
    normals: mesh.normals,
    uv: mesh.uv ? { name: names.uv, values: mesh.uv } : null,
    color: color ? { name: names.color, values: color } : null,
    smoothing: smoothing ? mesh.smooth : null,
    materials: mesh.materials.map((m) => materials.get(m)),
    slots: mesh.materials.length > 1 ? mesh.slots : null,
    skin:
      armature && mesh.groups
        ? {
            armature,
            groups: armature.bones.map((_, b) => {
              const group = [...(mesh.groups![b] ?? [])].sort((x, y) => x[0] - y[0]);
              return { indexes: group.map((g) => g[0]), weights: group.map((g) => g[1]) };
            }),
          }
        : null,
  };
}
function exportArmature(scene: GltfScene, name?: string): ExportArmature {
  if (!scene.armature) throw Error('The export has no skeleton.');
  return {
    kind: 'armature',
    name: name ?? scene.armature.name,
    world: scene.armature.world,
    bones: scene.armature.bones.map((b) => ({ name: b.name, parent: b.parent, rest: b.rest })),
  };
}
const posed = (objects: (ExportArmature | ExportMesh)[], bones: Matrix4[]): ExportPose => ({
  objects: objects.map((o) => o.world),
  bones: [bones],
});

/** A character of a shared-skeleton package: one FBX per body part that has geometry. */
export async function sharedCharacterFbx(glb: Uint8Array, label: string) {
  const gltf = readGlb(glb),
    scene = new GltfScene(gltf, { unit: 100 }),
    armature = exportArmature(scene, 'Armature'),
    materials = new Materials(gltf, label + '_'),
    files: { variant: 'body' | 'arms' | 'legs'; path: string; data: Uint8Array }[] = [];
  for (const [variant, prefix] of [
    ['body', 'Body__'],
    ['arms', 'Arms__'],
    ['legs', 'Legs__'],
  ] as const) {
    const parts = scene.skinned.filter((m) => m.name.startsWith(prefix));
    // Partial characters export only the geometry they actually contain.
    if (!parts.length) continue;
    const name = 'SK_' + label + '_' + variant[0].toUpperCase() + variant.slice(1),
      mesh = exportMesh(joinMeshes(parts, name), armature, materials, true),
      objects = [armature, mesh];
    files.push({
      variant,
      path: 'Characters/' + label + '/' + name + '.fbx',
      data: await writeFbx(
        {
          objects,
          global: FORWARD_X,
          unit: CENTIMETRES,
          boneSize: BONE_SIZE,
          media: name + '.fbm',
          fps: 30,
          pose: posed(objects, scene.pose()),
          animation: null,
        },
        CREATOR,
      ),
    });
  }
  const bones = scene.armature!.bones;
  return {
    files,
    textures: [...materials.files.values()],
    hierarchy: bones.map((b) => ({ name: b.name, parent: bones[b.parent]?.name ?? null })),
    /** Rest matrix of every bone in scene space, row by row. */
    referencePose: Object.fromEntries(
      bones.map((b) => [b.name, armature.world.clone().multiply(b.rest).transpose().toArray()]),
    ) as Record<string, number[]>,
    /** Rest offset of every bone from its parent. */
    offsets: Object.fromEntries(
      bones.map((b) => [
        b.name,
        new Vector3().setFromMatrixPosition(
          b.parent < 0 ? b.rest : bones[b.parent].rest.clone().invert().multiply(b.rest),
        ),
      ]),
    ) as Record<string, Vector3>,
  };
}

/** One clip of a shared-skeleton package: the skeleton alone, keyed on every sample. */
export async function sharedAnimationFbx(
  glb: Uint8Array,
  rate: number,
  end: number,
  offsets: Record<string, Vector3>,
) {
  const gltf = readGlb(glb),
    scene = new GltfScene(gltf, { unit: 100 }),
    armature = exportArmature(scene, 'Armature'),
    animation = new GltfAnimation(gltf, 0),
    bones = scene.armature!.bones,
    objects = [armature],
    translated = new Set<string>(),
    at = new Vector3();
  const sample = (frame: number) => {
    const pose = scene.pose(animation, frame / rate);
    // Bones that leave their rest offset need their translation kept in Unreal.
    bones.forEach((b, i) => {
      const rest = offsets[b.name];
      if (!rest || translated.has(b.name)) return;
      at.setFromMatrixPosition(
        b.parent < 0 ? pose[i] : pose[b.parent].clone().invert().multiply(pose[i]),
      );
      if (at.distanceTo(rest) > 0.001) translated.add(b.name);
    });
    return posed(objects, pose);
  };
  const data = await writeFbx(
    {
      objects,
      global: FORWARD_X,
      unit: CENTIMETRES,
      boneSize: BONE_SIZE,
      media: '',
      fps: rate,
      pose: sample(0),
      animation: { name: 'Scene', first: 0, count: end + 1, sample },
    },
    CREATOR,
  );
  return {
    data,
    translated,
    hierarchy: bones.map((b) => ({ name: b.name, parent: bones[b.parent]?.name ?? null })),
  };
}

export interface PropPlacement {
  offset: number[];
  /** Degrees about X, Y and Z. */
  rotation: number[];
  scale: number;
}
/** A prop as a static mesh, baked so it sits on its socket with no further transform. */
export async function sharedPropFbx(glb: Uint8Array, placement: PropPlacement, label: string) {
  const gltf = readGlb(glb),
    scene = new GltfScene(gltf, { unit: 100 }),
    parts = [...scene.skinned, ...scene.statics],
    materials = new Materials(gltf, label + '_');
  if (!parts.length) throw Error('Prop has no geometry: ' + label);
  // Socket bones are a quarter turn about X away from the prop's own axes.
  const socket = new Matrix4().makeRotationX(-Math.PI / 2),
    rad = Math.PI / 180,
    place = new Matrix4()
      .makeTranslation(
        placement.offset[0] * 100,
        placement.offset[1] * 100,
        placement.offset[2] * 100,
      )
      .multiply(
        new Matrix4().makeRotationFromEuler(
          new Euler(
            placement.rotation[0] * rad,
            placement.rotation[1] * rad,
            placement.rotation[2] * rad,
          ),
        ),
      )
      .multiply(new Matrix4().makeScale(placement.scale, placement.scale, placement.scale))
      .multiply(socket);
  const name = 'SM_' + label,
    joined = joinMeshes(
      parts.map((p) => transformMesh({ ...p, groups: null }, place.clone().multiply(p.world))),
      name,
    ),
    objects = [exportMesh(joined, null, materials, true)];
  return {
    path: 'Props/' + name + '.fbx',
    data: await writeFbx(
      {
        objects,
        global: FORWARD_X,
        unit: CENTIMETRES,
        boneSize: BONE_SIZE,
        media: name + '.fbm',
        fps: 24,
        pose: posed(objects, []),
        animation: null,
      },
      CREATOR,
    ),
    textures: [...materials.files.values()],
  };
}

/** A retargeted character with its baked clip, Y up, as other tools expect a glTF scene. */
export async function retargetFbx(glb: Uint8Array, fps: number, end: number, name: string) {
  const gltf = readGlb(glb),
    scene = new GltfScene(gltf, { unit: 1 }),
    armature = exportArmature(scene),
    materials = new Materials(gltf),
    animation = gltf.json.animations?.length ? new GltfAnimation(gltf, 0) : undefined,
    objects = [
      armature,
      ...[...scene.skinned, ...scene.statics].map((m) =>
        exportMesh(m, m.groups ? armature : null, materials, false),
      ),
    ],
    sample = (frame: number) => posed(objects, scene.pose(animation, frame / fps));
  return writeFbx(
    {
      objects,
      global: new Matrix4()
        .makeScale(100, 100, 100)
        .multiply(new Matrix4().makeRotationX(-Math.PI / 2)),
      unit: 1,
      boneSize: BONE_SIZE,
      media: name + '.fbm',
      fps,
      pose: sample(0),
      animation: { name: 'Scene', first: 0, count: end + 1, sample },
    },
    CREATOR,
  );
}

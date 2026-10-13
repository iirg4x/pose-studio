import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import {
  FullSkinnedMesh,
  fullSkinLoader,
  skinSets,
  skinWeightFor,
} from '../src/scene/skinInfluences';
import { maskedGeometry } from '../src/scene/meshMask';
import { MeshGrounding } from '../src/scene/meshGrounding';

function fixture() {
  const chunks: Uint8Array[] = [],
    views: { buffer: number; byteOffset: number; byteLength: number }[] = [],
    accessors: Record<string, unknown>[] = [];
  let size = 0;
  function attribute(array: Float32Array | Uint16Array, type: string, count: number) {
    const pad = (4 - (size % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      size += pad;
    }
    views.push({ buffer: 0, byteOffset: size, byteLength: array.byteLength });
    chunks.push(new Uint8Array(array.buffer));
    size += array.byteLength;
    accessors.push({
      bufferView: views.length - 1,
      componentType: array instanceof Float32Array ? 5126 : 5123,
      type,
      count,
    });
    return accessors.length - 1;
  }
  const attributes = {
    POSITION: attribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3', 3),
    JOINTS_0: attribute(new Uint16Array(12), 'VEC4', 3),
    WEIGHTS_0: attribute(
      new Float32Array([0.25, 0, 0, 0, 0.25, 0, 0, 0, 0.25, 0, 0, 0]),
      'VEC4',
      3,
    ),
    JOINTS_1: attribute(new Uint16Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 'VEC4', 3),
    WEIGHTS_1: attribute(
      new Float32Array([0.75, 0, 0, 0, 0.75, 0, 0, 0, 0.75, 0, 0, 0]),
      'VEC4',
      3,
    ),
  };
  const indices = attribute(new Uint16Array([0, 1, 2]), 'SCALAR', 3),
    bind = attribute(
      new Float32Array([...new T.Matrix4().elements, ...new T.Matrix4().elements]),
      'MAT4',
      2,
    ),
    buffer = Buffer.concat(chunks);
  accessors[attributes.POSITION].min = [0, 0, 0];
  accessors[attributes.POSITION].max = [1, 1, 0];
  const json = JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ byteLength: size }],
    bufferViews: views,
    accessors,
    meshes: [{ primitives: [{ attributes, indices }] }],
    skins: [{ joints: [1, 2], inverseBindMatrices: bind }],
    nodes: [{ mesh: 0, skin: 0 }, { name: 'root', children: [2] }, { name: 'foot_l' }],
    scenes: [{ nodes: [0, 1] }],
    scene: 0,
  });
  const text = Buffer.from(json + ' '.repeat((4 - (json.length % 4)) % 4)),
    binary = Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4)]),
    glb = Buffer.alloc(28 + text.length + binary.length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(text.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  text.copy(glb, 20);
  glb.writeUInt32LE(binary.length, 20 + text.length);
  glb.writeUInt32LE(0x004e4942, 24 + text.length);
  binary.copy(glb, 28 + text.length);
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
}
async function load() {
  const scene = (await fullSkinLoader().parseAsync(fixture(), '')).scene;
  let mesh!: FullSkinnedMesh;
  scene.traverse((o) => {
    if (o instanceof T.SkinnedMesh) mesh = o as FullSkinnedMesh;
  });
  return { scene, mesh, bone: mesh.skeleton.bones[1] };
}
describe('complete skin influences', () => {
  it('preserves the combined original weights during glTF load and CPU deformation', async () => {
    const { scene, mesh, bone } = await load();
    expect(mesh).toBeInstanceOf(FullSkinnedMesh);
    // Scene precompilation happens before the first render callback.
    expect(
      (mesh.material as T.Material & { defines: Record<string, unknown> }).defines.POSE_SKIN_SETS,
    ).toBe(2);
    expect(skinSets(mesh.geometry).map((s) => s.weight.getX(0))).toEqual([0.25, 0.75]);
    bone.position.x = 4;
    scene.updateMatrixWorld(true);
    expect(mesh.applyBoneTransform(0, new T.Vector3()).x).toBeCloseTo(3, 6);
    expect(skinWeightFor(mesh, 0, (n) => n === 'foot_l')).toBe(0.75);
  });
  it('keeps multi-influence CPU behavior through skeleton clones and material clones', async () => {
    const { scene } = await load(),
      copy = cloneSkeleton(scene);
    let mesh!: FullSkinnedMesh;
    copy.traverse((o) => {
      if (o instanceof T.SkinnedMesh) mesh = o as FullSkinnedMesh;
    });
    mesh.material = (mesh.material as T.Material).clone();
    mesh.skeleton.bones[1].position.y = -2;
    copy.updateMatrixWorld(true);
    expect(mesh).toBeInstanceOf(FullSkinnedMesh);
    expect(mesh.applyBoneTransform(0, new T.Vector3()).y).toBeCloseTo(-1.5, 6);
    const m = mesh.material as T.Material & { defines: Record<string, unknown> };
    mesh.onBeforeRender(null!, null!, null!, mesh.geometry, m);
    expect(m.defines.POSE_SKIN_SETS).toBe(2);
    const depth = new T.MeshDepthMaterial() as T.MeshDepthMaterial & {
      defines: Record<string, unknown>;
    };
    mesh.onBeforeShadow(null!, null!, null!, null!, mesh.geometry, depth);
    expect(depth.defines.POSE_SKIN_SETS).toBe(2);
    expect(T.ShaderChunk.skinning_vertex).toContain('poseBone1x*skinVertex*weights_1.x');
    expect(T.ShaderChunk.skinnormal_vertex).toContain('weights_1.x*poseBone1x');
  });
  it('uses additional influences for mesh masks and grounding rather than losing those vertices', async () => {
    const { scene, mesh, bone } = await load();
    bone.position.y = -2;
    scene.updateMatrixWorld(true);
    const mask = maskedGeometry(mesh, /^foot_l$/, 0.7);
    expect(mask.index!.count).toBe(3);
    const grounding = new MeshGrounding();
    expect(grounding.minimum(scene, bone, bone.matrixWorld)).toBeCloseTo(-1.5, 6);
    expect(grounding.lift(scene, bone, bone.matrixWorld, 0)).toBeCloseTo(2, 6);
  });
});

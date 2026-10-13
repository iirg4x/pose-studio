import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTFLoaderPlugin, GLTFParser } from 'three/addons/loaders/GLTFLoader.js';

type Attribute = T.BufferAttribute | T.InterleavedBufferAttribute;
export type SkinSet = {
  index: Attribute;
  weight: Attribute;
  indexName: string;
  weightName: string;
};
const setsCache = new WeakMap<T.BufferGeometry, SkinSet[]>();
export function skinSets(g: T.BufferGeometry): SkinSet[] {
  const cached = setsCache.get(g);
  if (
    cached &&
    cached.every(
      (s) => g.getAttribute(s.indexName) === s.index && g.getAttribute(s.weightName) === s.weight,
    ) &&
    !g.getAttribute(cached.length ? 'joints_' + cached.length : 'skinIndex')
  )
    return cached;
  const result: SkinSet[] = [];
  for (let i = 0; ; i++) {
    const indexName = i ? 'joints_' + i : 'skinIndex',
      weightName = i ? 'weights_' + i : 'skinWeight';
    const index = g.getAttribute(indexName),
      weight = g.getAttribute(weightName);
    if (!index || !weight) break;
    result.push({ index, weight, indexName, weightName });
  }
  setsCache.set(g, result);
  return result;
}
export function skinWeightFor(
  mesh: T.SkinnedMesh,
  vertex: number,
  accept: (name: string) => boolean,
) {
  let result = 0;
  for (const { index, weight } of skinSets(mesh.geometry))
    for (let k = 0; k < 4; k++)
      if (accept(mesh.skeleton.bones[index.getComponent(vertex, k)]?.name ?? ''))
        result += weight.getComponent(vertex, k);
  return result;
}

// Three's built-in skinning shader and CPU queries use JOINTS_0 only. Keep both
// paths consistent for imported multi-set skins, including picking and shadows.
const originalChunks = {
  pars: T.ShaderChunk.skinning_pars_vertex,
  base: T.ShaderChunk.skinbase_vertex,
  position: T.ShaderChunk.skinning_vertex,
  normal: T.ShaderChunk.skinnormal_vertex,
};
let shaderSets = 1;
function extendShaders(count: number) {
  if (count <= shaderSets) return;
  shaderSets = count;
  let pars = '',
    base = '',
    position = '',
    normal = '';
  for (let i = 1; i < count; i++) {
    const guard = `\n#if defined(USE_SKINNING) && POSE_SKIN_SETS > ${i}\n`;
    pars += guard + `attribute vec4 joints_${i};\nattribute vec4 weights_${i};\n#endif\n`;
    let matrices = '',
      positions = '',
      normals = '';
    for (const axis of ['x', 'y', 'z', 'w']) {
      const name = `poseBone${i}${axis}`;
      matrices += `mat4 ${name}=getBoneMatrix(joints_${i}.${axis});\n`;
      positions += `skinned+=${name}*skinVertex*weights_${i}.${axis};\n`;
      normals += `skinMatrix+=weights_${i}.${axis}*${name};\n`;
    }
    base += guard + matrices + '#endif\n';
    position += guard + positions + '#endif\n';
    normal += guard + normals + '#endif\n';
  }
  // compileAsync can visit an unprepared material before onBeforeRender. GLSL
  // requires a defined integer here even for non-skinned meshes using the chunk.
  T.ShaderChunk.skinning_pars_vertex =
    '#ifndef POSE_SKIN_SETS\n#define POSE_SKIN_SETS 1\n#endif\n' + originalChunks.pars + pars;
  T.ShaderChunk.skinbase_vertex = originalChunks.base + base;
  T.ShaderChunk.skinning_vertex = originalChunks.position.replace(
    'transformed =',
    position + '\ntransformed =',
  );
  T.ShaderChunk.skinnormal_vertex = originalChunks.normal.replace(
    'skinMatrix = bindMatrixInverse',
    normal + '\nskinMatrix = bindMatrixInverse',
  );
}
function prepareMaterial(material: T.Material, count: number) {
  extendShaders(count);
  const m = material as T.Material & { defines?: Record<string, unknown> };
  if (m.defines?.POSE_SKIN_SETS === count) return;
  m.defines = { ...m.defines, POSE_SKIN_SETS: count };
  m.needsUpdate = true;
}
const basePoint = new T.Vector3(),
  weightedPoint = new T.Vector3(),
  boneMatrix = new T.Matrix4();
export class FullSkinnedMesh extends T.SkinnedMesh {
  override applyBoneTransform(index: number, target: T.Vector3) {
    const sets = skinSets(this.geometry);
    if (sets.length < 2) return super.applyBoneTransform(index, target);
    basePoint.copy(target).applyMatrix4(this.bindMatrix);
    target.set(0, 0, 0);
    for (const set of sets)
      for (let k = 0; k < 4; k++) {
        const weight = set.weight.getComponent(index, k);
        if (!weight) continue;
        const bone = set.index.getComponent(index, k);
        boneMatrix.multiplyMatrices(
          this.skeleton.bones[bone].matrixWorld,
          this.skeleton.boneInverses[bone],
        );
        target.addScaledVector(weightedPoint.copy(basePoint).applyMatrix4(boneMatrix), weight);
      }
    return target.applyMatrix4(this.bindMatrixInverse);
  }
  override normalizeSkinWeights() {
    const sets = skinSets(this.geometry);
    if (sets.length < 2) return super.normalizeSkinWeights();
    for (let v = 0; v < sets[0].weight.count; v++) {
      let total = 0;
      for (const s of sets)
        for (let k = 0; k < 4; k++) total += Math.max(0, s.weight.getComponent(v, k));
      for (const [i, s] of sets.entries())
        for (let k = 0; k < 4; k++)
          s.weight.setComponent(
            v,
            k,
            total ? Math.max(0, s.weight.getComponent(v, k)) / total : Number(i === 0 && k === 0),
          );
    }
  }
  override onBeforeRender(
    _renderer: T.WebGLRenderer,
    _scene: T.Scene,
    _camera: T.Camera,
    _geometry: T.BufferGeometry,
    material: T.Material,
  ) {
    prepareMaterial(material, skinSets(this.geometry).length);
  }
  override onBeforeShadow(
    _renderer: T.WebGLRenderer,
    _object: T.Object3D,
    _camera: T.Camera,
    _shadowCamera: T.Camera,
    _geometry: T.BufferGeometry,
    material: T.Material,
  ) {
    prepareMaterial(material, skinSets(this.geometry).length);
  }
}
export function prepareSkinMesh(mesh: T.SkinnedMesh) {
  if (!(mesh instanceof FullSkinnedMesh)) Object.setPrototypeOf(mesh, FullSkinnedMesh.prototype);
  const count = skinSets(mesh.geometry).length;
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    prepareMaterial(material, count);
  return mesh as FullSkinnedMesh;
}
export function prepareSkinRoot(root: T.Object3D) {
  root.traverse((o) => {
    if (o instanceof T.SkinnedMesh) prepareSkinMesh(o);
  });
}

/** Preserve original weights before GLTFLoader normalizes the first set alone. */
function fullSkinPlugin(parser: GLTFParser): GLTFLoaderPlugin {
  const original = new Map<string, Attribute[]>();
  return {
    name: 'PoseFullSkinInfluences',
    async beforeRoot() {
      await Promise.all(
        (parser.json.meshes ?? []).flatMap(
          (mesh: { primitives: { attributes: Record<string, number> }[] }, mi: number) =>
            mesh.primitives.map(async (p, pi) => {
              if (p.attributes.WEIGHTS_1 === undefined) return;
              const weights: Attribute[] = [];
              for (let i = 0; p.attributes['WEIGHTS_' + i] !== undefined; i++)
                weights.push(
                  (
                    (await parser.getDependency(
                      'accessor',
                      p.attributes['WEIGHTS_' + i],
                    )) as Attribute
                  ).clone(),
                );
              original.set(mi + ':' + pi, weights);
            }),
        ),
      );
    },
    async afterRoot(result) {
      for (const scene of result.scenes)
        scene.traverse((o) => {
          if (!(o instanceof T.SkinnedMesh)) return;
          const association = parser.associations.get(o) as
              | { meshes?: number; primitives?: number }
              | undefined,
            weights = original.get(association?.meshes + ':' + association?.primitives);
          if (weights)
            for (const [i, w] of weights.entries())
              o.geometry.setAttribute(
                i ? 'weights_' + i : 'skinWeight',
                new T.Float32BufferAttribute(
                  Array.from({ length: w.count * 4 }, (_, v) =>
                    w.getComponent(Math.floor(v / 4), v % 4),
                  ),
                  4,
                ),
              );
          prepareSkinMesh(o);
          if (weights) o.normalizeSkinWeights();
        });
    },
  };
}
export const fullSkinLoader = () => new GLTFLoader().register(fullSkinPlugin);

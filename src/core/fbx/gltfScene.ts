import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { GltfAnimation, accessor, nodeMatrix } from './gltf';
import type { Gltf } from './gltf';

/**
 * Lays a glTF scene out the way Unreal-bound FBX files expect it: Z up, bones
 * turned a quarter turn about X onto their own Y axis, the rest pose taken from the inverse bind
 * matrices and every skinned mesh moved into that rest pose. The conventions
 * follow the glTF importer of the DCC tool earlier versions of this app used,
 * so skeletons written now line up with the ones already in Unreal projects.
 */
export interface SceneOptions {
  /** Scene units per metre: 100 for centimetres. */
  unit: number;
}
export interface SceneBone {
  name: string;
  node: number;
  /** Index into the bone list, or -1 at the top. */
  parent: number;
  /** Rest matrix in armature space. */
  rest: Matrix4;
  turn: Matrix4;
}
export interface SceneMaterial {
  index: number;
  tinted: boolean;
}
const slotOf = (list: SceneMaterial[], m: SceneMaterial) => {
  const at = list.findIndex((v) => v.index === m.index && v.tinted === m.tinted);
  return at < 0 ? list.push(m) - 1 : at;
};
export interface SceneMesh {
  name: string;
  /** Name of the glTF mesh the geometry came from. */
  data: string;
  /** Object matrix in scene space. Skinned meshes share the armature's. */
  world: Matrix4;
  points: Float32Array;
  /** Triangle corner → point. */
  corners: Uint32Array;
  /** One normal per corner. */
  normals: Float32Array;
  uv: Float32Array | null;
  color: Float32Array | null;
  /** 1 for a smooth triangle, 0 for a flat one. */
  smooth: Uint8Array;
  /** Material slot per triangle. */
  slots: Int32Array;
  /** Per slot: the glTF material (-1 for none) and whether its triangles carry vertex colours. */
  materials: SceneMaterial[];
  /** Per armature bone: point → weight. */
  groups: Map<number, number>[] | null;
}

const ROOT = -1;
/** A matrix without its scale. */
const rigid = (m: Matrix4) => {
  const t = new Vector3(),
    r = new Quaternion();
  m.decompose(t, r, new Vector3());
  return new Matrix4().compose(t, r, new Vector3(1, 1, 1));
};

export class GltfScene {
  readonly armature: { name: string; world: Matrix4; bones: SceneBone[] } | null = null;
  readonly skinned: SceneMesh[] = [];
  readonly statics: SceneMesh[] = [];
  private parents: number[];
  /** glTF Y-up → Z-up. */
  private axes = new Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
  private back = this.axes.clone().invert();

  constructor(
    readonly gltf: Gltf,
    private options: SceneOptions,
  ) {
    const nodes = gltf.json.nodes ?? [],
      skins = gltf.json.skins ?? [];
    this.parents = nodes.map(() => ROOT);
    nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (this.parents[c] = i)));
    const path = (node: number) => {
      const out: number[] = [];
      for (let n = node; n !== ROOT; n = this.parents[n]) out.unshift(n);
      return out;
    };

    // The armature sits above every joint; everything between it and a joint is a bone.
    const isBone = new Set<number>();
    let armature: number | undefined;
    for (const skin of skins) {
      let common: number[] | undefined;
      for (const joint of [
        ...skin.joints,
        ...(skin.skeleton === undefined ? [] : [skin.skeleton]),
      ]) {
        const p = path(joint);
        if (!common) common = p;
        else {
          let k = 0;
          while (k < common.length && k < p.length && common[k] === p[k]) k++;
          common = common.slice(0, k);
        }
      }
      let top = common?.length ? common[common.length - 1] : ROOT;
      if (skin.joints.includes(top)) top = this.parents[top];
      if (armature !== undefined && armature !== top)
        throw Error('The model has more than one skeleton.');
      armature = top;
      for (const joint of skin.joints)
        for (let n = joint; n !== top; n = this.parents[n]) isBone.add(n);
    }

    if (armature !== undefined) {
      const order: number[] = [];
      const visit = (n: number) => {
        if (!isBone.has(n)) return;
        order.push(n);
        (nodes[n].children ?? []).forEach(visit);
      };
      (armature === ROOT ? this.roots() : (nodes[armature].children ?? [])).forEach(visit);
      const index = new Map(order.map((n, i) => [n, i]));

      // Bind matrices, in scene space, of every node the skins describe.
      const inverse = new Map<number, Matrix4>([[ROOT, new Matrix4()]]);
      for (const skin of skins) {
        if (skin.inverseBindMatrices === undefined) continue;
        let skeleton = skin.skeleton;
        if (skeleton !== undefined) {
          if (skin.joints.includes(skeleton)) skeleton = this.parents[skeleton];
          if (!inverse.has(skeleton)) inverse.set(skeleton, new Matrix4());
        }
        const values = accessor(gltf, skin.inverseBindMatrices).values;
        skin.joints.forEach((joint, i) =>
          inverse.set(joint, this.convert(new Matrix4().fromArray(values, i * 16))),
        );
      }
      // Bones lie along their own Y axis: a quarter turn about X from the glTF joint.
      const turn = new Matrix4().makeRotationX(Math.PI / 2),
        bind: Matrix4[] = [];
      const bones: SceneBone[] = order.map((node, i) => {
        const up = this.parents[node],
          parent = index.get(up) ?? -1,
          a = inverse.get(up),
          b = inverse.get(node),
          local = rigid(
            a && b ? a.clone().multiply(b.clone().invert()) : this.convert(nodeMatrix(nodes[node])),
          );
        bind[i] = (parent < 0 ? new Matrix4() : bind[parent].clone()).multiply(local);
        return {
          name: nodes[node].name ?? 'Node_' + node,
          node,
          parent,
          rest: bind[i].clone().multiply(turn),
          turn,
        };
      });
      const name =
        (armature === ROOT ? undefined : nodes[armature].name) ??
        skins.find((s) => s.name)?.name ??
        'Armature';
      this.armature = { name, world: this.world(armature), bones };

      const cache = new Map<string, SceneMesh>();
      nodes.forEach((node) => {
        if (node.mesh === undefined || node.skin === undefined) return;
        const key = node.mesh + ':' + node.skin,
          skin = skins[node.skin];
        let mesh = cache.get(key);
        if (!mesh) {
          const values =
            skin.inverseBindMatrices === undefined
              ? null
              : accessor(gltf, skin.inverseBindMatrices).values;
          // Moves a point bound with this skin's matrices onto the shared rest pose.
          const joints = skin.joints.map((joint, j) =>
            bind[index.get(joint)!]
              .clone()
              .multiply(
                values ? this.convert(new Matrix4().fromArray(values, j * 16)) : new Matrix4(),
              ),
          );
          mesh = this.mesh(node.mesh, { joints, bones: skin.joints.map((j) => index.get(j)!) });
          cache.set(key, mesh);
        }
        this.skinned.push({ ...mesh, name: node.name ?? mesh.data, world: this.armature!.world });
      });
    }
    nodes.forEach((node, n) => {
      if (node.mesh === undefined || (node.skin !== undefined && this.armature)) return;
      const mesh = this.mesh(node.mesh, null);
      this.statics.push({ ...mesh, name: node.name ?? mesh.data, world: this.world(n) });
    });
  }

  private roots() {
    const json = this.gltf.json;
    return (
      json.scenes?.[json.scene ?? 0]?.nodes ??
      this.parents.flatMap((p, i) => (p === ROOT ? [i] : []))
    );
  }
  /** A glTF matrix in scene axes and units. */
  private convert(m: Matrix4) {
    const out = this.axes.clone().multiply(m).multiply(this.back),
      u = this.options.unit;
    out.elements[12] *= u;
    out.elements[13] *= u;
    out.elements[14] *= u;
    return out;
  }
  private world(node: number) {
    const m = new Matrix4();
    for (let n = node; n !== ROOT; n = this.parents[n])
      m.premultiply(nodeMatrix(this.gltf.json.nodes![n]));
    return this.convert(m);
  }

  /** Armature-space matrix of every bone, at rest or at a time of an animation. */
  pose(animation?: GltfAnimation, time = 0): Matrix4[] {
    const nodes = this.gltf.json.nodes ?? [],
      bones = this.armature?.bones ?? [],
      chain: Matrix4[] = [];
    return bones.map((bone, i) => {
      const local = nodeMatrix(nodes[bone.node], animation?.at(bone.node, time));
      chain[i] = bone.parent < 0 ? local : chain[bone.parent].clone().multiply(local);
      return this.convert(chain[i]).multiply(bone.turn);
    });
  }

  private mesh(index: number, skin: { joints: Matrix4[]; bones: number[] } | null): SceneMesh {
    const gltf = this.gltf,
      source = gltf.json.meshes![index],
      u = this.options.unit,
      points: number[] = [],
      pointNormals: number[] = [],
      corners: number[] = [],
      uv: number[] = [],
      color: number[] = [],
      slots: number[] = [],
      materials: SceneMaterial[] = [],
      flat: boolean[] = [],
      weights: Map<number, number>[] = [];
    const prims = source.primitives.filter((p) => p.attributes.POSITION !== undefined),
      hasNormals = prims.some((p) => p.attributes.NORMAL !== undefined),
      hasUv = prims.some((p) => p.attributes.TEXCOORD_0 !== undefined),
      hasColor = prims.some((p) => p.attributes.COLOR_0 !== undefined);
    const v = new Vector3(),
      skinMatrix = new Float64Array(16);
    for (const prim of prims) {
      if ((prim.mode ?? 4) !== 4) continue;
      const position = accessor(gltf, prim.attributes.POSITION),
        normal =
          prim.attributes.NORMAL === undefined ? null : accessor(gltf, prim.attributes.NORMAL),
        indices =
          prim.indices === undefined
            ? Uint32Array.from({ length: position.count }, (_, i) => i)
            : accessor(gltf, prim.indices).values,
        used = [...new Set(indices)].sort((a, b) => a - b),
        remap = new Map(used.map((old, i) => [old, points.length / 3 + i])),
        base = points.length / 3;
      const joints: { j: ArrayLike<number>; w: ArrayLike<number> }[] = [];
      if (skin)
        for (let set = 0; ; set++) {
          const j = prim.attributes['JOINTS_' + set],
            w = prim.attributes['WEIGHTS_' + set];
          if (j === undefined || w === undefined) break;
          joints.push({ j: accessor(gltf, j).values, w: accessor(gltf, w).values });
        }
      used.forEach((old, i) => {
        // x, y, z → x, -z, y
        let p = [
            position.values[old * 3] * u,
            -position.values[old * 3 + 2] * u,
            position.values[old * 3 + 1] * u,
          ],
          n = normal
            ? [normal.values[old * 3], -normal.values[old * 3 + 2], normal.values[old * 3 + 1]]
            : [0, 0, 0];
        if (skin && joints.length) {
          const group = new Map<number, number>();
          skinMatrix.fill(0);
          let total = 0;
          for (const { j, w } of joints)
            for (let k = 0; k < 4; k++) {
              const weight = w[old * 4 + k],
                joint = j[old * 4 + k];
              if (!weight) continue;
              const e = skin.joints[joint].elements;
              for (let c = 0; c < 16; c++) skinMatrix[c] += e[c] * weight;
              total += weight;
              group.set(skin.bones[joint], weight);
            }
          if (!total) {
            // Unweighted points follow the first joint.
            skinMatrix.set(skin.joints[0].elements);
            total = 1;
            group.set(skin.bones[0], 1);
          }
          const m = skinMatrix;
          p = [
            (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / total,
            (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / total,
            (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / total,
          ];
          v.set(
            m[0] * n[0] + m[4] * n[1] + m[8] * n[2],
            m[1] * n[0] + m[5] * n[1] + m[9] * n[2],
            m[2] * n[0] + m[6] * n[1] + m[10] * n[2],
          ).normalize();
          n = [v.x, v.y, v.z];
          weights[base + i] = group;
        } else if (skin) weights[base + i] = new Map([[skin.bones[0], 1]]);
        points.push(...p);
        pointNormals.push(...n);
      });
      const texture =
          prim.attributes.TEXCOORD_0 === undefined
            ? null
            : accessor(gltf, prim.attributes.TEXCOORD_0),
        tint =
          prim.attributes.COLOR_0 === undefined ? null : accessor(gltf, prim.attributes.COLOR_0);
      const slot = slotOf(materials, { index: prim.material ?? -1, tinted: !!tint });
      for (let t = 0; t + 2 < indices.length; t += 3) {
        for (let k = 0; k < 3; k++) {
          const old = indices[t + k];
          corners.push(remap.get(old)!);
          if (hasUv)
            uv.push(
              texture ? texture.values[old * 2] : 0,
              texture ? 1 - texture.values[old * 2 + 1] : 0,
            );
          if (hasColor)
            for (let c = 0; c < 4; c++)
              color.push(tint ? (c < tint.size ? tint.values[old * tint.size + c] : 1) : 1);
        }
        slots.push(slot);
        flat.push(!normal);
      }
    }

    // Triangles that reuse a point, or repeat an earlier triangle, are dropped.
    const keep: number[] = [],
      seen = new Set<string>();
    for (let t = 0; t < slots.length; t++) {
      const [a, b, c] = corners.slice(t * 3, t * 3 + 3);
      if (a === b || b === c || a === c) continue;
      const key = [a, b, c].sort((x, y) => x - y).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      keep.push(t);
    }
    const count = keep.length,
      out: SceneMesh = {
        name: source.name ?? 'Mesh_' + index,
        data: source.name ?? 'Mesh_' + index,
        world: new Matrix4(),
        points: Float32Array.from(points),
        corners: new Uint32Array(count * 3),
        normals: new Float32Array(count * 9),
        uv: hasUv ? new Float32Array(count * 6) : null,
        color: hasColor ? new Float32Array(count * 12) : null,
        smooth: new Uint8Array(count),
        slots: new Int32Array(count),
        materials,
        groups: null,
      };
    const a = new Vector3(),
      b = new Vector3(),
      c = new Vector3(),
      face = new Float32Array(3);
    keep.forEach((t, i) => {
      const tri = corners.slice(t * 3, t * 3 + 3);
      out.corners.set(tri, i * 3);
      out.slots[i] = slots[t];
      if (out.uv) out.uv.set(uv.slice(t * 6, t * 6 + 6), i * 6);
      if (out.color) out.color.set(color.slice(t * 12, t * 12 + 12), i * 12);
      a.fromArray(out.points, tri[0] * 3);
      b.fromArray(out.points, tri[1] * 3);
      c.fromArray(out.points, tri[2] * 3);
      v.copy(a).sub(b).cross(b.sub(c)).normalize();
      face.set([v.x, v.y, v.z]);
      // A triangle whose corner normals all equal its own normal is flat.
      let smooth = false;
      if (hasNormals && !flat[t])
        for (const point of tri)
          if (v.dot(a.fromArray(pointNormals, point * 3)) <= 0.9999999) smooth = true;
      out.smooth[i] = smooth ? 1 : 0;
      tri.forEach((p, k) =>
        out.normals.set(smooth ? pointNormals.slice(p * 3, p * 3 + 3) : face, i * 9 + k * 3),
      );
    });
    if (skin && this.armature === null) throw Error('The model has no skeleton.');
    if (skin) {
      const bones = Math.max(...skin.bones) + 1;
      out.groups = Array.from({ length: Math.max(bones, 0) }, () => new Map<number, number>());
      weights.forEach((group, point) =>
        group.forEach((weight, bone) => out.groups![bone].set(point, weight)),
      );
    }
    return out;
  }
}

/** Geometry moved by a matrix, as when a prop is baked into its socket space. */
export function transformMesh(mesh: SceneMesh, matrix: Matrix4): SceneMesh {
  const points = mesh.points.slice(),
    normals = mesh.normals.slice(),
    normal = new Matrix3().getNormalMatrix(matrix),
    v = new Vector3();
  for (let i = 0; i < points.length; i += 3) {
    v.fromArray(points, i).applyMatrix4(matrix);
    points.set([v.x, v.y, v.z], i);
  }
  for (let i = 0; i < normals.length; i += 3) {
    v.fromArray(normals, i).applyMatrix3(normal).normalize();
    normals.set([v.x, v.y, v.z], i);
  }
  return { ...mesh, points, normals, world: new Matrix4() };
}

/** Several meshes as one object, the first one's name aside. */
export function joinMeshes(parts: SceneMesh[], name: string): SceneMesh {
  const total = (pick: (m: SceneMesh) => number) => parts.reduce((n, m) => n + pick(m), 0),
    triangles = total((m) => m.slots.length),
    hasUv = parts.some((m) => m.uv),
    hasColor = parts.some((m) => m.color),
    bones = Math.max(0, ...parts.map((m) => m.groups?.length ?? 0));
  const out: SceneMesh = {
    name,
    data: parts[0].data,
    world: parts[0].world,
    points: new Float32Array(total((m) => m.points.length)),
    corners: new Uint32Array(triangles * 3),
    normals: new Float32Array(triangles * 9),
    uv: hasUv ? new Float32Array(triangles * 6) : null,
    color: hasColor ? new Float32Array(triangles * 12).fill(1) : null,
    smooth: new Uint8Array(triangles),
    slots: new Int32Array(triangles),
    materials: [],
    groups: parts.some((m) => m.groups)
      ? Array.from({ length: bones }, () => new Map<number, number>())
      : null,
  };
  let point = 0,
    triangle = 0;
  for (const m of parts) {
    out.points.set(m.points, point * 3);
    out.corners.set(
      m.corners.map((c) => c + point),
      triangle * 3,
    );
    out.normals.set(m.normals, triangle * 9);
    if (m.uv) out.uv!.set(m.uv, triangle * 6);
    if (m.color) out.color!.set(m.color, triangle * 12);
    out.smooth.set(m.smooth, triangle);
    const slot = m.materials.map((material) => slotOf(out.materials, material));
    out.slots.set(
      m.slots.map((s) => slot[s]),
      triangle,
    );
    m.groups?.forEach((group, bone) =>
      group.forEach((weight, p) => out.groups![bone].set(p + point, weight)),
    );
    point += m.points.length / 3;
    triangle += m.slots.length;
  }
  return out;
}

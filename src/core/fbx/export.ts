import { Matrix4 } from 'three';
import { TEMPLATES } from './templates';
import { D, I, L, P, S, encodeFbx, named, node } from './write';
import type { OutNode } from './write';

/**
 * Writes FBX files with the layout Unreal already knows from this app's
 * earlier exports: a null "armature" node above the root bone, limb nodes with
 * XYZ Euler curves keyed on every frame, meshes at the scene root, and a bind
 * pose per skinned mesh. Scene data is given in the authoring space (Z up);
 * `global` turns it into the file's axes and is carried by root nodes only.
 */
interface ExportBone {
  name: string;
  /** Index into the armature's bone list; -1 for a bone at the top. */
  parent: number;
  /** Rest matrix in armature space. */
  rest: Matrix4;
}
export interface ExportArmature {
  kind: 'armature';
  name: string;
  world: Matrix4;
  bones: ExportBone[];
}
export interface ExportTexture {
  /** FBX material property the image drives, for example `DiffuseColor` or `NormalMap`. */
  slot: string;
  /** Name of the image, without its extension. */
  image: string;
  /** File name of the image; the bytes are embedded in the FBX. */
  file: string;
  content: Uint8Array;
}
export interface ExportMaterial {
  name: string;
  color: [number, number, number];
  emissive: [number, number, number];
  emissiveStrength: number;
  roughness: number;
  metallic: number;
  textures: ExportTexture[];
}
/** Values stored once per polygon corner, in polygon order. */
interface CornerLayer {
  name: string;
  values: ArrayLike<number>;
}
export interface ExportMesh {
  kind: 'mesh';
  name: string;
  /** Name of the geometry and its bind pose. */
  data: string;
  world: Matrix4;
  points: Float64Array;
  /** Triangle corner → point index. */
  triangles: Uint32Array | Int32Array;
  normals: ArrayLike<number>;
  uv: CornerLayer | null;
  color: CornerLayer | null;
  /** One flag per triangle (1 smooth, 0 flat); omitted when the mesh carries no smoothing layer. */
  smoothing: ArrayLike<number> | null;
  materials: ExportMaterial[];
  /** Material slot per triangle; omitted when every triangle uses the first slot. */
  slots: ArrayLike<number> | null;
  skin: {
    armature: ExportArmature;
    /** Per armature bone: the points it moves and their weights. */
    groups: { indexes: number[]; weights: number[] }[];
  } | null;
}
export interface ExportPose {
  /** World matrix of every scene object, in scene order. */
  objects: Matrix4[];
  /** Armature-space matrices of every bone, per armature, in scene order. */
  bones: Matrix4[][];
}
export interface ExportScene {
  objects: (ExportArmature | ExportMesh)[];
  /** Authoring space → file space. Root nodes carry it; nothing is baked into data. */
  global: Matrix4;
  /** Value written as `UnitScaleFactor`: centimetres per file unit. */
  unit: number;
  /** Size shown for bones by DCC tools; cosmetic. */
  boneSize: number;
  /** Folder importers unpack embedded images into, named after the FBX file. */
  media: string;
  fps: number;
  /** Grey level of the ambient light recorded on materials; cosmetic. */
  ambient?: number;
  /** Pose stored on the nodes themselves. */
  pose: ExportPose;
  animation: {
    name: string;
    /** Number of the first key; later keys follow one frame apart. */
    first: number;
    count: number;
    sample(index: number): ExportPose | Promise<ExportPose>;
  } | null;
}

const KTIME = 46186158000n;
const DEG = 180 / Math.PI;
type Vec3 = [number, number, number];

/** Rotation matrix (unit columns) → XYZ Euler, choosing the solution nearest `previous`. */
function eulerXYZ(e: ArrayLike<number>, previous: Vec3 | null): Vec3 {
  // e is column-major: e[column * 4 + row].
  const cy = Math.hypot(e[0], e[1]);
  let a: Vec3, b: Vec3;
  if (cy > 16 * 1.1920929e-7) {
    a = [Math.atan2(e[6], e[10]), Math.atan2(-e[2], cy), Math.atan2(e[1], e[0])];
    b = [Math.atan2(-e[6], -e[10]), Math.atan2(-e[2], -cy), Math.atan2(-e[1], -e[0])];
  } else {
    a = [Math.atan2(-e[9], e[5]), Math.atan2(-e[2], cy), 0];
    b = [...a];
  }
  const size = (v: Vec3, o: Vec3) =>
    Math.abs(v[0] - o[0]) + Math.abs(v[1] - o[1]) + Math.abs(v[2] - o[2]);
  if (!previous) return size(a, [0, 0, 0]) > size(b, [0, 0, 0]) ? b : a;
  const near = (v: Vec3): Vec3 => {
    const two = Math.PI * 2;
    for (let i = 0; i < 3; i++) {
      const d = v[i] - previous[i];
      if (d > 5.1) v[i] -= Math.floor(d / two + 0.5) * two;
      else if (d < -5.1) v[i] += Math.floor(-d / two + 0.5) * two;
    }
    const d = v.map((x, i) => Math.abs(x - previous[i]));
    // A single axis that is half a turn away has flipped; bring it back round.
    if (d[0] > 3.2 && d[1] < 1.6 && d[2] < 1.6) v[0] += v[0] > previous[0] ? -two : two;
    if (d[1] > 3.2 && d[2] < 1.6 && d[0] < 1.6) v[1] += v[1] > previous[1] ? -two : two;
    if (d[2] > 3.2 && d[1] < 1.6 && d[0] < 1.6) v[2] += v[2] > previous[2] ? -two : two;
    return v;
  };
  near(a);
  near(b);
  return size(a, previous) > size(b, previous) ? b : a;
}

/** Location, XYZ Euler in radians and scale of a matrix, the way DCC tools split it. */
function decompose(m: Matrix4, previous: Vec3 | null) {
  const e = m.elements,
    scale: Vec3 = [
      Math.hypot(e[0], e[1], e[2]),
      Math.hypot(e[4], e[5], e[6]),
      Math.hypot(e[8], e[9], e[10]),
    ];
  const sign = m.determinant() < 0 ? -1 : 1,
    r = new Float64Array(16);
  for (let c = 0; c < 3; c++) {
    const s = (scale[c] || 1) * sign;
    for (let k = 0; k < 3; k++) r[c * 4 + k] = e[c * 4 + k] / s;
    scale[c] *= sign;
  }
  return { location: [e[12], e[13], e[14]] as Vec3, rotation: eulerXYZ(r, previous), scale };
}

interface Item {
  id: bigint;
  name: string;
  type: 'Null' | 'LimbNode' | 'Mesh';
  parent: Item | null;
  /** Matrix relative to the parent item, or in file space for a root. */
  local(pose: ExportPose): Matrix4;
  animated: boolean;
}

export async function writeFbx(scene: ExportScene, creator: string): Promise<Uint8Array> {
  let next = 1000000n;
  const uid = () => (next += 7n);
  const objects: OutNode[] = [],
    links: OutNode[] = [],
    counts = new Map<string, number>();
  const add = (n: OutNode) => {
    objects.push(n);
    counts.set(n.name, (counts.get(n.name) ?? 0) + 1);
    return n;
  };
  const link = (child: bigint, parent: bigint, property?: string) =>
    links.push(
      node(
        'C',
        property ? [S('OP'), L(child), L(parent), S(property)] : [S('OO'), L(child), L(parent)],
      ),
    );
  const matrix = (m: Matrix4) => Float64Array.from(m.elements);
  const global = scene.global,
    ambient = scene.ambient ?? 0;

  // Scene items: every root object, then every bone.
  const items: Item[] = [],
    armatures = scene.objects.filter((o): o is ExportArmature => o.kind === 'armature'),
    roots = new Map<ExportArmature | ExportMesh, Item>(),
    boneItems = new Map<ExportArmature, Item[]>();
  scene.objects.forEach((object, index) => {
    const item: Item = {
      id: uid(),
      name: object.name,
      type: object.kind === 'armature' ? 'Null' : 'Mesh',
      parent: null,
      local: (pose) => global.clone().multiply(pose.objects[index]),
      animated: !!scene.animation && object.kind === 'armature',
    };
    items.push(item);
    roots.set(object, item);
  });
  armatures.forEach((armature, a) => {
    const list: Item[] = [];
    armature.bones.forEach((bone, b) => {
      const item: Item = {
        id: uid(),
        name: bone.name,
        type: 'LimbNode',
        parent: bone.parent < 0 ? roots.get(armature)! : list[bone.parent],
        local: (pose) =>
          bone.parent < 0
            ? pose.bones[a][b].clone()
            : pose.bones[a][bone.parent].clone().invert().multiply(pose.bones[a][b]),
        animated: !!scene.animation,
      };
      list.push(item);
      items.push(item);
    });
    boneItems.set(armature, list);
  });

  // Node attributes and geometry come first, as tools write them.
  const attributes = new Map<Item, bigint>();
  for (const item of items)
    if (item.type === 'Null') {
      const id = uid();
      attributes.set(item, id);
      add(
        node(
          'NodeAttribute',
          [L(id), named(item.name, 'NodeAttribute'), S('Null')],
          [
            node('TypeFlags', [S('Null')]),
            node(
              'Properties70',
              [],
              [
                P('Color', 'ColorRGB', 'Color', '', 0.8, 0.8, 0.8),
                P('Size', 'double', 'Number', '', 100),
                P('Look', 'enum', '', '', 1),
              ],
            ),
          ],
        ),
      );
    }
  const geometry = new Map<ExportMesh, bigint>();
  for (const mesh of scene.objects)
    if (mesh.kind === 'mesh') {
      const id = uid();
      geometry.set(mesh, id);
      add(meshGeometry(mesh, id));
    }

  const current = new Map<Item, ReturnType<typeof decompose>>();
  for (const item of items) {
    const tx = decompose(item.local(scene.pose), null);
    current.set(item, tx);
    const rows: OutNode[] = [],
      row = (name: string, v: Vec3, fallback: number) => {
        if (item.animated || v.some((x) => x !== fallback))
          rows.push(P(name, name, '', item.animated ? 'A+' : 'A', ...v));
      };
    row('Lcl Translation', tx.location, 0);
    row('Lcl Rotation', tx.rotation.map((r) => r * DEG) as Vec3, 0);
    row('Lcl Scaling', tx.scale, 1);
    rows.push(
      P('DefaultAttributeIndex', 'int', 'Integer', '', 0),
      P('InheritType', 'enum', '', '', 1),
    );
    add(
      node(
        'Model',
        [L(item.id), named(item.name, 'Model'), S(item.type)],
        [
          node('Version', [I(232)]),
          node('Properties70', [], rows),
          node('MultiLayer', [I(0)]),
          node('MultiTake', [I(0)]),
          node('Shading', [['C', true]]),
          node('Culling', [S('CullingOff')]),
        ],
      ),
    );
  }
  for (const item of items)
    if (item.type === 'LimbNode') {
      const id = uid();
      attributes.set(item, id);
      add(
        node(
          'NodeAttribute',
          [L(id), named(item.name, 'NodeAttribute'), S('LimbNode')],
          [
            node('TypeFlags', [S('Skeleton')]),
            node('Properties70', [], [P('Size', 'double', 'Number', '', scene.boneSize)]),
          ],
        ),
      );
    }

  // Rest matrices in file space.
  const restWorld = (armature: ExportArmature) => global.clone().multiply(armature.world),
    restBone = (armature: ExportArmature, b: number) =>
      restWorld(armature).multiply(armature.bones[b].rest);
  const skins: { mesh: ExportMesh; skin: bigint; clusters: bigint[] }[] = [];
  for (const mesh of scene.objects) {
    if (mesh.kind !== 'mesh' || !mesh.skin) continue;
    const { armature, groups } = mesh.skin,
      meshWorld = global.clone().multiply(mesh.world),
      bones = boneItems.get(armature)!;
    add(
      node(
        'Pose',
        [L(uid()), named(mesh.data, 'Pose'), S('BindPose')],
        [
          node('Type', [S('BindPose')]),
          node('Version', [I(100)]),
          node('NbPoseNodes', [I(2 + bones.length)]),
          ...[
            [roots.get(mesh)!.id, meshWorld] as const,
            [roots.get(armature)!.id, restWorld(armature)] as const,
            ...bones.map((b, i) => [b.id, restBone(armature, i)] as const),
          ].map(([id, m]) =>
            node('PoseNode', [], [node('Node', [L(id)]), node('Matrix', [matrix(m)])]),
          ),
        ],
      ),
    );
    const skin = uid(),
      clusters: bigint[] = [];
    add(
      node(
        'Deformer',
        [L(skin), named(armature.name, 'Deformer'), S('Skin')],
        [node('Version', [I(101)]), node('Link_DeformAcuracy', [D(50)])],
      ),
    );
    bones.forEach((bone, i) => {
      const id = uid(),
        bind = restBone(armature, i),
        group = groups[i];
      clusters.push(id);
      add(
        node(
          'Deformer',
          [L(id), named(bone.name, 'SubDeformer'), S('Cluster')],
          [
            node('Version', [I(100)]),
            node('UserData', [S(''), S('')]),
            ...(group?.indexes.length
              ? [
                  node('Indexes', [Int32Array.from(group.indexes)]),
                  node('Weights', [Float64Array.from(group.weights)]),
                ]
              : []),
            node('Transform', [matrix(bind.clone().invert().multiply(meshWorld))]),
            node('TransformLink', [matrix(bind)]),
            node('TransformAssociateModel', [matrix(restWorld(armature))]),
          ],
        ),
      );
    });
    skins.push({ mesh, skin, clusters });
  }

  // Materials are written once and shared by every mesh that names them.
  const materials = new Map<ExportMaterial, bigint>(),
    textures: { id: bigint; material: bigint; slot: string }[] = [],
    videos = new Map<string, bigint>(),
    media: { texture: bigint; video: bigint }[] = [];
  for (const mesh of scene.objects)
    if (mesh.kind === 'mesh')
      for (const m of mesh.materials) {
        if (materials.has(m)) continue;
        const id = uid(),
          shininess = (1 - m.roughness) ** 2 * 100,
          lit = m.emissive.some((v) => v > 0),
          has = (slot: string) => m.textures.some((t) => t.slot === slot),
          // A texture replaces the flat colour, which then keeps its neutral default.
          color = has('DiffuseColor') ? ([0.8, 0.8, 0.8] as Vec3) : m.color,
          strength = lit ? m.emissiveStrength : 0;
        materials.set(m, id);
        add(
          node(
            'Material',
            [L(id), named(m.name, 'Material'), S('')],
            [
              node('Version', [I(102)]),
              node('ShadingModel', [S('Phong')]),
              node('MultiLayer', [I(0)]),
              node(
                'Properties70',
                [],
                [
                  P('DiffuseColor', 'Color', '', 'A', ...color),
                  P('EmissiveColor', 'Color', '', 'A', ...(lit ? m.emissive : [1, 1, 1])),
                  // Values equal to the template default of 1 are left to the template.
                  ...(strength === 1 ? [] : [P('EmissiveFactor', 'Number', '', 'A', strength)]),
                  P('AmbientColor', 'Color', '', 'A', ambient, ambient, ambient),
                  P('AmbientFactor', 'Number', '', 'A', 0),
                  ...(has('NormalMap') ? [] : [P('BumpFactor', 'double', 'Number', '', 0)]),
                  P('SpecularColor', 'Color', '', 'A', ...color),
                  P('SpecularFactor', 'Number', '', 'A', 0.25),
                  P('Shininess', 'Number', '', 'A', shininess),
                  P('ShininessExponent', 'Number', '', 'A', shininess),
                  P('ReflectionColor', 'Color', '', 'A', ...color),
                  P('ReflectionFactor', 'Number', '', 'A', m.metallic),
                ],
              ),
            ],
          ),
        );
      }
  for (const [m, material] of materials)
    for (const t of m.textures) {
      const id = uid(),
        file = scene.media + '/' + t.file,
        name =
          { DiffuseColor: 'base_color', EmissiveColor: 'emission_color', NormalMap: 'normalmap' }[
            t.slot
          ] + '_texture';
      textures.push({ id, material, slot: t.slot });
      add(
        node(
          'Texture',
          [L(id), named(name, 'Texture'), S('')],
          [
            node('Type', [S('TextureVideoClip')]),
            node('Version', [I(202)]),
            node('TextureName', [named(name, 'Texture')]),
            node('Media', [named(t.image, 'Video')]),
            node('FileName', [S(file)]),
            node('RelativeFilename', [S(file)]),
            node('Properties70', [], [P('UseMaterial', 'bool', '', '', 1)]),
          ],
        ),
      );
      if (!videos.has(t.file)) videos.set(t.file, uid());
      media.push({ texture: id, video: videos.get(t.file)! });
    }
  const written = new Set<string>();
  for (const m of materials.keys())
    for (const t of m.textures) {
      if (written.has(t.file)) continue;
      written.add(t.file);
      add(
        node(
          'Video',
          [L(videos.get(t.file)!), named(t.image, 'Video'), S('Clip')],
          [
            node('Type', [S('Clip')]),
            node('Properties70', [], [P('Path', 'KString', 'Url', '', scene.media + '/' + t.file)]),
            node('UseMipMap', [I(0)]),
            node('Filename', [S(scene.media + '/' + t.file)]),
            node('RelativeFilename', [S(scene.media + '/' + t.file)]),
            node('Content', [['R', t.content]]),
          ],
        ),
      );
    }

  // Connections, in the order tools write them: hierarchy, data, skin, materials.
  for (const item of items) link(item.id, item.parent?.id ?? 0n);
  for (const [item, id] of attributes) if (item.type === 'Null') link(id, item.id);
  for (const [mesh, id] of geometry) link(id, roots.get(mesh)!.id);
  for (const [item, id] of attributes) if (item.type === 'LimbNode') link(id, item.id);
  for (const { mesh, skin, clusters } of skins) {
    link(skin, geometry.get(mesh)!);
    const bones = boneItems.get(mesh.skin!.armature)!;
    clusters.forEach((cluster, i) => {
      link(cluster, skin);
      link(bones[i].id, cluster);
    });
  }
  for (const mesh of scene.objects)
    if (mesh.kind === 'mesh')
      for (const m of mesh.materials) link(materials.get(m)!, roots.get(mesh)!.id);
  for (const t of textures) link(t.id, t.material, t.slot);
  for (const m of media) link(m.video, m.texture);

  // Animation: one stack, one layer, nine curves per animated node, a key on every frame.
  const takes: OutNode[] = [];
  let span: [bigint, bigint] = [0n, KTIME];
  if (scene.animation) {
    const { name, first, count } = scene.animation,
      animated = items.filter((i) => i.animated),
      curves = animated.map(() => Array.from({ length: 9 }, () => new Float32Array(count))),
      previous = new Map<Item, Vec3>(),
      times = new BigInt64Array(count);
    // Key times are cut to whole ticks, as the files Unreal already has were.
    for (let f = 0; f < count; f++) {
      times[f] = BigInt(Math.trunc(((first + f) / scene.fps) * Number(KTIME)));
      const pose = await scene.animation.sample(f);
      animated.forEach((item, i) => {
        const tx = decompose(item.local(pose), previous.get(item) ?? null);
        previous.set(item, tx.rotation);
        for (let k = 0; k < 3; k++) {
          curves[i][k][f] = tx.location[k];
          curves[i][3 + k][f] = tx.rotation[k] * DEG;
          curves[i][6 + k][f] = tx.scale[k];
        }
      });
    }
    span = [times[0], times[count - 1]];
    const stack = uid(),
      layer = uid();
    add(
      node(
        'AnimationStack',
        [L(stack), named(name, 'AnimStack'), S('')],
        [
          node(
            'Properties70',
            [],
            [
              P('LocalStart', 'KTime', 'Time', '', span[0]),
              P('LocalStop', 'KTime', 'Time', '', span[1]),
              P('ReferenceStart', 'KTime', 'Time', '', span[0]),
              P('ReferenceStop', 'KTime', 'Time', '', span[1]),
            ],
          ),
        ],
      ),
    );
    add(node('AnimationLayer', [L(layer), named(name, 'AnimLayer'), S('')]));
    link(layer, stack);
    animated.forEach((item, i) => {
      const tx = current.get(item)!,
        values = [tx.location, tx.rotation.map((r) => r * DEG), tx.scale];
      ['T', 'R', 'S'].forEach((kind, k) => {
        const id = uid();
        add(
          node(
            'AnimationCurveNode',
            [L(id), named(kind, 'AnimCurveNode'), S('')],
            [
              node(
                'Properties70',
                [],
                [
                  P('d|X', 'Number', '', 'A', values[k][0]),
                  P('d|Y', 'Number', '', 'A', values[k][1]),
                  P('d|Z', 'Number', '', 'A', values[k][2]),
                ],
              ),
            ],
          ),
        );
        link(id, layer);
        link(id, item.id, ['Lcl Translation', 'Lcl Rotation', 'Lcl Scaling'][k]);
        ['d|X', 'd|Y', 'd|Z'].forEach((axis, c) => {
          const curve = uid();
          add(
            node(
              'AnimationCurve',
              [L(curve), named('', 'AnimCurve'), S('')],
              [
                node('Default', [D(values[k][c])]),
                node('KeyVer', [I(4008)]),
                node('KeyTime', [times]),
                node('KeyValueFloat', [curves[i][k * 3 + c]]),
                // Cubic interpolation with automatic tangents, shared by every key.
                node('KeyAttrFlags', [Int32Array.of(24836)]),
                node('KeyAttrDataFloat', [Float32Array.of(0, 0, 0, 0)]),
                node('KeyAttrRefCount', [Int32Array.of(count)]),
              ],
            ),
          );
          link(curve, id, axis);
        });
      });
    });
    takes.push(
      node(
        'Take',
        [S(name)],
        [
          node('FileName', [S(name + '.tak')]),
          node('LocalTime', [L(span[0]), L(span[1])]),
          node('ReferenceTime', [L(span[0]), L(span[1])]),
        ],
      ),
    );
  }

  const mode = { 120: 1, 100: 2, 60: 3, 50: 4, 48: 5, 30: 6, 25: 10, 24: 11 }[scene.fps] ?? 14;
  const now = new Date();
  // Unreal recognises this exporter by its saved application name and then
  // drops the armature node above the root bone. Files keep that identity so
  // skeletons match the ones imported from earlier versions of this app.
  const application = [
    ['ApplicationVendor', 'Blender Foundation'],
    ['ApplicationName', 'Blender (stable FBX IO)'],
    ['ApplicationVersion', '5.2.3 LTS'],
  ];
  const definitions = [
    node('ObjectType', [S('GlobalSettings')], [node('Count', [I(1)])]),
    ...[...counts].map(([type, count]) =>
      node(
        'ObjectType',
        [S(type)],
        [
          node('Count', [I(count)]),
          ...(TEMPLATES[type]
            ? [
                node(
                  'PropertyTemplate',
                  [S(TEMPLATES[type].name)],
                  [
                    node(
                      'Properties70',
                      [],
                      TEMPLATES[type].rows.map(([n, t, l, f, ...v]) => P(n, t, l, f, ...v)),
                    ),
                  ],
                ),
              ]
            : []),
        ],
      ),
    ),
  ];
  return encodeFbx([
    node(
      'FBXHeaderExtension',
      [],
      [
        node('FBXHeaderVersion', [I(1003)]),
        node('FBXVersion', [I(7400)]),
        node('EncryptionType', [I(0)]),
        node(
          'CreationTimeStamp',
          [],
          [
            node('Version', [I(1000)]),
            node('Year', [I(now.getFullYear())]),
            node('Month', [I(now.getMonth() + 1)]),
            node('Day', [I(now.getDate())]),
            node('Hour', [I(now.getHours())]),
            node('Minute', [I(now.getMinutes())]),
            node('Second', [I(now.getSeconds())]),
            node('Millisecond', [I(now.getMilliseconds())]),
          ],
        ),
        node('Creator', [S(creator)]),
        node(
          'SceneInfo',
          [named('GlobalInfo', 'SceneInfo'), S('UserData')],
          [
            node('Type', [S('UserData')]),
            node('Version', [I(100)]),
            node(
              'MetaData',
              [],
              [
                node('Version', [I(100)]),
                ...['Title', 'Subject', 'Author', 'Keywords', 'Revision', 'Comment'].map((k) =>
                  node(k, [S(k === 'Comment' ? 'Written by ' + creator : '')]),
                ),
              ],
            ),
            node(
              'Properties70',
              [],
              [
                P('DocumentUrl', 'KString', 'Url', '', '/foobar.fbx'),
                P('SrcDocumentUrl', 'KString', 'Url', '', '/foobar.fbx'),
                P('Original', 'Compound', '', ''),
                ...application.map(([k, v]) => P('Original|' + k, 'KString', '', '', v)),
                P('Original|DateTime_GMT', 'DateTime', '', '', '01/01/1970 00:00:00.000'),
                P('Original|FileName', 'KString', '', '', '/foobar.fbx'),
                P('LastSaved', 'Compound', '', ''),
                ...application.map(([k, v]) => P('LastSaved|' + k, 'KString', '', '', v)),
                P('LastSaved|DateTime_GMT', 'DateTime', '', '', '01/01/1970 00:00:00.000'),
              ],
            ),
          ],
        ),
      ],
    ),
    node('FileId', [
      [
        'R',
        Uint8Array.of(
          0x28,
          0xb3,
          0x2a,
          0xeb,
          0xb6,
          0x24,
          0xcc,
          0xc2,
          0xbf,
          0xc8,
          0xb0,
          0x2a,
          0xa9,
          0x2b,
          0xfc,
          0xf1,
        ),
      ],
    ]),
    node('CreationTime', [S('1970-01-01 10:00:00:000')]),
    node('Creator', [S(creator)]),
    node(
      'GlobalSettings',
      [],
      [
        node('Version', [I(1000)]),
        node(
          'Properties70',
          [],
          [
            ...axes(global),
            P('OriginalUpAxis', 'int', 'Integer', '', -1),
            P('OriginalUpAxisSign', 'int', 'Integer', '', 1),
            P('UnitScaleFactor', 'double', 'Number', '', scene.unit),
            P('OriginalUnitScaleFactor', 'double', 'Number', '', scene.unit),
            P('AmbientColor', 'ColorRGB', 'Color', '', 0, 0, 0),
            P('DefaultCamera', 'KString', '', '', 'Producer Perspective'),
            P('TimeMode', 'enum', '', '', mode),
            P('TimeSpanStart', 'KTime', 'Time', '', 0),
            P('TimeSpanStop', 'KTime', 'Time', '', KTIME),
            P('CustomFrameRate', 'double', 'Number', '', scene.fps),
          ],
        ),
      ],
    ),
    node(
      'Documents',
      [],
      [
        node('Count', [I(1)]),
        node(
          'Document',
          [L(uid()), S('Scene'), S('Scene')],
          [
            node(
              'Properties70',
              [],
              [
                P('SourceObject', 'object', '', ''),
                P('ActiveAnimStackName', 'KString', '', '', ''),
              ],
            ),
            node('RootNode', [L(0)]),
          ],
        ),
      ],
    ),
    node('References'),
    node(
      'Definitions',
      [],
      [
        node('Version', [I(100)]),
        node('Count', [I(1 + [...counts.values()].reduce((a, b) => a + b, 0))]),
        ...definitions,
      ],
    ),
    node('Objects', [], objects),
    node('Connections', [], links),
    node('Takes', [], [node('Current', [S('')]), ...takes]),
  ]);
}

/** The axis rows of `GlobalSettings` for a rotation from Z-up authoring space. */
function axes(global: Matrix4) {
  // Where the authoring axes land in the file: up is +Z, forward is -Y, right is +X.
  const e = global.elements,
    find = (column: number, flip: number): [number, number] => {
      let best = 0;
      for (let row = 1; row < 3; row++)
        if (Math.abs(e[column * 4 + row]) > Math.abs(e[column * 4 + best])) best = row;
      return [best, Math.sign(e[column * 4 + best]) * flip];
    };
  const up = find(2, 1),
    front = find(1, -1),
    coord = find(0, 1);
  return [
    P('UpAxis', 'int', 'Integer', '', up[0]),
    P('UpAxisSign', 'int', 'Integer', '', up[1]),
    P('FrontAxis', 'int', 'Integer', '', front[0]),
    P('FrontAxisSign', 'int', 'Integer', '', front[1]),
    P('CoordAxis', 'int', 'Integer', '', coord[0]),
    P('CoordAxisSign', 'int', 'Integer', '', coord[1]),
  ];
}

/** Values → unique rows plus one index per corner. */
function indexed(values: ArrayLike<number>, size: number) {
  const seen = new Map<string, number>(),
    count = values.length / size,
    index = new Int32Array(count),
    unique: number[] = [],
    key = new Float32Array(size),
    bytes = new Uint32Array(key.buffer);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < size; k++) key[k] = values[i * size + k];
    const id = bytes.join(',');
    let at = seen.get(id);
    if (at === undefined) {
      at = unique.length / size;
      seen.set(id, at);
      for (let k = 0; k < size; k++) unique.push(values[i * size + k]);
    }
    index[i] = at;
  }
  return { values: Float64Array.from(unique), index };
}

function meshGeometry(mesh: ExportMesh, id: bigint): OutNode {
  const polygons = Int32Array.from(mesh.triangles, (v, i) => (i % 3 === 2 ? ~v : v)),
    layers: OutNode[] = [],
    listed: string[] = [];
  const layer = (
    type: string,
    version: number,
    name: string,
    mapping: string,
    reference: string,
    data: OutNode[],
  ) => {
    layers.push(
      node(
        type,
        [I(0)],
        [
          node('Version', [I(version)]),
          node('Name', [S(name)]),
          node('MappingInformationType', [S(mapping)]),
          node('ReferenceInformationType', [S(reference)]),
          ...data,
        ],
      ),
    );
    listed.push(type);
  };
  if (mesh.smoothing)
    layer('LayerElementSmoothing', 102, '', 'ByPolygon', 'Direct', [
      node('Smoothing', [Int32Array.from(mesh.smoothing)]),
    ]);
  const normals = indexed(mesh.normals, 3);
  layer('LayerElementNormal', 101, '', 'ByPolygonVertex', 'IndexToDirect', [
    node('Normals', [normals.values]),
    node('NormalsIndex', [normals.index]),
  ]);
  if (mesh.color) {
    const colors = indexed(mesh.color.values, 4);
    layer('LayerElementColor', 101, mesh.color.name, 'ByPolygonVertex', 'IndexToDirect', [
      node('Colors', [colors.values]),
      node('ColorIndex', [colors.index]),
    ]);
  }
  if (mesh.uv) {
    const uv = indexed(mesh.uv.values, 2);
    layer('LayerElementUV', 101, mesh.uv.name, 'ByPolygonVertex', 'IndexToDirect', [
      node('UV', [uv.values]),
      node('UVIndex', [uv.index]),
    ]);
  }
  if (mesh.materials.length)
    layer('LayerElementMaterial', 101, '', mesh.slots ? 'ByPolygon' : 'AllSame', 'IndexToDirect', [
      node('Materials', [mesh.slots ? Int32Array.from(mesh.slots) : Int32Array.of(0)]),
    ]);
  // Readers expect normals first in the layer list, whatever order the data came in.
  const order = [
    'LayerElementNormal',
    'LayerElementSmoothing',
    'LayerElementColor',
    'LayerElementUV',
    'LayerElementMaterial',
  ];
  return node(
    'Geometry',
    [L(id), named(mesh.data, 'Geometry'), S('Mesh')],
    [
      node('Properties70'),
      node('GeometryVersion', [I(124)]),
      node('Vertices', [mesh.points]),
      node('PolygonVertexIndex', [polygons]),
      ...layers,
      node(
        'Layer',
        [I(0)],
        [
          node('Version', [I(100)]),
          ...order
            .filter((t) => listed.includes(t))
            .map((t) =>
              node('LayerElement', [], [node('Type', [S(t)]), node('TypedIndex', [I(0)])]),
            ),
        ],
      ),
    ],
  );
}

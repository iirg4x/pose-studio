import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { child, children, numbers, objectName, parseFbx, properties } from './parse';
import type { FbxNode, FbxValue } from './parse';

type Vec3 = [number, number, number];
/** Seconds are stored as integer ticks; the rate changed with FBX 2019.5. */
const KTIME_V7 = 46186158000,
  KTIME_V8 = 141120000;
// TimeMode → frames per second (0 and 14 mean "use CustomFrameRate").
const FRAME_RATES: Record<number, number> = {
  1: 120,
  2: 100,
  3: 60,
  4: 50,
  5: 48,
  6: 30,
  7: 30,
  8: 29.97,
  9: 29.97,
  10: 25,
  11: 24,
  12: 1,
  13: 23.976,
  15: 96,
  16: 72,
  17: 59.94,
  18: 119.88,
};
// FBX names the order rotations are applied in; three names the matrix product.
const ORDERS = ['ZYX', 'YZX', 'XZY', 'ZXY', 'YXZ', 'XYZ', 'ZYX'] as const;
const DEG = Math.PI / 180;

export interface FbxModel {
  id: string;
  name: string;
  /** `LimbNode`, `Null`, `Root`, `Mesh`, … */
  type: string;
  node: FbxNode;
  parent: FbxModel | null;
  children: FbxModel[];
  bone: boolean;
  translation: Vec3;
  rotation: Vec3;
  scaling: Vec3;
  order: (typeof ORDERS)[number];
  /** Everything between translation and rotation: offset, pivot and pre-rotation. */
  before: Matrix4;
  /** Everything between rotation and scaling. */
  between: Matrix4;
  /** The inverse scaling pivot. */
  after: Matrix4;
  /** Geometry-only offset: applies to the node's own mesh, never to its children. */
  geometric: Matrix4;
  /** Bind pose relative to the parent's bind pose, when the file has one. */
  bind: Matrix4;
}
interface Channels {
  times: Float64Array;
  /** Nine rows: translation, rotation and scaling, resampled at `times`. */
  values: Float64Array[];
}
export interface FbxAction {
  id: string;
  name: string;
  /** Seconds of the first and last key on this rig. */
  start: number;
  end: number;
  tracks: Map<FbxModel, Channels>;
}
export interface FbxRig {
  name: string;
  /** The node Blender would turn into the armature object; absent for bones at the scene root. */
  armature: FbxModel | null;
  bones: FbxModel[];
  /** Unreal writes its root bone as the armature node itself. Offer it as a bone. */
  top: boolean;
  actions: FbxAction[];
}
export interface FbxScene {
  version: number;
  root: FbxNode;
  objects: Map<string, FbxNode>;
  /** child id → [parent id, property] and the reverse. */
  parents: Map<string, [string, string][]>;
  links: Map<string, [string, string][]>;
  models: Map<string, FbxModel>;
  roots: FbxModel[];
  fps: number;
  /** File space → metres, Y up. */
  global: Matrix4;
  rigs: FbxRig[];
}

const id = (value: FbxValue | undefined) => String(value);
const vec = (values: FbxValue[] | undefined, fallback: Vec3): Vec3 =>
  values && values.length >= 3
    ? [Number(values[0]), Number(values[1]), Number(values[2])]
    : fallback;
const translate = (v: Vec3) => new Matrix4().makeTranslation(v[0], v[1], v[2]);
const rotate = (v: Vec3, order: (typeof ORDERS)[number] = 'ZYX') =>
  new Matrix4().makeRotationFromEuler(new Euler(v[0] * DEG, v[1] * DEG, v[2] * DEG, order));
/** FBX matrices are sixteen doubles in column order, like three's. */
export const matrix = (node: FbxNode | undefined) => {
  const a = numbers(node?.props[0]);
  return a.length === 16 ? new Matrix4().fromArray(Array.from(a)) : null;
};

function readModel(node: FbxNode, defaults: Map<string, FbxValue[]>): FbxModel {
  const own = properties(node),
    get = (name: string) => own.get(name) ?? defaults.get(name);
  const zero: Vec3 = [0, 0, 0],
    one: Vec3 = [1, 1, 1];
  const active = Boolean(Number(get('RotationActive')?.[0] ?? 0));
  const pivot = translate(vec(get('RotationPivot'), zero)),
    scalePivot = translate(vec(get('ScalingPivot'), zero));
  const type = String(node.props[2] ?? '');
  return {
    id: id(node.props[0]),
    name: objectName(node.props[1]),
    type,
    node,
    parent: null,
    children: [],
    bone: type === 'LimbNode' || type === 'Limb',
    translation: vec(get('Lcl Translation'), zero),
    rotation: vec(get('Lcl Rotation'), zero),
    scaling: vec(get('Lcl Scaling'), one),
    order: active ? (ORDERS[Number(get('RotationOrder')?.[0] ?? 0)] ?? 'ZYX') : 'ZYX',
    before: translate(vec(get('RotationOffset'), zero))
      .multiply(pivot)
      .multiply(rotate(active ? vec(get('PreRotation'), zero) : zero)),
    between: rotate(active ? vec(get('PostRotation'), zero) : zero)
      .invert()
      .multiply(pivot.clone().invert())
      .multiply(translate(vec(get('ScalingOffset'), zero)))
      .multiply(scalePivot),
    after: scalePivot.clone().invert(),
    geometric: translate(vec(get('GeometricTranslation'), zero))
      .multiply(rotate(vec(get('GeometricRotation'), zero)))
      .multiply(new Matrix4().makeScale(...vec(get('GeometricScaling'), one))),
    bind: new Matrix4(),
  };
}

/** A node's transform relative to its parent for the given channel values. */
function localMatrix(
  model: FbxModel,
  t: ArrayLike<number> = model.translation,
  r: ArrayLike<number> = model.rotation,
  s: ArrayLike<number> = model.scaling,
  target = new Matrix4(),
) {
  return target
    .makeTranslation(t[0], t[1], t[2])
    .multiply(model.before)
    .multiply(rotate([r[0], r[1], r[2]], model.order))
    .multiply(model.between)
    .multiply(scratch.makeScale(s[0], s[1], s[2]))
    .multiply(model.after);
}
const scratch = new Matrix4();

function unique(name: string, used: Set<string>) {
  let result = name || 'Bone';
  for (let i = 1; used.has(result); i++) result = name + '.' + String(i).padStart(3, '0');
  used.add(result);
  return result;
}

export function readFbxScene(data: Uint8Array): FbxScene {
  const { version, root } = parseFbx(data);
  const objects = new Map<string, FbxNode>(),
    parents = new Map<string, [string, string][]>(),
    links = new Map<string, [string, string][]>(),
    models = new Map<string, FbxModel>();
  const section = child(root, 'Objects');
  if (!section) throw Error('This FBX file has no objects.');
  for (const node of section.children) objects.set(id(node.props[0]), node);
  for (const c of children(child(root, 'Connections'), 'C')) {
    const from = id(c.props[1]),
      to = id(c.props[2]),
      property = c.props[0] === 'OP' ? String(c.props[3] ?? '') : '';
    if (c.props[0] !== 'OO' && c.props[0] !== 'OP') continue;
    (parents.get(from) ?? parents.set(from, []).get(from)!).push([to, property]);
    (links.get(to) ?? links.set(to, []).get(to)!).push([from, property]);
  }
  const template = children(child(root, 'Definitions'), 'ObjectType')
    .filter((t) => t.props[0] === 'Model')
    .map((t) => properties(child(t, 'PropertyTemplate')))[0];
  for (const node of section.children)
    if (node.name === 'Model')
      models.set(id(node.props[0]), readModel(node, template ?? new Map()));
  const roots: FbxModel[] = [];
  for (const model of models.values()) {
    const parent = (parents.get(model.id) ?? [])
      .map(([to, property]) => (property ? undefined : models.get(to)))
      .find(Boolean);
    if (parent) {
      model.parent = parent;
      parent.children.push(model);
    } else roots.push(model);
  }
  // Children keep the order of their connections, which is the order tools list them in.
  const order = new Map<string, number>();
  let n = 0;
  for (const c of children(child(root, 'Connections'), 'C')) {
    // Only the link to the parent node counts; nodes also connect to display layers and sets.
    const to = id(c.props[2]);
    if (c.props[0] === 'OO' && (to === '0' || models.has(to))) order.set(id(c.props[1]), n++);
  }
  const sort = (list: FbxModel[]) =>
    list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  sort(roots);
  for (const model of models.values()) sort(model.children);

  const settings = properties(child(root, 'GlobalSettings')),
    number = (name: string, fallback: number) => Number(settings.get(name)?.[0] ?? fallback);
  const axis = (index: number, sign: number) =>
    new Vector3().setComponent(Math.min(2, Math.max(0, index)), sign < 0 ? -1 : 1);
  const up = axis(number('UpAxis', 1), number('UpAxisSign', 1)),
    right = axis(number('CoordAxis', 0), number('CoordAxisSign', 1));
  if (Math.abs(up.dot(right)) > 0.5) right.set(up.y, up.z, up.x);
  const front = new Vector3().crossVectors(right, up);
  // Rows are where each file axis lands: right → X, up → Y, towards the viewer → Z.
  const scale = number('UnitScaleFactor', 1) / 100;
  const global = new Matrix4()
    .set(
      right.x,
      right.y,
      right.z,
      0,
      up.x,
      up.y,
      up.z,
      0,
      front.x,
      front.y,
      front.z,
      0,
      0,
      0,
      0,
      1,
    )
    .premultiply(new Matrix4().makeScale(scale, scale, scale));
  const custom = number('CustomFrameRate', 25);
  let fps = FRAME_RATES[number('TimeMode', 0)] ?? custom;
  if (!(fps > 0)) fps = 25;

  const scene: FbxScene = {
    version,
    root,
    objects,
    parents,
    links,
    models,
    roots,
    fps,
    global,
    rigs: [],
  };
  readBindPose(scene);
  findRigs(scene);
  readActions(scene);
  return scene;
}

/** World transform of a node in file space from its stored (unanimated) values. */
export function staticWorld(model: FbxModel | null): Matrix4 {
  return model ? staticWorld(model.parent).multiply(localMatrix(model)) : new Matrix4();
}

function readBindPose(scene: FbxScene) {
  const world = new Map<FbxModel, Matrix4>();
  for (const node of scene.objects.values()) {
    if (node.name !== 'Pose' || node.props[2] !== 'BindPose') continue;
    for (const entry of children(node, 'PoseNode')) {
      const model = scene.models.get(id(child(entry, 'Node')?.props[0])),
        m = matrix(child(entry, 'Matrix'));
      if (model && m) world.set(model, m);
    }
  }
  // A skin cluster's link transform is the bone's bind pose and wins over the pose list.
  for (const model of scene.models.values()) {
    if (!model.bone) continue;
    for (const [from] of scene.links.get(model.id) ?? []) {
      const cluster = scene.objects.get(from);
      if (cluster?.name !== 'Deformer' || cluster.props[2] !== 'Cluster') continue;
      const m = matrix(child(cluster, 'TransformLink'));
      if (m) world.set(model, m);
    }
  }
  const walk = (model: FbxModel, parent: Matrix4) => {
    const bound = world.get(model);
    model.bind = bound ? parent.clone().invert().multiply(bound) : localMatrix(model);
    const next = parent.clone().multiply(model.bind);
    for (const c of model.children) walk(c, next);
  };
  for (const model of scene.roots) walk(model, new Matrix4());
}

function findRigs(scene: FbxScene) {
  const names = new Set<string>();
  const hasBones = (m: FbxModel): boolean => m.bone || m.children.some(hasBones);
  const collect = (m: FbxModel, into: FbxModel[]) => {
    // A plain node between two bones still carries the chain, so it counts as a bone.
    for (const c of m.children)
      if (hasBones(c)) {
        into.push(c);
        collect(c, into);
      }
  };
  const visit = (parent: FbxModel | null, list: FbxModel[]) => {
    if (list.some((c) => c.bone)) {
      const armature = parent && (parent.type === 'Null' || parent.type === 'Root') ? parent : null;
      const bones: FbxModel[] = [];
      for (const c of list)
        if (armature ? hasBones(c) : c.bone) {
          bones.push(c);
          collect(c, bones);
        }
      const name = unique(armature?.name || 'Armature', names);
      scene.rigs.push({
        name,
        armature,
        bones,
        top:
          !!armature &&
          name.toLowerCase() === 'root' &&
          !bones.some((b) => b.name.toLowerCase() === 'root'),
        actions: [],
      });
      if (armature) return;
    }
    for (const c of list) if (!c.bone) visit(c, c.children);
  };
  visit(null, scene.roots);
  for (const rig of scene.rigs) {
    const used = new Set<string>(rig.top ? [rig.name] : []);
    for (const bone of rig.bones) bone.name = unique(bone.name, used);
  }
}

function readActions(scene: FbxScene) {
  const header = child(scene.root, 'FBXHeaderExtension');
  let ktime = scene.version >= 8000 ? KTIME_V8 : KTIME_V7;
  if (Number(child(header, 'FBXHeaderVersion')?.props[0] ?? 0) >= 1004) {
    const definition = child(child(header, 'OtherFlags'), 'TCDefinition')?.props[0];
    if (definition !== undefined) ktime = Number(definition) === 127 ? KTIME_V7 : KTIME_V8;
  }
  const rows = ['Lcl Translation', 'Lcl Rotation', 'Lcl Scaling'],
    axes = ['d|X', 'd|Y', 'd|Z'];
  for (const stack of scene.objects.values()) {
    if (stack.name !== 'AnimationStack') continue;
    const stackName = objectName(stack.props[1]);
    for (const [layerId] of scene.links.get(id(stack.props[0])) ?? []) {
      const layer = scene.objects.get(layerId);
      if (layer?.name !== 'AnimationLayer') continue;
      const layerName = objectName(layer.props[1]);
      // model → channel index → keys. Only the first curve on a channel counts.
      const curves = new Map<FbxModel, Map<number, [Float64Array, Float64Array]>>();
      for (const [nodeId] of scene.links.get(layerId) ?? []) {
        const curveNode = scene.objects.get(nodeId);
        if (curveNode?.name !== 'AnimationCurveNode') continue;
        for (const [target, property] of scene.parents.get(nodeId) ?? []) {
          const model = scene.models.get(target),
            row = rows.indexOf(property);
          if (!model || row < 0) continue;
          for (const [curveId, channel] of scene.links.get(nodeId) ?? []) {
            const curve = scene.objects.get(curveId),
              column = axes.indexOf(channel);
            if (curve?.name !== 'AnimationCurve' || column < 0) continue;
            const keys = readCurve(curve, ktime);
            if (!keys) continue;
            const channels = curves.get(model) ?? curves.set(model, new Map()).get(model)!;
            if (!channels.has(row * 3 + column)) channels.set(row * 3 + column, keys);
          }
        }
      }
      for (const rig of scene.rigs) {
        const tracks = new Map<FbxModel, Channels>();
        let start = Infinity,
          end = -Infinity;
        for (const model of rig.armature ? [rig.armature, ...rig.bones] : rig.bones) {
          const channels = curves.get(model);
          if (!channels) continue;
          const track = combine(model, channels);
          tracks.set(model, track);
          start = Math.min(start, track.times[0]);
          end = Math.max(end, track.times[track.times.length - 1]);
        }
        if (!tracks.size) continue;
        const name =
          stackName === layerName
            ? rig.name + '|' + stackName
            : rig.name + '|' + stackName + '|' + layerName;
        rig.actions.push({ id: name + '#' + rig.actions.length, name, start, end, tracks });
      }
    }
  }
}

function readCurve(curve: FbxNode, ktime: number): [Float64Array, Float64Array] | null {
  const times = numbers(child(curve, 'KeyTime')?.props[0]),
    values = numbers(child(curve, 'KeyValueFloat')?.props[0]);
  const count = Math.min(times.length, values.length);
  if (!count) return null;
  const t: number[] = [],
    v: number[] = [];
  for (let i = 0; i < count; i++) {
    const time = times[i] / ktime;
    // Files are meant to hold strictly increasing times; drop anything that is not.
    if (t.length && time <= t[t.length - 1]) continue;
    t.push(time);
    v.push(values[i]);
  }
  return [Float64Array.from(t), Float64Array.from(v)];
}

/** Give every channel a value at every key time, interpolating linearly like Blender's importer. */
function combine(model: FbxModel, channels: Map<number, [Float64Array, Float64Array]>): Channels {
  const all = new Set<number>();
  for (const [times] of channels.values()) for (const t of times) all.add(t);
  const times = Float64Array.from([...all].sort((a, b) => a - b));
  const initial = [...model.translation, ...model.rotation, ...model.scaling];
  const values = initial.map((value, index) => {
    const keys = channels.get(index),
      out = new Float64Array(times.length);
    if (!keys) return out.fill(value);
    const [kt, kv] = keys;
    let k = 0;
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      while (k < kt.length - 1 && kt[k + 1] <= t) k++;
      out[i] =
        t <= kt[0] || k === kt.length - 1
          ? kv[t <= kt[0] ? 0 : k]
          : kv[k] + ((kv[k + 1] - kv[k]) * (t - kt[k])) / (kt[k + 1] - kt[k]);
    }
    return out;
  });
  return { times, values };
}

const pa = new Vector3(),
  pb = new Vector3(),
  qa = new Quaternion(),
  qb = new Quaternion(),
  sa = new Vector3(),
  sb = new Vector3(),
  mb = new Matrix4();

/** A node's local transform at `time` seconds in an action; its stored transform when unanimated. */
function actionLocal(model: FbxModel, action: FbxAction | null, time: number, target: Matrix4) {
  const track = action?.tracks.get(model);
  if (!track) return localMatrix(model, undefined, undefined, undefined, target);
  const { times, values } = track,
    last = times.length - 1;
  const at = (i: number, into: Matrix4) =>
    localMatrix(
      model,
      [values[0][i], values[1][i], values[2][i]],
      [values[3][i], values[4][i], values[5][i]],
      [values[6][i], values[7][i], values[8][i]],
      into,
    );
  if (time <= times[0]) return at(0, target);
  if (time >= times[last]) return at(last, target);
  let low = 0,
    high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (times[mid] <= time) low = mid;
    else high = mid;
  }
  const f = (time - times[low]) / (times[high] - times[low]);
  if (f < 1e-9) return at(low, target);
  if (f > 1 - 1e-9) return at(high, target);
  // Between keys Blender blends location, quaternion and scale separately.
  at(low, target).decompose(pa, qa, sa);
  at(high, mb).decompose(pb, qb, sb);
  if (qa.dot(qb) < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
  qa.set(
    qa.x + (qb.x - qa.x) * f,
    qa.y + (qb.y - qa.y) * f,
    qa.z + (qb.z - qa.z) * f,
    qa.w + (qb.w - qa.w) * f,
  ).normalize();
  return target.compose(pa.lerp(pb, f), qa, sa.lerp(sb, f));
}

/** World matrices (metres, Y up) of a rig's bones at `time`, top node first when the rig has one. */
export function sampleRig(scene: FbxScene, rig: FbxRig, action: FbxAction | null, time: number) {
  const world = new Map<FbxModel | null, Matrix4>([[null, scene.global.clone()]]);
  const resolve = (model: FbxModel | null): Matrix4 => {
    let m = world.get(model);
    if (!m) {
      m = resolve(model!.parent)
        .clone()
        .multiply(actionLocal(model!, action, time, new Matrix4()));
      world.set(model, m);
    }
    return m;
  };
  return [...(rig.top ? [rig.armature!] : []), ...rig.bones].map(resolve);
}

/** Rest matrices in the same space and order as `sampleRig`. */
/** World matrix of the rig's armature node; the file's global transform when it has none. */
export function rigBase(scene: FbxScene, rig: FbxRig, action: FbxAction | null = null) {
  // Blender reports the armature where the action's first frame puts it.
  const pose = (model: FbxModel | null): Matrix4 =>
    model
      ? pose(model.parent).multiply(actionLocal(model, action, 0, new Matrix4()))
      : new Matrix4();
  return scene.global.clone().multiply(pose(rig.armature));
}

export function restRig(scene: FbxScene, rig: FbxRig, action: FbxAction | null = null) {
  const base = rigBase(scene, rig, action);
  const world = new Map<FbxModel | null, Matrix4>([[rig.armature, base]]);
  const resolve = (model: FbxModel): Matrix4 => {
    let m = world.get(model);
    if (!m) {
      m = resolve(model.parent!).clone().multiply(model.bind);
      world.set(model, m);
    }
    return m;
  };
  return [...(rig.top ? [base] : []), ...rig.bones.map(resolve)];
}

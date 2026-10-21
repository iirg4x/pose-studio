import { copyPose } from './poseCopy';
import { applyLiveMirrors, mirroredLimb, validateMirrorLinks } from './liveMirror';
import type { MirrorLinks } from './liveMirror';
import { validateControllerConstraints } from './controllerConstraints';
import type { ControllerConstraints } from './controllerConstraints';
import { validateMotionRig } from './motionRig';
import { validateNativeRotationLinks } from './nativeRotationLinks';
import type { MotionRig } from './motionRig';
import { hydratePropTracks, projectProps, validateProps, isProp } from './assets';
import type { PropBindings } from './assets';
import type { BoneFollowing } from './boneFollowing';
import { evaluateLayers, rawForLayer, syncLayers, layerParent, switchLayerParent } from './layers';
import type { AnimationLayer } from './layers';
import { INTERPOLATION_MODES, validateMotionOptions, motionOptions } from './interpolation';
import {
  CONTROLS,
  CONTROL_IDS,
  LEGACY_IDS,
  collectPropControlIds,
  isOffsetControl,
  controlLayerVisible,
  withProposedPropControls,
} from './controls';
import type { ControlId, LimbId, LimbMode } from './controls';
export type { ControlId, LimbId, LimbMode } from './controls';
import type { MotionOptions } from './interpolation';
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { EulerOrder } from 'three';
import {
  CHANNELS,
  channelValue,
  channelSample,
  readCurve,
  baseSample,
  sampleChannels,
  sampleIncoming,
  keyCurveFromPose,
  validateCurves,
} from './curves';
import type { Channel, Curve } from './curves';

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
export type ParentId = ControlId | 'world';
export type Interpolation = (typeof INTERPOLATION_MODES)[number];
export interface Pose {
  layerPosition?: boolean;
  p: V3;
  q: Q4;
  grip: number[];
  fov: number;
}
export interface Key extends Pose, MotionOptions {
  frame: number;
  interpolation?: Interpolation;
}
interface Space {
  frame: number;
  parent: ParentId;
  offset: number[];
  base: number[];
  sourceParent?: ParentId;
  sourceParentMatrix?: number[];
}
export interface Track extends MotionOptions {
  keyLock?: boolean;
  lockedChannels?: Channel[];
  layerReference?: import('./layerBlend').LayerReference;
  following?: BoneFollowing[];
  additive?: boolean;
  cameraSpace?: boolean;
  rotationOrder?: EulerOrder;
  rotationMode?: 'euler' | 'quaternion';
  basis?: { pre: number[]; post: number[] };
  curves?: Partial<Record<Channel, Curve>>;
  keys: Key[];
  spaces: Space[];
  interpolation: Interpolation;
}
export type RigLayer = 'firstPerson' | 'body';
interface BodyBase {
  sourceId: string;
  source: Project;
  enabled: boolean;
  excluded: ControlId[];
  alignment?: number[];
}
interface CameraBinding {
  bone: string;
  offset: number[];
  enabled: boolean;
}
export interface Project {
  mirrorLinks?: MirrorLinks;
  cameraBinding?: CameraBinding;
  constraints?: Partial<Record<RigLayer, ControllerConstraints>>;
  motionRig?: MotionRig;
  ikReference?: 'fk';
  props?: PropBindings;
  layers?: AnimationLayer[];
  activeLayerId?: string;
  actionType?: RigLayer;
  bodyBase?: BodyBase;
  propPreset?: 'rifle' | 'axe';
  limbModes?: Partial<
    Record<RigLayer, Partial<Record<LimbId, { frame: number; mode: LimbMode }[]>>>
  >;
  loop?: { enabled: boolean; start: number; end: number };
  version: 2;
  rig: 'ue5-manny-simple';
  name: string;
  fps: number;
  end: number;
  editing: RigLayer;
  tracks: Record<ControlId, Track>;
  otherTracks: Record<ControlId, Track>;
}
export const CAMERA_REFERENCE = pose([0, 1.65, 0], [0, 1, 0, 0], undefined, 65);
export function forLayer(p: Project, layer: RigLayer): Project {
  return p.editing === layer
    ? p
    : p.bodyBase && layer === p.bodyBase.source.editing
      ? p.bodyBase.source
      : {
          ...p,
          bodyBase: undefined,
          layers: undefined,
          activeLayerId: undefined,
          editing: layer,
          tracks: p.otherTracks,
          otherTracks: p.tracks,
        };
}
export const layerFrame = (p: Project, layer: RigLayer, frame: number) =>
  p.bodyBase && layer !== p.editing ? baseFrame(p, frame) : frame;
const CONTROL_LABELS = Object.fromEntries(
  CONTROL_IDS.map((id) => [id, CONTROLS[id].label]),
) as Record<ControlId, string>;
export const controlLabel = (
  id: ControlId,
  project?: Pick<Project, 'propPreset' | 'props'> | null,
) => (isProp(id) ? (projectProps(project)[id]?.name ?? 'Prop') : CONTROL_LABELS[id]);
export const controlLabels = (project?: Pick<Project, 'propPreset' | 'props'> | null) =>
  Object.fromEntries(IDS.map((id) => [id, controlLabel(id, project)])) as Record<ControlId, string>;
export const IDS = CONTROL_IDS;
export function limbMode(p: Project, limb: LimbId, frame: number): LimbMode {
  const linked = mirroredLimb(p, limb, frame);
  if (linked) return limbMode({ ...p, mirrorLinks: undefined }, linked.limb, linked.frame);
  return (
    p.limbModes?.[p.editing]?.[limb]?.filter((k) => k.frame <= frame).at(-1)?.mode ??
    (p.bodyBase?.enabled &&
    !p.bodyBase.excluded.includes(
      ((limb.startsWith('arm') ? 'hand_' : 'foot_') + limb.at(-1)) as ControlId,
    )
      ? limbMode(p.bodyBase.source, limb, baseFrame(p, frame))
      : 'ik')
  );
}
export function controlEnabled(p: Project, id: ControlId, frame: number) {
  const d = CONTROLS[id];
  return !d.limb || !d.only || limbMode(p, d.limb, frame) === d.only;
}
export const clone = <T>(value: T): T => structuredClone(value);
export function pose(
  p: V3 = [0, 0, 0],
  q: Q4 = [0, 0, 0, 1],
  grip = [0.4, 0.6, 0.7, 0.7, 0.7],
  fov = 70,
): Pose {
  return { p, q, grip, fov };
}
export function matrix(p: Pose) {
  return new Matrix4().compose(new Vector3(...p.p), new Quaternion(...p.q), new Vector3(1, 1, 1));
}
export function fromMatrix(m: Matrix4, extra: Pose = pose()): Pose {
  const p = new Vector3(),
    q = new Quaternion();
  m.decompose(p, q, new Vector3());
  return { ...copyPose(extra), p: p.toArray() as V3, q: q.normalize().toArray() as Q4 };
}
export function sample(track: Track, frame: number): Pose {
  return sampleChannels(track, frame, baseSample(track, frame));
}
export function trackMatrix(track: Track, value: Pose) {
  return track.basis
    ? new Matrix4()
        .fromArray(track.basis.pre)
        .multiply(matrix(value))
        .multiply(new Matrix4().fromArray(track.basis.post))
    : matrix(value);
}
export function activeSpace(track: Track, frame: number) {
  let out: Space | undefined;
  for (const s of track.spaces) if (s.frame <= frame) out = s;
  return out;
}
/** Raw value that leaves a control exactly where its active attachment placed it. */
export function attachmentRest(track: Track, frame: number, template: Pose): Pose | undefined {
  const s = activeSpace(track, frame);
  return s && fromMatrix(new Matrix4().fromArray(s.base), template);
}
export const overlayPose = () => pose([0, 0, 0], [0, 0, 0, 1], [0, 0, 0, 0, 0]);
const baseFrame = (p: Project, frame: number) =>
  p.bodyBase ? Math.min(p.bodyBase.source.end, (frame * p.bodyBase.source.fps) / p.fps) : frame;
const defaultBodyExclusions = () =>
  IDS.filter(
    (id) =>
      id === 'camera' ||
      ['head', 'neck_01', 'neck_02'].includes(id) ||
      CONTROLS[id].group.endsWith('leg'),
  );
const referenceCache = new WeakMap<
  Project,
  { reference: Record<ControlId, Pose>; alignment: Matrix4 }
>();
function sourceWorld(source: Project, frame: number) {
  const values = rigLocal(evaluate(source, frame)),
    camera = matrix(values.camera).multiply(matrix(CAMERA_REFERENCE).invert());
  for (const id of IDS)
    if (rootChild(id))
      values[id] = fromMatrix(camera.clone().multiply(matrix(values[id])), values[id]);
  return values;
}
type SourcePoseResolver = (
  source: Project,
  frame: number,
  values: Record<ControlId, Pose>,
) => Record<ControlId, Pose>;
let bodySourceResolver: SourcePoseResolver | undefined;
export const setBodySourceResolver = (resolver?: SourcePoseResolver) => {
  bodySourceResolver = resolver;
};
const resolvedBodySource = (source: Project, frame: number) => {
  const values = evaluate(source, frame);
  return rigLocal(bodySourceResolver ? bodySourceResolver(source, frame, values) : values);
};
function bodyBaseValues(p: Project, frame: number): Record<ControlId, Pose> | null {
  if (!p.bodyBase) return null;
  if (p.editing === 'firstPerson') {
    const { source, enabled, excluded } = p.bodyBase,
      reference = resolvedBodySource(source, 0),
      values = enabled ? resolvedBodySource(source, baseFrame(p, frame)) : clone(reference);
    for (const id of IDS)
      if (isProp(id) && projectProps(p)[id] && !projectProps(source)[id])
        values[id] = pose([0, 1, 0]);
      else if (id === 'camera') values[id] = clone(CAMERA_REFERENCE);
      else if (!enabled || excluded.includes(id))
        values[id] = id === 'root' || isOffsetControl(id) ? overlayPose() : clone(reference[id]);
    for (const side of ['l', 'r'] as const)
      for (const [index, digit] of ['thumb', 'index', 'middle', 'ring', 'pinky'].entries())
        if ([1, 2, 3].every((j) => excluded.includes((digit + '_0' + j + '_' + side) as ControlId)))
          values[('hand_' + side) as ControlId].grip[index] = 0;
    return values;
  }
  const { source, enabled, excluded } = p.bodyBase;
  let cached = referenceCache.get(source);
  if (!cached) {
    const reference = rigLocal(evaluate(forLayer(source, 'body'), 0)),
      initial = sourceWorld(source, 0);
    cached = {
      reference,
      alignment: matrix(reference.rifle).multiply(matrix(initial.rifle).invert()),
    };
    referenceCache.set(source, cached);
  }
  const values = enabled ? sourceWorld(source, baseFrame(p, frame)) : clone(cached.reference);
  for (const id of IDS) {
    if (isProp(id) && !projectProps(source)[id]) {
      values[id] = pose([0, 1, 0]);
      continue;
    }
    if (id === 'camera' || !enabled || excluded.includes(id))
      values[id] =
        isOffsetControl(id) || id === 'root' ? overlayPose() : clone(cached.reference[id]);
    else if (rootChild(id))
      values[id] = fromMatrix(
        (p.bodyBase.alignment
          ? new Matrix4().fromArray(p.bodyBase.alignment)
          : cached.alignment.clone()
        ).multiply(matrix(values[id])),
        values[id],
      );
  }
  for (const side of ['l', 'r'] as const)
    for (const [index, digit] of ['thumb', 'index', 'middle', 'ring', 'pinky'].entries())
      if ([1, 2, 3].every((j) => excluded.includes((digit + '_0' + j + '_' + side) as ControlId)))
        values[('hand_' + side) as ControlId].grip[index] = 0;
  return values;
}
function inheritedParent(p: Project, id: ControlId, frame: number): ParentId {
  const base = p.bodyBase;
  if (!base?.enabled || base.excluded.includes(id)) return 'world';
  const parent = controlParent(base.source, id, baseFrame(p, frame));
  return parent !== 'world' && base.excluded.includes(parent) ? 'world' : parent;
}
export function controlParent(p: Project, id: ControlId, frame: number): ParentId {
  const base = p.layers?.[0];
  const tracks = base && base.id !== p.activeLayerId ? base.tracks : p.tracks;
  return layerParent(
    p,
    id,
    frame,
    activeSpace(tracks[id], frame)?.parent ?? inheritedParent(p, id, frame),
  );
}
export function createBodyAction(source: Project, sourceId: string): Project {
  const snapshot = clone(forLayer(source, 'firstPerson'));
  snapshot.actionType = 'firstPerson';
  const tracks = Object.fromEntries(
    IDS.map((id) => [
      id,
      {
        additive: true,
        keys: [{ ...overlayPose(), frame: 0 }],
        spaces: [],
        interpolation: 'smooth',
      },
    ]),
  ) as unknown as Project['tracks'];
  const alignment = matrix(rigLocal(evaluate(forLayer(snapshot, 'body'), 0)).rifle)
    .multiply(matrix(sourceWorld(snapshot, 0).rifle).invert())
    .toArray();
  return {
    version: 2,
    rig: source.rig,
    name: source.name + ' · Body',
    fps: source.fps,
    end: source.end,
    editing: 'body',
    actionType: 'body',
    motionRig: clone(source.motionRig),
    props: clone(projectProps(source)),
    propPreset: source.propPreset,
    loop: clone(source.loop),
    tracks,
    otherTracks: clone(snapshot.tracks),
    bodyBase: {
      sourceId,
      source: snapshot,
      enabled: true,
      excluded: defaultBodyExclusions(),
      alignment,
    },
  };
}
export function createFirstPersonAction(source: Project, sourceId: string): Project {
  const snapshot = clone(forLayer(source, 'body'));
  snapshot.actionType = 'body';
  const tracks = Object.fromEntries(
    IDS.map((id) => [
      id,
      {
        additive: true,
        keys: [{ ...overlayPose(), frame: 0 }],
        spaces: [],
        interpolation: 'smooth',
      },
    ]),
  ) as unknown as Project['tracks'];
  return {
    version: 2,
    rig: source.rig,
    name: source.name + ' · First person',
    cameraBinding: clone(source.cameraBinding),
    fps: source.fps,
    end: source.end,
    editing: 'firstPerson',
    actionType: 'firstPerson',
    motionRig: clone(source.motionRig),
    props: clone(projectProps(source)),
    propPreset: source.propPreset,
    loop: clone(source.loop),
    tracks,
    otherTracks: clone(snapshot.tracks),
    bodyBase: { sourceId, source: snapshot, enabled: true, excluded: ['root', 'camera'] },
  };
}
function evaluateLocal(
  project: Project,
  frame: number,
  drafts: Partial<Record<ControlId, Pose>> = {},
  convertCamera = true,
) {
  const result = {} as Record<ControlId, Pose>,
    visiting = new Set<ControlId>();
  const base = bodyBaseValues(project, frame);
  const boundaries = new Map<number, Record<ControlId, Pose>>();
  const resolve = (id: ControlId): Pose => {
    if (result[id]) return result[id];
    if (visiting.has(id)) throw Error('Attachment cycle');
    visiting.add(id);
    const t = project.tracks[id],
      s = activeSpace(t, frame);
    let raw = drafts[id] ?? sample(t, frame);
    const next = t.spaces.find((event) => event.frame > frame),
      keyTimes = next
        ? [
            ...t.keys.map((k) => k.frame),
            ...Object.values(t.curves ?? {}).flatMap((c) => c!.keys.map((k) => k.frame)),
          ]
        : [];
    if (!drafts[id] && next && keyTimes.includes(next.frame)) {
      const start = Math.max(...keyTimes.filter((f) => f < next.frame));
      if (frame >= start) {
        let at = boundaries.get(next.frame);
        if (!at) {
          at = evaluateLocal(project, next.frame, {}, false);
          boundaries.set(next.frame, at);
        }
        let incoming = matrix(at[id]);
        if (s) {
          const parent = s.parent === 'world' ? new Matrix4() : matrix(at[s.parent]);
          incoming = new Matrix4()
            .fromArray(s.base)
            .multiply(new Matrix4().fromArray(s.offset).invert())
            .multiply(parent.invert())
            .multiply(incoming);
        }
        const boundaryBase = bodyBaseValues(project, next.frame);
        if (boundaryBase) {
          if (!s) {
            const parent = inheritedParent(project, id, frame);
            if (parent !== 'world')
              incoming = matrix(boundaryBase[parent])
                .multiply(matrix(at[parent]).invert())
                .multiply(incoming);
          }
          incoming = matrix(boundaryBase[id]).invert().multiply(incoming);
        }
        if (t.basis)
          incoming = new Matrix4()
            .fromArray(t.basis.pre)
            .invert()
            .multiply(incoming)
            .multiply(new Matrix4().fromArray(t.basis.post).invert());
        const endpoint = fromMatrix(incoming, sample(t, next.frame));
        if (new Quaternion(...endpoint.q).dot(new Quaternion(...sample(t, next.frame).q)) < 0)
          endpoint.q = endpoint.q.map((v) => -v) as Q4;
        raw = sampleIncoming(t, frame, next.frame, endpoint);
      }
    }
    let m = trackMatrix(t, raw);
    if (base) m = matrix(base[id]).multiply(m);
    if (s) {
      const parent = s.parent === 'world' ? new Matrix4() : matrix(resolve(s.parent));
      m = parent
        .multiply(new Matrix4().fromArray(s.offset))
        .multiply(new Matrix4().fromArray(s.base).invert())
        .multiply(m);
    } else if (base) {
      const parent = inheritedParent(project, id, frame);
      if (parent !== 'world')
        m = matrix(resolve(parent)).multiply(matrix(base[parent]).invert()).multiply(m);
    }
    const extra = base
      ? { ...raw, grip: raw.grip.map((v, i) => Math.max(-1, Math.min(1, v + base[id].grip[i]))) }
      : raw;
    result[id] = fromMatrix(m, extra);
    visiting.delete(id);
    return result[id];
  };
  for (const id of IDS) resolve(id);
  if (convertCamera && project.editing === 'firstPerson') {
    const worldToCamera = matrix(CAMERA_REFERENCE).multiply(matrix(result.camera).invert());
    for (const id of IDS)
      if (project.tracks[id].cameraSpace)
        result[id] = fromMatrix(worldToCamera.clone().multiply(matrix(result[id])), result[id]);
  }
  return result;
}
// Pose offsets and camera have their own spaces; spatial targets share the rig root.
export const rootChild = (id: ControlId) =>
  id !== 'root' && id !== 'camera' && !isOffsetControl(id);
export function rigLocal(values: Record<ControlId, Pose>) {
  const inv = matrix(values.root).invert(),
    local = { ...values };
  for (const id of IDS)
    if (rootChild(id)) local[id] = fromMatrix(inv.clone().multiply(matrix(values[id])), values[id]);
  return local;
}
export function evaluate(
  project: Project,
  frame: number,
  drafts: Partial<Record<ControlId, Pose>> = {},
) {
  hydratePropTracks(project);
  const source = (at: number) =>
    project.layers ? evaluateLayers(project, at, drafts) : evaluateUnlayered(project, at, drafts);
  return applyLiveMirrors(project, frame, source(frame), source);
}
export function evaluateUnlayered(
  project: Project,
  frame: number,
  drafts: Partial<Record<ControlId, Pose>> = {},
) {
  const values = evaluateLocal(project, frame, drafts),
    root = matrix(values.root);
  for (const id of IDS)
    if (rootChild(id))
      values[id] = fromMatrix(root.clone().multiply(matrix(values[id])), values[id]);
  return values;
}
export function putKey(track: Track, frame: number, value: Pose) {
  if (
    !track.keyLock &&
    (track.lockedChannels?.length || Object.values(track.curves ?? {}).some((c) => c?.keyLock))
  ) {
    for (const c of CHANNELS) {
      if (
        c.startsWith('blend') ||
        (track.rotationMode === 'quaternion' && ['rx', 'ry', 'rz'].includes(c)) ||
        (track.rotationMode !== 'quaternion' && c.startsWith('q'))
      )
        continue;
      const locked = track.lockedChannels?.includes(c) || track.curves?.[c]?.keyLock;
      if (locked && !readCurve(track, c).keys.some((k) => k.frame === frame)) continue;
      if (
        !track.curves?.[c] &&
        Math.abs(channelValue(value, c, track.rotationOrder) - channelSample(track, c, frame)) <
          1e-7
      )
        continue;
      track.curves ??= {};
      track.curves[c] ??= clone(readCurve(track, c));
    }
    keyCurveFromPose(track, frame, value);
    return;
  }
  if (track.keyLock && !track.keys.some((k) => k.frame === frame)) {
    keyCurveFromPose(track, frame, value);
    return;
  }
  const previous =
      track.keys.find((k) => k.frame === frame) ??
      track.keys.filter((k) => k.frame <= frame).at(-1),
    k = {
      ...clone(value),
      ...motionOptions(previous ?? {}),
      interpolation: previous?.interpolation,
      frame,
    };
  track.keys = track.keys.filter((v) => v.frame !== frame);
  track.keys.push(k);
  track.keys.sort((a, b) => a.frame - b.frame);
  keyCurveFromPose(track, frame, value);
}
export function rawForWorld(
  project: Project,
  id: ControlId,
  frame: number,
  world: Pose,
  drafts: Partial<Record<ControlId, Pose>> = {},
): Pose {
  return project.layers
    ? rawForLayer(project, id, frame, world, drafts)
    : rawForWorldUnlayered(project, id, frame, world, drafts);
}
export function rawForWorldUnlayered(
  project: Project,
  id: ControlId,
  frame: number,
  world: Pose,
  drafts: Partial<Record<ControlId, Pose>> = {},
): Pose {
  const local = evaluateLocal(project, frame, drafts, false),
    base = bodyBaseValues(project, frame);
  if (rootChild(id)) world = fromMatrix(matrix(local.root).invert().multiply(matrix(world)), world);
  const track = project.tracks[id],
    s = activeSpace(track, frame);
  let m = matrix(world);
  if (track.cameraSpace && project.editing === 'firstPerson')
    m = matrix(local.camera).multiply(matrix(CAMERA_REFERENCE).invert()).multiply(m);
  if (s) {
    const parent = s.parent === 'world' ? new Matrix4() : matrix(local[s.parent]);
    m = new Matrix4()
      .fromArray(s.base)
      .multiply(new Matrix4().fromArray(s.offset).invert())
      .multiply(parent.invert())
      .multiply(m);
  } else if (base) {
    const parent = inheritedParent(project, id, frame);
    if (parent !== 'world')
      m = matrix(base[parent]).multiply(matrix(local[parent]).invert()).multiply(m);
  }
  if (base) {
    m = matrix(base[id]).invert().multiply(m);
    world = {
      ...world,
      grip: world.grip.map((v, i) => Math.max(-2, Math.min(2, v - base[id].grip[i]))),
    };
  }
  if (track.basis)
    m = new Matrix4()
      .fromArray(track.basis.pre)
      .invert()
      .multiply(m)
      .multiply(new Matrix4().fromArray(track.basis.post).invert());
  return fromMatrix(m, world);
}
export function switchParent(project: Project, id: ControlId, parent: ParentId, frame: number) {
  if (id === 'root' || parent === 'root')
    throw Error('Root already drives the rig and cannot use attachments.');
  if (id === parent) throw Error('A control cannot follow itself.');
  if (
    !!project.tracks[id].cameraSpace !==
    !!(parent === 'world' ? project.tracks[id].cameraSpace : project.tracks[parent].cameraSpace)
  )
    throw Error('These controls use different camera spaces.');
  if (project.layers && project.activeLayerId !== project.layers[0].id)
    return switchLayerParent(project, id, parent, frame);
  const before = evaluateLocal(project, frame, {}, false),
    base = sample(project.tracks[id], frame);
  const pm = parent === 'world' ? new Matrix4() : matrix(before[parent]);
  const inherited = bodyBaseValues(project, frame),
    baseMatrix = trackMatrix(project.tracks[id], base);
  if (inherited) baseMatrix.premultiply(matrix(inherited[id]));
  const event: Space = {
    frame,
    parent,
    offset: pm.invert().multiply(matrix(before[id])).toArray(),
    base: baseMatrix.toArray(),
  };
  const next = clone(project);
  next.tracks[id].spaces = next.tracks[id].spaces
    .filter((s) => s.frame !== event.frame)
    .concat(event)
    .sort((a, b) => a.frame - b.frame);
  // Check every future attachment boundary; a valid current graph can otherwise create a later cycle.
  const boundaries = new Set([
    frame,
    ...IDS.flatMap((k) => next.tracks[k].spaces.map((s) => s.frame)),
  ]);
  for (const f of boundaries) evaluate(next, f);
  return next;
}
export function createProject(rest: Partial<Record<ControlId, Pose>> = {}, demo = true): Project {
  const defaults: Record<ControlId, Pose> = {
    ...(Object.fromEntries(IDS.map((id) => [id, pose()])) as Record<ControlId, Pose>),
    root: pose(),
    hand_l: pose([0.03, 1.22, 0.48]),
    hand_r: pose([-0.15, 1.24, 0.28]),
    elbow_l: pose([0.48, 1.0, 0.04]),
    elbow_r: pose([-0.48, 1.0, 0.04]),
    rifle: pose([-0.12, 1.3, 0.27]),
    magazine: pose([-0.12, 1.15, 0.34]),
    camera: clone(CAMERA_REFERENCE),
    hips: pose(),
    chest: pose(),
    head: pose(),
    foot_l: pose([0.14, 0.08, -0.01]),
    foot_r: pose([-0.14, 0.08, -0.01]),
    knee_l: pose([0.18, 0.5, 0.7]),
    knee_r: pose([-0.18, 0.5, 0.7]),
  };
  const initial = { ...defaults, ...rest };
  const tracks = {} as Project['tracks'];
  for (const id of IDS)
    tracks[id] = {
      keys: [{ ...clone(initial[id] ?? pose()), frame: 0 }],
      spaces: [],
      interpolation: 'smooth',
    };
  let project: Project = {
    version: 2,
    rig: 'ue5-manny-simple',
    name: demo ? 'Rifle reload' : 'Untitled animation',
    fps: 24,
    end: 96,
    editing: 'firstPerson',
    tracks,
    otherTracks: {} as Project['tracks'],
  };
  // Stable contact offsets relative to the authored prop.
  project = switchParent(project, 'hand_r', 'rifle', 0);
  project = switchParent(project, 'hand_l', 'rifle', 0);
  project = switchParent(project, 'magazine', 'rifle', 0);
  if (demo) {
    const r = initial.rifle;
    for (const [f, dp] of [
      [0, [0, 0, 0]],
      [20, [0.015, -0.015, -0.015]],
      [38, [0.01, -0.04, -0.025]],
      [58, [0.01, -0.04, -0.025]],
      [78, [0, 0, 0]],
      [96, [0, 0, 0]],
    ] as [number, V3][]) {
      putKey(project.tracks.rifle, f, { ...r, p: r.p.map((v, i) => v + dp[i]) as V3 });
    }
    // Release the hand, then guide it to the magazine.
    project = switchParent(project, 'hand_l', 'world', 22);
    const at22 = evaluate(project, 22).hand_l;
    putKey(project.tracks.hand_l, 22, rawForWorld(project, 'hand_l', 22, at22));
    const grab = { ...initial.hand_l, p: [-0.025, 1.18, 0.315] as V3 };
    putKey(project.tracks.hand_l, 34, rawForWorld(project, 'hand_l', 34, grab));
    project = switchParent(project, 'hand_l', 'magazine', 34);
    project = switchParent(project, 'magazine', 'world', 36);
    for (const [f, p] of [
      [36, [-0.11, 1.12, 0.315]],
      [48, [-0.06, 1.02, 0.24]],
      [58, [-0.05, 1.02, 0.25]],
      [70, [-0.12, 1.15, 0.34]],
    ] as [number, V3][]) {
      putKey(
        project.tracks.magazine,
        f,
        rawForWorld(project, 'magazine', f, { ...initial.magazine, p }),
      );
    }
    project = switchParent(project, 'magazine', 'rifle', 70);
    project = switchParent(project, 'hand_l', 'world', 72);
    putKey(
      project.tracks.hand_l,
      72,
      rawForWorld(project, 'hand_l', 72, evaluate(project, 72).hand_l),
    );
    putKey(project.tracks.hand_l, 86, rawForWorld(project, 'hand_l', 86, initial.hand_l));
    project = switchParent(project, 'hand_l', 'rifle', 86);
  }
  project.otherTracks = clone(project.tracks);
  // Frame the independent player rig for readability; world-body anatomy stays unchanged.
  for (const id of ['hand_l', 'hand_r', 'elbow_l', 'elbow_r', 'rifle', 'magazine'] as ControlId[]) {
    for (const key of project.tracks[id].keys) {
      key.p[1] += 0.27;
      key.p[2] += 0.25;
    }
    for (const space of project.tracks[id].spaces) {
      space.base[13] += 0.27;
      space.base[14] += 0.25;
      if (space.parent === 'world') {
        space.offset[13] += 0.27;
        space.offset[14] += 0.25;
      }
    }
  }
  return project;
}
export interface ProjectValidationOptions {
  takeOwnership?: boolean;
  /** Keep dynamic prop controls local until the containing operation commits. */
  commitPropControls?: boolean;
}
export function validateProject(input: unknown, options: ProjectValidationOptions = {}): Project {
  if (!input || typeof input !== 'object') throw Error('This is not an animation project.');
  return withProposedPropControls(
    collectPropControlIds(input),
    () => validateOwnedProject((options.takeOwnership ? input : clone(input)) as Project),
    options.commitPropControls !== false,
  );
}
// Validation owns this copy, including nested source clips. Copying it again
// doubles transient document memory without providing any further isolation.
function validateOwnedProject(p: Project): Project {
  if (!p || typeof p !== 'object') throw Error('This is not an animation project.');
  if (p.props !== undefined) validateProps(p.props);
  hydratePropTracks(p);
  if ((p as unknown as { version: number }).version === 1) {
    p.version = 2;
    p.editing = 'firstPerson';
    p.otherTracks = clone(p.tracks);
  }
  if (
    p.version !== 2 ||
    !['firstPerson', 'body'].includes(p.editing) ||
    p.rig !== 'ue5-manny-simple'
  )
    throw Error('This version opens Manny Simple projects only.');
  if (p.propPreset !== undefined && !['rifle', 'axe'].includes(p.propPreset))
    throw Error('Unknown prop preset.');
  validateMotionRig(p.motionRig);
  validateControllerConstraints(p.constraints);
  validateMirrorLinks(p);
  if (p.ikReference !== undefined && p.ikReference !== 'fk')
    throw Error('Invalid IK reference pose.');
  if (
    p.actionType !== undefined &&
    (!['firstPerson', 'body'].includes(p.actionType) || p.actionType !== p.editing)
  )
    throw Error('Invalid action type.');
  if (p.bodyBase) {
    const b = p.bodyBase;
    if (
      !p.actionType ||
      typeof b.sourceId !== 'string' ||
      !b.sourceId ||
      b.sourceId.length > 100 ||
      typeof b.enabled !== 'boolean' ||
      !Array.isArray(b.excluded) ||
      b.excluded.some((id) => !IDS.includes(id)) ||
      !b.source ||
      b.source.editing === p.editing
    )
      throw Error('Invalid source animation.');
    b.source = validateOwnedProject(b.source);
  }
  if (
    typeof p.name !== 'string' ||
    p.name.length > 100 ||
    !Number.isInteger(p.end) ||
    p.end < 1 ||
    p.end > 2400 ||
    !Number.isInteger(p.fps) ||
    p.fps < 1 ||
    p.fps > 120
  )
    throw Error('Invalid project timing or name.');
  if (
    p.loop &&
    (typeof p.loop.enabled !== 'boolean' ||
      !Number.isInteger(p.loop.start) ||
      !Number.isInteger(p.loop.end) ||
      p.loop.start < 0 ||
      p.loop.end > p.end ||
      p.loop.end <= p.loop.start)
  )
    throw Error('Invalid loop range.');
  const finite = (a: unknown, n: number) =>
    Array.isArray(a) &&
    a.length === n &&
    a.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6);
  if (p.cameraBinding) {
    const b = p.cameraBinding;
    if (
      typeof b.enabled !== 'boolean' ||
      typeof b.bone !== 'string' ||
      !Object.values(CONTROLS).some((c) => c.bone === b.bone) ||
      !finite(b.offset, 16) ||
      Math.abs(new Matrix4().fromArray(b.offset).determinant() - 1) > 0.001
    )
      throw Error('Invalid camera bone attachment.');
  }
  if (
    p.bodyBase?.alignment &&
    (!finite(p.bodyBase.alignment, 16) ||
      Math.abs(new Matrix4().fromArray(p.bodyBase.alignment).determinant()) < 1e-8)
  )
    throw Error('Invalid body base alignment.');
  if (p.limbModes) {
    for (const [layer, limbs] of Object.entries(p.limbModes)) {
      if (!['firstPerson', 'body'].includes(layer) || !limbs || typeof limbs !== 'object')
        throw Error('Invalid rig modes');
      for (const [limb, keys] of Object.entries(limbs)) {
        if (
          !['arm_l', 'arm_r', 'leg_l', 'leg_r'].includes(limb) ||
          !Array.isArray(keys) ||
          keys.length > 2401
        )
          throw Error('Invalid limb modes');
        let last = -1;
        for (const k of keys) {
          if (
            !Number.isFinite(k.frame) ||
            k.frame < 0 ||
            k.frame > 2400 ||
            k.frame <= last ||
            !['ik', 'fk'].includes(k.mode)
          )
            throw Error('Invalid limb mode key');
          last = k.frame;
        }
      }
    }
  }
  if (p.layers) {
    if (
      !Array.isArray(p.layers) ||
      !p.layers.length ||
      p.layers.length > 32 ||
      p.layers[0].kind !== 'base' ||
      !p.layers.some((l) => l.id === p.activeLayerId)
    )
      throw Error('Invalid layer stack.');
    for (const [i, l] of p.layers.entries())
      if (l.poseLinks !== undefined) {
        if (i !== 0 || !l.static || !Array.isArray(l.poseLinks) || l.poseLinks.length > 8)
          throw Error('Invalid base pose link.');
        for (const link of l.poseLinks) {
          if (
            !link ||
            typeof link.clipId !== 'string' ||
            !link.clipId ||
            link.clipId.length > 100 ||
            !Number.isFinite(link.frame) ||
            link.frame < 0 ||
            link.frame > 2400
          )
            throw Error('Invalid base pose link.');
          if (
            link.controls !== undefined &&
            (!Array.isArray(link.controls) ||
              !link.controls.length ||
              new Set(link.controls).size !== link.controls.length ||
              link.controls.some((id) => !IDS.includes(id)))
          )
            throw Error('Invalid base pose controls.');
        }
      }
    for (const l of p.layers)
      if (
        l.contactMask !== undefined &&
        (!Array.isArray(l.contactMask) ||
          new Set(l.contactMask).size !== l.contactMask.length ||
          l.contactMask.some((id) => !IDS.includes(id)))
      )
        throw Error('Invalid layer contact mask.');
    for (const l of p.layers) {
      if (
        l.nativeSpace !== undefined &&
        (!['local', 'mesh'].includes(l.nativeSpace) ||
          l.kind !== 'additive' ||
          !p.motionRig?.parents ||
          !p.motionRig.restRotations)
      )
        throw Error('Invalid native additive layer.');
      validateNativeRotationLinks(l.nativeRotationLinks, l.nativeSpace);
    }
    const ids = new Set<string>();
    for (const [i, l] of p.layers.entries()) {
      if (l.static !== undefined && (typeof l.static !== 'boolean' || i !== 0))
        throw Error('Invalid static base layer.');
      if (
        l.source?.referenceAsset !== undefined &&
        (typeof l.source.referenceAsset !== 'string' || l.source.referenceAsset.length > 1024)
      )
        throw Error('Invalid layer reference source.');
      if (
        l.source &&
        (!l.source.asset ||
          typeof l.source.asset !== 'string' ||
          l.source.asset.length > 1024 ||
          !Number.isFinite(l.source.frame) ||
          l.source.frame < 0)
      )
        throw Error('Invalid layer source.');
      if (
        typeof l.id !== 'string' ||
        !l.id ||
        l.id.length > 100 ||
        ids.has(l.id) ||
        typeof l.name !== 'string' ||
        !l.name.trim() ||
        l.name.length > 100 ||
        !(i === 0 ? l.kind === 'base' : ['pose', 'additive'].includes(l.kind)) ||
        typeof l.enabled !== 'boolean' ||
        typeof l.solo !== 'boolean' ||
        typeof l.contacts !== 'boolean' ||
        !Number.isFinite(l.weight) ||
        l.weight < 0 ||
        l.weight > 1 ||
        !Array.isArray(l.excluded) ||
        l.excluded.some((id) => !IDS.includes(id))
      )
        throw Error('Invalid animation layer.');
      if (
        (l.space && !['local', 'parent', 'world'].includes(l.space)) ||
        (l.spaces &&
          Object.entries(l.spaces).some(
            ([id, v]) =>
              !IDS.includes(id as ControlId) || !v || !['local', 'parent', 'world'].includes(v),
          ))
      )
        throw Error('Invalid layer space.');
      ids.add(l.id);
    }
    syncLayers(p);
  }
  for (const tracks of new Set([
    p.tracks,
    p.otherTracks,
    ...(p.layers ?? []).map((l) => l.tracks),
  ])) {
    // Upgrade the previously implicit identity root without changing existing poses.
    if (tracks && !Object.hasOwn(tracks, 'root'))
      tracks.root = { keys: [{ ...pose(), frame: 0 }], spaces: [], interpolation: 'smooth' };
    if (tracks)
      for (const id of IDS)
        if (!LEGACY_IDS.includes(id) && !Object.hasOwn(tracks, id))
          tracks[id] = {
            keys: [
              {
                ...pose(
                  id === 'knee_l'
                    ? [0.18, 0.5, 0.7]
                    : id === 'knee_r'
                      ? [-0.18, 0.5, 0.7]
                      : [0, 0, 0],
                ),
                frame: 0,
              },
            ],
            spaces: [],
            interpolation: 'smooth',
          };
    for (const id of IDS) {
      const t = tracks?.[id];
      if (
        !t ||
        !Array.isArray(t.keys) ||
        !t.keys.length ||
        t.keys.length > 5000 ||
        !Array.isArray(t.spaces) ||
        t.spaces.length > 5000 ||
        !INTERPOLATION_MODES.includes(t.interpolation)
      )
        throw Error('Invalid animation track: ' + id);
      if ((id === 'root' && t.spaces.length) || t.spaces.some((s) => s.parent === 'root'))
        throw Error('Root cannot use attachment spaces.');
      if (
        t.lockedChannels !== undefined &&
        (!Array.isArray(t.lockedChannels) || t.lockedChannels.some((c) => !CHANNELS.includes(c)))
      )
        throw Error('Invalid locked channels.');
      if (t.keyLock !== undefined && typeof t.keyLock !== 'boolean')
        throw Error('Invalid control key lock.');
      validateMotionOptions(t);
      validateCurves(t);
      if (t.following !== undefined) {
        if (!Array.isArray(t.following) || t.following.length > 5000)
          throw Error('Invalid bone following.');
        let previous = -1;
        for (const key of t.following) {
          if (
            !Number.isFinite(key.frame) ||
            key.frame < 0 ||
            key.frame > 2400 ||
            key.frame <= previous ||
            typeof key.position !== 'boolean' ||
            typeof key.rotation !== 'boolean' ||
            ![key.world, key.local, key.parent].every(
              (m) => finite(m, 16) && Math.abs(new Matrix4().fromArray(m).determinant()) > 1e-8,
            )
          )
            throw Error('Invalid bone following key on ' + id);
          if (
            (key.target !== undefined &&
              key.target !== 'world' &&
              key.target !== 'native' &&
              !IDS.includes(key.target)) ||
            key.target === id
          )
            throw Error('Invalid attachment target.');
          previous = key.frame;
        }
      }

      if (
        t.additive !== undefined &&
        (typeof t.additive !== 'boolean' ||
          (t.additive &&
            !(
              (p.bodyBase && (tracks === p.tracks || tracks === p.otherTracks)) ||
              p.layers?.some((l) => l.tracks === tracks)
            )))
      )
        throw Error('Invalid additive track.');
      if (t.rotationMode !== undefined && !['euler', 'quaternion'].includes(t.rotationMode))
        throw Error('Invalid rotation mode.');
      if (
        t.rotationOrder !== undefined &&
        !['XYZ', 'XZY', 'YXZ', 'YZX', 'ZXY', 'ZYX'].includes(t.rotationOrder)
      )
        throw Error('Invalid rotation order.');
      if (
        t.cameraSpace !== undefined &&
        (typeof t.cameraSpace !== 'boolean' ||
          id === 'camera' ||
          id === 'root' ||
          isOffsetControl(id))
      )
        throw Error('Invalid camera space.');
      if (t.layerReference) {
        const r = t.layerReference,
          valid = (v: Pose) =>
            v &&
            finite(v.p, 3) &&
            finite(v.q, 4) &&
            finite(v.grip, 5) &&
            Number.isFinite(v.fov) &&
            Math.abs(new Quaternion(...v.q).length() - 1) < 0.01;
        if (
          !Number.isFinite(r.frame) ||
          r.frame < 0 ||
          r.frame > 2400 ||
          !valid(r.value) ||
          !valid(r.root) ||
          (r.parent && !valid(r.parent)) ||
          (r.basis &&
            (!finite(r.basis.parent, 4) ||
              !finite(r.basis.rest, 4) ||
              (r.basis.parentPosition && !finite(r.basis.parentPosition, 3)) ||
              (r.basis.restPosition && !finite(r.basis.restPosition, 3))))
        )
          throw Error('Invalid replacement reference.');
      }
      if (
        t.basis &&
        (!finite(t.basis.pre, 16) ||
          !finite(t.basis.post, 16) ||
          Math.abs(new Matrix4().fromArray(t.basis.pre).determinant()) < 1e-8 ||
          Math.abs(new Matrix4().fromArray(t.basis.post).determinant()) < 1e-8)
      )
        throw Error('Invalid control basis.');
      let last = -1;
      for (const k of t.keys) {
        const gripLimit = t.additive ? 2 : 1;
        if (k.layerPosition !== undefined && typeof k.layerPosition !== 'boolean')
          throw Error('Invalid layer position intent.');
        validateMotionOptions(k);
        if (k.interpolation !== undefined && !INTERPOLATION_MODES.includes(k.interpolation))
          throw Error('Invalid key interpolation.');
        if (
          !Number.isFinite(k.frame) ||
          k.frame < 0 ||
          k.frame > 2400 ||
          k.frame <= last ||
          !finite(k.p, 3) ||
          !finite(k.q, 4) ||
          !finite(k.grip, 5) ||
          !Number.isFinite(k.fov) ||
          (t.additive ? Math.abs(k.fov) > 1e6 : k.fov < 20 || k.fov > 120) ||
          Math.abs(new Quaternion(...k.q).length() - 1) > 0.01 ||
          k.grip.some((v) => v < -gripLimit || v > gripLimit)
        )
          throw Error('Invalid pose on ' + id);
        last = k.frame;
      }
      last = -1;
      for (const s of t.spaces) {
        if (
          !Number.isFinite(s.frame) ||
          s.frame < 0 ||
          s.frame > 2400 ||
          s.frame <= last ||
          (!IDS.includes(s.parent as ControlId) && s.parent !== 'world') ||
          !finite(s.offset, 16) ||
          !finite(s.base, 16) ||
          Math.abs(new Matrix4().fromArray(s.offset).determinant()) < 1e-8 ||
          Math.abs(new Matrix4().fromArray(s.base).determinant()) < 1e-8
        )
          throw Error('Invalid attachment on ' + id);
        if (
          s.sourceParent !== undefined &&
          ((s.sourceParent !== 'world' && !IDS.includes(s.sourceParent)) ||
            !finite(s.sourceParentMatrix, 16) ||
            Math.abs(new Matrix4().fromArray(s.sourceParentMatrix!).determinant()) < 1e-8)
        )
          throw Error('Invalid attachment source space.');
        last = s.frame;
      }
      // Early Axe imports wrote unused knee controls as identity offsets, even
      // though IK poles are absolute targets. Repair only that exact neutral
      // import signature; authored poles and additive body corrections stay intact.
      if (
        p.propPreset === 'axe' &&
        (id === 'knee_l' || id === 'knee_r') &&
        !t.additive &&
        !t.basis &&
        !t.cameraSpace &&
        !t.spaces.length &&
        t.keys.length === 1 &&
        t.keys[0].frame === 0 &&
        t.keys[0].p.every((v) => v === 0) &&
        t.keys[0].grip.every((v) => v === 0) &&
        ['px', 'py', 'pz', 'rx', 'ry', 'rz'].every((c) => {
          const curve = t.curves?.[c as Channel];
          return (
            curve &&
            curve.keys.length === 1 &&
            curve.keys[0].frame === 0 &&
            curve.keys[0].value === 0 &&
            !curve.modifiers.length
          );
        })
      ) {
        t.keys[0].p = id === 'knee_l' ? [0.18, 0.5, 0.7] : [-0.18, 0.5, 0.7];
        for (const [i, c] of (['px', 'py', 'pz'] as const).entries())
          t.curves![c]!.keys[0].value = t.keys[0].p[i] * 100;
      }
    }
    for (const f of new Set([0, ...IDS.flatMap((id) => tracks[id].spaces.map((s) => s.frame))]))
      evaluate(
        {
          ...p,
          tracks,
          layers: undefined,
          activeLayerId: undefined,
          bodyBase: tracks === p.tracks ? p.bodyBase : undefined,
        },
        f,
      );
  }
  return p;
}

export function visibleControls(
  layer: RigLayer,
  project?: Pick<Project, 'propPreset' | 'props' | 'cameraBinding'> | null,
) {
  return IDS.filter(
    (id) =>
      (controlLayerVisible(id, layer) ||
        (!!project?.cameraBinding && CONTROLS[id].bone === project.cameraBinding.bone)) &&
      (!isProp(id) || !!projectProps(project ?? { propPreset: undefined })[id]),
  );
}

import { mirrorDriver } from './liveMirror';
import { randomId } from './crypto';
import { layerAxes, layerBases, layerDelta, removeLayerDelta } from './layerSpaces';
import type { LayerSpace, LayerBasis } from './layerSpaces';
import { Matrix4, Quaternion } from 'three';
import {
  IDS,
  clone,
  pose,
  overlayPose,
  matrix,
  trackMatrix,
  fromMatrix,
  rigLocal,
  rootChild,
  evaluateUnlayered,
  rawForWorldUnlayered,
  controlParent,
  sample,
  activeSpace,
} from './model';
import type { Project, ControlId, Pose, Track, V3, Q4 } from './model';
import { BONE_CONTROLS } from './controls';
import {
  nativeSkeletonPose,
  nativeBoneOffset,
  removeNativeBoneDelta,
  nativeTargetInput,
} from '../scene/nativeSkeleton';
import type { NativeContext, NativeSpace } from '../scene/nativeSkeleton';
import { resolveNativeRotations, nativeRotationResidual } from './nativeRotationLinks';
import type { NativeRotationLinks } from './nativeRotationLinks';

import {
  hasAxisBlend,
  controlLayerWeight,
  blendLayerPoses,
  layerReferencePose,
  captureLayerReference,
  invertLayerBlend,
} from './layerBlend';
export interface PoseLink {
  clipId: string;
  frame: number;
  controls?: ControlId[];
}
export interface AnimationLayer {
  contactMask?: ControlId[];
  nativeSpace?: NativeSpace;
  nativeRotationLinks?: NativeRotationLinks;
  poseLinks?: PoseLink[];
  static?: boolean;
  source?: { asset: string; frame: number; referenceAsset?: string };
  space?: LayerSpace;
  spaces?: Partial<Record<ControlId, LayerSpace>>;
  id: string;
  name: string;
  kind: 'base' | 'pose' | 'additive';
  enabled: boolean;
  solo: boolean;
  weight: number;
  excluded: ControlId[];
  contacts: boolean;
  tracks: Record<ControlId, Track>;
}
export const activeAnimationLayer = (p: Project) => p.layers?.find((l) => l.id === p.activeLayerId);
export const keyingFrame = (p: Project, frame: number) =>
  activeAnimationLayer(p)?.kind === 'pose' || activeAnimationLayer(p)?.static ? 0 : frame;
export function layerTracks(p: Project, l: AnimationLayer) {
  return l.id === p.activeLayerId ? p.tracks : l.tracks;
}
export function syncLayers(p: Project) {
  const active = activeAnimationLayer(p);
  if (active) active.tracks = p.tracks;
  return p;
}
export function ensureLayers(p: Project) {
  if (p.layers) return syncLayers(p);
  const base: AnimationLayer = {
    id: randomId(),
    name: p.bodyBase
      ? p.editing === 'body'
        ? 'Body corrections'
        : 'First-person corrections'
      : 'Base animation',
    kind: 'base',
    enabled: true,
    solo: false,
    weight: 1,
    excluded: [],
    contacts: true,
    tracks: p.tracks,
  };
  p.layers = [base];
  p.activeLayerId = base.id;
  return p;
}
export function selectAnimationLayer(p: Project, id: string) {
  syncLayers(p);
  const layer = p.layers?.find((l) => l.id === id);
  if (layer) {
    p.activeLayerId = id;
    p.tracks = layer.tracks;
  }
  return p;
}
export function addAnimationLayer(project: Project, kind: 'pose' | 'additive') {
  const p = ensureLayers(clone(project));
  const layer: AnimationLayer = {
    id: randomId(),
    name: kind === 'pose' ? 'Pose layer' : 'Adjustment ' + p.layers!.length,
    kind,
    space: kind === 'pose' ? 'world' : 'local',
    enabled: true,
    solo: false,
    weight: 1,
    excluded: ['camera'],
    contacts: true,
    tracks: Object.fromEntries(
      IDS.map((id) => [
        id,
        {
          additive: true,
          interpolation: 'smooth',
          keys: [{ ...overlayPose(), frame: 0 }],
          spaces: [],
        },
      ]),
    ) as unknown as Record<ControlId, Track>,
  };
  p.layers!.push(layer);
  return selectAnimationLayer(p, layer.id);
}
export function editLayerAllowed(p: Project, id?: ControlId) {
  if (id && mirrorDriver(p, id)) return false;
  const l = activeAnimationLayer(p);
  return !l || l.kind === 'base'
    ? !l?.poseLinks?.length
    : l.enabled &&
        l.weight > 0 &&
        !p.layers!.some((x) => x.kind !== 'base' && x.solo && x.enabled && x.id !== l.id) &&
        (!id || !l.excluded.includes(id));
}
export function authorLayerPosition(p: Project, id: ControlId) {
  const layer = activeAnimationLayer(p);
  if (!layer || layer.kind === 'base' || (layer.spaces?.[id] ?? layer.space ?? 'local') !== 'world')
    return;
  layerTracks(p, layer)[id].keys[0].layerPosition = true;
  return true;
}
function ownsPosition(p: Project, layer: AnimationLayer, id: ControlId, raw: Pose) {
  if ((layer.spaces?.[id] ?? layer.space ?? 'local') !== 'world') return false;
  const track = layerTracks(p, layer)[id];
  return (
    raw.layerPosition ||
    track.keys.some((k) => k.layerPosition) ||
    raw.p.some((v) => Math.abs(v) > 1e-8) ||
    track.keys.some((k) => k.p.some((v) => Math.abs(v) > 1e-8)) ||
    (['px', 'py', 'pz'] as const).some((c) =>
      track.curves?.[c]?.keys.some((k) => Math.abs(k.value) > 1e-6),
    )
  );
}
function baseProject(p: Project) {
  const base = p.layers![0];
  return { ...p, layers: undefined, activeLayerId: undefined, tracks: layerTracks(p, base) };
}
function layerWeight(p: Project, l: AnimationLayer, id: ControlId, frame = 0) {
  const solo = p.layers!.some((x) => x.kind !== 'base' && x.solo && x.enabled);
  return l.enabled && (!solo || l.solo) && !l.excluded.includes(id)
    ? l.weight * controlLayerWeight(layerTracks(p, l)[id], frame)
    : 0;
}
function weighted(value: Pose, weight: number) {
  return pose(
    value.p.map((v) => v * weight) as V3,
    new Quaternion().slerp(new Quaternion(...value.q), weight).toArray() as Q4,
    value.grip.map((v) => v * weight),
    70 + (value.fov - 70) * weight,
  );
}
type Values = Record<ControlId, Pose>;
type Stage = {
  native?: NativeContext;
  sampled: Values;
  bases: Partial<Record<ControlId, LayerBasis>>;
  layer: AnimationLayer;
  before: Values;
  after: Values;
  deltas: Values;
  transforms: Record<ControlId, Matrix4>;
  sourceParents: Record<ControlId, ControlId | 'world'>;
  operations: Partial<Record<ControlId, (value: Pose, raw: Pose) => Pose>>;
};
const nativeBone = (id: ControlId) => id === 'root' || BONE_CONTROLS.includes(id);
const nativeTarget = (id: ControlId) => /^(hand|elbow|foot|knee)_[lr]$/.test(id);
function stages(p: Project, frame: number, drafts: Partial<Values> = {}) {
  const base = baseProject(p),
    baseActive = p.activeLayerId === p.layers![0].id;
  const baseFrame = p.layers![0].static ? 0 : frame;
  let values = rigLocal(evaluateUnlayered(base, baseFrame, baseActive ? drafts : {}));
  const list: Stage[] = [];
  const attachmentParents = Object.fromEntries(
    IDS.map((id) => [id, controlParent(base, id, frame)]),
  ) as Record<ControlId, ControlId | 'world'>;
  for (const layer of p.layers!.slice(1)) {
    const sampled = resolveNativeRotations(
      Object.fromEntries(
        IDS.map((id) => {
          const track = layerTracks(p, layer)[id],
            raw =
              (layer.id === p.activeLayerId && drafts[id]) ||
              sample(track, layer.kind === 'pose' ? 0 : frame);
          return [id, fromMatrix(trackMatrix(track, raw), raw)];
        }),
      ) as Values,
      layer.nativeRotationLinks,
    );
    const native =
      layer.nativeSpace && IDS.some((id) => layerWeight(p, layer, id, frame) > 0)
        ? nativeSkeletonPose(
            p,
            frame,
            values,
            sampled,
            (id) => layerWeight(p, layer, id, frame),
            layer.nativeSpace,
            layerTracks(p, layer),
          )
        : undefined;
    const bases = layerBases(
        values,
        p,
        frame,
        layer.space === 'world' || Object.values(layer.spaces ?? {}).includes('world'),
      ),
      before = native ? { ...values } : values,
      after = {} as Values,
      deltas = {} as Values,
      transforms = {} as Stage['transforms'],
      sourceParents = { ...attachmentParents },
      operations: Stage['operations'] = {},
      visiting = new Set<ControlId>();
    if (native)
      for (const id of IDS)
        if (nativeTarget(id) && layerWeight(p, layer, id, frame) > 0)
          before[id] = native.values[id];
    const resolve = (id: ControlId): Pose => {
      if (after[id]) return after[id];
      if (visiting.has(id)) throw Error('Attachment cycle');
      visiting.add(id);
      const w = layerWeight(p, layer, id, frame),
        raw = sampled[id],
        delta = weighted(raw, w);
      deltas[id] = delta;
      if (native && nativeBone(id)) {
        operations[id] = native.operations[id];
        transforms[id] = new Matrix4();
        after[id] = native.values[id];
        visiting.delete(id);
        return after[id];
      }
      // A layer edits the solved lower pose. Contact propagation moves the whole
      // contact group, then the child's own offset is applied in that new space.
      const event = w > 0 ? activeSpace(layerTracks(p, layer)[id], frame) : undefined,
        parent =
          event?.parent ??
          (layer.contacts && (!layer.contactMask || layer.contactMask.includes(id))
            ? attachmentParents[id]
            : 'world');
      if (native && nativeTarget(id) && parent !== 'world') resolve(parent);
      const transform = (transforms[id] = event
        ? (parent === 'world' ? new Matrix4() : matrix(resolve(parent)))
            .multiply(new Matrix4().fromArray(event.offset))
            .multiply(new Matrix4().fromArray(event.base).invert())
        : native && nativeTarget(id)
          ? new Matrix4()
          : parent !== 'world'
            ? matrix(resolve(parent)).multiply(matrix(before[parent]).invert())
            : new Matrix4());
      if (event?.sourceParent && event.sourceParent !== 'world' && event.sourceParentMatrix)
        transform
          .multiply(new Matrix4().fromArray(event.sourceParentMatrix))
          .multiply(matrix(before[event.sourceParent]).invert());
      let m = transform.clone().multiply(matrix(before[id]));
      // An authored world position belongs to the solved lower pose, not to the
      // current contact parent. Untouched controls still travel with their prop.
      if (!event && w > 0 && ownsPosition(p, layer, id, raw)) {
        m.elements[12] = before[id].p[0];
        m.elements[13] = before[id].p[1];
        m.elements[14] = before[id].p[2];
        transforms[id] = m.clone().multiply(matrix(before[id]).invert());
      }
      sourceParents[id] = parent;
      const track = layerTracks(p, layer)[id],
        space = layer.spaces?.[id] ?? layer.space ?? 'local',
        parentPose = parent === 'world' ? undefined : (after[parent] ?? before[parent]);
      if (hasAxisBlend(track)) {
        const operation = (value: Pose, offset: Pose) => {
          const apply = (v: Pose) => ({
            ...layerDelta(v, offset, space, bases[id], before.root, parentPose, id),
            grip: v.grip.map((x, i) => x + offset.grip[i]),
            fov: v.fov + offset.fov - 70,
          });
          const reference = layerReferencePose(
            track.layerReference,
            value,
            space,
            before.root,
            parentPose,
            bases[id],
            id,
          );
          return blendLayerPoses(
            value,
            apply(value),
            apply(reference),
            layerAxes(value, space, bases[id], before.root, parentPose, id),
            track,
            frame,
            w,
          );
        };
        operations[id] = operation;
        after[id] = operation(fromMatrix(m, before[id]), raw);
      } else {
        m = matrix(layerDelta(fromMatrix(m), delta, space, bases[id], before.root, parentPose, id));
        after[id] = fromMatrix(m, {
          ...before[id],
          grip: before[id].grip.map((v, i) => v + delta.grip[i]),
          fov: before[id].fov + delta.fov - 70,
        });
      }
      visiting.delete(id);
      return after[id];
    };
    for (const id of IDS) resolve(id);
    list.push({
      native,
      sampled,
      bases,
      layer,
      before,
      after,
      deltas,
      transforms,
      sourceParents,
      operations,
    });
    values = after;
    for (const id of IDS) {
      const event =
        layerWeight(p, layer, id, frame) > 0
          ? activeSpace(layerTracks(p, layer)[id], frame)
          : undefined;
      if (event) attachmentParents[id] = event.parent;
    }
  }
  return { base, values, list };
}
export function evaluateLayers(p: Project, frame: number, drafts: Partial<Values> = {}) {
  const { values } = stages(p, frame, drafts),
    root = matrix(values.root);
  for (const id of IDS) {
    values[id] = {
      ...values[id],
      grip: values[id].grip.map((v) => Math.max(-1, Math.min(1, v))),
      fov: Math.max(20, Math.min(120, values[id].fov)),
    };
    if (rootChild(id))
      values[id] = fromMatrix(root.clone().multiply(matrix(values[id])), values[id]);
  }
  return values;
}
export function rawForLayer(
  p: Project,
  id: ControlId,
  frame: number,
  world: Pose,
  drafts: Partial<Values> = {},
) {
  const { base, values, list } = stages(p, frame, drafts);
  let target = matrix(world),
    extra = clone(world);
  if (rootChild(id)) target = matrix(values.root).invert().multiply(target);
  for (const stage of [...list].reverse()) {
    const transformed = fromMatrix(stage.transforms[id].clone().multiply(matrix(stage.before[id])));
    if (stage.layer.id === p.activeLayerId) {
      const w = layerWeight(p, stage.layer, id, frame);
      if (w <= 0) return sample(p.tracks[id], keyingFrame(p, frame));
      if (stage.operations[id]) {
        const operation = stage.operations[id]!,
          initial = stage.sampled[id],
          desired = fromMatrix(target, extra);
        if (
          !stage.native &&
          (stage.layer.spaces?.[id] ?? stage.layer.space) === 'world' &&
          !activeSpace(layerTracks(p, stage.layer)[id], frame) &&
          desired.p.some((v, i) => Math.abs(v - stage.after[id].p[i]) > 1e-8)
        )
          transformed.p = [...stage.before[id].p];
        const input = stage.native && nativeBone(id) ? stage.native.blendInputs[id]! : transformed;
        const raw = invertLayerBlend(initial, desired, (value) => operation(input, value));
        raw.grip = extra.grip.map((v, i) => (v - stage.before[id].grip[i]) / w);
        raw.fov = 70 + (extra.fov - stage.before[id].fov) / w;
        if ((stage.layer.spaces?.[id] ?? stage.layer.space) === 'world') raw.layerPosition = true;
        const residual = stage.native
            ? nativeRotationResidual(id, raw, stage.sampled, stage.layer.nativeRotationLinks)
            : raw,
          basis = layerTracks(p, stage.layer)[id].basis;
        return basis
          ? fromMatrix(
              new Matrix4()
                .fromArray(basis.pre)
                .invert()
                .multiply(matrix(residual))
                .multiply(new Matrix4().fromArray(basis.post).invert()),
              residual,
            )
          : residual;
      }
      if (stage.native && nativeBone(id)) {
        const desired = fromMatrix(target, extra),
          raw =
            id === 'root'
              ? {
                  ...desired,
                  p: desired.p.map((v, i) => (v - stage.before.root.p[i]) / w) as V3,
                  q: new Quaternion()
                    .slerp(
                      new Quaternion(...desired.q).multiply(
                        new Quaternion(...stage.before.root.q).invert(),
                      ),
                      1 / w,
                    )
                    .normalize()
                    .toArray() as Q4,
                }
              : nativeBoneOffset(stage.native, id, desired, w, stage.layer.nativeSpace!),
          basis = layerTracks(p, stage.layer)[id].basis;
        const residual = nativeRotationResidual(
          id,
          raw,
          stage.sampled,
          stage.layer.nativeRotationLinks,
        );
        return basis
          ? fromMatrix(
              new Matrix4()
                .fromArray(basis.pre)
                .invert()
                .multiply(matrix(residual))
                .multiply(new Matrix4().fromArray(basis.post).invert()),
              residual,
            )
          : residual;
      }
      const targetPose = fromMatrix(target),
        space = stage.layer.spaces?.[id] ?? stage.layer.space ?? 'local';
      const ownPosition =
        space === 'world' &&
        !activeSpace(layerTracks(p, stage.layer)[id], frame) &&
        (ownsPosition(p, stage.layer, id, drafts[id] ?? stage.deltas[id]) ||
          targetPose.p.some((v, i) => Math.abs(v - stage.after[id].p[i]) > 1e-8));
      if (ownPosition) transformed.p = [...stage.before[id].p];
      const parent = stage.sourceParents[id],
        offset = layerDelta(
          transformed,
          targetPose,
          stage.layer.spaces?.[id] ?? stage.layer.space ?? 'local',
          stage.bases[id],
          stage.before.root,
          parent === 'world' ? undefined : stage.after[parent],
          id,
          true,
        );
      const q = new Quaternion().slerp(new Quaternion(...offset.q), 1 / w).normalize();
      const raw = {
        ...offset,
        ...(ownPosition ? { layerPosition: true } : {}),
        p: offset.p.map((v) => v / w) as V3,
        q: q.toArray() as Q4,
        grip: extra.grip.map((v, i) =>
          Math.max(-2, Math.min(2, (v - stage.before[id].grip[i]) / w)),
        ),
        fov: 70 + (extra.fov - stage.before[id].fov) / w,
      };
      const basis = layerTracks(p, stage.layer)[id].basis;
      return basis
        ? fromMatrix(
            new Matrix4()
              .fromArray(basis.pre)
              .invert()
              .multiply(matrix(raw))
              .multiply(new Matrix4().fromArray(basis.post).invert()),
            raw,
          )
        : raw;
    }
    if (stage.operations[id]) {
      const operation = stage.operations[id]!,
        input = stage.native && nativeBone(id) ? stage.native.blendInputs[id]! : transformed;
      const current = invertLayerBlend(input, fromMatrix(target), (value) =>
        operation(value, stage.sampled[id]),
      );
      if (stage.native && nativeBone(id)) {
        const original = stage.native.blendInputs[id]!,
          authored = stage.native.inputs[id];
        current.p = current.p.map((v, i) => v - original.p[i] + authored.p[i]) as V3;
        current.q = new Quaternion(...authored.q)
          .multiply(new Quaternion(...original.q).invert())
          .multiply(new Quaternion(...current.q))
          .normalize()
          .toArray() as Q4;
      }
      target = stage.transforms[id].clone().invert().multiply(matrix(current));
      const w = layerWeight(p, stage.layer, id, frame);
      extra = {
        ...extra,
        grip: extra.grip.map((v, i) => v - stage.sampled[id].grip[i] * w),
        fov: extra.fov - (stage.sampled[id].fov - 70) * w,
      };
      continue;
    }
    if (stage.native && nativeBone(id)) {
      target = matrix(
        removeNativeBoneDelta(
          stage.native,
          id,
          fromMatrix(target),
          stage.deltas[id],
          stage.layer.nativeSpace!,
        ),
      );
      continue;
    }
    const parent = stage.sourceParents[id],
      space = stage.layer.spaces?.[id] ?? stage.layer.space ?? 'local',
      current = removeLayerDelta(
        fromMatrix(target),
        stage.deltas[id],
        space,
        stage.bases[id],
        stage.before.root,
        parent === 'world' ? undefined : stage.after[parent],
        id,
      );
    target = stage.transforms[id].clone().invert().multiply(matrix(current));
    extra = {
      ...extra,
      grip: extra.grip.map((v, i) => v - stage.deltas[id].grip[i]),
      fov: extra.fov - stage.deltas[id].fov + 70,
    };
    if (stage.native && nativeTarget(id) && layerWeight(p, stage.layer, id, frame) > 0) {
      const context = stage.native;
      target = matrix(
        nativeTargetInput(
          context,
          id,
          fromMatrix(target),
          (input) =>
            nativeSkeletonPose(
              p,
              frame,
              { ...context.inputs, [id]: input },
              stage.sampled,
              (k) => layerWeight(p, stage.layer, k, frame),
              stage.layer.nativeSpace!,
              layerTracks(p, stage.layer),
            ).values[id],
        ),
      );
    }
  }
  if (rootChild(id))
    target.premultiply(matrix(rigLocal(evaluateUnlayered(base, frame, drafts)).root));
  return rawForWorldUnlayered(
    base,
    id,
    p.layers![0].static ? 0 : frame,
    fromMatrix(target, extra),
    drafts,
  );
}
export function layerParent(p: Project, id: ControlId, frame: number, parent: ControlId | 'world') {
  for (const layer of p.layers?.slice(1) ?? []) {
    const event =
      layerWeight(p, layer, id, frame) > 0
        ? activeSpace(layerTracks(p, layer)[id], frame)
        : undefined;
    if (event) parent = event.parent;
  }
  return parent;
}
export function switchLayerParent(
  p: Project,
  id: ControlId,
  parent: ControlId | 'world',
  frame: number,
) {
  const stage = stages(p, frame).list.find((s) => s.layer.id === p.activeLayerId);
  if (!stage) throw Error('Choose an editable animation layer.');
  const pm = parent === 'world' ? new Matrix4() : matrix(stage.after[parent]);
  const sourceParent = stage.sourceParents[id],
    event = {
      frame,
      parent,
      offset: pm.invert().multiply(matrix(stage.after[id])).toArray(),
      base: matrix(stage.before[id]).multiply(matrix(stage.deltas[id])).toArray(),
      sourceParent,
      sourceParentMatrix: (sourceParent === 'world'
        ? new Matrix4()
        : matrix(stage.before[sourceParent])
      ).toArray(),
    };
  const next = clone(p);
  next.tracks[id].spaces = next.tracks[id].spaces
    .filter((s) => s.frame !== event.frame)
    .concat(event)
    .sort((a, b) => a.frame - b.frame);
  for (const time of new Set([
    frame,
    ...next.layers!.flatMap((l) =>
      IDS.flatMap((k) => layerTracks(next, l)[k].spaces.map((s) => s.frame)),
    ),
  ]))
    evaluateLayers(next, time);
  return next;
}

/** Capture the solved pose under this layer once; animation settings remain
 * separate from static pose keys and use the real playhead frame. */
export function captureControlLayerReference(p: Project, id: ControlId, frame: number) {
  const track = p.tracks[id];
  if (track.layerReference) return;
  const stage = stages(p, frame).list.find((s) => s.layer.id === p.activeLayerId);
  if (!stage) return;
  const parent = stage.sourceParents[id];
  let value =
    stage.native && nativeBone(id)
      ? (stage.native.blendInputs[id] ?? stage.before[id])
      : fromMatrix(
          stage.transforms[id].clone().multiply(matrix(stage.before[id])),
          stage.before[id],
        );
  if (stage.native && nativeBone(id) && id !== 'root') {
    const bone = stage.native.rig.bodyBone(id),
      raw = stage.native.before.get(bone.name)!,
      rest = stage.native.rig.rest.get(bone.name)!;
    value = {
      ...value,
      p: raw.p.clone().sub(rest.p).toArray() as V3,
      q: rest.q.clone().invert().multiply(raw.q).normalize().toArray() as Q4,
    };
  }
  track.layerReference = captureLayerReference(
    value,
    stage.before.root,
    parent === 'world' ? undefined : stage.before[parent],
    stage.bases[id],
    frame,
  );
}

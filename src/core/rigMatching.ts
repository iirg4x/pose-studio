import { keyingFrame } from './layers';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { clone, evaluate, fromMatrix, limbMode, pose, putKey, rawForWorld } from './model';
import type { ControlId, LimbId, LimbMode, Pose, Project, Q4, V3 } from './model';
import type { MannyRig } from '../scene/rig';
export function matchLimb(
  project: Project,
  frame: number,
  limb: LimbId,
  mode: LimbMode,
  rig: MannyRig,
  worldToRig = new Matrix4(),
  drafts: Partial<Record<ControlId, Pose>> = {},
): Project {
  const next = clone(project);
  for (const [id, value] of Object.entries(drafts))
    putKey(next.tracks[id as ControlId], keyingFrame(next, frame), value!);
  if (limbMode(next, limb, frame) === mode) return next;
  const side = limb.endsWith('_l') ? 'l' : 'r',
    arm = limb.startsWith('arm');
  const ids = (arm ? ['upperarm', 'forearm', 'wrist'] : ['thigh', 'shin', 'ankle']).map(
    (stem) => (stem + '_' + side) as ControlId,
  );
  if (mode === 'fk')
    for (const id of ids) {
      const b = rig.bodyBone(id),
        rest = rig.rest.get(b.name)!,
        value = pose(
          b.position.clone().sub(rest.p).toArray() as V3,
          rest.q.clone().invert().multiply(b.quaternion).normalize().toArray() as Q4,
        );
      putKey(next.tracks[id], keyingFrame(next, frame), rawForWorld(next, id, frame, value));
    }
  else {
    const a = rig.bodyBone(ids[0]),
      b = rig.bodyBone(ids[1]),
      c = rig.bodyBone(ids[2]);
    const start = a.getWorldPosition(new Vector3()).applyMatrix4(worldToRig),
      mid = b.getWorldPosition(new Vector3()).applyMatrix4(worldToRig),
      end = c.getWorldPosition(new Vector3()).applyMatrix4(worldToRig),
      axis = end.clone().sub(start).normalize();
    let bend = mid.clone().sub(start);
    bend.addScaledVector(axis, -bend.dot(axis));
    if (bend.lengthSq() < 1e-10) {
      bend.set(0, 0, 1).addScaledVector(axis, -axis.z);
      if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0);
    }
    const target = ((arm ? 'hand_' : 'foot_') + side) as ControlId,
      pole = ((arm ? 'elbow_' : 'knee_') + side) as ControlId,
      values = evaluate(next, frame);
    putKey(
      next.tracks[target],
      keyingFrame(next, frame),
      rawForWorld(
        next,
        target,
        frame,
        fromMatrix(worldToRig.clone().multiply(c.matrixWorld), values[target]),
      ),
    );
    putKey(
      next.tracks[pole],
      keyingFrame(next, frame),
      rawForWorld(next, pole, frame, {
        ...values[pole],
        p: mid.addScaledVector(bend.normalize(), 0.35).toArray() as V3,
      }),
    );
    if (!arm)
      for (const stem of ['heel', 'ball']) {
        const id = (stem + '_' + side) as ControlId;
        putKey(next.tracks[id], keyingFrame(next, frame), rawForWorld(next, id, frame, pose()));
      }
  }
  next.limbModes ??= {};
  next.limbModes[next.editing] ??= {};
  const keys = next.limbModes[next.editing]![limb] ?? [];
  next.limbModes[next.editing]![limb] = keys
    .filter((k) => k.frame !== frame)
    .concat({ frame, mode })
    .sort((a, b) => a.frame - b.frame);
  return next;
}

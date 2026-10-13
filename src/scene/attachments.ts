import { controllerConstraints } from '../core/controllerConstraints';
import { Bone, Matrix4, Vector3 } from 'three';
import { CONTROLS, isBoneControl } from '../core/controls';
import { IDS, matrix, fromMatrix, rootChild } from '../core/model';
import type { ControlId, Pose, Project } from '../core/model';
import { boneFollowing, followedBone, unfollowedBone } from '../core/boneFollowing';
import type { BoneFollowing } from '../core/boneFollowing';
import type { MannyRig } from './rig';

export type AttachmentTarget = ControlId | 'world' | 'native';
export const boneControl = (name: string): ControlId | undefined =>
  IDS.find((id) => CONTROLS[id].bone === name && isBoneControl(id)) ??
  IDS.find((id) => CONTROLS[id].bone === name);
function controlWorld(rig: MannyRig, values: Record<ControlId, Pose>, id: ControlId) {
  return CONTROLS[id].bone ? rig.bodyBone(id).matrixWorld.clone() : matrix(values[id]);
}
export class AttachmentSolver {
  private worlds = new Map<ControlId, Matrix4>();
  private inputs = new Map<ControlId, Matrix4>();
  private parents = new Map<ControlId, Matrix4>();
  private keys: Partial<Record<ControlId, BoneFollowing>> = {};
  private root = new Matrix4();
  private sceneTransform = new Matrix4();
  apply(
    rig: MannyRig,
    values: Record<ControlId, Pose>,
    p: Project,
    frame: number,
    sceneTransform = new Matrix4(),
  ) {
    rig.constraints = controllerConstraints(p);
    this.sceneTransform.copy(sceneTransform);
    this.inputs.clear();
    this.parents.clear();
    this.keys = boneFollowing(p, frame);
    this.root = matrix(values.root);
    const done = new Set<ControlId>(),
      visiting = new Set<ControlId>();
    const local = (id: ControlId) =>
      isBoneControl(id)
        ? rig.bodyBone(id).matrix.clone()
        : rootChild(id)
          ? this.root.clone().invert().multiply(matrix(values[id]))
          : matrix(values[id]);
    for (const id of IDS) this.inputs.set(id, local(id));
    const resolve = (id: ControlId) => {
      if (done.has(id)) return;
      if (visiting.has(id)) throw Error('Attachment cycle');
      visiting.add(id);
      const bone = CONTROLS[id].bone ? rig.bodyBone(id) : undefined;
      if (bone) {
        let parent = bone.parent;
        while (parent instanceof Bone) {
          const control = boneControl(parent.name);
          if (control && control !== id) resolve(control);
          parent = parent.parent;
        }
      }
      const key = this.keys[id];
      if (key?.target !== undefined) {
        const target = key.target;
        let parent: Matrix4;
        if (target === 'world') parent = new Matrix4();
        else if (target === 'native')
          parent = sceneTransform.clone().multiply(bone ? bone.parent!.matrixWorld : this.root);
        else {
          resolve(target);
          parent = sceneTransform
            .clone()
            .multiply(target === 'root' ? this.root : controlWorld(rig, values, target));
        }
        this.parents.set(id, parent);
        const world = sceneTransform
          .clone()
          .invert()
          .multiply(followedBone(this.inputs.get(id)!, parent, key));
        if (isBoneControl(id) || id === 'root') {
          bone!
            .parent!.matrixWorld.clone()
            .invert()
            .multiply(world)
            .decompose(bone!.position, bone!.quaternion, bone!.scale);
          bone!.updateMatrixWorld(true);
          if (id === 'root') {
            values.root = fromMatrix(world, values.root);
            this.root.copy(world);
          }
        } else {
          values[id] = fromMatrix(world, values[id]);
          if (/^(hand|foot)_[lr]$/.test(id)) {
            const side = id.at(-1)!,
              limb = id.startsWith('hand') ? 'arm' : 'leg',
              pole = values[((limb === 'arm' ? 'elbow_' : 'knee_') + side) as ControlId];
            // solve() operates in scene coordinates after the root has been applied.
            rig.solve(side, limb, values[id], new Vector3(...pole.p));
            rig.updateTwists(side, limb);
          }
        }
      }
      visiting.delete(id);
      done.add(id);
    };
    for (const id of IDS) resolve(id);
    rig.root.updateMatrixWorld(true);
    this.worlds = new Map(
      IDS.map((id) => [id, sceneTransform.clone().multiply(controlWorld(rig, values, id))]),
    );
  }
  capture(
    rig: MannyRig,
    values: Record<ControlId, Pose>,
    id: ControlId,
    target: AttachmentTarget,
    frame: number,
    position: boolean,
    rotation: boolean,
  ): BoneFollowing {
    if (id === target) throw Error('A control cannot follow itself.');
    if (id === 'root' && target !== 'world' && target !== 'native')
      throw Error('The rig root cannot follow its own descendants.');
    const bone = CONTROLS[id].bone ? rig.bodyBone(id) : undefined;
    if (
      bone &&
      target !== 'world' &&
      target !== 'native' &&
      target !== 'root' &&
      CONTROLS[target].bone
    ) {
      let ancestor = rig.bodyBone(target).parent;
      while (ancestor) {
        if (ancestor === bone) throw Error('A bone cannot follow its own descendant.');
        ancestor = ancestor.parent;
      }
    }
    const parent =
      target === 'world'
        ? new Matrix4()
        : target === 'root'
          ? this.sceneTransform.clone().multiply(matrix(values.root))
          : target === 'native'
            ? this.sceneTransform.clone().multiply(bone?.parent?.matrixWorld ?? matrix(values.root))
            : (this.worlds.get(target)?.clone() ?? controlWorld(rig, values, target));
    return {
      frame,
      target,
      position,
      rotation,
      world: (this.worlds.get(id) ?? controlWorld(rig, values, id)).toArray(),
      local: (this.inputs.get(id) ?? matrix(values[id])).toArray(),
      parent: parent.toArray(),
    };
  }
  captureInput(id: ControlId) {
    const key = this.keys[id],
      parent = this.parents.get(id)?.clone();
    if (!key || key.target === undefined || !parent) return undefined;
    const scene = this.sceneTransform.clone(),
      root = this.root.clone();
    return (world: Matrix4) => {
      const sceneWorld = isBoneControl(id) ? world : scene.clone().multiply(world),
        local = unfollowedBone(sceneWorld, parent, key);
      return isBoneControl(id) ? local : rootChild(id) ? root.clone().multiply(local) : local;
    };
  }
  input(id: ControlId, world: Matrix4) {
    const key = this.keys[id],
      parent = this.parents.get(id);
    if (!key || key.target === undefined || !parent) return undefined;
    const sceneWorld = isBoneControl(id) ? world : this.sceneTransform.clone().multiply(world),
      local = unfollowedBone(sceneWorld, parent, key);
    return isBoneControl(id) ? local : rootChild(id) ? this.root.clone().multiply(local) : local;
  }
}

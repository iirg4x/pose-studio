import { measureFoot, footControlShape } from './footControls';
import type { FootGeometry, FootPivot } from './footControls';
import { prepareSkinRoot } from './skinInfluences';
import { MeshGrounding } from './meshGrounding';
import type { ControllerConstraints } from '../core/controllerConstraints';
import * as T from 'three';
import { pose, rigLocal, matrix } from '../core/model';
import type { ControlId, Pose, Q4, V3 } from '../core/model';
import { BONE_CONTROLS, CONTROLS } from '../core/controls';
import type { LimbId, LimbMode } from '../core/controls';
import { followedBone, unfollowedBone } from '../core/boneFollowing';
import type { BoneFollowing } from '../core/boneFollowing';
import type { MotionRig } from '../core/motionRig';

/** Lightweight pose solver: copy the rest skeleton, never its meshes/textures. */
export function poseRig(reference: MannyRig) {
  const root = new T.Group(),
    bones = new Map<string, T.Bone>();
  root.userData = { ...reference.root.userData };
  for (const [name, source] of reference.bones) {
    const bone = new T.Bone();
    bone.name = name;
    bone.userData = { ...source.userData };
    const parent = bones.get(source.parent!.name);
    (parent ?? root).add(bone);
    bones.set(name, bone);
    const parentWorld = parent ? reference.rest.get(parent.name)!.world : new T.Matrix4();
    parentWorld
      .clone()
      .invert()
      .multiply(reference.rest.get(name)!.world)
      .decompose(bone.position, bone.quaternion, bone.scale);
  }
  return new MannyRig(root);
}

export class MannyRig {
  bones = new Map<string, T.Bone>();
  rest = new Map<string, { p: T.Vector3; q: T.Quaternion; s: T.Vector3; world: T.Matrix4 }>();
  restControls: Partial<Record<ControlId, Pose>> = {};
  constraints: ControllerConstraints = {};
  private meshGrounding = new MeshGrounding();
  private twistStretchDeltas = new Map<string, T.Vector3>();
  private chainInputs = new Map<string, { middle: T.Vector3; end: T.Vector3 }>();
  motionRig?: MotionRig;
  motionRevision = 0;
  private bindRest?: MannyRig['rest'];
  private motionSignature = '';
  /** Sample keys on their authoring proportions; preview meshes keep their own rest. */
  setMotionRig(reference?: MotionRig) {
    const signature = reference ? JSON.stringify(reference) : '';
    if (signature === this.motionSignature) return;
    this.bindRest ??= new Map(
      [...this.rest].map(([n, r]) => [
        n,
        { p: r.p.clone(), q: r.q.clone(), s: r.s.clone(), world: r.world.clone() },
      ]),
    );
    this.motionSignature = signature;
    this.motionRig = reference;
    this.motionRevision++;
    const worlds = new Map<string, T.Matrix4>();
    for (const [name, b] of this.bones) {
      const original = this.bindRest.get(name)!,
        world = original.world.clone();
      if (reference?.positions[name])
        world.setPosition(new T.Vector3(...reference.positions[name]));
      worlds.set(name, world);
      const parent =
        worlds.get(b.parent!.name) ??
        original.world
          .clone()
          .multiply(new T.Matrix4().compose(original.p, original.q, original.s).invert());
      const p = new T.Vector3(),
        q = new T.Quaternion(),
        s = new T.Vector3();
      parent.clone().invert().multiply(world).decompose(p, q, s);
      this.rest.set(name, { p, q, s, world });
    }
    this.pivotCache.clear();
    this.contactFrames.clear();
    this.footGeometryCache.clear();
    this.footShapeCache.clear();
    this.reset();
  }
  private lastValues?: Record<ControlId, Pose>;
  private following: Partial<Record<ControlId, BoneFollowing>> = {};
  private rootMotion = new T.Matrix4();
  private localInputs = new Map<ControlId, T.Matrix4>();
  constructor(
    public root: T.Group,
    public floating = false,
  ) {
    prepareSkinRoot(root);
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (o instanceof T.Bone) {
        this.bones.set(o.name, o);
        this.rest.set(o.name, {
          p: o.position.clone(),
          q: o.quaternion.clone(),
          s: o.scale.clone(),
          world: o.matrixWorld.clone(),
        });
      }
    });
    for (const side of ['l', 'r']) {
      const h = this.bones.get('hand_' + side)!,
        index = this.position('index_01_' + side),
        pinky = this.position('pinky_01_' + side),
        middle = this.position('middle_03_' + side);
      const radial = index.sub(pinky).normalize(),
        forward = middle.sub(h.getWorldPosition(new T.Vector3())).normalize();
      const normal = radial.clone().cross(forward).normalize(),
        y = normal.clone().cross(radial).normalize();
      const restBasis = new T.Matrix4().makeBasis(radial, y, normal);
      const targetRadial = new T.Vector3(0, 0, side === 'r' ? 1 : -1),
        targetForward = new T.Vector3(0, -1, 0),
        targetNormal = targetRadial.clone().cross(targetForward).normalize();
      const targetBasis = new T.Matrix4().makeBasis(targetRadial, targetForward, targetNormal);
      const orient = new T.Quaternion()
        .setFromRotationMatrix(targetBasis)
        .multiply(new T.Quaternion().setFromRotationMatrix(restBasis).invert())
        .multiply(h.getWorldQuaternion(new T.Quaternion()));
      this.restControls[('hand_' + side) as ControlId] = pose(
        side === 'r' ? [-0.155, 1.26, 0.175] : [-0.03, 1.31, 0.4],
        orient.toArray() as Q4,
        side === 'r' ? [0.45, 0.25, 0.68, 0.7, 0.7] : [0.4, 0.58, 0.63, 0.68, 0.68],
      );
      const foot = this.bones.get('foot_' + side)!;
      this.restControls[('foot_' + side) as ControlId] = pose(
        foot.getWorldPosition(new T.Vector3()).toArray() as V3,
        foot.getWorldQuaternion(new T.Quaternion()).toArray() as Q4,
      );
    }
  }
  position(name: string) {
    return this.bones.get(name)!.getWorldPosition(new T.Vector3());
  }
  reset() {
    this.chainInputs.clear();
    this.twistStretchDeltas.clear();
    for (const [name, b] of this.bones) {
      const r = this.rest.get(name)!;
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    }
    this.root.updateMatrixWorld(true);
  }
  setWorldQuaternion(b: T.Bone, q: T.Quaternion) {
    const parent = b.parent!.getWorldQuaternion(new T.Quaternion());
    b.quaternion.copy(parent.invert().multiply(q));
    b.updateMatrixWorld(true);
  }
  aim(b: T.Bone, child: T.Bone, target: T.Vector3) {
    const start = b.getWorldPosition(new T.Vector3()),
      current = child.getWorldPosition(new T.Vector3()).sub(start).normalize(),
      direction = target.clone().sub(start).normalize();
    const q = new T.Quaternion()
      .setFromUnitVectors(current, direction)
      .multiply(b.getWorldQuaternion(new T.Quaternion()));
    this.setWorldQuaternion(b, q);
  }
  solve(side: string, limb: 'arm' | 'leg', target: Pose, pole: T.Vector3) {
    const a = this.bones.get((limb === 'arm' ? 'upperarm_' : 'thigh_') + side)!,
      b = this.bones.get((limb === 'arm' ? 'lowerarm_' : 'calf_') + side)!,
      c = this.bones.get((limb === 'arm' ? 'hand_' : 'foot_') + side)!;
    const key = limb + '_' + side;
    let input = this.chainInputs.get(key);
    if (!input) {
      input = { middle: b.position.clone(), end: c.position.clone() };
      this.chainInputs.set(key, input);
    } else {
      b.position.copy(input.middle);
      c.position.copy(input.end);
      a.updateMatrixWorld(true);
    }
    const start = a.getWorldPosition(new T.Vector3()),
      mid = b.getWorldPosition(new T.Vector3()),
      end = c.getWorldPosition(new T.Vector3()),
      dest = new T.Vector3(...target.p);
    const dir = dest.clone().sub(start),
      raw = dir.length();
    if (raw < 1e-6) return;
    dir.normalize();
    let l1 = start.distanceTo(mid),
      l2 = mid.distanceTo(end);
    const stretch =
      this.constraints[((limb === 'arm' ? 'hand_' : 'foot_') + side) as ControlId]?.stretch;
    if (stretch && raw > l1 + l2 && l1 + l2 > 1e-6) {
      const factor = raw / (l1 + l2);
      b.position.copy(input.middle).multiplyScalar(factor);
      c.position.copy(input.end).multiplyScalar(factor);
      a.updateMatrixWorld(true);
      l1 *= factor;
      l2 *= factor;
    }
    const d = T.MathUtils.clamp(raw, Math.abs(l1 - l2) + 0.0001, l1 + l2 - (stretch ? 0 : 0.0001));
    const bend = pole.clone().sub(start);
    bend.addScaledVector(dir, -bend.dot(dir));
    if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(dir, -dir.z);
    bend.normalize();
    const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d),
      height = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    const elbow = start.clone().addScaledVector(dir, x).addScaledVector(bend, height);
    this.aim(a, b, elbow);
    this.aim(b, c, start.clone().addScaledVector(dir, d));
    this.setWorldQuaternion(c, new T.Quaternion(...target.q));
  }
  updateTwists(side: string, limb: 'arm' | 'leg') {
    const a = this.bones.get((limb === 'arm' ? 'upperarm_' : 'thigh_') + side)!,
      b = this.bones.get((limb === 'arm' ? 'lowerarm_' : 'calf_') + side)!,
      c = this.bones.get((limb === 'arm' ? 'hand_' : 'foot_') + side)!;
    // Keep twist deformers between their parent and distal joint, without changing the source hierarchy.
    for (const [stem, parent, child] of [
      [limb === 'arm' ? 'upperarm' : 'thigh', a, b],
      [limb === 'arm' ? 'lowerarm' : 'calf', b, c],
    ] as [string, T.Bone, T.Bone][]) {
      const parentQ = parent.getWorldQuaternion(new T.Quaternion()),
        childQ = child.getWorldQuaternion(new T.Quaternion());
      const parentRest = new T.Quaternion().setFromRotationMatrix(
        this.rest.get(parent.name)!.world,
      );
      const childRest = new T.Quaternion().setFromRotationMatrix(this.rest.get(child.name)!.world);
      const relative = parentQ
        .clone()
        .invert()
        .multiply(childQ)
        .multiply(childRest.clone().invert().multiply(parentRest));
      const axis = child.position.clone().normalize();
      const v = new T.Vector3(relative.x, relative.y, relative.z),
        projection = axis.clone().multiplyScalar(v.dot(axis));
      const twist = new T.Quaternion(
        projection.x,
        projection.y,
        projection.z,
        relative.w,
      ).normalize();
      for (const [n, amount] of [
        ['01', 0.33],
        ['02', 0.66],
      ] as [string, number][]) {
        const t = this.bones.get(stem + '_twist_' + n + '_' + side);
        if (t) {
          const r = this.rest.get(t.name)!;
          if (
            this.constraints[((limb === 'arm' ? 'hand_' : 'foot_') + side) as ControlId]?.stretch
          ) {
            const input = this.chainInputs.get(limb + '_' + side),
              length = (parent === a ? input?.middle : input?.end)?.length();
            if (length && length > 1e-6) {
              const factor = child.position.length() / length,
                base = t.position
                  .clone()
                  .sub(this.twistStretchDeltas.get(t.name) ?? new T.Vector3()),
                delta = axis.clone().multiplyScalar(base.dot(axis) * (factor - 1));
              t.position.copy(base).add(delta);
              this.twistStretchDeltas.set(t.name, delta);
            }
          }
          t.quaternion.copy(new T.Quaternion().slerp(twist, amount)).multiply(r.q);
          t.updateMatrixWorld(true);
        }
      }
    }
  }
  apply(
    values: Record<ControlId, Pose>,
    modes: Partial<Record<LimbId, LimbMode>> = {},
    following: Partial<Record<ControlId, BoneFollowing>> = {},
    fkReference = false,
    constraints: ControllerConstraints = {},
  ) {
    this.constraints = constraints;
    const rootMotion = matrix(values.root);
    values = rigLocal(values);
    this.following = following;
    this.rootMotion.copy(rootMotion);
    this.localInputs.clear();
    this.lastValues = values;
    this.reset();
    for (const id of BONE_CONTROLS)
      if (CONTROLS[id].group === 'Body' || id.startsWith('shoulder'))
        this.applyOffset(id, values[id]);
    if (this.floating && !this.motionRig)
      for (const side of ['l', 'r']) {
        const b = this.bones.get('clavicle_' + side)!;
        b.position.add(
          new T.Vector3(0, 0.03, 0.225).applyQuaternion(
            b.parent!.getWorldQuaternion(new T.Quaternion()).invert(),
          ),
        );
        b.updateMatrixWorld(true);
      }
    for (const side of ['l', 'r']) {
      if (modes[('leg_' + side) as LimbId] === 'fk')
        for (const stem of ['thigh', 'shin', 'ankle'])
          this.applyOffset(
            (stem + '_' + side) as ControlId,
            values[(stem + '_' + side) as ControlId],
          );
      else
        this.solve(
          side,
          'leg',
          this.footTarget(side, values),
          new T.Vector3(...values[('knee_' + side) as ControlId].p),
        );
      this.applyOffset(('toe_' + side) as ControlId, values[('toe_' + side) as ControlId]);
      // A reconstructed source pose can supply authored roll and joint translation
      // while the hand and pole remain editable IK targets. Ordinary rigs retain
      // their existing rest-pose IK reference unless the project requests this.
      if (modes[('arm_' + side) as LimbId] === 'fk' || fkReference)
        for (const stem of ['upperarm', 'forearm', 'wrist'])
          this.applyOffset(
            (stem + '_' + side) as ControlId,
            values[(stem + '_' + side) as ControlId],
          );
      if (modes[('arm_' + side) as LimbId] !== 'fk')
        this.solve(
          side,
          'arm',
          values[('hand_' + side) as ControlId],
          new T.Vector3(...values[('elbow_' + side) as ControlId].p),
        );
      this.updateTwists(side, 'arm');
      this.updateTwists(side, 'leg');
      for (const stem of ['upperarm', 'lowerarm', 'thigh', 'calf'])
        for (const j of [1, 2]) {
          const id = `${stem}_twist_0${j}_${side}` as ControlId,
            b = this.bones.get(id),
            value = values[id];
          if (!b || !value) continue;
          if (fkReference) this.applyOffset(id, value);
          else {
            b.position.add(new T.Vector3(...value.p));
            b.quaternion.multiply(new T.Quaternion(...value.q));
            b.updateMatrixWorld(true);
          }
        }
      for (const digit of ['index', 'middle', 'ring', 'pinky'])
        this.applyOffset(
          (digit + '_palm_' + side) as ControlId,
          values[(digit + '_palm_' + side) as ControlId],
        );
      const grip = values[('hand_' + side) as ControlId].grip;
      for (const [i, digit] of ['thumb', 'index', 'middle', 'ring', 'pinky'].entries())
        for (let j = 1; j <= 3; j++) {
          const name = digit + '_0' + j + '_' + side,
            b = this.bones.get(name);
          if (!b) continue;
          b.quaternion
            .copy(this.rest.get(name)!.q)
            .multiply(this.curlRotation(i, j, grip[i]))
            .multiply(new T.Quaternion(...values[name as ControlId].q));
          b.position
            .copy(this.rest.get(name)!.p)
            .add(new T.Vector3(...values[name as ControlId].p));
          b.updateMatrixWorld(true);
          this.applyFollowing(name as ControlId);
        }
    }
    this.root.updateMatrixWorld(true);
    for (const side of ['l', 'r'])
      for (const [ik, target] of [
        ['ik_hand_', 'hand_'],
        ['ik_foot_', 'foot_'],
      ]) {
        const b = this.bones.get(ik + side),
          t = this.bones.get(target + side);
        if (b && t) {
          const m = b.parent!.matrixWorld.clone().invert().multiply(t.matrixWorld);
          m.decompose(b.position, b.quaternion, b.scale);
          b.updateMatrixWorld(true);
        }
      }
    // Apply the master once after IK, including helper and deform bones.
    const rootBone = this.bones.get('root')!;
    const world = rootMotion.multiply(rootBone.matrixWorld);
    rootBone
      .parent!.matrixWorld.clone()
      .invert()
      .multiply(world)
      .decompose(rootBone.position, rootBone.quaternion, rootBone.scale);
    this.root.updateMatrixWorld(true);
  }
  applyOffset(id: ControlId, value: Pose) {
    const b = this.bodyBone(id),
      r = this.rest.get(b.name)!;
    b.position.copy(r.p).add(new T.Vector3(...value.p));
    b.quaternion.copy(r.q).multiply(new T.Quaternion(...value.q));
    b.updateMatrixWorld(true);
    this.applyFollowing(id);
  }
  private applyFollowing(id: ControlId) {
    const b = this.bodyBone(id);
    b.updateMatrix();
    this.localInputs.set(id, b.matrix.clone());
    const key = this.following[id];
    if (!key || key.target !== undefined) return;
    const parent = this.rootMotion.clone().multiply(b.parent!.matrixWorld),
      world = followedBone(b.matrix, parent, key);
    parent.invert().multiply(world).decompose(b.position, b.quaternion, b.scale);
    b.updateMatrixWorld(true);
  }
  captureFollowing(
    id: ControlId,
    frame: number,
    position: boolean,
    rotation: boolean,
  ): BoneFollowing {
    const b = this.bodyBone(id);
    return {
      frame,
      position,
      rotation,
      world: b.matrixWorld.toArray(),
      parent: b.parent!.matrixWorld.toArray(),
      local: (this.localInputs.get(id) ?? b.matrix).toArray(),
    };
  }
  captureWorldInput(id: ControlId) {
    const b = this.bodyBone(id),
      parent = b.parent!.matrixWorld.clone(),
      key = this.following[id];
    return (world: T.Matrix4) =>
      key && key.target === undefined
        ? unfollowedBone(world, parent, key)
        : parent.clone().invert().multiply(world);
  }
  inputForWorld(id: ControlId, world: T.Matrix4) {
    const b = this.bodyBone(id),
      key = this.following[id];
    return key && key.target === undefined
      ? unfollowedBone(world, b.parent!.matrixWorld, key)
      : b.parent!.matrixWorld.clone().invert().multiply(world);
  }
  bodyBone(id: ControlId) {
    return this.bones.get(CONTROLS[id].bone!)!;
  }
  // Manny's mirrored finger bones both flex inward around their own positive Z.
  // Use each joint's bend plane, including the thumb's separate opposition plane.
  private curlRotation(digit: number, joint: number, curl: number) {
    return new T.Quaternion().setFromAxisAngle(
      new T.Vector3(0, 0, 1),
      T.MathUtils.clamp(curl, -1, 1) * [0, 1.15, 1.5, 1.05][joint] * (digit === 0 ? 0.7 : 1),
    );
  }
  // Floating shoulders include a preview offset that must not become an animation key when dragged.
  offsetPositionBase(id: ControlId) {
    const b = this.bodyBone(id);
    return this.floating && !this.motionRig && id.startsWith('shoulder') && this.lastValues
      ? b.position.clone().sub(new T.Vector3(...this.lastValues[id].p))
      : this.rest.get(b.name)!.p.clone();
  }
  offsetBase(id: ControlId) {
    const b = this.bodyBone(id),
      r = this.rest.get(b.name)!,
      base = r.q.clone(),
      match = b.name.match(/^(thumb|index|middle|ring|pinky)_0([123])_([lr])$/);
    if (match && this.lastValues) {
      const i = ['thumb', 'index', 'middle', 'ring', 'pinky'].indexOf(match[1]),
        j = Number(match[2]),
        grip = this.lastValues[('hand_' + match[3]) as ControlId].grip[i];
      base.multiply(this.curlRotation(i, j, grip));
    }
    return base;
  }
  private footGeometryCache = new Map<string, FootGeometry>();
  private footShapeCache = new Map<ControlId, number[]>();
  footGeometry(side: string) {
    let geometry = this.footGeometryCache.get(side);
    if (geometry) return geometry;
    const saved = new Map(
        [...this.bones].map(([name, b]) => [
          name,
          { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() },
        ]),
      ),
      chains = new Map(this.chainInputs),
      twists = new Map(this.twistStretchDeltas);
    try {
      this.reset();
      const foot = this.bones.get('foot_' + side)!,
        toe = this.bones.get('ball_' + side)!;
      geometry = measureFoot(
        this.meshGrounding.points(this.root, foot),
        foot.matrixWorld,
        toe.matrixWorld,
      );
      this.footGeometryCache.set(side, geometry);
      return geometry;
    } finally {
      for (const [name, b] of this.bones) {
        const r = saved.get(name)!;
        b.position.copy(r.p);
        b.quaternion.copy(r.q);
        b.scale.copy(r.s);
      }
      this.chainInputs = chains;
      this.twistStretchDeltas = twists;
      this.root.updateMatrixWorld(true);
    }
  }
  footShape(id: ControlId) {
    let shape = this.footShapeCache.get(id);
    if (!shape) {
      shape = footControlShape(id, this.footGeometry(id.at(-1)!));
      this.footShapeCache.set(id, shape);
    }
    return shape;
  }
  footContactPoint(side: string, kind: Exclude<FootPivot, 'ankle'>) {
    const g = this.footGeometry(side);
    return g[kind]
      .clone()
      .applyMatrix4(g.foot.clone().invert())
      .applyMatrix4(this.bones.get('foot_' + side)!.matrixWorld);
  }
  /** Authoring-only collision correction; ordinary playback never invokes it. */
  floorRotation(id: ControlId, desired: T.Matrix4, clearance = 0) {
    const result = desired.clone(),
      shift = this.meshGrounding.lift(this.root, this.bodyBone(id), result, clearance);
    return result.setPosition(
      new T.Vector3().setFromMatrixPosition(result).add(new T.Vector3(0, shift, 0)),
    );
  }
  pivotLocal(side: string, kind: 'heel' | 'ball') {
    const g = this.footGeometry(side);
    return g[kind].clone().applyMatrix4(g.foot.clone().invert());
  }
  private pivotCache = new Map<string, T.Vector3>();
  pivotPoint(side: string, kind: 'heel' | 'ball') {
    const key = kind + '_' + side;
    if (!this.pivotCache.has(key)) {
      const saved = new Map(
        [...this.bones].map(([name, b]) => [
          name,
          { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() },
        ]),
      );
      const chains = new Map(this.chainInputs),
        twists = new Map(this.twistStretchDeltas);
      this.reset();
      this.chainInputs = chains;
      this.twistStretchDeltas = twists;
      this.root.traverse((o) => {
        if (o instanceof T.SkinnedMesh) o.skeleton.update();
      });
      this.pivotCache.set(key, this.pivotLocal(side, kind));
      for (const [name, b] of this.bones) {
        const r = saved.get(name)!;
        b.position.copy(r.p);
        b.quaternion.copy(r.q);
        b.scale.copy(r.s);
      }
      this.root.updateMatrixWorld(true);
    }
    return this.pivotCache.get(key)!.clone();
  }
  private contactFrames = new Map<string, T.Matrix4>();
  contactFrame(id: ControlId) {
    const bone = this.bodyBone(id);
    let frame = this.contactFrames.get(bone.name);
    if (frame) return frame.clone();
    const saved = new Map(
        [...this.bones].map(([name, b]) => [
          name,
          { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() },
        ]),
      ),
      chains = new Map(this.chainInputs),
      twists = new Map(this.twistStretchDeltas);
    this.reset();
    const points = this.meshGrounding.points(this.root, bone),
      cells = new Map<number, T.Vector3>(),
      bounds = new T.Box3().setFromPoints(points),
      size = bounds.getSize(new T.Vector3());
    // Fit the lower envelope of the real mesh, rather than the ankle axes or an
    // assumed flat shoe. A small grid avoids weighting dense topology more heavily.
    for (const p of points) {
      const x = Math.min(3, Math.floor(((p.x - bounds.min.x) / Math.max(size.x, 1e-6)) * 4)),
        z = Math.min(3, Math.floor(((p.z - bounds.min.z) / Math.max(size.z, 1e-6)) * 4)),
        key = x + z * 4,
        old = cells.get(key);
      if (!old || p.y < old.y) cells.set(key, p);
    }
    const samples = [...cells.values()],
      center = samples
        .reduce((v, p) => v.add(p), new T.Vector3())
        .divideScalar(samples.length || 1);
    let xx = 0,
      xz = 0,
      zz = 0,
      xy = 0,
      zy = 0;
    for (const p of samples) {
      const x = p.x - center.x,
        y = p.y - center.y,
        z = p.z - center.z;
      xx += x * x;
      xz += x * z;
      zz += z * z;
      xy += x * y;
      zy += z * y;
    }
    const det = xx * zz - xz * xz,
      normal =
        Math.abs(det) > 1e-12
          ? new T.Vector3(-(xy * zz - zy * xz) / det, 1, -(zy * xx - xy * xz) / det).normalize()
          : new T.Vector3(0, 1, 0),
      forward = new T.Vector3(0, 0, 1).addScaledVector(normal, -normal.z).normalize(),
      right = normal.clone().cross(forward).normalize();
    frame = bone.matrixWorld
      .clone()
      .invert()
      .multiply(new T.Matrix4().makeBasis(right, normal, forward));
    frame.setPosition(0, 0, 0);
    this.contactFrames.set(bone.name, frame);
    for (const [name, b] of this.bones) {
      const r = saved.get(name)!;
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    }
    this.chainInputs = chains;
    this.twistStretchDeltas = twists;
    this.root.updateMatrixWorld(true);
    return frame.clone();
  }
  meshMinimum(id: ControlId, scene = new T.Matrix4()) {
    const bone = this.bodyBone(id);
    return this.meshGrounding.minimum(
      this.root,
      bone,
      scene.clone().multiply(bone.matrixWorld),
      scene,
    );
  }
  private flatContact(id: ControlId, world: T.Matrix4) {
    const contact = world.clone().multiply(this.contactFrame(id)),
      forward = new T.Vector3().setFromMatrixColumn(contact, 2);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) {
      forward.setFromMatrixColumn(contact, 0);
      forward.y = 0;
      forward.cross(new T.Vector3(0, 1, 0));
    }
    forward.normalize();
    const up = new T.Vector3(0, 1, 0),
      right = up.clone().cross(forward),
      flat = new T.Matrix4().makeBasis(right, up, forward),
      q = new T.Quaternion()
        .setFromRotationMatrix(flat)
        .multiply(new T.Quaternion().setFromRotationMatrix(this.contactFrame(id)).invert());
    return new T.Matrix4().compose(
      new T.Vector3().setFromMatrixPosition(world),
      q,
      new T.Vector3().setFromMatrixScale(world),
    );
  }
  // Authoring operation: returns floor poses to key once, never runs in playback.
  groundPose(id: ControlId, clearance = 0): Map<ControlId, T.Matrix4> {
    if (/^ankle_[lr]$/.test(id))
      return this.groundPose(('foot_' + id.at(-1)) as ControlId, clearance);
    if (/^toe_[lr]$/.test(id)) {
      const footId = ('foot_' + id.at(-1)) as ControlId,
        foot = this.bodyBone(footId),
        toe = this.bodyBone(id),
        old = toe.quaternion.clone(),
        flat = this.flatContact(id, toe.matrixWorld),
        world = foot.matrixWorld.clone();
      let targets: Map<ControlId, T.Matrix4> | undefined;
      try {
        toe.quaternion.copy(
          new T.Quaternion()
            .setFromRotationMatrix(toe.parent!.matrixWorld)
            .invert()
            .multiply(new T.Quaternion().setFromRotationMatrix(flat)),
        );
        toe.updateMatrixWorld(true);
        // The ankle carries the toe joint down. Never stretch or translate the toe
        // relative to the foot just to meet the floor. Preserve a raised heel.
        const shift = this.meshGrounding.lift(
          this.root,
          foot,
          world,
          clearance,
          new T.Matrix4(),
          true,
          toe,
        );
        world.setPosition(
          new T.Vector3().setFromMatrixPosition(world).add(new T.Vector3(0, shift, 0)),
        );
        if ((this.meshGrounding.minimum(this.root, foot, world) ?? clearance) >= clearance - 1e-6) {
          flat.setPosition(
            new T.Vector3().setFromMatrixPosition(flat).add(new T.Vector3(0, shift, 0)),
          );
          targets = new Map([
            [footId, world],
            [id, flat],
          ]);
        }
      } finally {
        toe.quaternion.copy(old);
        toe.updateMatrixWorld(true);
      }
      return targets ?? this.groundPose(footId, clearance);
    }
    const bone = this.bodyBone(id),
      world = this.flatContact(id, bone.matrixWorld),
      targets = new Map<ControlId, T.Matrix4>([[id, world]]);
    let restore: (() => void) | undefined;
    if (/^foot_[lr]$/.test(id)) {
      const toeId = ('toe_' + id.at(-1)) as ControlId,
        toe = this.bodyBone(toeId),
        old = toe.quaternion.clone(),
        delta = world.clone().multiply(bone.matrixWorld.clone().invert()),
        proposed = delta.clone().multiply(toe.matrixWorld),
        flat = this.flatContact(toeId, proposed),
        parent = delta.multiply(toe.parent!.matrixWorld);
      toe.quaternion.copy(
        new T.Quaternion()
          .setFromRotationMatrix(parent)
          .invert()
          .multiply(new T.Quaternion().setFromRotationMatrix(flat)),
      );
      toe.updateMatrixWorld(true);
      targets.set(toeId, flat);
      restore = () => {
        toe.quaternion.copy(old);
        toe.updateMatrixWorld(true);
      };
    }
    try {
      const shift = this.meshGrounding.lift(
        this.root,
        bone,
        world,
        clearance,
        new T.Matrix4(),
        true,
      );
      for (const target of targets.values()) {
        const p = new T.Vector3().setFromMatrixPosition(target);
        p.y += shift;
        target.setPosition(p);
      }
      return targets;
    } finally {
      restore?.();
    }
  }
  pivotWorld(id: ControlId) {
    const side = id.at(-1)!,
      m = this.bones.get('foot_' + side)!.matrixWorld.clone();
    return m.setPosition(
      this.pivotPoint(side, id.startsWith('heel') ? 'heel' : 'ball').applyMatrix4(m),
    );
  }
  footTarget(side: string, values: Record<ControlId, Pose>) {
    const foot = values[('foot_' + side) as ControlId],
      m = matrix(foot),
      ball = this.pivotPoint(side, 'ball'),
      heel = this.pivotPoint(side, 'heel');
    for (const [stem, pivot] of [
      ['ball', ball],
      ['heel', heel],
    ] as const) {
      const q = values[(stem + '_' + side) as ControlId].q;
      m.multiply(new T.Matrix4().makeTranslation(...pivot.toArray()))
        .multiply(new T.Matrix4().makeRotationFromQuaternion(new T.Quaternion(...q)))
        .multiply(new T.Matrix4().makeTranslation(...pivot.clone().negate().toArray()));
    }
    const p = new T.Vector3(),
      q = new T.Quaternion();
    m.decompose(p, q, new T.Vector3());
    return { ...foot, p: p.toArray() as V3, q: q.toArray() as Q4 };
  }
  deformation(worldToRig = new T.Matrix4()) {
    const out: Record<string, number[]> = {};
    for (const [name, b] of this.bones)
      out[name] = worldToRig
        .clone()
        .multiply(b.matrixWorld)
        .multiply(this.rest.get(name)!.world.clone().invert())
        .toArray();
    return out;
  }
}

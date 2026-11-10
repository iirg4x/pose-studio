import { Matrix4, Quaternion, Vector3 } from 'three';
import { anatomicalFrame, palmFinger } from './anatomicalFrame';
import { sparseMotion } from './sparseMotion';
import type { MotionTolerance } from './sparseMotion';
import { blankProject } from './assets';
import { BONE_CONTROLS, CONTROLS } from './controls';
import { clone, pose, fromMatrix, CAMERA_REFERENCE } from './model';
import type { ControlId, Project, Q4, RigLayer, V3 } from './model';
import type { MannyRig } from '../scene/rig';
export interface AnimationInspection {
  token: string;
  filename: string;
  fps: number;
  rigs: {
    name: string;
    bones: string[];
    actions: { id: string; name: string; start: number; end: number }[];
  }[];
}
export interface MotionSource {
  name: string;
  fps: number;
  end: number;
  bones: { name: string; parent: string | null; rest: number[] }[];
  frames: number[][][];
}
const rotation = (m: Matrix4) => {
  const q = new Quaternion();
  m.decompose(new Vector3(), q, new Vector3());
  return q;
};
const position = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);
export interface ImportMotionOptions {
  /**
   * Keep a two-handed grip. Rotations alone cannot hold both hands on a prop
   * when the target's arms and hands have different proportions, so the named
   * hand is moved with arm IK until it sits where the source placed it
   * relative to the other hand.
   */
  followHand?: 'left' | 'right';
}
/** Hands further apart than this are not treated as sharing a grip. */
const GRIP_FAR = 0.6;
/** Hands closer than this get the full correction. */
const GRIP_NEAR = 0.35;
/**
 * Exporters that store one clip per file give every action the same
 * placeholder name ("Unreal Take", "Armature|Take 001|BaseLayer"). The file
 * name is the only thing that tells those clips apart.
 */
export function importedName(action: string, filename: string) {
  const fromFile = filename.replace(/\.[^.]+$/, '');
  return (
    /Unreal Take|Base ?Layer|\bTake \d+\b/i.test(action) && fromFile ? fromFile : action
  ).slice(0, 100);
}
/** Motion deltas are transferred through bind axes; target bone lengths stay native. */
export function importMotion(
  data: MotionSource,
  mapping: Record<string, string>,
  rig: MannyRig,
  type: RigLayer = 'body',
  facing = 0,
  scale = 1,
  reduction: MotionTolerance | false | undefined = undefined,
  placement: 'scene' | 'camera' = type === 'firstPerson' ? 'camera' : 'scene',
  options: ImportMotionOptions = {},
): Project {
  if (
    !Number.isInteger(data.end) ||
    data.end < 1 ||
    data.end > 2400 ||
    data.frames.length !== data.end + 1 ||
    !Number.isInteger(data.fps) ||
    data.fps < 1 ||
    data.fps > 120
  )
    throw Error('Invalid animation timing.');
  const source = new Map(data.bones.map((b, i) => [b.name, { ...b, index: i }])),
    mapped = Object.entries(mapping).filter(([name, b]) => source.has(b) && rig.bones.has(name));
  if (!mapped.length) throw Error('Map at least one source bone before importing.');
  const p = blankProject(rig.restControls);
  p.name = data.name.slice(0, 100);
  p.fps = data.fps;
  p.end = data.end;
  p.editing = type;
  p.actionType = type;
  p.limbModes = {
    [type]: Object.fromEntries(
      ['arm_l', 'arm_r', 'leg_l', 'leg_r'].map((limb) => [limb, [{ frame: 0, mode: 'fk' }]]),
    ),
  };
  const facingMatrix = new Matrix4().makeRotationY((facing * Math.PI) / 180),
    rest = new Map(
      mapped.map(([name, b]) => [
        name,
        facingMatrix.clone().multiply(new Matrix4().fromArray(source.get(b)!.rest)),
      ]),
    );
  const hip = rest.get('pelvis'),
    targetHip = rig.rest.get('pelvis')!.world,
    ratio =
      hip && Math.abs(position(hip).y) > 1e-4
        ? (position(targetHip).y / Math.abs(position(hip).y)) * scale
        : scale;
  const orientation = new Map<string, Quaternion>();
  const targetWorlds = new Map([...rig.rest].map(([n, r]) => [n, r.world]));
  for (const [name] of mapped) {
    const side = name.endsWith('_l') ? 'l' : 'r',
      palm = palmFinger(
        side,
        (bone) => rest.has(bone),
        (bone) => targetWorlds.has(bone),
      ),
      sourceFrame = anatomicalFrame(name, rest, palm),
      targetFrame = anatomicalFrame(name, targetWorlds, palm),
      sr = rest.get(name)!,
      tr = rig.rest.get(name)!.world;
    // Align anatomical directions rather than transferring an A-pose/T-pose
    // difference into every animated arm and finger.
    orientation.set(
      name,
      rotation(sr)
        .invert()
        .multiply(
          sourceFrame && targetFrame
            ? sourceFrame.multiply(targetFrame.invert())
            : new Quaternion(),
        )
        .multiply(rotation(tr)),
    );
  }
  const cameraOffset =
    type === 'firstPerson' && placement === 'camera'
      ? new Vector3(...CAMERA_REFERENCE.p)
      : new Vector3();
  const byBone = new Map(BONE_CONTROLS.map((id) => [CONTROLS[id].bone!, id]));
  const names = [...rig.bones.keys()];
  const depth = (name: string) => {
    let b = rig.bones.get(name)!,
      n = 0;
    while (b.parent && rig.bones.has(b.parent.name)) {
      n++;
      b = rig.bones.get(b.parent.name)!;
    }
    return n;
  };
  names.sort((a, b) => depth(a) - depth(b));
  const active = new Set<ControlId>([
    'root',
    ...mapped.flatMap(([bone]) => (byBone.has(bone) ? [byBone.get(bone)!] : [])),
  ]);
  for (const id of active) p.tracks[id].keys = [];
  const follow = options.followHand === 'left' ? 'l' : options.followHand === 'right' ? 'r' : null,
    lead = follow === 'l' ? 'r' : 'l',
    gripBones = follow
      ? (['upperarm', 'lowerarm', 'hand'] as const).map((stem) => stem + '_' + follow)
      : [],
    canGrip =
      !!follow &&
      gripBones.every((name) => rig.bones.has(name)) &&
      source.has(mapping['hand_' + follow]) &&
      source.has(mapping['hand_' + lead]) &&
      rig.bones.has('hand_' + lead);
  // The nearest of these ancestors decides which arm segment a bone rides on.
  const segment = new Map<string, string>();
  if (canGrip)
    for (const name of names) {
      let bone = rig.bones.get(name);
      while (bone && !gripBones.includes(bone.name)) bone = bone.parent as typeof bone;
      if (bone && rig.bones.has(bone.name)) segment.set(name, bone.name);
    }
  const sourceWorld = (sample: number[][], bone: string) =>
    facingMatrix.clone().multiply(new Matrix4().fromArray(sample[source.get(bone)!.index]));
  const palm = (hand: Vector3, knuckle?: Vector3) =>
    knuckle ? hand.clone().lerp(knuckle, 0.5) : hand.clone();
  for (let frame = 0; frame <= data.end; frame++) {
    const sample = data.frames[frame];
    const solve = (turns?: Map<string, Quaternion>) => {
      const desired = new Map<string, Matrix4>();
      for (const name of names) {
        const target = rig.bones.get(name)!,
          r = rig.rest.get(name)!,
          parent = desired.get(target.parent!.name) ?? target.parent!.matrixWorld,
          src = source.get(mapping[name]),
          turn = turns?.get(segment.get(name) ?? '');
        let world: Matrix4;
        if (src) {
          const values = sample[src.index];
          if (
            !Array.isArray(values) ||
            values.length !== 16 ||
            values.some((n) => !Number.isFinite(n))
          )
            throw Error('Invalid sampled bone transform.');
          const motion = facingMatrix.clone().multiply(new Matrix4().fromArray(values)),
            sourceRest = rest.get(name)!,
            fk = rotation(motion).multiply(orientation.get(name)!),
            q = turn ? turn.clone().multiply(fk) : fk;
          let pos: Vector3;
          if (name === 'pelvis' || name === 'root')
            pos = position(r.world)
              .add(position(motion).sub(position(sourceRest)).multiplyScalar(ratio))
              .add(name === 'pelvis' ? cameraOffset : new Vector3());
          else {
            pos = r.p.clone().applyMatrix4(parent);
            const srcParent = source.get(src.parent ?? '');
            if (srcParent) {
              const expected = facingMatrix
                .clone()
                .multiply(new Matrix4().fromArray(sample[srcParent.index]))
                .multiply(new Matrix4().fromArray(srcParent.rest).invert())
                .multiply(new Matrix4().fromArray(src.rest));
              // Keep authored joint translations (especially first-person shoulders),
              // independently of native limb lengths and source object scale.
              pos.add(position(motion).sub(position(expected)).multiplyScalar(ratio));
            }
          }
          world = new Matrix4().compose(pos, q, new Vector3(1, 1, 1));
        } else world = parent.clone().multiply(new Matrix4().compose(r.p, r.q, r.s));
        desired.set(name, world);
      }
      return desired;
    };
    let desired = solve();
    if (canGrip) {
      const [upper, lower, hand] = gripBones,
        knuckle = (side: string) => 'middle_01_' + side,
        has = (name: string) => rig.bones.has(name) && source.has(mapping[name]),
        sourcePalm = (side: string) =>
          palm(
            position(sourceWorld(sample, mapping['hand_' + side])),
            has(knuckle(side)) ? position(sourceWorld(sample, mapping[knuckle(side)])) : undefined,
          ),
        // Where the source held the following palm, measured from the leading
        // wrist. The prop travels with that wrist, so this is the contact.
        offset = sourcePalm(follow!)
          .sub(position(sourceWorld(sample, mapping['hand_' + lead])))
          .multiplyScalar(ratio),
        apart =
          position(sourceWorld(sample, mapping['hand_' + follow])).distanceTo(
            position(sourceWorld(sample, mapping['hand_' + lead])),
          ) * ratio,
        fade = Math.max(0, Math.min(1, (GRIP_FAR - apart) / (GRIP_FAR - GRIP_NEAR))),
        weight = fade * fade * (3 - 2 * fade);
      if (weight > 0) {
        const shoulder = position(desired.get(upper)!),
          elbow = position(desired.get(lower)!),
          wrist = position(desired.get(hand)!),
          reach = palm(
            wrist,
            has(knuckle(follow!)) ? position(desired.get(knuckle(follow!))!) : undefined,
          ).sub(wrist),
          wanted = position(desired.get('hand_' + lead)!)
            .add(offset)
            .sub(reach),
          goal = wrist.clone().lerp(wanted, weight),
          a = elbow.distanceTo(shoulder),
          b = wrist.distanceTo(elbow),
          toGoal = goal.clone().sub(shoulder),
          d = Math.max(Math.abs(a - b) + 1e-4, Math.min(a + b - 1e-4, toGoal.length()));
        if (a > 1e-5 && b > 1e-5 && toGoal.lengthSq() > 1e-10) {
          const axis = toGoal.normalize(),
            // Bend in the plane the retargeted elbow already uses.
            bend = elbow.clone().sub(shoulder),
            pole = bend.addScaledVector(axis, -bend.dot(axis));
          if (pole.lengthSq() > 1e-10) {
            pole.normalize();
            const along = (a * a - b * b + d * d) / (2 * d),
              out = Math.sqrt(Math.max(0, a * a - along * along)),
              newElbow = shoulder.clone().addScaledVector(axis, along).addScaledVector(pole, out),
              newWrist = shoulder.clone().addScaledVector(axis, d),
              turns = new Map([
                [
                  upper,
                  new Quaternion().setFromUnitVectors(
                    elbow.clone().sub(shoulder).normalize(),
                    newElbow.clone().sub(shoulder).normalize(),
                  ),
                ],
                [
                  lower,
                  new Quaternion().setFromUnitVectors(
                    wrist.clone().sub(elbow).normalize(),
                    newWrist.clone().sub(newElbow).normalize(),
                  ),
                ],
              ]);
            desired = solve(turns);
          }
        }
      }
    }
    for (const name of names) {
      const id = name === 'root' ? 'root' : byBone.get(name);
      if (!id || !active.has(id)) continue;
      const target = rig.bones.get(name)!,
        r = rig.rest.get(name)!,
        parent = desired.get(target.parent!.name) ?? target.parent!.matrixWorld,
        world = desired.get(name)!,
        local = parent.clone().invert().multiply(world),
        q = r.q.clone().invert().multiply(rotation(local)).normalize(),
        value = pose(position(local).sub(r.p).toArray() as V3, q.toArray() as Q4, [0, 0, 0, 0, 0]);
      p.tracks[id].keys.push({
        ...(name === 'root'
          ? fromMatrix(world.clone().multiply(r.world.clone().invert()), value)
          : value),
        frame,
        interpolation: 'linear',
      });
      p.tracks[id].interpolation = 'linear';
    }
  }
  if (reduction !== false)
    for (const id of active)
      Object.assign(p.tracks[id], sparseMotion(p.tracks[id].keys, reduction));
  p.otherTracks = clone(p.tracks);
  return p;
}

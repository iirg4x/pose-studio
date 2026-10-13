import { Matrix4, Quaternion, Vector3 } from 'three';
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
  const anatomicalFrame = (name: string, worlds: Map<string, Matrix4>) => {
    const current = worlds.get(name);
    if (!current) return null;
    const side = name.endsWith('_l') ? 'l' : 'r',
      stem = name.slice(0, -2);
    const next = (
      {
        clavicle: 'upperarm',
        upperarm: 'lowerarm',
        lowerarm: 'hand',
        thigh: 'calf',
        calf: 'foot',
        foot: 'ball',
        hand: 'middle_01',
      } as Record<string, string>
    )[stem];
    const digit = /^(thumb|index|middle|ring|pinky)_0([123])_[lr]$/.exec(name);
    let direction: Vector3 | undefined;
    if (next && worlds.has(next + '_' + side))
      direction = position(worlds.get(next + '_' + side)!).sub(position(current));
    else if (digit) {
      const joint = Number(digit[2]),
        other = worlds.get(digit[1] + '_0' + (joint === 3 ? 2 : joint + 1) + '_' + side);
      if (other) {
        direction =
          joint === 3
            ? position(current).sub(position(other))
            : position(other).sub(position(current));
        if (joint === 3 && direction.lengthSq() > 1e-12) {
          // A terminal phalanx has no child joint. Its predecessor describes the
          // middle phalanx, not this bone's axis; using it transfers bind-pose curl.
          const previous = direction.clone().normalize(),
            axes = [0, 1, 2].map((i) => new Vector3().setFromMatrixColumn(current, i).normalize());
          axes.sort((a, b) => Math.abs(b.dot(previous)) - Math.abs(a.dot(previous)));
          if (Math.abs(axes[0].dot(previous)) > 0.85)
            direction = axes[0].multiplyScalar(Math.sign(axes[0].dot(previous)));
        }
      }
    }
    if (!direction || direction.lengthSq() < 1e-12) return null;
    const x = direction.normalize();
    let up = new Vector3(0, 0, 1);
    if (stem === 'hand' || digit) {
      const hand = worlds.get('hand_' + side),
        index = worlds.get('index_01_' + side),
        pinky = worlds.get('pinky_01_' + side);
      if (hand && index && pinky)
        up = position(index)
          .sub(position(hand))
          .cross(position(pinky).sub(position(hand)))
          .normalize();
    }
    if (Math.abs(up.dot(x)) > 0.98) up.set(0, 1, 0);
    const z = up.addScaledVector(x, -up.dot(x)).normalize(),
      y = z.clone().cross(x).normalize();
    return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  };
  const targetWorlds = new Map([...rig.rest].map(([n, r]) => [n, r.world]));
  for (const [name] of mapped) {
    const sourceFrame = anatomicalFrame(name, rest),
      targetFrame = anatomicalFrame(name, targetWorlds),
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
  for (let frame = 0; frame <= data.end; frame++) {
    const sample = data.frames[frame],
      desired = new Map<string, Matrix4>();
    for (const name of names) {
      const target = rig.bones.get(name)!,
        r = rig.rest.get(name)!,
        parent = desired.get(target.parent!.name) ?? target.parent!.matrixWorld,
        src = source.get(mapping[name]);
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
          q = rotation(motion).multiply(orientation.get(name)!);
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
      const id = name === 'root' ? 'root' : byBone.get(name);
      if (!id || !active.has(id)) continue;
      const local = parent.clone().invert().multiply(world),
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

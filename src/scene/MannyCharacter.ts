import { retargetContact } from '../core/retargetContact';
import { controllerConstraints } from '../core/controllerConstraints';
import * as T from 'three';
import { projectProps, isProp } from '../core/assets';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { RetargetRig } from './RetargetRig';
import { MannyRig, poseRig } from './rig';
import { maskedGeometry } from './meshMask';
import { CONTROLS } from '../core/controls';
import { controlParent, evaluate, limbMode, matrix, pose } from '../core/model';
import type { ControlId, Pose, Project, Q4, V3 } from '../core/model';
import type { RetargetCharacter } from '../core/retarget';
import { boneFollowing } from '../core/boneFollowing';
import { skinSets, skinWeightFor, prepareSkinMesh } from './skinInfluences';

const pos = (m: T.Matrix4) => new T.Vector3().setFromMatrixPosition(m);
const rot = (m: T.Matrix4) => {
  const q = new T.Quaternion();
  m.decompose(new T.Vector3(), q, new T.Vector3());
  return q;
};
const unit = new T.Vector3(1, 1, 1);
const materials = (mesh: T.Mesh) =>
  Array.isArray(mesh.material) ? mesh.material : [mesh.material];

export const mannyPreviewConfig = (rig: MannyRig): RetargetCharacter => ({
  id: 'manny',
  name: 'Manny',
  asset: 'manny',
  mapping: Object.fromEntries([...rig.bones.keys()].map((n) => [n, n])),
  hiddenMeshes: [],
  scale: 1,
  facing: 0,
  handIK: true,
  footIK: true,
  preserveSkinning: true,
  offsets: {},
});

/** Rebind the character to Manny's names, axes and hierarchy, at its own proportions. */
export function bindCharacterToManny(
  raw: RetargetRig,
  source: MannyRig,
  config: RetargetCharacter,
) {
  raw.configure(source, config);
  raw.resetToBind();
  const native = new Map([...raw.bones].map(([name, b]) => [name, b.matrixWorld.clone()]));
  const reverse = new Map(
    Object.entries(config.mapping).map(([manny, original]) => [original, manny]),
  );
  const nearest = (bone: T.Bone): string => {
    let b: T.Object3D | null = bone;
    while (b) {
      const name = reverse.get(b.name);
      if (name) return name;
      b = b.parent;
    }
    return 'pelvis';
  };
  const names = [...source.bones.keys()],
    indexOf = new Map(names.map((n, i) => [n, i])),
    root = new T.Group();
  root.name = 'MannyCharacter';
  const geometry: { original: T.Mesh; geometry: T.BufferGeometry }[] = [],
    bounds = new T.Box3();
  for (const mesh of raw.meshes) {
    const g = mesh.geometry.clone(),
      p = g.getAttribute('position'),
      n = g.getAttribute('normal');
    if (mesh instanceof T.SkinnedMesh) {
      mesh.skeleton.update();
      const transforms = mesh.skeleton.bones.map((b, i) =>
        mesh.matrixWorld
          .clone()
          .multiply(mesh.bindMatrixInverse)
          .multiply(b.matrixWorld)
          .multiply(mesh.skeleton.boneInverses[i])
          .multiply(mesh.bindMatrix),
      );
      const normalTransforms = transforms.map((m) => new T.Matrix3().getNormalMatrix(m)),
        sets = skinSets(g),
        indices = sets.map(() => new Uint16Array(p.count * 4));
      for (let v = 0; v < p.count; v++) {
        const point = new T.Vector3(),
          normal = new T.Vector3(),
          originalP = new T.Vector3().fromBufferAttribute(p, v),
          originalN = n ? new T.Vector3().fromBufferAttribute(n, v) : undefined;
        for (const [set, s] of sets.entries())
          for (let k = 0; k < 4; k++) {
            const bi = s.index.getComponent(v, k),
              weight = s.weight.getComponent(v, k);
            indices[set][v * 4 + k] = indexOf.get(nearest(mesh.skeleton.bones[bi]))!;
            if (!weight) continue;
            point.addScaledVector(originalP.clone().applyMatrix4(transforms[bi]), weight);
            if (originalN)
              normal.addScaledVector(originalN.clone().applyMatrix3(normalTransforms[bi]), weight);
          }
        p.setXYZ(v, point.x, point.y, point.z);
        if (n) {
          normal.normalize();
          n.setXYZ(v, normal.x, normal.y, normal.z);
        }
      }
      for (const [i, set] of sets.entries())
        g.setAttribute(set.indexName, new T.Uint16BufferAttribute(indices[i], 4));
    } else {
      g.applyMatrix4(mesh.matrixWorld);
      const indices = new Uint16Array(p.count * 4),
        weights = new Float32Array(p.count * 4);
      for (let v = 0; v < p.count; v++) {
        indices[v * 4] = indexOf.get('pelvis')!;
        weights[v * 4] = 1;
      }
      g.setAttribute('skinIndex', new T.Uint16BufferAttribute(indices, 4));
      g.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
    }
    // Tangents refer to the imported bind pose. Let Three derive them from the
    // baked normals and UVs, so rotated A/T-pose patches keep correct shading.
    g.deleteAttribute('tangent');
    g.computeBoundingBox();
    if (mesh.visible) bounds.union(g.boundingBox!);
    geometry.push({ original: mesh, geometry: g });
  }
  // Keep the original vertices in their native bind pose. Store the A/T-pose
  // correction per bone in the inverse bind matrices, never in an averaged
  // skinned vertex: baking that average then skinning it again pinches joints.
  raw.apply(true);
  raw.root.updateMatrixWorld(true);
  bounds.makeEmpty();
  for (const mesh of raw.meshes)
    if (mesh.visible) bounds.union(new T.Box3().setFromObject(mesh, true));
  const floor = bounds.isEmpty() || !raw.hasLowerBodySurface() ? 0 : -bounds.min.y,
    positions = new Map<string, T.Vector3>();
  positions.set('root', new T.Vector3());
  for (const [name, original] of Object.entries(config.mapping)) {
    const b = raw.bones.get(original);
    if (b) positions.set(name, b.getWorldPosition(new T.Vector3()).add(new T.Vector3(0, floor, 0)));
  }
  const ratio = (positions.get('pelvis')?.y ?? 1) / pos(source.rest.get('pelvis')!.world).y;
  const sourcePosition = (name: string) => pos(source.rest.get(name)!.world);
  // Fill Manny-only spine, neck, palm, twist and IK joints between anatomical
  // anchors. They keep Manny's hierarchy without stretching the imported mesh.
  const locate = (name: string): T.Vector3 => {
    if (positions.has(name)) return positions.get(name)!.clone();
    const b = source.bones.get(name)!,
      parent = b.parent instanceof T.Bone ? b.parent.name : 'root';
    if (name.startsWith('ik_hand_') && !name.endsWith('root'))
      return locate(name === 'ik_hand_gun' ? 'hand_r' : name.replace('ik_', ''));
    if (name.startsWith('ik_foot_') && !name.endsWith('root'))
      return locate(name.replace('ik_', ''));
    let end: string | undefined;
    if (name.includes('_metacarpal_')) end = name.replace('_metacarpal_', '_01_');
    else if (name.includes('_twist_')) {
      const stem = name.split('_twist_')[0],
        side = name.at(-1);
      end =
        (
          { upperarm: 'lowerarm', lowerarm: 'hand', thigh: 'calf', calf: 'foot' } as Record<
            string,
            string
          >
        )[stem] +
        '_' +
        side;
    } else if (name.startsWith('spine_') || name.startsWith('neck_')) {
      const chain = [
        'pelvis',
        'spine_01',
        'spine_02',
        'spine_03',
        'spine_04',
        'spine_05',
        'neck_01',
        'neck_02',
        'head',
      ];
      end = chain.slice(chain.indexOf(name) + 1).find((n) => positions.has(n));
    }
    const start = locate(parent);
    let p: T.Vector3;
    if (end && positions.has(end)) {
      const a = sourcePosition(parent),
        ab = sourcePosition(end).sub(a),
        t = T.MathUtils.clamp(
          sourcePosition(name).sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-8),
          0,
          1,
        );
      p = start.lerp(locate(end), t);
    } else p = start.add(sourcePosition(name).sub(sourcePosition(parent)).multiplyScalar(ratio));
    positions.set(name, p);
    return p.clone();
  };
  const bones = new Map<string, T.Bone>();
  for (const name of names) {
    const b = new T.Bone();
    b.name = name;
    b.userData = { mannyBone: name };
    bones.set(name, b);
  }
  for (const [name, b] of bones) {
    const original = source.bones.get(name)!,
      parent = original.parent instanceof T.Bone ? bones.get(original.parent.name)! : root;
    parent.add(b);
    const world = new T.Matrix4().compose(locate(name), rot(source.rest.get(name)!.world), unit);
    parent.updateWorldMatrix(true, false);
    parent.matrixWorld
      .clone()
      .invert()
      .multiply(world)
      .decompose(b.position, b.quaternion, b.scale);
    b.updateMatrixWorld(true);
  }
  root.updateMatrixWorld(true);
  const bind = new Map<string, T.Matrix4>();
  for (const [name, b] of bones) {
    const original = config.mapping[name],
      nativeWorld = original ? native.get(original) : undefined;
    let world: T.Matrix4;
    if (nativeWorld) {
      const aligned = raw.bones.get(original)!.matrixWorld,
        q = rot(nativeWorld).multiply(rot(aligned).invert()).multiply(rot(b.matrixWorld));
      world = new T.Matrix4().compose(pos(nativeWorld).add(new T.Vector3(0, floor, 0)), q, unit);
    } else if (b.parent instanceof T.Bone) {
      const parent = b.parent;
      world = bind
        .get(parent.name)!
        .clone()
        .multiply(parent.matrixWorld.clone().invert())
        .multiply(b.matrixWorld);
    } else world = b.matrixWorld.clone();
    bind.set(name, world);
    b.userData.nativeBind = world.toArray();
  }
  const skeleton = new T.Skeleton(
    [...bones.values()],
    [...bind.values()].map((m) => m.clone().invert()),
  );
  for (const entry of geometry) {
    const g = entry.geometry;
    g.translate(0, floor, 0);
    if (!config.preserveSkinning) distributeForearmWeights(g, names, bind);
    g.computeBoundingSphere();
    const mesh = new T.SkinnedMesh(
      g,
      Array.isArray(entry.original.material)
        ? entry.original.material.map((m) => m.clone())
        : entry.original.material.clone(),
    );
    mesh.name = entry.original.name;
    mesh.visible = entry.original.visible;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    mesh.bind(skeleton, new T.Matrix4());
  }
  root.userData = {
    rig: 'ue5-manny-simple',
    sourceCharacter: config.name,
    canonicalSkinning: config.asset === 'manny',
    proportions: 'character',
    partialCharacter: !raw.hasLowerBodySurface(),
    floorLift: raw.floorLift + floor,
  };
  return root;
}

/** Preserve authored weights; only spread existing forearm influence over its
 * twist deformers. Adjacent samples blend continuously and remain normalized. */
function distributeForearmWeights(
  g: T.BufferGeometry,
  names: string[],
  bind: Map<string, T.Matrix4>,
) {
  const p = g.getAttribute('position'),
    sets = skinSets(g),
    rows: [number, number][][] = [];
  const chains = ['l', 'r'].map((side) => {
    const start = pos(bind.get('lowerarm_' + side)!),
      end = pos(bind.get('hand_' + side)!),
      axis = end.clone().sub(start);
    return {
      start,
      axis,
      lengthSq: axis.lengthSq(),
      indices: ['lowerarm_' + side, 'lowerarm_twist_01_' + side, 'lowerarm_twist_02_' + side].map(
        (n) => names.indexOf(n),
      ),
    };
  });
  for (let i = 0; i < p.count; i++) {
    const weights = new Map<number, number>(),
      point = new T.Vector3().fromBufferAttribute(p, i),
      add = (index: number, w: number) => weights.set(index, (weights.get(index) ?? 0) + w);
    for (const set of sets)
      for (let k = 0; k < 4; k++) {
        const index = set.index.getComponent(i, k),
          w = set.weight.getComponent(i, k);
        if (!w) continue;
        const chain = chains.find((c) => c.indices[0] === index);
        if (!chain) {
          add(index, w);
          continue;
        }
        const t =
            T.MathUtils.clamp(
              point.clone().sub(chain.start).dot(chain.axis) / chain.lengthSq,
              0,
              1,
            ) * 2,
          slot = Math.min(1, Math.floor(t)),
          blend = t - slot;
        add(chain.indices[slot], w * (1 - blend));
        add(chain.indices[slot + 1], w * blend);
      }
    const entries = [...weights].filter(([, w]) => w > 1e-8).sort((a, b) => b[1] - a[1]),
      total = entries.reduce((n, [, w]) => n + w, 0);
    rows.push(entries.map(([bone, w]) => [bone, w / total]));
  }
  const count = Math.max(
    sets.length,
    Math.ceil(rows.reduce((n, row) => Math.max(n, row.length), 0) / 4),
  );
  for (let set = 0; set < count; set++) {
    const indices = new Uint16Array(p.count * 4),
      weights = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++)
      for (let k = 0; k < 4; k++) {
        indices[i * 4 + k] = rows[i][set * 4 + k]?.[0] ?? 0;
        weights[i * 4 + k] = rows[i][set * 4 + k]?.[1] ?? 0;
      }
    g.setAttribute(set ? 'joints_' + set : 'skinIndex', new T.Uint16BufferAttribute(indices, 4));
    g.setAttribute(set ? 'weights_' + set : 'skinWeight', new T.Float32BufferAttribute(weights, 4));
  }
}

function firstPersonGeometry(mesh: T.SkinnedMesh) {
  const p = mesh.geometry.getAttribute('position');
  const arms = ['l', 'r'].map((side) => {
    const a = mesh.skeleton.bones.find((b) => b.name === 'upperarm_' + side)!,
      b = mesh.skeleton.bones.find((b) => b.name === 'lowerarm_' + side)!,
      start = pos(new T.Matrix4().fromArray(a.userData.nativeBind)),
      axis = pos(new T.Matrix4().fromArray(b.userData.nativeBind)).sub(start);
    return { side, start, axis, lengthSq: axis.lengthSq() };
  });
  return maskedGeometry(
    mesh,
    /^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)/,
    0.45,
    (i) => {
      // Floating FP arms have no torso. Exclude shoulder caps and the proximal
      // upper arm so these disconnected pieces cannot enter the camera corners.
      for (const arm of arms) {
        const weight = skinWeightFor(
          mesh,
          i,
          (name) => name.startsWith('upperarm') && name.endsWith(arm.side),
        );
        if (
          weight > 0.45 &&
          new T.Vector3().fromBufferAttribute(p, i).sub(arm.start).dot(arm.axis) / arm.lengthSq <
            0.35
        )
          return false;
      }
      return true;
    },
  );
}

/** One shared Manny animation, sampled on a different anatomical rest skeleton. */
export class ProportionalRig extends MannyRig {
  motionScale: number;
  armScale: Record<string, number> = {};
  legScale: Record<string, number> = {};
  private referenceRevision = -1;
  private referenceRig?: MannyRig;
  private floatingCalibrations = new WeakMap<Project, Record<string, T.Vector3>>();
  shoulderAdjustments: Record<string, number> = { l: 0, r: 0 };
  props: Partial<Record<ControlId, T.Matrix4>> = {
    rifle: new T.Matrix4(),
    magazine: new T.Matrix4(),
  };
  private source?: MannyRig;
  private values?: Record<ControlId, Pose>;
  private project?: Project;
  private frame = 0;
  constructor(root: T.Group, reference: MannyRig) {
    super(root);
    this.motionScale =
      pos(this.rest.get('pelvis')!.world).y / pos(reference.rest.get('pelvis')!.world).y;
    for (const side of ['l', 'r']) {
      this.armScale[side] =
        this.chainLength(this, 'upperarm', side) / this.chainLength(reference, 'upperarm', side);
      this.legScale[side] =
        this.chainLength(this, 'thigh', side) / this.chainLength(reference, 'thigh', side);
    }
    if (root.userData.partialCharacter) this.motionScale = (this.armScale.l + this.armScale.r) / 2;
  }
  private chainLength(rig: MannyRig, start: string, side: string) {
    const names = (
      start === 'upperarm' ? ['upperarm', 'lowerarm', 'hand'] : ['thigh', 'calf', 'foot']
    ).map((n) => n + '_' + side);
    return (
      pos(rig.rest.get(names[0])!.world).distanceTo(pos(rig.rest.get(names[1])!.world)) +
      pos(rig.rest.get(names[1])!.world).distanceTo(pos(rig.rest.get(names[2])!.world))
    );
  }
  override updateTwists(side: string, limb: 'arm' | 'leg') {
    super.updateTwists(side, limb);
    if (limb !== 'arm' || this.root.userData.canonicalSkinning) return;
    const parent = this.bones.get('lowerarm_' + side)!,
      hand = this.bones.get('hand_' + side)!,
      a = new T.Matrix4().fromArray(parent.userData.nativeBind),
      c = new T.Matrix4().fromArray(hand.userData.nativeBind);
    const relative = parent
      .getWorldQuaternion(new T.Quaternion())
      .invert()
      .multiply(hand.getWorldQuaternion(new T.Quaternion()))
      .multiply(rot(c).invert().multiply(rot(a)));
    const axis = pos(c).sub(pos(a)).applyQuaternion(rot(a).invert()).normalize(),
      v = new T.Vector3(relative.x, relative.y, relative.z),
      projection = axis.multiplyScalar(v.dot(axis));
    const twist = new T.Quaternion(
      projection.x,
      projection.y,
      projection.z,
      relative.w,
    ).normalize();
    if (twist.w < 0) twist.set(-twist.x, -twist.y, -twist.z, -twist.w);
    for (const [n, amount] of [
      ['01', 0.5],
      ['02', 1],
    ] as const) {
      const b = this.bones.get('lowerarm_twist_' + n + '_' + side)!;
      b.quaternion.copy(new T.Quaternion().slerp(twist, amount)).multiply(this.rest.get(b.name)!.q);
      b.updateMatrixWorld(true);
    }
  }
  ratioFor(id: ControlId) {
    const parent = (control: ControlId) =>
      this.project ? controlParent(this.project, control, this.frame) : 'world';
    if (id.startsWith('hand_')) {
      const contact = this.contact(id),
        side = id.at(-1)!;
      if (contact) {
        const anchor = contact.parent === 'rifle' || parent('magazine') === 'rifle' ? 'r' : 'l';
        if (side !== anchor) return this.armScale[side] * (1 - contact.weight) + contact.weight;
      }
      return this.armScale[side];
    }
    if (id === 'rifle') return parent('hand_r') === 'rifle' ? this.armScale.r : 1;
    if (id === 'magazine')
      return parent('magazine') !== 'rifle' && parent('hand_l') === 'magazine'
        ? this.armScale.l
        : 1;
    if (id.startsWith('elbow_')) return this.armScale[id.at(-1)!];
    if (/^(foot|knee)/.test(id)) return this.legScale[id.at(-1)!];
    return this.motionScale;
  }
  private contact(id: ControlId) {
    return this.project ? retargetContact(this.project, id, this.frame) : undefined;
  }
  private shoulderPoint(point: T.Vector3, side: string) {
    return point
      .sub(this.source!.position('upperarm_' + side))
      .multiplyScalar(this.armScale[side])
      .add(this.position('upperarm_' + side));
  }
  private footPoint(point: T.Vector3, side: string) {
    const source = this.source!,
      sourceRoot = source.bones.get('root')!.matrixWorld,
      root = this.bones.get('root')!.matrixWorld;
    const sr = source.rest.get('root')!.world,
      tr = this.rest.get('root')!.world;
    const start = pos(source.rest.get('foot_' + side)!.world).applyMatrix4(sr.clone().invert()),
      target = pos(this.rest.get('foot_' + side)!.world).applyMatrix4(tr.clone().invert());
    return point
      .applyMatrix4(sourceRoot.clone().invert())
      .sub(start)
      .multiplyScalar(this.legScale[side])
      .add(target)
      .applyMatrix4(root);
  }
  gripMatrix(side: string, rig: MannyRig = this) {
    // Anchor the contact at the palm and thumb web. Fingertips travel far while
    // curling and made differently sized hands slide into the held prop.
    const points = ['index_01', 'middle_01', 'ring_01', 'pinky_01', 'thumb_02'],
      center = new T.Vector3();
    for (const digit of points) center.add(rig.position(digit + '_' + side));
    return rig.bones
      .get('hand_' + side)!
      .matrixWorld.clone()
      .setPosition(center.multiplyScalar(1 / points.length));
  }
  private floatingCalibration(source: MannyRig, project: Project, config: RetargetCharacter) {
    const cached = this.floatingCalibrations.get(project);
    if (cached) return cached;
    const donor = poseRig(source),
      target = new ProportionalRig(poseRig(this).root, donor),
      values = evaluate(project, 0);
    donor.setMotionRig(project.motionRig);
    donor.apply(
      values,
      Object.fromEntries(
        (['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const).map((id) => [id, limbMode(project, id, 0)]),
      ),
      boneFollowing(project, 0),
      project.ikReference === 'fk',
      controllerConstraints(project),
    );
    // Calibrate once, without contact adaptation recursively feeding itself.
    target.sample(donor, values, project, 0, { ...config, handIK: false, footIK: false });
    const shifts: Record<string, T.Vector3> = {};
    for (const side of ['l', 'r']) {
      const hand = target.bones.get('hand_' + side)!,
        shoulder = target.bones.get('upperarm_' + side)!;
      const desired = this.gripMatrix(side, donor)
        .multiply(target.gripMatrix(side).invert())
        .multiply(hand.matrixWorld);
      shifts[side] = pos(desired)
        .sub(target.position('hand_' + side))
        .applyQuaternion(shoulder.parent!.getWorldQuaternion(new T.Quaternion()).invert());
    }
    this.floatingCalibrations.set(project, shifts);
    return shifts;
  }
  sample(
    source: MannyRig,
    values: Record<ControlId, Pose>,
    project: Project,
    frame: number,
    config: RetargetCharacter,
    referencePose = false,
    sceneTransform = new T.Matrix4(),
  ) {
    if (this.referenceRig !== source || this.referenceRevision !== source.motionRevision) {
      this.referenceRig = source;
      this.referenceRevision = source.motionRevision;
      this.floatingCalibrations = new WeakMap();
      for (const side of ['l', 'r']) {
        this.armScale[side] =
          this.chainLength(this, 'upperarm', side) / this.chainLength(source, 'upperarm', side);
        this.legScale[side] =
          this.chainLength(this, 'thigh', side) / this.chainLength(source, 'thigh', side);
      }
      this.motionScale =
        this.root.userData.partialCharacter || source.motionRig?.partial
          ? (this.armScale.l + this.armScale.r) / 2
          : pos(this.rest.get('pelvis')!.world).y / pos(source.rest.get('pelvis')!.world).y;
    }
    const floatingContact =
      !!this.root.userData.floatingFirstPerson &&
      !!project.motionRig?.partial &&
      project.editing === 'firstPerson';
    this.constraints = controllerConstraints(project);
    this.source = source;
    this.values = values;
    this.project = project;
    this.frame = frame;
    this.reset();
    if (referencePose) {
      for (const side of ['l', 'r']) this.updateTwists(side, 'arm');
      return;
    }
    for (const [name, b] of this.bones) {
      const src = source.bones.get(name)!,
        sr = source.rest.get(name)!,
        rest = this.rest.get(name)!;
      if (name === 'root') {
        const world = src.matrixWorld
          .clone()
          .multiply(sr.world.clone().invert())
          .multiply(rest.world);
        world.setPosition(
          pos(rest.world).add(
            src
              .getWorldPosition(new T.Vector3())
              .sub(pos(sr.world))
              .multiplyScalar(this.motionScale),
          ),
        );
        b.parent!.matrixWorld.clone()
          .invert()
          .multiply(world)
          .decompose(b.position, b.quaternion, b.scale);
      } else {
        b.position
          .copy(rest.p)
          .add(src.position.clone().sub(sr.p).multiplyScalar(this.motionScale));
        b.quaternion.copy(
          rot(b.parent!.matrixWorld)
            .invert()
            .multiply(rot(src.matrixWorld))
            .multiply(rot(sr.world).invert())
            .multiply(rot(rest.world)),
        );
      }
      // Bones are traversed parent-first. Updating just this joint avoids walking
      // its entire descendant tree again for every joint in both preview rigs.
      b.updateWorldMatrix(false, false);
    }
    if (project.motionRig?.partial && project.editing === 'firstPerson') {
      const lift = Number(this.root.userData.floorLift ?? 0);
      if (lift) {
        const rootBone = this.bones.get('root')!,
          position = rootBone.getWorldPosition(new T.Vector3());
        position.y -= lift;
        rootBone.position.copy(rootBone.parent!.worldToLocal(position));
        rootBone.updateMatrixWorld(true);
      }
    }
    for (const [id, following] of Object.entries(boneFollowing(project, frame))) {
      if (!following || following.position) continue;
      const name = CONTROLS[id as ControlId].bone;
      if (!name) continue;
      const b = this.bones.get(name)!,
        desired = pos(this.rest.get(name)!.world).add(
          source
            .position(name)
            .sub(pos(source.rest.get(name)!.world))
            .multiplyScalar(this.motionScale),
        );
      b.position.copy(b.parent!.worldToLocal(desired));
      b.updateMatrixWorld(true);
    }
    this.shoulderAdjustments = { l: 0, r: 0 };
    if (floatingContact && config.handIK) {
      const shifts = this.floatingCalibration(source, project, config);
      for (const side of ['l', 'r'])
        if (limbMode(project, ('arm_' + side) as 'arm_l' | 'arm_r', frame) !== 'fk') {
          const shoulder = this.bones.get('upperarm_' + side)!;
          shoulder.position.add(shifts[side]);
          shoulder.updateMatrixWorld(true);
          this.shoulderAdjustments[side] = shifts[side].length();
        }
    }
    for (const side of ['l', 'r']) {
      if (
        !floatingContact &&
        config.handIK &&
        limbMode(project, ('arm_' + side) as 'arm_l' | 'arm_r', frame) !== 'fk'
      ) {
        const dest = this.shoulderPoint(
            new T.Vector3(...values[('hand_' + side) as ControlId].p),
            side,
          ),
          pole = this.shoulderPoint(
            new T.Vector3(...values[('elbow_' + side) as ControlId].p),
            side,
          );
        this.solve(
          side,
          'arm',
          pose(
            dest.toArray() as V3,
            source.bones
              .get('hand_' + side)!
              .getWorldQuaternion(new T.Quaternion())
              .toArray() as Q4,
          ),
          pole,
        );
      }
      if (
        config.footIK &&
        limbMode(project, ('leg_' + side) as 'leg_l' | 'leg_r', frame) !== 'fk'
      ) {
        const dest = this.footPoint(source.position('foot_' + side), side),
          pole = this.footPoint(new T.Vector3(...values[('knee_' + side) as ControlId].p), side);
        this.solve(
          side,
          'leg',
          pose(
            dest.toArray() as V3,
            source.bones
              .get('foot_' + side)!
              .getWorldQuaternion(new T.Quaternion())
              .toArray() as Q4,
          ),
          pole,
        );
      }
    }
    // Props retain their physical size. A stable primary-hand frame adapts their
    // trajectory; contact hands are solved against that prop, not a scaled origin.
    for (const id of ['rifle', 'magazine'] as const) {
      const side = id === 'rifle' ? 'r' : 'l',
        prop = (this.props[id] ??= new T.Matrix4());
      // Camera-authored weapon motion is an end-effector constraint. Different
      // arm lengths must adapt to it, not move the sight or magazine in the view.
      if (project.motionRig?.partial && project.editing === 'firstPerson')
        prop.copy(matrix(values[id]));
      else
        prop
          .copy(this.gripMatrix(side))
          .multiply(this.gripMatrix(side, source).invert())
          .multiply(matrix(values[id]));
    }
    const bindings = boneFollowing(project, frame),
      resolved = new Set<ControlId>(),
      resolving = new Set<ControlId>();
    const propMatrix = (id: ControlId): T.Matrix4 => {
      if (resolved.has(id)) return this.props[id]!;
      if (resolving.has(id)) return matrix(values[id]);
      resolving.add(id);
      const key = bindings[id],
        parent = key?.target ?? controlParent(project, id, frame);
      let value = matrix(values[id]);
      if (key?.target !== undefined || id.startsWith('prop:')) {
        if (parent !== 'world' && parent !== 'native') {
          let target: T.Matrix4, original: T.Matrix4;
          if (isProp(parent)) {
            target = propMatrix(parent);
            original = matrix(values[parent]);
          } else if (
            parent === 'hand_l' ||
            parent === 'wrist_l' ||
            parent === 'hand_r' ||
            parent === 'wrist_r'
          ) {
            const side = parent.at(-1)!;
            target = this.gripMatrix(side);
            original = this.gripMatrix(side, source);
          } else if (CONTROLS[parent]?.bone) {
            target = this.bodyBone(parent).matrixWorld;
            original = source.bodyBone(parent).matrixWorld;
          } else {
            target = this.controlMatrix(parent);
            original = matrix(values[parent]);
          }
          const adapted = target.clone().multiply(original.clone().invert()).multiply(value);
          if (key && !key.position) adapted.setPosition(pos(value));
          if (key && !key.rotation) adapted.compose(pos(adapted), rot(value), unit);
          value = adapted;
        }
        this.props[id] = value;
      }
      resolving.delete(id);
      resolved.add(id);
      return this.props[id] ?? value;
    };
    for (const id of Object.keys(projectProps(project)) as ControlId[]) propMatrix(id);
    if (!bindings.magazine && controlParent(project, 'magazine', frame) === 'rifle')
      this.props
        .magazine!.copy(this.props.rifle!)
        .multiply(matrix(values.rifle).invert())
        .multiply(matrix(values.magazine));
    for (const side of ['r', 'l']) {
      const id = ('hand_' + side) as ControlId,
        contact = this.contact(id);
      if (
        config.handIK &&
        limbMode(project, ('arm_' + side) as 'arm_l' | 'arm_r', frame) !== 'fk' &&
        contact &&
        this.props[contact.parent]
      ) {
        const hand = this.bones.get('hand_' + side)!,
          gripToHand = this.gripMatrix(side).invert().multiply(hand.matrixWorld),
          m = this.props[contact.parent]!.clone()
            .multiply(matrix(values[contact.parent]).invert())
            .multiply(this.gripMatrix(side, source))
            .multiply(gripToHand),
          p = this.position('hand_' + side).lerp(pos(m), contact.weight),
          q = hand.getWorldQuaternion(new T.Quaternion()).slerp(rot(m), contact.weight);
        if (floatingContact) {
          // Keep the calibrated shoulder stable through changes of elbow bend.
          // Only move it farther when the target lies beyond the unchanged limb's
          // physical reach; this correction depends on reach, never the FK elbow.
          const shoulder = this.bones.get('upperarm_' + side)!,
            start = this.position('upperarm_' + side),
            elbow = this.position('lowerarm_' + side),
            end = this.position('hand_' + side),
            direction = p.clone().sub(start),
            distance = direction.length(),
            reach = start.distanceTo(elbow) + elbow.distanceTo(end) - 0.0002;
          if (distance > reach) {
            const shift = direction.multiplyScalar((distance - reach) / distance);
            shoulder.position.copy(shoulder.parent!.worldToLocal(start.add(shift)));
            shoulder.updateMatrixWorld(true);
            this.shoulderAdjustments[side] += shift.length();
          }
          this.solve(
            side,
            'arm',
            pose(p.toArray() as V3, q.toArray() as Q4),
            this.shoulderPoint(new T.Vector3(...values[('elbow_' + side) as ControlId].p), side),
          );
        } else
          this.solve(
            side,
            'arm',
            pose(p.toArray() as V3, q.toArray() as Q4),
            this.shoulderPoint(new T.Vector3(...values[('elbow_' + side) as ControlId].p), side),
          );
      }
    }
    for (const side of ['l', 'r']) {
      this.updateTwists(side, 'arm');
      this.updateTwists(side, 'leg');
      for (const kind of ['hand', 'foot']) {
        const b = this.bones.get('ik_' + kind + '_' + side)!,
          end = this.bones.get(kind + '_' + side)!;
        b.parent!.matrixWorld.clone()
          .invert()
          .multiply(end.matrixWorld)
          .decompose(b.position, b.quaternion, b.scale);
        b.updateMatrixWorld(true);
      }
    }
    if (project.ikReference === 'fk')
      for (const [name, b] of this.bones)
        if (name.includes('_twist_')) {
          // UE4 has one twist deformer per segment; Manny has two. An absent source
          // joint is not an authored zero rotation: use the target's roll distribution.
          const authored = project.motionRig?.authoredBones,
            family = name.split('_twist_')[0] + '_twist_',
            side = name.at(-1);
          if (
            authored &&
            Object.keys(config.mapping).some(
              (n) => n.startsWith(family) && n.endsWith(side!) && !authored.includes(n),
            )
          )
            continue;
          const src = source.bones.get(name)!,
            sr = source.rest.get(name)!,
            rest = this.rest.get(name)!;
          b.position
            .copy(rest.p)
            .add(src.position.clone().sub(sr.p).multiplyScalar(this.motionScale));
          this.setWorldQuaternion(
            b,
            src
              .getWorldQuaternion(new T.Quaternion())
              .multiply(rot(sr.world).invert())
              .multiply(rot(rest.world)),
          );
          b.updateMatrixWorld(true);
        }
    this.root.updateMatrixWorld(true);
  }
  controlMatrix(id: ControlId) {
    const d = CONTROLS[id];
    if (d.kind === 'pivot') return this.pivotWorld(id);
    if (d.kind === 'bone' || id === 'root' || id.startsWith('hand_') || id.startsWith('foot_'))
      return this.bodyBone(id).matrixWorld.clone();
    if (isProp(id)) return this.props[id]?.clone() ?? matrix(this.values![id]);
    const p = new T.Vector3(...this.values![id].p);
    if (id.startsWith('elbow_'))
      return new T.Matrix4().makeTranslation(...this.shoulderPoint(p, id.at(-1)!).toArray());
    if (id.startsWith('knee_'))
      return new T.Matrix4().makeTranslation(...this.footPoint(p, id.at(-1)!).toArray());
    return matrix(this.values![id]);
  }
  cameraMatrix(sourceCamera: T.Matrix4, rest = false) {
    if (this.root.userData.partialCharacter || this.source?.motionRig?.partial)
      return sourceCamera.clone();
    const source = this.source!;
    const sourceHead = rest ? pos(source.rest.get('head')!.world) : source.position('head'),
      head = rest ? pos(this.rest.get('head')!.world) : this.position('head'),
      p = pos(sourceCamera).sub(sourceHead).multiplyScalar(this.motionScale).add(head);
    return sourceCamera.clone().setPosition(p);
  }
}

export class MannyCharacter {
  body: ProportionalRig;
  first: ProportionalRig;
  fpGroup = new T.Group();
  legs: T.SkinnedMesh[] = [];
  meshes: T.SkinnedMesh[] = [];
  worldMaterials = new Set<T.Material>();
  constructor(
    public raw: RetargetRig,
    source: MannyRig,
    public config: RetargetCharacter,
  ) {
    const root = bindCharacterToManny(raw, source, config);
    this.body = new ProportionalRig(root, source);
    const floating = cloneSkeleton(root) as T.Group;
    floating.userData.floatingFirstPerson = true;
    this.first = new ProportionalRig(floating, source);
    this.fpGroup.matrixAutoUpdate = false;
    this.fpGroup.add(floating);
    floating.traverse((o) => {
      if (o instanceof T.SkinnedMesh) {
        o.geometry = firstPersonGeometry(o);
        o.material = Array.isArray(o.material)
          ? o.material.map((m) => m.clone())
          : o.material.clone();
        o.castShadow = false;
        o.receiveShadow = false;
        o.layers.enable(1);
      }
    });
    root.traverse((o) => {
      if (o instanceof T.SkinnedMesh) {
        this.meshes.push(o);
        o.layers.enable(1);
        for (const m of materials(o)) this.worldMaterials.add(m);
        const leg = new T.SkinnedMesh(
          maskedGeometry(o, /^(pelvis|thigh|calf|foot|ball)/),
          Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(),
        );
        leg.name = o.name;
        leg.bind(o.skeleton, o.bindMatrix);
        leg.layers.set(1);
        leg.frustumCulled = false;
        leg.castShadow = false;
        leg.visible = false;
        this.legs.push(leg);
      }
    });
    for (const leg of this.legs) {
      prepareSkinMesh(leg);
      root.add(leg);
    }
  }
  updateParts(config: RetargetCharacter) {
    this.config = config;
    for (const mesh of this.meshes) mesh.visible = !config.hiddenMeshes.includes(mesh.name);
    this.first.root.traverse((o) => {
      if (o instanceof T.Mesh) o.visible = !config.hiddenMeshes.includes(o.name);
    });
  }
  dispose() {
    const geometries = new Set<T.BufferGeometry>(),
      mats = new Set<T.Material>(),
      skeletons = new Set<T.Skeleton>();
    for (const root of [this.body.root, this.fpGroup]) {
      root.removeFromParent();
      root.traverse((o) => {
        if (o instanceof T.Mesh) {
          if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton);
          geometries.add(o.geometry);
          for (const m of materials(o)) mats.add(m);
        }
      });
    }
    for (const g of geometries) g.dispose();
    for (const m of mats) m.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
  }
}

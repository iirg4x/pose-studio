import { prepareSkinRoot, skinWeightFor } from './skinInfluences';
import * as T from 'three';
import type { MannyRig } from './rig';
import type { RetargetCharacter } from '../core/retarget';
import { mappingIssues } from '../core/retarget';

type Rest = { p: T.Vector3; q: T.Quaternion; s: T.Vector3; world: T.Matrix4 };
const position = (m: T.Matrix4) => new T.Vector3().setFromMatrixPosition(m);
const rotation = (m: T.Matrix4) => {
  const q = new T.Quaternion();
  m.decompose(new T.Vector3(), q, new T.Vector3());
  return q;
};
export class RetargetRig {
  root = new T.Group();
  bones = new Map<string, T.Bone>();
  meshes: T.Mesh[] = [];
  rest = new Map<string, Rest>();
  private calibrated = new Map<string, T.Quaternion>();
  private signature = '';
  private ratio = 1;
  private groundOffset = 0;
  private origin = new T.Vector3();
  private surfaceLift = 0;
  private pairs: { source: string; target: T.Bone }[] = [];
  private source?: MannyRig;
  private config?: RetargetCharacter;
  constructor(public model: T.Group) {
    prepareSkinRoot(model);
    this.root.name = 'RetargetCharacter';
    this.root.add(model);
    this.root.updateMatrixWorld(true);
    model.traverse((o) => {
      if (o instanceof T.Bone) {
        if (this.bones.has(o.name)) throw Error('Bone names must be unique: ' + o.name);
        this.bones.set(o.name, o);
        this.rest.set(o.name, {
          p: o.position.clone(),
          q: o.quaternion.clone(),
          s: o.scale.clone(),
          world: o.matrixWorld.clone(),
        });
      }
      if (o instanceof T.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        this.meshes.push(o);
      }
    });
    if (!this.bones.size || !this.meshes.some((m) => m instanceof T.SkinnedMesh))
      throw Error('This model has no skinned skeleton. Import a rigged humanoid.');
  }
  private reset() {
    for (const [name, b] of this.bones) {
      const r = this.rest.get(name)!;
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
      b.scale.copy(r.s);
    }
    this.root.updateMatrixWorld(true);
  }
  private setWorldRotation(b: T.Bone, q: T.Quaternion) {
    b.quaternion.copy(b.parent!.getWorldQuaternion(new T.Quaternion()).invert().multiply(q));
    b.updateMatrixWorld(true);
  }
  private mapped(name: string) {
    const target = this.config?.mapping[name];
    return target ? this.bones.get(target) : undefined;
  }
  /** A partial arm mesh has no floor surface; its skeleton still defines height. */
  hasLowerBodySurface() {
    const names = new Set(
      ['l', 'r'].flatMap((side) =>
        ['thigh', 'calf', 'foot', 'ball']
          .map((stem) => this.config?.mapping[stem + '_' + side])
          .filter((n): n is string => !!n),
      ),
    );
    for (const mesh of this.meshes) {
      if (!mesh.visible || !(mesh instanceof T.SkinnedMesh)) continue;
      const index = mesh.geometry.index,
        si = mesh.geometry.getAttribute('skinIndex');
      for (let v = 0; v < (index?.count ?? si.count); v++) {
        const i = index ? index.getX(v) : v;
        if (skinWeightFor(mesh, i, (name) => names.has(name)) > 0.5) return true;
      }
    }
    return false;
  }
  private sourceRest(name: string) {
    return this.source?.rest.get(name)?.world;
  }
  private direction(name: string, target: boolean): T.Vector3 | undefined {
    const get = (n: string) =>
      target
        ? this.mapped(n)?.getWorldPosition(new T.Vector3())
        : this.sourceRest(n)
          ? position(this.sourceRest(n)!)
          : undefined;
    const start = get(name);
    if (!start) return;
    let end: string | undefined;
    if (name.startsWith('clavicle_')) end = name.replace('clavicle_', 'upperarm_');
    else if (name.startsWith('upperarm_')) end = name.replace('upperarm_', 'lowerarm_');
    else if (name.startsWith('lowerarm_')) end = name.replace('lowerarm_', 'hand_');
    else if (name.startsWith('thigh_')) end = name.replace('thigh_', 'calf_');
    else if (name.startsWith('calf_')) end = name.replace('calf_', 'foot_');
    else if (name.startsWith('foot_')) end = name.replace('foot_', 'ball_');
    else if (name.startsWith('hand_')) end = 'middle_01_' + name.at(-1);
    else if (/_0[12]_/.test(name))
      end = name.replace(/_0([12])_/, (_, n) => '_0' + (Number(n) + 1) + '_');
    else if (
      this.config?.origin === 'skeleton' &&
      /^(thumb|index|middle|ring|pinky)_03_/.test(name)
    ) {
      const previous = get(name.replace('_03_', '_02_')),
        world = target ? this.mapped(name)?.matrixWorld : this.sourceRest(name);
      if (previous && world) {
        const direction = start.clone().sub(previous).normalize(),
          axes = [0, 1, 2].map((i) => new T.Vector3().setFromMatrixColumn(world, i).normalize());
        axes.sort((a, b) => Math.abs(b.dot(direction)) - Math.abs(a.dot(direction)));
        return Math.abs(axes[0].dot(direction)) > 0.85
          ? axes[0].multiplyScalar(Math.sign(axes[0].dot(direction)))
          : direction;
      }
    }
    // Torso joints describe different anatomical landmarks across skeletons.
    // A neck can start behind (or below) its ribcage joint. Aiming that short
    // offset at Manny's vertical spine rotates the entire chest by nearly 90°.
    // Preserve the imported torso shape and transfer animation deltas instead.
    const stop = end ? get(end) : undefined;
    return stop && stop.distanceToSquared(start) > 1e-10 ? stop.sub(start).normalize() : undefined;
  }
  configure(source: MannyRig, config: RetargetCharacter) {
    this.source = source;
    this.config = config;
    for (const mesh of this.meshes) mesh.visible = !config.hiddenMeshes.includes(mesh.name);
    const signature = JSON.stringify([
      config.mapping,
      config.scale,
      config.facing,
      config.offsets,
      config.origin,
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    // The wrapper retains unit/facing conversion. All original bind matrices and
    // local bone lengths remain intact, including bones without a Manny match.
    this.root.position.set(0, 0, 0);
    this.root.scale.setScalar(config.scale);
    this.root.rotation.set(0, T.MathUtils.degToRad(config.facing), 0);
    this.reset();
    const visible = new T.Box3();
    for (const mesh of this.meshes)
      if (mesh.visible) visible.union(new T.Box3().setFromObject(mesh, true));
    const hipsBone = this.mapped('pelvis'),
      hipOrigin = hipsBone?.getWorldPosition(new T.Vector3()) ?? new T.Vector3();
    // FP exports often move the entire skeleton so the camera/head is at zero.
    // An arms-only surface cannot supply a floor. Restore the skeleton origin,
    // rather than treating the negative pelvis height as character proportions.
    let skeletonRoot: T.Object3D | undefined = hipsBone;
    while (skeletonRoot?.parent instanceof T.Bone) skeletonRoot = skeletonRoot.parent;
    const skeletonY = skeletonRoot?.parent?.getWorldPosition(new T.Vector3()).y ?? 0;
    const skeletonOffset =
        config.origin === 'skeleton' && hipOrigin.y < 0 && skeletonY < hipOrigin.y ? -skeletonY : 0,
      grounded = this.hasLowerBodySurface() && !visible.isEmpty();
    this.groundOffset = grounded ? -visible.min.y : skeletonOffset;
    this.surfaceLift = grounded ? this.groundOffset - skeletonOffset : 0;
    this.origin.set(-hipOrigin.x, this.groundOffset, -hipOrigin.z);
    this.root.position.copy(this.origin);
    this.root.updateMatrixWorld(true);
    const depth = (o: T.Object3D) => {
      let n = 0;
      while (o.parent) {
        n++;
        o = o.parent;
      }
      return n;
    };
    this.pairs = Object.entries(config.mapping)
      .flatMap(([s, n]) => {
        const b = this.bones.get(n);
        return b && source.bones.has(s) ? [{ source: s, target: b }] : [];
      })
      .sort((a, b) => depth(a.target) - depth(b.target));
    this.calibrated.clear();
    const soleRotations = new Map(
      ['l', 'r'].flatMap((side) => {
        const b = this.mapped('foot_' + side);
        return b ? [['foot_' + side, b.getWorldQuaternion(new T.Quaternion())] as const] : [];
      }),
    );
    // Match A/T pose geometrically rather than assuming identical bone axes.
    for (const pair of this.pairs) {
      const { source: name, target: b } = pair;
      const from = this.direction(name, true),
        to = this.direction(name, false);
      let q = b.getWorldQuaternion(new T.Quaternion());
      if (soleRotations.has(name)) q.copy(soleRotations.get(name)!);
      else if (from && to) q.premultiply(new T.Quaternion().setFromUnitVectors(from, to));
      this.setWorldRotation(b, q);
      if (name.startsWith('hand_')) {
        const side = name.at(-1)!,
          index = this.mapped('index_01_' + side),
          pinky = this.mapped('pinky_01_' + side),
          si = this.sourceRest('index_01_' + side),
          sp = this.sourceRest('pinky_01_' + side);
        const axis = this.direction(name, true);
        if (index && pinky && si && sp && axis) {
          const a = index
              .getWorldPosition(new T.Vector3())
              .sub(pinky.getWorldPosition(new T.Vector3())),
            z = position(si).sub(position(sp));
          a.addScaledVector(axis, -a.dot(axis)).normalize();
          z.addScaledVector(axis, -z.dot(axis)).normalize();
          if (a.lengthSq() > 0.1 && z.lengthSq() > 0.1) {
            const angle = Math.atan2(axis.dot(a.clone().cross(z)), a.dot(z));
            q.premultiply(new T.Quaternion().setFromAxisAngle(axis, angle));
            this.setWorldRotation(b, q);
          }
        }
      }
      const offset = config.offsets[name];
      if (offset) {
        q.multiply(
          new T.Quaternion().setFromEuler(
            new T.Euler(...(offset.map(T.MathUtils.degToRad) as [number, number, number])),
          ),
        );
        this.setWorldRotation(b, q);
      }
      this.calibrated.set(name, b.getWorldQuaternion(new T.Quaternion()));
    }
    const hips = this.mapped('pelvis'),
      sourceHip = source.rest.get('pelvis');
    this.ratio =
      hips && sourceHip
        ? hips.getWorldPosition(new T.Vector3()).y / position(sourceHip.world).y
        : 1;
    if (!this.hasLowerBodySurface()) {
      const ratios = ['l', 'r'].flatMap((side) => {
        const names = ['upperarm', 'lowerarm', 'hand'].map((n) => n + '_' + side),
          bones = names.map((n) => this.mapped(n));
        if (bones.some((b) => !b)) return [];
        const p = bones.map((b) => b!.getWorldPosition(new T.Vector3())),
          s = names.map((n) => position(source.rest.get(n)!.world));
        return [
          (p[0].distanceTo(p[1]) + p[1].distanceTo(p[2])) /
            (s[0].distanceTo(s[1]) + s[1].distanceTo(s[2])),
        ];
      });
      this.ratio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1;
    }
  }
  get ready() {
    return !!this.config && mappingIssues(this.config.mapping, [...this.bones.keys()]).ready;
  }
  get motionScale() {
    return this.ratio;
  }
  /** Sole placement is a body-preview convention, not part of FP motion. */
  get floorLift() {
    return this.surfaceLift;
  }
  resetToBind() {
    this.root.position.copy(this.origin);
    this.reset();
  }
  setPreviewOffset(x: number) {
    this.root.position.x = this.origin.x + x;
    this.root.updateMatrixWorld(true);
  }
  apply(restPose = false) {
    if (!this.source || !this.config) return;
    this.root.position.copy(this.origin);
    this.reset();
    for (const { source: name, target: b } of this.pairs) {
      const src = this.source.bones.get(name)!,
        srcRest = this.source.rest.get(name)!,
        cal = this.calibrated.get(name)!;
      const desired = restPose
        ? cal.clone()
        : src
            .getWorldQuaternion(new T.Quaternion())
            .multiply(rotation(srcRest.world).invert())
            .multiply(cal);
      this.setWorldRotation(b, desired);
      if (name !== 'pelvis' && !restPose) {
        const delta = src.position
          .clone()
          .sub(srcRest.p)
          .applyMatrix3(new T.Matrix3().setFromMatrix4(src.parent!.matrixWorld))
          .multiplyScalar(this.ratio)
          .applyMatrix3(new T.Matrix3().setFromMatrix4(b.parent!.matrixWorld.clone().invert()));
        b.position.add(delta);
        b.updateMatrixWorld(true);
      }
      if (name === 'pelvis' && !restPose) {
        const restWorld = position(this.rest.get(b.name)!.world)
          .multiplyScalar(this.config.scale)
          .applyAxisAngle(new T.Vector3(0, 1, 0), T.MathUtils.degToRad(this.config.facing))
          .add(this.origin);
        const delta = src
          .getWorldPosition(new T.Vector3())
          .sub(position(srcRest.world))
          .multiplyScalar(this.ratio);
        b.position.copy(b.parent!.worldToLocal(restWorld.add(delta)));
        b.updateMatrixWorld(true);
      }
    }
    if (!restPose && this.ready) {
      for (const side of ['l', 'r']) {
        if (this.config.handIK)
          this.solve('upperarm_' + side, 'lowerarm_' + side, 'hand_' + side, false);
        if (this.config.footIK) this.solve('thigh_' + side, 'calf_' + side, 'foot_' + side, true);
      }
    }
    this.root.updateMatrixWorld(true);
  }
  private solve(aName: string, bName: string, cName: string, foot: boolean) {
    const a = this.mapped(aName)!,
      b = this.mapped(bName)!,
      c = this.mapped(cName)!,
      source = this.source!;
    const start = a.getWorldPosition(new T.Vector3()),
      mid = b.getWorldPosition(new T.Vector3()),
      end = c.getWorldPosition(new T.Vector3()),
      endQ = c.getWorldQuaternion(new T.Quaternion());
    const sa = source.position(aName),
      sb = source.position(bName),
      sc = source.position(cName),
      dest = sc.clone().multiplyScalar(this.ratio);
    if (foot) {
      const targetBind = position(this.rest.get(c.name)!.world).multiplyScalar(this.config!.scale);
      dest.y +=
        targetBind.y + this.groundOffset - position(source.rest.get(cName)!.world).y * this.ratio;
    }
    const l1 = start.distanceTo(mid),
      l2 = mid.distanceTo(end),
      dir = dest.clone().sub(start),
      raw = dir.length();
    if (raw < 1e-6 || l1 < 1e-6 || l2 < 1e-6) return;
    dir.normalize();
    const sourceDir = sc.clone().sub(sa).normalize(),
      bend = sb.clone().sub(sa);
    bend.addScaledVector(sourceDir, -bend.dot(sourceDir));
    bend.addScaledVector(dir, -bend.dot(dir));
    if (bend.lengthSq() < 1e-8) {
      bend.copy(mid).sub(start).addScaledVector(dir, -mid.clone().sub(start).dot(dir));
    }
    if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(dir, -dir.z);
    bend.normalize();
    const d = T.MathUtils.clamp(raw, Math.abs(l1 - l2) + 1e-5, l1 + l2 - 1e-5),
      along = (l1 * l1 - l2 * l2 + d * d) / (2 * d),
      elbow = start
        .clone()
        .addScaledVector(dir, along)
        .addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
    this.aim(a, b, elbow);
    this.aim(b, c, start.clone().addScaledVector(dir, d));
    this.setWorldRotation(c, endQ);
  }
  private aim(b: T.Bone, child: T.Bone, target: T.Vector3) {
    const p = b.getWorldPosition(new T.Vector3()),
      from = child.getWorldPosition(new T.Vector3()).sub(p).normalize(),
      to = target.clone().sub(p).normalize();
    this.setWorldRotation(
      b,
      new T.Quaternion()
        .setFromUnitVectors(from, to)
        .multiply(b.getWorldQuaternion(new T.Quaternion())),
    );
  }
  dispose() {
    const materials = new Set<T.Material>(),
      textures = new Set<T.Texture>(),
      geometry = new Set<T.BufferGeometry>();
    for (const mesh of this.meshes) {
      geometry.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        materials.add(material);
    }
    for (const m of materials) {
      for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
      m.dispose();
    }
    for (const t of textures) t.dispose();
    for (const g of geometry) g.dispose();
    this.root.removeFromParent();
  }
}

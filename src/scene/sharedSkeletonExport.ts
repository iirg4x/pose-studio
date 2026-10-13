import { controllerConstraints } from '../core/controllerConstraints';
import { animationCamera } from './animationCamera';
import * as T from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { fullSkinLoader } from './skinInfluences';
import { MannyRig } from './rig';
import { MannyCharacter, ProportionalRig, mannyPreviewConfig } from './MannyCharacter';
import { RetargetRig } from './RetargetRig';
import { AttachmentSolver } from './attachments';
import { maskedGeometry } from './meshMask';
import { CAMERA_REFERENCE, evaluate, forLayer, layerFrame, limbMode, matrix } from '../core/model';
import type { ControlId, Project } from '../core/model';
import { boneFollowing } from '../core/boneFollowing';
import { mappingIssues } from '../core/retarget';
import type { AnimationLibrary } from '../core/library';
import type { SharedExportPlan, SharedExportItem } from '../core/sharedExport';
import { sampleSharedAnimation } from './sharedAnimationSampling';
import type { SharedSamplingInfo } from './sharedAnimationSampling';

export class SharedPoseSampler {
  private solver = new AttachmentSolver();
  private canonicalTarget?: MannyCharacter;
  constructor(public source: MannyRig) {}
  sampleSource(project: Project, frame: number) {
    const values = evaluate(project, frame),
      first = project.editing === 'firstPerson';
    this.source.floating = first && project.bodyBase?.source.editing !== 'body';
    this.source.setMotionRig(project.motionRig);
    this.source.apply(
      values,
      Object.fromEntries(
        (['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const).map((id) => [
          id,
          limbMode(project, id, frame),
        ]),
      ),
      boneFollowing(project, frame),
      project.ikReference === 'fk',
      controllerConstraints(project),
    );
    const delta = first
      ? matrix(evaluate(forLayer(project, 'body'), layerFrame(project, 'body', frame)).root)
          .multiply(matrix(values.camera))
          .multiply(matrix(CAMERA_REFERENCE).invert())
      : new T.Matrix4();
    this.solver.apply(this.source, values, project, frame, delta);
    return {
      rig: this.source,
      values,
      delta,
      props: (id: ControlId) => matrix(values[id]),
      camera: animationCamera(project, this.source, values.camera).toArray(),
    };
  }
  sample(project: Project, frame: number, target?: ProportionalRig, character?: MannyCharacter) {
    const first = project.editing === 'firstPerson';
    if (project.motionRig && !target) {
      if (!this.canonicalTarget) {
        this.source.setMotionRig();
        this.source.reset();
        this.canonicalTarget = new MannyCharacter(
          new RetargetRig(cloneSkeleton(this.source.root) as T.Group),
          this.source,
          mannyPreviewConfig(this.source),
        );
      }
      character = this.canonicalTarget;
      target = first ? character.first : character.body;
    }
    const { values, delta, camera } = this.sampleSource(project, frame);
    if (target && character)
      target.sample(this.source, values, project, frame, character.config, false, delta);
    return {
      rig: target ?? this.source,
      props: (id: ControlId) => target?.props[id]?.clone() ?? matrix(values[id]),
      camera,
    };
  }
  dispose() {
    this.canonicalTarget?.dispose();
  }
}

/** Keep the exact inverse binds used by the preview. Recomputing them from the
 * aligned pose would change the shoulder and wrist deformation on imported rigs. */
export function sharedExportRig(
  source: MannyRig,
  slots: SharedExportPlan['sockets'],
  arms?: MannyRig,
) {
  const root = cloneSkeleton(source.root) as T.Group;
  root.name = 'PoseShared';
  root.removeFromParent();
  const bones = new Map<string, T.Bone>(),
    body: T.SkinnedMesh[] = [],
    variants: T.SkinnedMesh[] = [];
  root.traverse((o) => {
    if (o instanceof T.Bone) bones.set(o.name, o);
    if (o instanceof T.SkinnedMesh) body.push(o);
  });
  for (const [name, b] of bones) {
    const r = source.rest.get(name)!;
    b.position.copy(r.p);
    b.quaternion.copy(r.q);
    b.scale.copy(r.s);
  }
  root.updateMatrixWorld(true);
  const firstMeshes = new Map<string, T.SkinnedMesh>();
  arms?.root.traverse((o) => {
    if (o instanceof T.SkinnedMesh) firstMeshes.set(o.name, o);
  });
  const visible = body.filter(
    (m) => m.visible && (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) > 0,
  );
  if (!visible.length)
    throw Error(
      'This character has no visible skinned meshes. Enable its body parts before exporting.',
    );
  const skeletons = new Set(visible.map((m) => m.skeleton));
  for (const sk of skeletons) {
    sk.bones = [...sk.bones];
    sk.boneInverses = sk.boneInverses.map((m) => m.clone());
  }
  for (const slot of slots) {
    const b = new T.Bone();
    b.name = slot.bone;
    bones.get(slot.parent)!.add(b);
    b.updateMatrixWorld(true);
    bones.set(b.name, b);
    for (const sk of skeletons) {
      sk.bones.push(b);
      sk.boneInverses.push(b.matrixWorld.clone().invert());
    }
  }
  for (const sk of skeletons) sk.init();
  for (const mesh of body) {
    if (!visible.includes(mesh)) {
      mesh.removeFromParent();
      continue;
    }
    const originalName = mesh.name;
    mesh.geometry = mesh.geometry.clone();
    mesh.name = 'Body__' + originalName;
    mesh.userData = { variant: 'body' };
    variants.push(mesh);
    for (const variant of ['arms', 'legs'] as const) {
      const part = mesh.clone();
      part.geometry =
        variant === 'arms' && firstMeshes.has(originalName)
          ? firstMeshes.get(originalName)!.geometry.clone()
          : maskedGeometry(
              mesh,
              variant === 'arms'
                ? /^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)/
                : /^(pelvis|thigh|calf|foot|ball)/,
            );
      part.name = (variant === 'arms' ? 'Arms__' : 'Legs__') + originalName;
      part.userData = { variant };
      if (part.geometry.index?.count) {
        mesh.parent!.add(part);
        variants.push(part);
      } else part.geometry.dispose();
    }
  }
  // A tiny skin declares every joint for animation-only GLBs without repeating
  // the character geometry and textures for every clip. It is never exported to FBX.
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 0.001, 0, 0, 0, 0.001, 0], 3));
  g.setIndex([0, 1, 2]);
  g.setAttribute('skinIndex', new T.Uint16BufferAttribute(new Uint16Array(12), 4));
  g.setAttribute(
    'skinWeight',
    new T.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  const dummy = new T.SkinnedMesh(g, new T.MeshBasicMaterial());
  dummy.name = 'Pose_AnimationCarrier';
  dummy.bind(visible[0].skeleton, new T.Matrix4());
  dummy.visible = false;
  root.add(dummy);
  const hierarchy = [...bones].map(([name, b]) => ({
    name,
    parent: b.parent instanceof T.Bone ? b.parent.name : null,
  }));
  const sync = (rig: MannyRig, props: (id: ControlId) => T.Matrix4) => {
    for (const [name, b] of bones) {
      const slot = slots.find((s) => s.bone === name),
        world = slot ? props(slot.id as ControlId) : rig.bones.get(name)!.matrixWorld;
      b.parent!.updateWorldMatrix(true, false);
      b.parent!.matrixWorld.clone()
        .invert()
        .multiply(world)
        .decompose(b.position, b.quaternion, b.scale);
      b.updateMatrixWorld(true);
    }
  };
  return {
    root,
    bones,
    variants,
    dummy,
    hierarchy,
    sync,
    dispose() {
      for (const mesh of variants) mesh.geometry.dispose();
      g.dispose();
      (dummy.material as T.Material).dispose();
      for (const sk of skeletons) sk.dispose();
    },
  };
}
type ExportRig = ReturnType<typeof sharedExportRig>;
async function encode(rig: ExportRig, animations: T.AnimationClip[] = []) {
  const scene = new T.Scene();
  scene.add(rig.root);
  try {
    const data = await new GLTFExporter().parseAsync(scene, {
      binary: true,
      onlyVisible: true,
      animations,
    });
    if (!(data instanceof ArrayBuffer)) throw Error('Could not encode the shared skeleton.');
    return new Uint8Array(data);
  } finally {
    rig.root.removeFromParent();
  }
}
export async function sharedMeshGLB(rig: ExportRig) {
  rig.dummy.visible = false;
  for (const m of rig.variants) m.visible = true;
  return encode(rig);
}
export async function sharedAnimationGLB(
  rig: ExportRig,
  name: string,
  fps: number,
  end: number,
  sample: (frame: number) => void,
  progress: (value: number) => void,
  onSampling?: (info: SharedSamplingInfo) => void,
) {
  const times: number[] = [],
    values = new Map(
      [...rig.bones.values()].map((b) => [
        b,
        { p: [] as number[], q: [] as number[], s: [] as number[] },
      ]),
    );
  const sampled = await sampleSharedAnimation([...rig.bones.values()], fps, end, sample, progress);
  for (let f = 0; f < sampled.frames.length; f++) {
    times.push(f / sampled.info.sampleRate);
    let i = 0;
    for (const v of values.values()) {
      const frame = sampled.frames[f],
        at = i++ * 10;
      v.p.push(...frame.subarray(at, at + 3));
      const q = new T.Quaternion().fromArray(frame, at + 3).normalize();
      if (v.q.length && q.dot(new T.Quaternion().fromArray(v.q, v.q.length - 4)) < 0)
        q.set(-q.x, -q.y, -q.z, -q.w);
      v.q.push(...q.toArray());
      v.s.push(...frame.subarray(at + 7, at + 10));
    }
  }
  onSampling?.(sampled.info);
  const tracks: T.KeyframeTrack[] = [];
  for (const [b, v] of values)
    tracks.push(
      new T.VectorKeyframeTrack(b.uuid + '.position', times, v.p),
      new T.QuaternionKeyframeTrack(b.uuid + '.quaternion', times, v.q),
      new T.VectorKeyframeTrack(b.uuid + '.scale', times, v.s),
    );
  for (const mesh of rig.variants) mesh.visible = false;
  rig.dummy.visible = true;
  try {
    sample(0);
    return await encode(rig, [new T.AnimationClip(name, end / fps, tracks)]);
  } finally {
    rig.dummy.visible = false;
    for (const mesh of rig.variants) mesh.visible = true;
  }
}
function disposeModel(root: T.Object3D) {
  const gs = new Set<T.BufferGeometry>(),
    ms = new Set<T.Material>(),
    ts = new Set<T.Texture>();
  root.traverse((o) => {
    if (o instanceof T.Mesh) {
      gs.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) ms.add(m);
    }
  });
  for (const m of ms) {
    for (const v of Object.values(m)) if (v instanceof T.Texture) ts.add(v);
    m.dispose();
  }
  for (const g of gs) g.dispose();
  for (const t of ts) t.dispose();
}
export async function bakeSharedSkeleton(
  workspace: AnimationLibrary,
  plan: SharedExportPlan,
  write: (item: SharedExportItem, data: Uint8Array) => Promise<void>,
  progress: (value: number, label: string) => void,
) {
  const model = (await fullSkinLoader().loadAsync('./assets/manny.glb')).scene,
    source = new MannyRig(model),
    sampler = new SharedPoseSampler(source);
  const jobs = plan.characters.length + plan.clips.length;
  let done = 0;
  try {
    for (const c of plan.characters) {
      let character: MannyCharacter | undefined, output: ExportRig | undefined;
      try {
        if (c.id !== 'manny') {
          const config = workspace.characters!.find((v) => v.id === c.id)!,
            data = await window.studioDesktop!.readCharacter(config.asset);
          const raw = new RetargetRig(
            (
              await fullSkinLoader().parseAsync(
                data.buffer.slice(
                  data.byteOffset,
                  data.byteOffset + data.byteLength,
                ) as ArrayBuffer,
                '',
              )
            ).scene,
          );
          if (!mappingIssues(config.mapping, [...raw.bones.keys()]).ready) {
            raw.dispose();
            throw Error(c.name + ': complete the required bone mapping in Character setup.');
          }
          source.reset();
          character = new MannyCharacter(raw, source, config);
        }
        source.reset();
        output = sharedExportRig(character?.body ?? source, plan.sockets, character?.first);
        progress(done / jobs, c.name + ' · meshes');
        await write({ characterId: c.id }, await sharedMeshGLB(output));
        done++;
      } finally {
        output?.dispose();
        if (character) {
          character.dispose();
          character.raw.dispose();
        }
      }
    }
    // One canonical set of local rotations; each mesh supplies its own bone lengths.
    source.reset();
    const output = sharedExportRig(source, plan.sockets);
    try {
      for (const clip of plan.clips) {
        const project = workspace.clips.find((v) => v.id === clip.id)!.project;
        let sampleRate = clip.fps;
        const bytes = await sharedAnimationGLB(
          output,
          clip.name,
          clip.fps,
          clip.end,
          (f) => {
            const s = sampler.sample(project, f);
            output.sync(s.rig, (id) =>
              clip.props.some((p) => p.slot === id)
                ? s.props(id)
                : s.rig.bones.get('root')!.matrixWorld,
            );
          },
          (v) => progress((done + v) / jobs, clip.name),
          (info) => {
            sampleRate = info.sampleRate;
          },
        );
        await write({ clipId: clip.id, sampleRate }, bytes);
        done++;
        progress(done / jobs, clip.name);
      }
    } finally {
      output.dispose();
    }
  } finally {
    sampler.dispose();
    disposeModel(model);
  }
}

import { randomId } from '../core/crypto';
import { AnimationMixer, Bone, LoopOnce } from 'three';
import type { AnimationClip, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import type { AnimationInspection, MotionSource } from '../core/importAnimation';
import { readFbxScene, restRig, sampleRig } from '../core/fbx/scene';
import type { FbxScene } from '../core/fbx/scene';
import { validateGLB } from './portableAssets';
import { MAX_SOURCE_BYTES } from './sourceFiles';

const MAX_FRAMES = 2400;
type Rig = AnimationInspection['rigs'][number];
interface Loaded {
  token: string;
  filename: string;
  fps: number;
  rigs: Rig[];
  sample(
    rig: Rig,
    action: Rig['actions'][number],
    start: number,
    end: number,
    fps: number,
  ): Promise<MotionSource>;
  dispose(): void;
}
const pause = () => new Promise((r) => setTimeout(r, 0));
const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

function loadFbx(scene: FbxScene): Omit<Loaded, 'token' | 'filename'> {
  const rigs = scene.rigs.filter((r) => r.actions.length);
  if (!scene.rigs.length)
    throw Error('No skeleton found. Import an animated armature, not a static mesh.');
  if (!rigs.length) throw Error('This FBX has a skeleton but no animation.');
  const names = (r: (typeof rigs)[number]) => [
    ...(r.top ? [r.name] : []),
    ...r.bones.map((b) => b.name),
  ];
  return {
    fps: scene.fps,
    rigs: rigs.map((r) => ({
      name: r.name,
      bones: names(r),
      actions: r.actions.map((a) => ({
        id: a.id,
        name: a.name,
        start: Math.round(a.start * scene.fps * 1000) / 1000,
        end: Math.round(a.end * scene.fps * 1000) / 1000,
      })),
    })),
    async sample(rig, action, start, end, fps) {
      const source = rigs.find((r) => r.name === rig.name)!,
        clip = source.actions.find((a) => a.id === action.id)!,
        list = names(source),
        count = Math.round(((end - start) / scene.fps) * fps);
      const parent = (i: number) => {
        const bone = source.bones[i - (source.top ? 1 : 0)],
          p = bone?.parent;
        if (!bone) return null;
        return p && source.bones.includes(p) ? p.name : source.top ? source.name : null;
      };
      const rest = restRig(scene, source, clip);
      const frames: number[][][] = [];
      for (let i = 0; i <= count; i++) {
        frames.push(
          sampleRig(scene, source, clip, start / scene.fps + i / fps).map((m) => m.toArray()),
        );
        if (i % 60 === 59) await pause();
      }
      return {
        name: clip.name,
        fps,
        end: count,
        bones: list.map((name, i) => ({ name, parent: parent(i), rest: rest[i].toArray() })),
        frames,
      };
    },
    dispose() {},
  };
}

/** glTF and BVH go through three's loaders and are sampled with its mixer, in the file's own units. */
function loadThree(
  root: Object3D,
  clips: AnimationClip[],
  fps: number,
  label: string,
  fallback: string,
  dispose: () => void,
): Omit<Loaded, 'token' | 'filename'> {
  const bones: Bone[] = [];
  root.traverse((o) => {
    if (o instanceof Bone) bones.push(o);
  });
  if (!bones.length || !clips.length)
    throw Error('Choose a file containing a skeleton and at least one animation.');
  if (new Set(bones.map((b) => b.name)).size !== bones.length)
    throw Error('Give every bone a unique name before importing.');
  return {
    fps,
    rigs: [
      {
        name: label,
        bones: bones.map((b) => b.name),
        actions: clips.map((a, i) => ({
          id: String(i),
          name: a.name || 'Action ' + (i + 1),
          start: 0,
          end: Math.round(a.duration * fps),
        })),
      },
    ],
    async sample(_rig, action, start, end, rate) {
      const clip = clips[Number(action.id)],
        from = start / fps,
        count = Math.round(((end - start) / fps) * rate);
      if (end / fps > clip.duration + 1 / fps) throw Error('Invalid animation range.');
      root.updateMatrixWorld(true);
      const rest = bones.map((b) => ({
        name: b.name,
        parent: b.parent instanceof Bone ? b.parent.name : null,
        rest: b.matrixWorld.toArray(),
      }));
      const mixer = new AnimationMixer(root),
        playing = mixer.clipAction(clip);
      playing.setLoop(LoopOnce, 1);
      playing.clampWhenFinished = true;
      playing.play();
      const frames: number[][][] = [];
      try {
        for (let i = 0; i <= count; i++) {
          mixer.setTime(Math.min(clip.duration, from + i / rate));
          root.updateMatrixWorld(true);
          frames.push(bones.map((b) => b.matrixWorld.toArray()));
          if (i % 60 === 0) await pause();
        }
      } finally {
        mixer.stopAllAction();
        mixer.uncacheRoot(root);
        root.updateMatrixWorld(true);
      }
      return { name: clip.name || fallback, fps: rate, end: count, bones: rest, frames };
    },
    dispose,
  };
}

async function load(name: string, data: Uint8Array): Promise<Omit<Loaded, 'token' | 'filename'>> {
  const type = extension(name);
  if (data.length > MAX_SOURCE_BYTES) throw Error('Choose an animation file below 256 MB.');
  if (type === 'fbx') return loadFbx(readFbxScene(data));
  if (type === 'bvh') {
    const { skeleton, clip } = new BVHLoader().parse(new TextDecoder().decode(data));
    // End sites only mark where a chain stops; they carry no motion and share one name.
    for (const bone of skeleton.bones)
      for (const c of [...bone.children]) if (c.name === 'ENDSITE') bone.remove(c);
    const times = clip.tracks[0]?.times,
      step = times && times.length > 1 ? times[1] - times[0] : 1 / 30;
    clip.name = '';
    return loadThree(
      skeleton.bones[0],
      [clip],
      Math.max(1, Math.round(1 / step)),
      'BVH skeleton',
      name.replace(/\.[^.]+$/, ''),
      () => {},
    );
  }
  if (type === 'glb' || type === 'gltf') {
    if (type === 'glb') validateGLB(data);
    const file = await new GLTFLoader().parseAsync(data.slice().buffer, '').catch((e) => {
      throw type === 'gltf'
        ? Error(
            'This glTF could not be read. Save it as one self-contained .glb file. ' +
              (e as Error).message,
          )
        : e;
    });
    return loadThree(file.scene, file.animations, 30, 'GLB skeleton', name, () =>
      file.scene.traverse((o) => {
        const m = o as import('three').Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          for (const material of Array.isArray(m.material) ? m.material : [m.material])
            material.dispose();
        }
      }),
    );
  }
  if (type === 'blend')
    throw Error(
      'Blender files cannot be read directly. Export the action from Blender as FBX or GLB.',
    );
  throw Error('Choose an FBX, GLB, glTF or BVH animation.');
}

/** Reads animation files inside the app and samples them for the shared importer. */
export class AnimationFileImport {
  private loaded?: Loaded;
  constructor(private pick: () => Promise<{ name: string; data: Uint8Array } | null>) {}
  async inspect(): Promise<AnimationInspection | null> {
    const input = await this.pick();
    if (!input) return null;
    const next = await load(input.name, input.data);
    this.loaded?.dispose();
    this.loaded = { ...next, token: randomId(), filename: input.name };
    const { token, filename, fps, rigs } = this.loaded;
    return { token, filename, fps, rigs };
  }
  async sample(token: string, options: Record<string, unknown>): Promise<MotionSource> {
    const loaded = this.loaded;
    if (!loaded || loaded.token !== token) throw Error('Choose the animation again.');
    const rig = loaded.rigs.find((r) => r.name === options.rig) ?? loaded.rigs[0],
      action = rig.actions.find((a) => a.id === String(options.action)),
      fps = Number(options.fps),
      start = Number(options.start ?? action?.start),
      end = Number(options.end ?? action?.end);
    if (!action) throw Error('Choose an action from this skeleton.');
    if (
      !Number.isFinite(fps) ||
      fps < 1 ||
      fps > 120 ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start
    )
      throw Error('Invalid animation range.');
    const count = Math.round(((end - start) / loaded.fps) * fps);
    if (count < 1 || count > MAX_FRAMES) throw Error('Select a range of 1 to 2400 output frames.');
    return loaded.sample(rig, action, start, end, fps);
  }
}

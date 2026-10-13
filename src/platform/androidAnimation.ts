import { randomId } from '../core/crypto';
import { AnimationMixer, Bone, LoopOnce } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { AnimationInspection, MotionSource } from '../core/importAnimation';
import { validateGLB } from './portableAssets';
/** GLB animations are sampled in glTF's metre / Y-up coordinates, then fitted by the shared importer. */
export class AndroidAnimationImport {
  private loaded?: { token: string; file: GLTF; name: string; bones: Bone[] };
  constructor(private pick: () => Promise<{ name: string; data: Uint8Array } | null>) {}
  async inspect(): Promise<AnimationInspection | null> {
    const input = await this.pick();
    if (!input) return null;
    validateGLB(input.data);
    const file = await new GLTFLoader().parseAsync(input.data.slice().buffer, '');
    const bones: Bone[] = [];
    file.scene.traverse((o) => {
      if (o instanceof Bone) bones.push(o);
    });
    if (!bones.length || !file.animations.length)
      throw Error(
        'Choose a GLB containing a skeleton and animation. FBX / Blend conversion is available in desktop Pose.',
      );
    if (new Set(bones.map((b) => b.name)).size !== bones.length)
      throw Error('Give every bone a unique name before importing.');
    this.dispose();
    const token = randomId();
    this.loaded = { token, file, name: input.name, bones };
    return {
      token,
      filename: input.name,
      fps: 30,
      rigs: [
        {
          name: 'GLB skeleton',
          bones: bones.map((b) => b.name),
          actions: file.animations.map((a, i) => ({
            id: String(i),
            name: a.name || 'Action ' + (i + 1),
            start: 0,
            end: Math.round(a.duration * 30),
          })),
        },
      ],
    };
  }
  async sample(token: string, options: Record<string, unknown>): Promise<MotionSource> {
    const loaded = this.loaded;
    if (!loaded || loaded.token !== token) throw Error('Choose the animation again.');
    const { file, bones } = loaded,
      clip = file.animations[Number(options.action)],
      fps = Number(options.fps),
      start = Number(options.start) / 30,
      stop = Number(options.end) / 30;
    if (
      !clip ||
      !Number.isFinite(fps) ||
      fps < 1 ||
      fps > 120 ||
      !Number.isFinite(start) ||
      !Number.isFinite(stop) ||
      start < 0 ||
      stop <= start ||
      stop > clip.duration + 1 / 30
    )
      throw Error('Invalid animation range.');
    const end = Math.round((stop - start) * fps);
    if (end > 2400) throw Error('Select a range up to 2400 output frames.');
    file.scene.updateMatrixWorld(true);
    const rest = bones.map((b) => ({
      name: b.name,
      parent: b.parent instanceof Bone ? b.parent.name : null,
      rest: b.matrixWorld.toArray(),
    }));
    const mixer = new AnimationMixer(file.scene),
      action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const frames: number[][][] = [];
    try {
      for (let i = 0; i <= end; i++) {
        mixer.setTime(Math.min(clip.duration, start + i / fps));
        file.scene.updateMatrixWorld(true);
        frames.push(bones.map((b) => b.matrixWorld.toArray()));
        if (i % 60 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      mixer.stopAllAction();
      mixer.uncacheRoot(file.scene);
      file.scene.updateMatrixWorld(true);
    }
    return { name: clip.name || loaded.name, fps, end, bones: rest, frames };
  }
  private dispose() {
    this.loaded?.file.scene.traverse((o) => {
      const m = o as import('three').Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        for (const material of Array.isArray(m.material) ? m.material : [m.material])
          material.dispose();
      }
    });
    this.loaded = undefined;
  }
}

import * as T from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { MannyRig } from './rig';
export async function exportRetargetGLB(
  target: MannyRig,
  name: string,
  fps: number,
  end: number,
  sample: (frame: number) => void,
  progress: (value: number) => void,
) {
  const times: number[] = [],
    tracks: T.KeyframeTrack[] = [],
    values = new Map<T.Bone, { p: number[]; q: number[]; s: number[] }>();
  for (const b of target.bones.values()) values.set(b, { p: [], q: [], s: [] });
  for (let frame = 0; frame <= end; frame++) {
    sample(frame);
    times.push(frame / fps);
    for (const [b, v] of values) {
      v.p.push(...b.position.toArray());
      const q = b.quaternion.clone();
      if (
        v.q.length &&
        q.dot(new T.Quaternion(...(v.q.slice(-4) as [number, number, number, number]))) < 0
      )
        q.set(-q.x, -q.y, -q.z, -q.w);
      v.q.push(...q.toArray());
      v.s.push(...b.scale.toArray());
    }
    if (frame % 12 === 0) {
      progress((frame / (end + 1)) * 0.85);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  for (const [b, v] of values) {
    tracks.push(
      new T.VectorKeyframeTrack(b.uuid + '.position', times, v.p),
      new T.QuaternionKeyframeTrack(b.uuid + '.quaternion', times, v.q),
      new T.VectorKeyframeTrack(b.uuid + '.scale', times, v.s),
    );
  }
  const clip = new T.AnimationClip(name, end / fps, tracks),
    exportScene = new T.Scene(),
    parent = target.root.parent;
  sample(0);
  exportScene.add(target.root);
  exportScene.userData = { fps, end, source: 'Pose · Manny retarget' };
  try {
    const data = await new GLTFExporter().parseAsync(exportScene, {
      binary: true,
      animations: [clip],
      onlyVisible: true,
    });
    if (!(data instanceof ArrayBuffer)) throw Error('Could not encode target animation.');
    progress(1);
    return new Uint8Array(data);
  } finally {
    target.root.removeFromParent();
    parent?.add(target.root);
  }
}

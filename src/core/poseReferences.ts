import { Matrix4 } from 'three';
import { boneFollowing } from './boneFollowing';
import { IDS, clone, controlParent, evaluate, fromMatrix, matrix, rigLocal } from './model';
import { layerTracks } from './layers';
import { isProp } from './assets';
import type { Project, Track } from './model';

/** A sampled base remains editable in its source clip; these tracks are only
 * a portable evaluation cache. Freeze the evaluated layer stack, including
 * contact spaces, rather than copying whichever layer happens to be active.
 */
export function snapshotPoseTracks(source: Project, frame: number): Project['tracks'] {
  const values = rigLocal(evaluate(source, frame)),
    following = boneFollowing(source, frame),
    identity = new Matrix4().toArray();
  return Object.fromEntries(
    IDS.map((id) => {
      const parent = controlParent(source, id, frame),
        value =
          parent === 'world'
            ? values[id]
            : fromMatrix(matrix(values[parent]).invert().multiply(matrix(values[id])), values[id]);
      const track: Track = {
        keys: [{ ...value, frame: 0 }],
        spaces:
          parent === 'world'
            ? []
            : [{ frame: 0, parent, offset: [...identity], base: [...identity] }],
        interpolation: 'smooth',
      };
      if (following[id]) track.following = [{ ...clone(following[id]!), frame: 0 }];
      return [id, track];
    }),
  ) as Project['tracks'];
}

export function refreshPoseLinks(
  project: Project,
  source: (id: string) => Project | undefined,
  cache = new Map<Project, Map<number, Project['tracks']>>(),
): Project {
  const base = project.layers?.[0];
  if (!base?.poseLinks?.length) return project;
  let tracks = layerTracks(project, base),
    changed = false;
  for (const link of base.poseLinks) {
    const pose = source(link.clipId);
    if (!pose) continue;
    const controls = link.controls ?? IDS;
    // Weapon-part poses are shared by first- and third-person clips. Their
    // sampled parent-local transforms do not inherit the source character pose.
    if (pose.editing !== project.editing && !controls.every(isProp))
      throw Error('A character base pose must use the same rig view as its animation.');
    const frame = Math.min(pose.end, link.frame),
      samples = cache.get(pose) ?? new Map<number, Project['tracks']>();
    cache.set(pose, samples);
    let sampled = samples.get(frame);
    if (!sampled) {
      sampled = snapshotPoseTracks(pose, frame);
      samples.set(frame, sampled);
    }
    for (const id of controls) {
      if (!sampled[id] || JSON.stringify(tracks[id]) === JSON.stringify(sampled[id])) continue;
      if (!changed) {
        tracks = { ...tracks };
        changed = true;
      }
      tracks[id] = clone(sampled[id]);
    }
  }
  if (!changed) return project;
  return {
    ...project,
    layers: project.layers!.map((l, i) => (i ? l : { ...l, tracks })),
    ...(project.activeLayerId === base.id ? { tracks } : {}),
  };
}

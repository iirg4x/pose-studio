import { clone } from './model';
import type { ControlId, Project } from './model';
// Pose edits own only these tracks. Reference rigs, source actions and untouched
// tracks retain identity so a pointer move never copies the whole document.
export function copyPoseTracks(project: Project, ids: Iterable<ControlId>): Project {
  const tracks = { ...project.tracks };
  for (const id of new Set(ids)) tracks[id] = clone(tracks[id]);
  return {
    ...project,
    tracks,
    layers: project.layers?.map((layer) => ({
      ...layer,
      tracks: layer.id === project.activeLayerId ? tracks : layer.tracks,
    })),
  };
}

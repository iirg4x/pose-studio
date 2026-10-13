import type { Project } from './model';
import type { AnimationLibrary } from './library';
function content(project: Project): Project {
  const p = { ...project };
  if (project.layers) {
    p.layers = project.layers.map((l) =>
      l.id === project.activeLayerId ? { ...l, tracks: project.tracks } : l,
    );
    const base = p.layers[0];
    if (base.poseLinks?.length) {
      const linked = new Set(
        base.poseLinks.flatMap((link) => link.controls ?? Object.keys(base.tracks)),
      );
      p.layers[0] = {
        ...base,
        tracks: Object.fromEntries(
          Object.entries(base.tracks).filter(([id]) => !linked.has(id)),
        ) as Project['tracks'],
      };
    }
    p.tracks = p.layers[0].tracks;
    delete p.activeLayerId;
  }
  if (p.bodyBase) p.bodyBase = { ...p.bodyBase, source: content(p.bodyBase.source) };
  return p;
}
// Hash one clip at a time: a large library must not allocate another complete JSON copy.
function digest(text: string) {
  let a = 0x811c9dc5,
    b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822519);
  }
  return (a >>> 0).toString(16) + ':' + (b >>> 0).toString(16) + ':' + text.length;
}
// Playback, selection, tabs and active-layer changes are view state, not edits.
const prefix = 'pose-save-v3:';
function signatureParts(data: AnimationLibrary) {
  const clips = data.clips
    .map(
      (c) =>
        [
          c.id,
          digest(
            JSON.stringify({
              id: c.id,
              folder: c.folder,
              previewId: c.previewId,
              previewSync: c.previewSync,
              project: content(c.project),
              drafts: c.drafts,
              ...(Object.keys(c.drafts).length ? { draftFrame: c.frame } : {}),
            }),
          ),
        ] as [string, string],
    )
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    meta: digest(
      JSON.stringify({
        version: data.version,
        rig: data.rig,
        name: data.name,
        poses: data.poses,
        characters: data.characters,
      }),
    ),
    clips,
  };
}
export function projectSaveSignature(data: AnimationLibrary): string {
  return prefix + JSON.stringify(signatureParts(data));
}

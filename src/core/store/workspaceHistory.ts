import type { AnimationLibrary } from '../library';
import { clone } from '../model';
import type { ControlId, Pose, Project } from '../model';
import type { TimelineKey } from '../timelineKeys';

/**
 * A workspace edit has more state than the active Project history can hold.
 * Keep the active clip and every per-clip history together so restoring a
 * library deletion cannot silently drop a clip's previous undo entries.
 */
export interface WorkspaceHistoryState {
  workspace: AnimationLibrary;
  project: Project;
  frame: number;
  selected: ControlId;
  selection: ControlId[];
  drafts: Partial<Record<ControlId, Pose>>;
  playing: boolean;
  timelineSelection: TimelineKey[];
  past: Project[];
  future: Project[];
  histories: Array<[string, { past: Project[]; future: Project[] }]>;
}

export interface WorkspaceHistoryEntry {
  before: WorkspaceHistoryState;
  after: WorkspaceHistoryState;
}

/**
 * Ignore tab/playhead and preview-character navigation when deciding whether
 * a deletion is still the latest workspace edit. Those fields are deliberately
 * not undoable in this store. Project contents and library relationships remain
 * significant, including character assets themselves.
 */
function editableWorkspace(workspace: AnimationLibrary) {
  return {
    version: workspace.version,
    rig: workspace.rig,
    name: workspace.name,
    characters: clone(workspace.characters),
    poses: clone(workspace.poses),
    clips: workspace.clips.map((clip) => ({
      id: clip.id,
      project: clone(clip.project),
      previewSync: clip.previewSync,
      folder: clone(clip.folder),
      previewId: clip.previewId,
    })),
  };
}

export function sameEditableWorkspace(a: AnimationLibrary, b: AnimationLibrary) {
  return JSON.stringify(editableWorkspace(a)) === JSON.stringify(editableWorkspace(b));
}

/** Navigation may move between tabs while a same-clip-set workspace edit is undoable. */
export function sameWorkspaceClipIds(a: AnimationLibrary, b: AnimationLibrary) {
  if (a.clips.length !== b.clips.length) return false;
  const ids = new Set(a.clips.map((clip) => clip.id));
  return b.clips.every((clip) => ids.has(clip.id));
}

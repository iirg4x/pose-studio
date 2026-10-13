import { DisplayClock } from '../displayClock';
import { isTouch } from '../../platform/storage';
import type { TimelineFilter } from '../timelineChannels';
import type { FootPivot } from '../../scene/footControls';
import { mirrorDriver, preserveMirrorTargets } from '../liveMirror';
import { curveLockViolation } from '../curveLocks';
import { hydratePropTracks } from '../assets';
import type { TransformOrientation, TransformPivot } from '../../scene/transformOptions';
import { activeAnimationLayer, syncLayers, editLayerAllowed } from '../layers';
import {
  visibleControls,
  controlLabel,
  controlParent,
  clone,
  forLayer,
  createProject,
  evaluate,
  controlEnabled,
} from '../model';
import type { ControlId, RigLayer, Pose, Project } from '../model';
import { library, refreshBases } from '../library';
import type { AnimationLibrary, PoseStamp } from '../library';
import { closeCurveLoop } from '../curves';
import type { CurveKey, Modifier } from '../curves';
import { loopRange } from '../loops';
import type { TimelineKey, KeyClipboard } from '../timelineKeys';

export interface StudioState {
  footPivot: FootPivot;
  multiSelect: boolean;
  boxSelection: null | 'replace' | 'add' | 'subtract';
  interacting: boolean;
  /** Timeline rows: every animated control, or only the selection. */
  timelineFilter: TimelineFilter;
  retargetMode: boolean;
  retargetRest: boolean;
  retargetCompare: boolean;
  retargetLoading: boolean;
  retargetError: string;
  retargetBones: string[];
  retargetMeshes: string[];
  gameView: boolean;
  playerView: boolean;
  cameraPreview: boolean;
  cinematic: boolean;
  transformSpace: TransformOrientation;
  transformPivot: TransformPivot;
  cursorPosition: [number, number, number];
  timelineSelection: TimelineKey[];
  keyClipboard: KeyClipboard | null;
  keyframeMenu: { x: number; y: number } | null;
  selection: ControlId[];
  hiddenControls: Record<RigLayer, ControlId[]>;
  curveClipboard: CurveKey[] | null;
  modifierClipboard: { modifiers: Modifier[]; source: string; unit: string } | null;
  playbackSeek: number;
  workspace: AnimationLibrary | null;
  clipboard: PoseStamp | null;
  project: Project | null;
  frame: number;
  selected: ControlId;
  playing: boolean;
  autoKey: boolean;
  mode: 'select' | 'translate' | 'rotate';
  tab: 'timeline' | 'curves';
  drafts: Partial<Record<ControlId, Pose>>;
  revision: number;
  message: string;
  ready: boolean;
}
/** State, subscriptions, batching, undo history, gestures and snapshots. */
export abstract class StoreCore {
  readonly displayClock = new DisplayClock();
  state: StudioState = {
    footPivot: 'ankle',
    multiSelect: false,
    boxSelection: null,
    interacting: false,
    timelineFilter: isTouch ? 'selected' : 'animated',
    retargetMode: false,
    retargetRest: false,
    retargetCompare: false,
    retargetLoading: false,
    retargetError: '',
    retargetBones: [],
    retargetMeshes: [],
    gameView: false,
    playerView: false,
    cameraPreview: false,
    cinematic: true,
    transformSpace: 'world',
    transformPivot: 'median',
    cursorPosition: [0, 0, 0],
    timelineSelection: [],
    keyClipboard: null,
    keyframeMenu: null,
    selection: ['hand_l'],
    hiddenControls: { firstPerson: [], body: [] },
    curveClipboard: null,
    modifierClipboard: null,
    playbackSeek: 0,
    workspace: null,
    clipboard: null,
    project: null,
    frame: 0,
    selected: 'hand_l',
    playing: false,
    autoKey: true,
    mode: 'translate',
    tab: 'timeline',
    drafts: {},
    revision: 0,
    message: 'Loading Manny…',
    ready: false,
  };
  protected hydrateAssets() {
    hydratePropTracks(this.resetProject);
    if (this.state.project) hydratePropTracks(this.state.project);
    if (this.state.workspace)
      for (const c of this.state.workspace.clips) hydratePropTracks(c.project);
    for (const p of [
      ...this.past,
      ...this.future,
      ...[...this.histories.values()].flatMap((h) => [...h.past, ...h.future]),
    ])
      hydratePropTracks(p);
  }
  protected resetProject = createProject({}, false);
  restPose?: (
    id: ControlId,
    kind: 'location' | 'rotation' | 'all',
    project: Project,
    frame: number,
    drafts: Partial<Record<ControlId, Pose>>,
  ) => Pose | undefined;
  protected histories = new Map<string, { past: Project[]; future: Project[] }>();
  protected batchDepth = 0;
  protected notificationPending = false;
  protected listeners = new Set<() => void>();
  protected past: Project[] = [];
  protected future: Project[] = [];
  protected gesture: Project | null = null;
  protected gestureChanged = false;
  protected gestureFrame: number | null = null;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  protected notify() {
    if (this.batchDepth) {
      this.notificationPending = true;
      return;
    }
    for (const fn of this.listeners) fn();
  }
  batch<T>(change: () => T): T {
    this.batchDepth++;
    try {
      return change();
    } finally {
      if (--this.batchDepth === 0 && this.notificationPending) {
        this.notificationPending = false;
        this.notify();
      }
    }
  }
  patch(p: Partial<StudioState>) {
    if (p.selected && !p.selection) p.selection = [p.selected];
    this.state = { ...this.state, ...p };
    this.notify();
  }
  /** Independent editable copy for external callers. Saving uses the shared read-only view. */
  snapshot(): AnimationLibrary | null {
    const data = this.workspaceSnapshot();
    return data ? clone(data) : null;
  }
  /** Stable by copy-on-write; consumers must not mutate inactive clip data. */
  documentSnapshot(): AnimationLibrary | null {
    return this.workspaceSnapshot();
  }
  // Recovery writes only changed clips; inactive animation data retains its identity.
  recoverySnapshot(): AnimationLibrary | null {
    const { workspace, project, frame, selected, drafts } = this.state;
    if (!project) return null;
    syncLayers(project);
    const data = workspace ?? library(project);
    return {
      ...data,
      clips: data.clips.map((c) =>
        c.id === data.activeId ? { ...c, project, frame, selected, drafts } : c,
      ),
    };
  }
  protected workspaceSnapshot(): AnimationLibrary | null {
    if (this.state.project) syncLayers(this.state.project);
    const { workspace, project, frame, selected, drafts } = this.state;
    if (!project) return null;
    const data = workspace
      ? {
          ...workspace,
          openIds: [...workspace.openIds],
          poses: clone(workspace.poses),
          characters: clone(workspace.characters),
          clips: workspace.clips.map((c) => ({
            ...c,
            project: {
              ...c.project,
              ...(c.project.bodyBase ? { bodyBase: { ...c.project.bodyBase } } : {}),
            },
          })),
        }
      : library(project);
    const active = data.clips.find((c) => c.id === data.activeId)!;
    Object.assign(active, { project: clone(project), frame, selected, drafts: clone(drafts) });
    return refreshBases(data);
  }
  canEditLayer(id?: ControlId) {
    const p = this.state.project;
    if (!p || editLayerAllowed(p, id)) return true;
    this.patch({
      message:
        id && mirrorDriver(p, id)
          ? 'This control is mirror-linked. Edit ' +
            controlLabel(mirrorDriver(p, id)!.source, p) +
            ' or unlink it.'
          : activeAnimationLayer(p)?.poseLinks?.length
            ? 'Open the linked source pose to update this base in every animation.'
            : 'Enable this layer and its bone mask before editing it.',
    });
    return false;
  }
  commit(project: Project, message?: string) {
    hydratePropTracks(project);
    this.commitTracks(project, message);
  }
  protected commitTracks(project: Project, message?: string) {
    syncLayers(project);
    if (!this.state.project) return;
    preserveMirrorTargets(this.state.project, project);
    const locked = curveLockViolation(this.state.project, project);
    if (locked) {
      this.patch({ message: locked });
      return false;
    }
    if (this.gesture) this.gestureChanged = true;
    if (!this.gesture) {
      this.past.push(clone(this.state.project));
      if (this.past.length > 80) this.past.shift();
    }
    this.future = [];
    this.patch({
      project,
      revision: this.state.revision + 1,
      message: message ?? this.state.message,
    });
  }
  beginGesture() {
    if (this.state.project && !this.gesture) {
      this.gesture = clone(this.state.project);
      this.gestureFrame = this.state.frame;
      this.gestureChanged = false;
      this.patch({ interacting: true });
    }
  }
  endGesture() {
    if (this.gesture && this.gestureChanged) {
      this.past.push(this.gesture);
      if (this.past.length > 80) this.past.shift();
    }
    this.gesture = null;
    this.gestureFrame = null;
    this.gestureChanged = false;
    if (this.state.interacting) this.patch({ interacting: false });
  }
  cancelGesture() {
    const project = this.gesture;
    this.gesture = null;
    this.gestureFrame = null;
    this.gestureChanged = false;
    if (project) this.patch({ project, revision: this.state.revision + 1, interacting: false });
  }
  protected saveControlVisibility(hiddenControls: Record<RigLayer, ControlId[]>) {
    this.patch({ hiddenControls });
    try {
      localStorage.setItem('manny-studio-control-visibility-v1', JSON.stringify(hiddenControls));
    } catch {}
  }
  controlVisible(id: ControlId) {
    const layer = this.state.project?.editing ?? 'firstPerson';
    return (
      visibleControls(layer, this.state.project).includes(id) &&
      !this.state.hiddenControls[layer].includes(id)
    );
  }
  selectedControls() {
    const p = this.state.project;
    return p
      ? this.state.selection.filter(
          (id) => this.controlVisible(id) && controlEnabled(p, id, this.state.frame),
        )
      : [];
  }
  protected liveBase(p: Project) {
    const workspace = this.state.workspace;
    if (!workspace) return p;
    const data = refreshBases({
      ...workspace,
      clips: workspace.clips.map((c) => ({
        ...c,
        project:
          c.id === workspace.activeId
            ? p
            : {
                ...c.project,
                ...(c.project.bodyBase ? { bodyBase: { ...c.project.bodyBase } } : {}),
              },
      })),
    });
    return data.clips.find((c) => c.id === workspace.activeId)!.project;
  }
  undo() {
    const p = this.past.pop();
    if (p && this.state.project) {
      this.future.push(clone(this.state.project));
      this.patch({
        project: this.liveBase(forLayer(p, this.state.project.editing)),
        frame: Math.min(this.state.frame, p.end),
        drafts: {},
        revision: this.state.revision + 1,
        message: 'Undone',
      });
    }
  }
  redo() {
    const p = this.future.pop();
    if (p && this.state.project) {
      this.past.push(clone(this.state.project));
      this.patch({
        project: this.liveBase(p),
        frame: Math.min(this.state.frame, p.end),
        drafts: {},
        revision: this.state.revision + 1,
        message: 'Redone',
      });
    }
  }
  setFrame(frame: number, playing = this.state.playing) {
    if (!Number.isFinite(frame)) return;
    const p = this.state.project;
    if (!p) return;
    this.patch({
      frame: Math.max(0, Math.min(p.end, frame)),
      playing,
      playbackSeek: this.state.playbackSeek + 1,
      drafts: {},
      message: Object.keys(this.state.drafts).length
        ? 'Unkeyed preview cleared — enable Auto key to keep edits.'
        : this.state.message,
    });
  }
  poseEditFrame() {
    return this.gestureFrame ?? this.state.frame;
  }
  protected poseEditPlayback() {
    return this.state.autoKey &&
      activeAnimationLayer(this.state.project!)?.kind !== 'pose' &&
      !activeAnimationLayer(this.state.project!)?.static
      ? { playing: false, frame: this.poseEditFrame() }
      : {};
  }
  protected syncModifierLoops(p: Project) {
    const { start, end } = loopRange(p);
    for (const tracks of [p.tracks, p.otherTracks, ...(p.layers ?? []).map((l) => l.tracks)])
      for (const track of Object.values(tracks))
        for (const curve of Object.values(track.curves ?? {})) {
          if (!curve) continue;
          for (const m of curve.modifiers) if (m.loop) m.loop = { start, end };
          if (curve.loop && (curve.loop.start !== start || curve.loop.end !== end))
            closeCurveLoop(curve, start, end);
        }
  }
  updateProject(value: Partial<Pick<Project, 'name' | 'fps' | 'end'>>) {
    if (!this.state.project) return;
    const p = clone(this.state.project);
    Object.assign(p, value);
    if (p.loop && p.loop.end > p.end)
      p.loop = { ...p.loop, start: Math.min(p.loop.start, p.end - 1), end: p.end };
    this.syncModifierLoops(p);
    this.commit(p);
    if (this.state.frame > p.end) this.setFrame(p.end);
  }
  currentPose() {
    const { project, selected, drafts } = this.state,
      frame = this.poseEditFrame();
    return project ? evaluate(project, frame, drafts)[selected] : null;
  }
  parent() {
    const s = this.state;
    return s.project ? controlParent(s.project, s.selected, s.frame) : 'world';
  }
}

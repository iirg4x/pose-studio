import { deleteLibraryAnimation, detachDeletedAnimation } from './deleteAnimation';
import { syncLoopSeam } from './loopInterpolation';
import { DisplayClock } from './displayClock';
import type { FootPivot } from '../scene/footControls';
import {
  mirrorDriver,
  liveMirrorLinks,
  makeMirrorLinks,
  preserveMirrorTargets,
} from './liveMirror';
import type { MirrorLink } from './liveMirror';
import type { MirrorRest } from './mirrorTimeline';
import {
  curveKeyLocked,
  canInsertCurveKey,
  lockControlKeys,
  lockCurveKeys,
  curveLockViolation,
} from './curveLocks';
import { randomId } from './crypto';
import { controllerConstraints, validateControllerConstraints } from './controllerConstraints';
import type { ControllerConstraint } from './controllerConstraints';
import { copyPoseTracks } from './poseEdits';
import { readPreference, readRecovery, RECOVERY, isTouch as isAndroid } from '../platform/storage';
import { blankProject, hydratePropTracks, projectProps } from './assets';
import type { PropAsset } from './assets';
import { registerPropControl } from './controls';
import type { RetargetCharacter } from './retarget';
import type { TransformOrientation, TransformPivot } from '../scene/transformOptions';
import {
  captureControlLayerReference,
  authorLayerPosition,
  activeAnimationLayer,
  addAnimationLayer,
  ensureLayers,
  selectAnimationLayer,
  syncLayers,
  keyingFrame,
  editLayerAllowed,
} from './layers';
import type { AnimationLayer, PoseLink } from './layers';
import { applyKeySettings } from './timelineSettings';
import type { KeySettings } from './timelineSettings';
import { insertChannels, KEYING_SETS } from './keying';
import type { KeyingSet } from './keying';
import { isBlendChannel } from './blendChannels';
import type { BlendChannel } from './blendChannels';
import { blendValue } from './layerBlend';
import { channelsFor, channelValue, CHANNEL_LABELS, channelUnit } from './curves';
import { motionOptions, validateMotionOptions } from './interpolation';
import type { MotionOptions } from './interpolation';
import {
  IDS,
  visibleControls,
  controlLabel,
  controlParent,
  attachmentRest,
  clone,
  forLayer,
  createProject,
  createBodyAction,
  createFirstPersonAction,
  overlayPose,
  evaluate,
  putKey,
  rawForWorld,
  sample,
  switchParent,
  validateProject,
  controlEnabled,
} from './model';
import type { ControlId, RigLayer, Interpolation, ParentId, Pose, Project } from './model';
import {
  applyPose,
  capturePose,
  entry,
  library,
  newId,
  validateLibrary,
  refreshBases,
  sourceWouldCycle,
  mergeHostedLibrary,
} from './library';
import type { AnimationLibrary, PoseStamp } from './library';
import {
  ensureCurve,
  readCurve,
  baseCurve,
  closeCurveLoop,
  explicitLoopCurve,
  modifier,
  sampleCurve,
  validateCurves,
} from './curves';
import type { Channel, Curve, CurveKey, Modifier } from './curves';
import { loopRange, matchLoopEnd } from './loops';
import {
  copyTimelineKeys,
  pasteTimelineKeys,
  moveTimelineKeys,
  deleteTimelineKeys,
  validKeys,
  uniqueKeys,
  keyToken,
} from './timelineKeys';
import type { TimelineKey, KeyClipboard } from './timelineKeys';
export interface StudioState {
  footPivot: FootPivot;
  multiSelect: boolean;
  boxSelection: null | 'replace' | 'add' | 'subtract';
  interacting: boolean;
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
export class StudioStore {
  readonly displayClock = new DisplayClock();
  state: StudioState = {
    footPivot: 'ankle',
    multiSelect: false,
    boxSelection: null,
    interacting: false,
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
  addCharacter(character: RetargetCharacter) {
    const w = this.workspaceSnapshot();
    if (!w) return;
    if ((w.characters?.length ?? 0) >= 8) throw Error('This project supports up to 8 characters.');
    w.characters = [...(w.characters ?? []), character];
    w.activeCharacterId = character.id;
    w.previewCharacterId = character.id;
    this.patch({
      workspace: w,
      retargetRest: false,
      message: 'Character added: ' + character.name,
    });
  }
  selectCharacter(id: string) {
    const w = this.workspaceSnapshot();
    if (!w?.characters?.some((c) => c.id === id)) return;
    w.activeCharacterId = id;
    w.previewCharacterId = id;
    this.patch({ workspace: w });
  }
  selectPreviewCharacter(id: string) {
    const w = this.workspaceSnapshot();
    if (!w || (id && !w.characters?.some((c) => c.id === id))) return;
    w.previewCharacterId = id || undefined;
    if (id) w.activeCharacterId = id;
    this.patch({
      workspace: w,
      retargetRest: false,
      message: 'Preview model: ' + (w.characters?.find((c) => c.id === id)?.name ?? 'Manny'),
    });
  }
  updateCharacter(value: Partial<RetargetCharacter>) {
    const w = this.workspaceSnapshot(),
      c = w?.characters?.find((c) => c.id === w.activeCharacterId);
    if (!w || !c) return;
    Object.assign(c, value);
    this.patch({ workspace: w, message: 'Retarget settings updated' });
  }
  removeCharacter() {
    const w = this.workspaceSnapshot();
    if (!w) return;
    if (w.previewCharacterId === w.activeCharacterId) delete w.previewCharacterId;
    w.characters = w.characters?.filter((c) => c.id !== w.activeCharacterId);
    w.activeCharacterId = w.characters?.[0]?.id;
    this.patch({ workspace: w });
  }
  addImportedAction(project: Project) {
    const workspace = this.workspaceSnapshot();
    if (!workspace) return;
    const next = entry(validateProject(project));
    workspace.clips.push(next);
    this.patch({ workspace });
    this.activate(next.id);
    this.patch({ message: 'Imported ' + project.name });
  }
  addProp(asset: PropAsset) {
    const id = ('prop:' + randomId()) as ControlId;
    registerPropControl(id);
    this.hydrateAssets();
    const p = clone(this.state.project!);
    p.props = { ...projectProps(p), [id]: asset };
    hydratePropTracks(p);
    this.commit(p, 'Added ' + asset.name);
    this.selectControl(id);
    return id;
  }
  configureConstraint(id: ControlId, value: Partial<ControllerConstraint>) {
    const p = this.state.project;
    if (!p) return;
    const next = clone(p);
    next.constraints = {
      ...next.constraints,
      [p.editing]: {
        ...controllerConstraints(p),
        [id]: { ...controllerConstraints(p)[id], ...value },
      },
    };
    validateControllerConstraints(next.constraints);
    this.commit(next, 'Controller limits updated');
  }
  updateProp(id: ControlId, value: Partial<PropAsset>) {
    if (!this.state.project) return;
    const p = clone(this.state.project);
    p.props = clone(projectProps(p));
    if (!p.props[id]) return;
    Object.assign(p.props[id]!, value);
    this.commit(p, 'Prop updated');
  }
  removeProp(id: ControlId) {
    if (!this.state.project) return;
    const p = clone(this.state.project);
    p.props = clone(projectProps(p));
    delete p.props[id];
    this.commit(p, 'Prop removed from this action');
    this.selectControl('root');
  }
  private hydrateAssets() {
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
  setCinematic(value: boolean) {
    this.patch({ cinematic: value });
    try {
      localStorage.setItem('pose-cinematic', String(value));
    } catch {}
  }
  setTransformOptions(
    value: Partial<Pick<StudioState, 'transformSpace' | 'transformPivot' | 'cursorPosition'>>,
  ) {
    this.patch(value);
    try {
      localStorage.setItem(
        'pose-transform-options',
        JSON.stringify({
          transformSpace: this.state.transformSpace,
          transformPivot: this.state.transformPivot,
          cursorPosition: this.state.cursorPosition,
        }),
      );
    } catch {}
  }
  private resetProject = createProject({}, false);
  restPose?: (
    id: ControlId,
    kind: 'location' | 'rotation' | 'all',
    project: Project,
    frame: number,
    drafts: Partial<Record<ControlId, Pose>>,
  ) => Pose | undefined;
  private histories = new Map<string, { past: Project[]; future: Project[] }>();
  private batchDepth = 0;
  private notificationPending = false;
  private listeners = new Set<() => void>();
  private past: Project[] = [];
  private future: Project[] = [];
  private gesture: Project | null = null;
  private gestureChanged = false;
  private gestureFrame: number | null = null;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  private notify() {
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
  init(rest: Partial<Record<ControlId, Pose>>) {
    this.resetProject = createProject(rest, false);
    let workspace = library(blankProject(rest)),
      message = 'Ready · open a project or import assets';
    workspace.name = 'Untitled project';
    try {
      const saved =
        readRecovery() ??
        readPreference(RECOVERY) ??
        localStorage.getItem('manny-studio-project-v1');
      if (saved) {
        workspace = validateLibrary(typeof saved === 'string' ? JSON.parse(saved) : saved);
        message = 'Recovered your animation project';
      }
    } catch {
      message = 'Could not restore autosave; opened a blank project.';
    }
    try {
      const hidden = JSON.parse(localStorage.getItem('manny-studio-control-visibility-v1') ?? '{}');
      this.state.hiddenControls = {
        firstPerson: Array.isArray(hidden.firstPerson)
          ? hidden.firstPerson.filter((id: ControlId) => IDS.includes(id))
          : [],
        body: Array.isArray(hidden.body)
          ? hidden.body.filter((id: ControlId) => IDS.includes(id))
          : [],
      };
    } catch {}
    try {
      const o = JSON.parse(localStorage.getItem('pose-transform-options') ?? '{}');
      if (['world', 'local', 'view'].includes(o.transformSpace))
        this.state.transformSpace = o.transformSpace;
      if (['median', 'active', 'individual', 'bounds', 'cursor'].includes(o.transformPivot))
        this.state.transformPivot = o.transformPivot;
      if (
        Array.isArray(o.cursorPosition) &&
        o.cursorPosition.length === 3 &&
        o.cursorPosition.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
      )
        this.state.cursorPosition = o.cursorPosition;
    } catch {}
    try {
      this.state.cinematic =
        localStorage.getItem('pose-cinematic') === null
          ? !isAndroid
          : localStorage.getItem('pose-cinematic') !== 'false';
    } catch {}
    this.loadWorkspace(workspace, message);
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
  private workspaceSnapshot(): AnimationLibrary | null {
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
  private loadWorkspace(workspace: AnimationLibrary, message: string) {
    this.endGesture();
    this.histories.clear();
    this.past = [];
    this.future = [];
    for (const clip of workspace.clips) hydratePropTracks(clip.project);
    const active = workspace.clips.find((c) => c.id === workspace.activeId)!;
    this.patch({
      timelineSelection: [],
      workspace,
      project: clone(active.project),
      frame: active.frame,
      selected: active.selected,
      drafts: clone(active.drafts),
      playing: false,
      ready: true,
      revision: this.state.revision + 1,
      message,
    });
  }
  openHostedAnimations(input: unknown, activate = true) {
    const incoming = validateLibrary(input),
      current = this.workspaceSnapshot();
    if (!current) return;
    this.batch(() => {
      this.patch({ workspace: mergeHostedLibrary(current, incoming) });
      this.activate(activate ? incoming.activeId : current.activeId);
    });
  }
  activate(id: string) {
    const workspace = this.workspaceSnapshot();
    if (!workspace) return;
    const next = workspace.clips.find((c) => c.id === id);
    if (!next) return;
    hydratePropTracks(next.project);
    this.endGesture();
    this.histories.set(workspace.activeId, { past: this.past, future: this.future });
    workspace.activeId = id;
    if (!workspace.openIds.includes(id)) workspace.openIds.push(id);
    const history = this.histories.get(id);
    this.past = history?.past ?? [];
    this.future = history?.future ?? [];
    this.patch({
      timelineSelection: [],
      workspace,
      project: clone(next.project),
      frame: next.frame,
      playbackSeek: this.state.playbackSeek + 1,
      selected: next.selected,
      drafts: clone(next.drafts),
      revision: this.state.revision + 1,
      message: 'Editing ' + next.project.name,
    });
  }
  closeAnimation(id: string) {
    let workspace = this.workspaceSnapshot();
    if (!workspace) return;
    if (workspace.openIds.length === 1 && workspace.openIds.includes(id)) {
      this.patch({ message: 'Keep one animation open. All animations stay in the library.' });
      return;
    }
    if (workspace.activeId === id) {
      const index = workspace.openIds.indexOf(id),
        next = workspace.openIds[index + 1] ?? workspace.openIds[index - 1];
      this.activate(next);
      workspace = this.workspaceSnapshot()!;
    }
    workspace.openIds = workspace.openIds.filter((key) => key !== id);
    this.patch({ workspace, message: 'Tab closed. Reopen it from Animations.' });
  }
  deleteAnimation(id: string) {
    this.endGesture();
    const before = this.workspaceSnapshot(),
      removed = before?.clips.find((c) => c.id === id);
    if (!before || !removed) return;
    const workspace = deleteLibraryAnimation(before, id, () => blankProject()),
      active = workspace.clips.find((c) => c.id === workspace.activeId)!;
    this.histories.set(before.activeId, { past: this.past, future: this.future });
    this.histories.delete(id);
    for (const history of this.histories.values()) {
      history.past = history.past.map((p) => detachDeletedAnimation(p, id));
      history.future = history.future.map((p) => detachDeletedAnimation(p, id));
    }
    const history = this.histories.get(active.id);
    this.past = history?.past ?? [];
    this.future = history?.future ?? [];
    this.patch({
      workspace,
      project: clone(active.project),
      frame: active.frame,
      selected: active.selected,
      drafts: clone(active.drafts),
      timelineSelection: [],
      revision: this.state.revision + 1,
      playbackSeek: this.state.playbackSeek + 1,
      message: 'Deleted “' + removed.project.name + '” from this project',
    });
  }
  setPreviewTiming(mode: 'time' | 'phase') {
    const w = this.workspaceSnapshot(),
      clip = w?.clips.find((c) => c.id === w.activeId);
    if (!w || !clip) return;
    clip.previewSync = mode;
    this.patch({
      workspace: w,
      message:
        mode === 'phase'
          ? 'Preview timing matches the animation range'
          : 'Preview timing uses elapsed seconds',
    });
  }
  setPreviewAnimation(id: string, previewId?: string) {
    const workspace = this.workspaceSnapshot(),
      clip = workspace?.clips.find((c) => c.id === id);
    if (!workspace || !clip) return;
    const target = previewId ? workspace.clips.find((c) => c.id === previewId) : undefined;
    if (previewId && (!target || target.project.editing === clip.project.editing))
      throw Error('Choose an animation of the other view type.');
    if (clip.previewId === previewId) return;
    clip.previewId = previewId;
    this.patch({
      workspace,
      message: target
        ? 'Preview paired with ' + target.project.name
        : 'Preview uses this animation',
    });
  }
  renameAnimation(id: string, name: string) {
    name = name.trim().slice(0, 100);
    const workspace = this.workspaceSnapshot();
    if (!name || !workspace) return;
    const clip = workspace.clips.find((c) => c.id === id);
    if (!clip || clip.project.name === name) return;
    if (id === workspace.activeId) {
      this.updateProject({ name });
      return;
    }
    const history = this.histories.get(id) ?? { past: [], future: [] };
    history.past.push(clone(clip.project));
    if (history.past.length > 80) history.past.shift();
    history.future = [];
    this.histories.set(id, history);
    clip.project.name = name;
    this.patch({ workspace: refreshBases(workspace), message: 'Renamed animation to ' + name });
  }
  closeOtherAnimations(id: string) {
    if (!this.state.workspace?.clips.some((c) => c.id === id)) return;
    if (this.state.workspace.activeId !== id) this.activate(id);
    const workspace = this.workspaceSnapshot()!;
    workspace.openIds = [id];
    this.patch({ workspace, message: 'Other tabs closed. Animations remain in the library.' });
  }
  addAnimation(rest: Partial<Record<ControlId, Pose>>, demo = false, duplicate = false) {
    const workspace = this.workspaceSnapshot();
    if (!workspace) return;
    const next = entry(duplicate ? this.state.project! : createProject(rest, demo));
    const base = duplicate ? next.project.name + ' copy' : demo ? 'Rifle reload' : 'New animation';
    let name = base,
      n = 2;
    while (workspace.clips.some((c) => c.project.name === name)) name = base + ' ' + n++;
    next.project.name = name;
    if (duplicate) {
      next.previewSync = workspace.clips.find((c) => c.id === workspace.activeId)?.previewSync;
      next.previewId = workspace.clips.find((c) => c.id === workspace.activeId)?.previewId;
      next.frame = this.state.frame;
      next.selected = this.state.selected;
      next.drafts = clone(this.state.drafts);
    }
    workspace.clips.push(next);
    this.patch({ workspace });
    this.activate(next.id);
  }
  importAnimations(input: unknown) {
    const incoming = validateLibrary(input),
      workspace = this.workspaceSnapshot();
    if (!workspace) return;
    if (workspace.poses.length + incoming.poses.length > 200)
      throw Error('Import exceeds the project limit of 200 saved poses.');
    const remap = new Map(incoming.clips.map((c) => [c.id, newId()]));
    const imported = incoming.clips.map((c) => {
      const next = { ...clone(c), id: remap.get(c.id)! };
      if (next.previewId) next.previewId = remap.get(next.previewId);
      if (next.project.bodyBase)
        next.project.bodyBase.sourceId = remap.get(next.project.bodyBase.sourceId) ?? newId();
      for (const layer of next.project.layers ?? [])
        for (const link of layer.poseLinks ?? []) link.clipId = remap.get(link.clipId) ?? newId();
      return next;
    });
    const extra = (incoming.characters ?? []).filter(
      (c) => !(workspace.characters ?? []).some((existing) => existing.asset === c.asset),
    );
    if ((workspace.characters?.length ?? 0) + extra.length > 8)
      throw Error('Import exceeds 8 characters.');
    if (extra.length) {
      workspace.characters = [
        ...(workspace.characters ?? []),
        ...extra.map((c) => ({ ...clone(c), id: newId() })),
      ];
      workspace.activeCharacterId ??= workspace.characters[0].id;
    }
    workspace.clips.push(...imported);
    workspace.poses.push(...incoming.poses.map((p) => ({ ...clone(p), id: newId() })));
    this.patch({ workspace });
    this.activate(imported[0].id);
    this.patch({
      message:
        'Imported ' + imported.length + ' animation(s). Your existing animations are still here.',
    });
  }
  createAction(
    rest: Partial<Record<ControlId, Pose>>,
    name: string,
    type: RigLayer,
    sourceId?: string,
  ) {
    const workspace = this.workspaceSnapshot();
    if (!workspace) return;
    const legacy = sourceId?.startsWith('legacy:')
      ? workspace.clips.find((c) => c.id === sourceId.slice(7))
      : undefined;
    const source = workspace.clips.find((c) => c.id === sourceId);
    if (source && source.project.editing === type)
      throw Error('Choose an animation of the other view type.');
    const project =
      type === 'body' && legacy
        ? clone(forLayer(legacy.project, 'body'))
        : source
          ? type === 'body'
            ? createBodyAction(source.project, source.id)
            : createFirstPersonAction(source.project, source.id)
          : forLayer(blankProject(rest), type);
    if (!source && !legacy) project.props = clone(projectProps(this.state.project));
    project.actionType = type;
    project.name = (name.trim() || 'New animation').slice(0, 100);
    const next = entry(project);
    workspace.clips.push(next);
    this.patch({ workspace });
    this.activate(next.id);
  }
  setBodyBase(sourceId: string) {
    const workspace = this.workspaceSnapshot(),
      p = this.state.project;
    if (!workspace || !p) return;
    const source = workspace.clips.find((c) => c.id === sourceId);
    if (
      !source ||
      source.project.editing === p.editing ||
      sourceWouldCycle(workspace, workspace.activeId, sourceId)
    )
      return;
    // Existing absolute body keys are retained when initially adding a base.
    // A new additive layer is offered through New -> Full body; changing an
    // established base keeps the animator's existing correction keys.
    if (!p.bodyBase) {
      this.patch({
        message: 'Create a new animation with this source to keep existing keys intact.',
      });
      return;
    }
    const next = clone(p),
      link = (
        p.editing === 'body'
          ? createBodyAction(source.project, source.id)
          : createFirstPersonAction(source.project, source.id)
      ).bodyBase!;
    next.bodyBase = {
      ...next.bodyBase!,
      sourceId: link.sourceId,
      source: link.source,
      alignment: link.alignment,
    };
    next.propPreset = source.project.propPreset;
    next.props = { ...clone(projectProps(source.project)), ...clone(projectProps(next)) };
    this.commit(next, 'Source animation changed');
    this.patch({ drafts: {} });
  }
  configureBodyBase(
    value: Partial<Pick<NonNullable<Project['bodyBase']>, 'enabled' | 'excluded'>>,
  ) {
    const p = this.state.project;
    if (!p?.bodyBase) return;
    const next = clone(p);
    Object.assign(next.bodyBase!, value);
    this.commit(next, 'Body inheritance updated');
    this.patch({ drafts: {} });
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
  addLayer(kind: 'pose' | 'additive') {
    const p = this.state.project;
    if (!p || (p.layers?.length ?? 1) >= 32) return;
    this.commit(
      addAnimationLayer(p, kind),
      kind === 'pose'
        ? 'Static body pose layer · edits apply to the whole action'
        : 'Adjustment layer · key your changes on this layer',
    );
    this.patch({ drafts: {}, timelineSelection: [] });
  }
  openPoseSource(link: PoseLink) {
    const source = this.state.workspace?.clips.find((c) => c.id === link.clipId);
    if (!source) {
      this.patch({ message: 'Source pose is not loaded. The saved base pose is still available.' });
      return;
    }
    this.activate(link.clipId);
    this.setFrame(link.frame);
    this.patch({ message: 'Editing shared pose · changes apply to every linked animation' });
  }
  selectLayer(id: string) {
    const p = this.state.project;
    if (!p) return;
    const linked = p.layers?.find((l) => l.id === id)?.poseLinks?.[0];
    if (linked) {
      this.openPoseSource(linked);
      return;
    }
    const next = clone(p);
    for (const [control, value] of Object.entries(this.state.drafts))
      putKey(next.tracks[control as ControlId], keyingFrame(next, this.state.frame), value!);
    selectAnimationLayer(next, id);
    this.patch({
      project: next,
      drafts: {},
      timelineSelection: [],
      message: 'Editing ' + activeAnimationLayer(next)?.name,
    });
  }
  configureLayer(
    id: string,
    value: Partial<
      Pick<
        AnimationLayer,
        'name' | 'enabled' | 'solo' | 'weight' | 'excluded' | 'contacts' | 'space' | 'spaces'
      >
    >,
  ) {
    const p = this.state.project;
    if (!p) return;
    const next = ensureLayers(clone(p)),
      layer = next.layers!.find((l) => l.id === id);
    if (!layer || (layer.kind === 'base' && Object.keys(value).some((k) => k !== 'name'))) return;
    if (value.name !== undefined) value.name = value.name.trim().slice(0, 100) || layer.name;
    if (
      Object.entries(value).every(
        ([k, v]) => JSON.stringify(layer[k as keyof AnimationLayer]) === JSON.stringify(v),
      )
    )
      return;
    Object.assign(layer, value);
    this.commit(next, 'Layer updated');
  }
  setControlLayerSetting(
    channel: BlendChannel,
    value: number,
    animated: boolean,
    transition = 0,
    easing: 'bezier' | 'linear' | 'step' = 'bezier',
    ids = this.selectedControls(),
  ) {
    const source = this.state.project,
      layer = source && activeAnimationLayer(source);
    if (!source || !layer || layer.kind === 'base' || !Number.isFinite(value)) return;
    const p = clone(source),
      frame = Math.round(this.state.frame),
      end = Math.min(p.end, frame + Math.max(0, Math.round(transition)));
    for (const id of ids) {
      captureControlLayerReference(p, id, frame);
      const track = p.tracks[id],
        current = blendValue(track, channel, frame),
        curve = ensureCurve(track, channel);
      const key = (at: number, v: number): CurveKey => ({
        frame: at,
        value: Math.max(0, Math.min(100, v)),
        interpolation: easing,
        handle: 'flat',
      });
      if (!animated) {
        curve.keys = [key(0, value)];
        curve.modifiers = [];
        delete curve.loop;
      } else if (end > frame) {
        curve.keys = curve.keys
          .filter((k) => k.frame < frame || k.frame > end)
          .concat(key(frame, current), key(end, value))
          .sort((a, b) => a.frame - b.frame);
        delete curve.loop;
      } else {
        curve.keys = curve.keys
          .filter((k) => k.frame !== frame)
          .concat(key(frame, value))
          .sort((a, b) => a.frame - b.frame);
        if (curve.loop) syncLoopSeam(curve);
      }
      validateCurves(track);
    }
    this.commit(
      p,
      animated
        ? end > frame
          ? 'Layer blend transition · frames ' + frame + '–' + end
          : 'Layer blend keyed at frame ' + frame
        : 'Layer blend updated',
    );
    this.patch({ drafts: {} });
  }
  keyControlLayerSettings(ids = this.selectedControls()) {
    const p = this.state.project;
    if (!p) return;
    this.beginGesture();
    for (const channel of [
      'blendWeight',
      ...(['px', 'py', 'pz', 'rx', 'ry', 'rz'] as const).flatMap((axis) => [
        'blendWeight_' + axis,
        'blendReplace_' + axis,
      ]),
    ] as BlendChannel[])
      for (const id of ids)
        this.setControlLayerSetting(
          channel,
          blendValue(p.tracks[id], channel, this.state.frame),
          true,
          0,
          'bezier',
          [id],
        );
    this.endGesture();
  }
  recaptureLayerReference(ids = this.selectedControls()) {
    const p = this.state.project;
    if (!p || activeAnimationLayer(p)?.kind === 'base') return;
    const next = clone(p);
    for (const id of ids) {
      delete next.tracks[id].layerReference;
      captureControlLayerReference(next, id, this.state.frame);
    }
    this.commit(next, 'Replacement pose captured at frame ' + this.state.frame);
  }
  moveLayer(id: string, direction: -1 | 1) {
    const p = this.state.project;
    if (!p?.layers) return;
    const next = clone(p),
      i = next.layers!.findIndex((l) => l.id === id),
      j = i + direction;
    if (i < 1 || j < 1 || j >= next.layers!.length) return;
    [next.layers![i], next.layers![j]] = [next.layers![j], next.layers![i]];
    this.commit(next, 'Layer order updated');
  }
  removeLayer(id: string) {
    const p = this.state.project;
    if (!p?.layers || p.layers[0].id === id) return;
    const next = clone(p),
      i = next.layers!.findIndex((l) => l.id === id);
    if (i < 1) return;
    syncLayers(next);
    next.layers!.splice(i, 1);
    if (next.activeLayerId === id) selectAnimationLayer(next, next.layers![Math.max(0, i - 1)].id);
    this.commit(next, 'Layer removed');
    this.patch({ drafts: {}, timelineSelection: [] });
  }
  duplicateLayer(id: string) {
    const p = this.state.project;
    if (!p?.layers || p.layers.length >= 32) return;
    const next = syncLayers(clone(p)),
      i = next.layers!.findIndex((l) => l.id === id);
    if (i < 1) return;
    const layer = {
      ...clone(next.layers![i]),
      id: newId(),
      name: next.layers![i].name + ' copy',
      solo: false,
    };
    next.layers!.splice(i + 1, 0, layer);
    selectAnimationLayer(next, layer.id);
    this.commit(next, 'Layer duplicated');
    this.patch({ drafts: {}, timelineSelection: [] });
  }
  copyPose(scope: 'control' | 'rig' = 'rig') {
    const s = this.state;
    if (!s.project) return;
    this.patch({
      clipboard: capturePose(s.project, s.frame, s.drafts, scope, s.selected),
      message:
        scope === 'rig'
          ? 'Rig pose copied, including props. Paste it into any animation.'
          : 'Control pose copied.',
    });
  }
  copySelectedPose() {
    const s = this.state,
      p = s.project,
      ids = this.selectedControls();
    if (!p || !ids.length) return;
    if (ids.length === 1) {
      this.copyPose('control');
      return;
    }
    const stamp = capturePose(p, s.frame, s.drafts, 'rig', s.selected),
      values = evaluate(p, s.frame, s.drafts);
    stamp.poses = Object.fromEntries(ids.map((id) => [id, clone(values[id])]));
    delete stamp.modes;
    this.patch({ clipboard: stamp, message: 'Copied ' + ids.length + ' selected controls' });
  }
  pastePose(stamp = this.state.clipboard, respectAutoKey = false) {
    const s = this.state;
    if (!s.project || !stamp || !this.canEditLayer()) return;
    if (stamp.scope === 'rig' && stamp.layer !== s.project.editing) {
      this.patch({
        message:
          'Switch to ' +
          (stamp.layer === 'firstPerson' ? 'First person' : 'Full body') +
          ' to paste this rig pose.',
      });
      return;
    }
    const desired =
      stamp.scope === 'control' ? { [s.selected]: Object.values(stamp.poses)[0] } : stamp.poses;
    const poses = Object.fromEntries(
      Object.entries(desired).filter(([id]) => editLayerAllowed(s.project!, id as ControlId)),
    );
    if (!Object.keys(poses).length) return;
    const next = applyPose(
      s.project,
      s.frame,
      { ...stamp, scope: 'rig', poses },
      s.selected,
      s.drafts,
    );
    if (respectAutoKey && !s.autoKey) {
      const drafts = { ...s.drafts };
      for (const id of Object.keys(poses) as ControlId[])
        drafts[id] = sample(next.tracks[id], keyingFrame(next, s.frame));
      this.patch({ drafts, message: 'Pasted pose · unkeyed preview' });
    } else {
      this.commit(next, 'Pasted and keyed pose at frame ' + keyingFrame(next, s.frame));
      this.patch({ drafts: {}, ...this.poseEditPlayback() });
    }
  }
  savePose(name: string, scope: 'control' | 'rig' = 'rig') {
    const workspace = this.workspaceSnapshot(),
      s = this.state;
    if (!workspace || !s.project || !name.trim()) return;
    if (workspace.poses.length >= 200) {
      this.patch({ message: 'This project supports up to 200 saved poses.' });
      return;
    }
    const stamp = capturePose(s.project, s.frame, s.drafts, scope, s.selected);
    stamp.name = name.trim().slice(0, 100);
    workspace.poses.push(stamp);
    this.patch({ workspace, message: 'Saved pose “' + stamp.name + '” in this project.' });
  }
  removePose(id: string) {
    const workspace = this.workspaceSnapshot();
    if (!workspace) return;
    workspace.poses = workspace.poses.filter((p) => p.id !== id);
    this.patch({ workspace, message: 'Saved pose removed.' });
  }
  setTimelineKeySettings(settings: KeySettings) {
    const p = this.state.project;
    if (!p) return;
    const selection = validKeys(p, this.state.timelineSelection);
    if (selection.length)
      this.commit(
        applyKeySettings(p, selection, settings),
        'Updated ' + selection.length + ' selected key(s)',
      );
  }
  renameWorkspace(name: string) {
    const workspace = this.workspaceSnapshot();
    if (!workspace) return;
    workspace.name = name.slice(0, 100);
    this.patch({ workspace });
  }
  commit(project: Project, message?: string) {
    hydratePropTracks(project);
    this.commitTracks(project, message);
  }
  private commitTracks(project: Project, message?: string) {
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
  private saveControlVisibility(hiddenControls: Record<RigLayer, ControlId[]>) {
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
  setControlVisible(id: ControlId, visible: boolean) {
    const layer = this.state.project?.editing ?? 'firstPerson';
    const hidden = this.state.hiddenControls[layer].filter((x) => x !== id);
    if (!visible) hidden.push(id);
    this.saveControlVisibility({ ...this.state.hiddenControls, [layer]: hidden });
  }
  showControls(visible: boolean) {
    const layer = this.state.project?.editing ?? 'firstPerson';
    this.saveControlVisibility({
      ...this.state.hiddenControls,
      [layer]: visible ? [] : visibleControls(layer, this.state.project),
    });
  }
  selectControl(id: ControlId, extend = false) {
    if (
      this.state.project &&
      !controlEnabled(this.state.project, id, this.state.frame) &&
      typeof window !== 'undefined'
    )
      window.dispatchEvent(new CustomEvent('pose-activate-control', { detail: id }));
    this.setControlVisible(id, true);
    const selection = extend
      ? this.state.selection.includes(id)
        ? this.state.selection.filter((x) => x !== id)
        : [...this.state.selection, id]
      : [id];
    this.patch({ selected: selection.at(-1) ?? id, selection, timelineSelection: [] });
  }
  selectedControls() {
    const p = this.state.project;
    return p
      ? this.state.selection.filter(
          (id) => this.controlVisible(id) && controlEnabled(p, id, this.state.frame),
        )
      : [];
  }
  selectAll() {
    const p = this.state.project;
    if (!p) return;
    const selection = visibleControls(p.editing, p).filter(
      (id) => this.controlVisible(id) && controlEnabled(p, id, this.state.frame),
    );
    this.patch({ selection, message: selection.length + ' controls selected' });
  }
  deselectAll() {
    this.patch({ selection: [], message: 'Selection cleared' });
  }
  invertSelection() {
    const p = this.state.project;
    if (!p) return;
    const selection = visibleControls(p.editing, p).filter(
      (id) =>
        this.controlVisible(id) &&
        controlEnabled(p, id, this.state.frame) &&
        !this.state.selection.includes(id),
    );
    this.patch({ selection, selected: selection.at(-1) ?? this.state.selected });
  }
  hideSelected(others = false) {
    const p = this.state.project;
    if (!p) return;
    const ids = visibleControls(p.editing, p).filter((id) =>
      others ? !this.state.selection.includes(id) : this.state.selection.includes(id),
    );
    this.saveControlVisibility({
      ...this.state.hiddenControls,
      [p.editing]: Array.from(new Set([...this.state.hiddenControls[p.editing], ...ids])),
    });
  }
  resetSelected(kind: 'location' | 'rotation' | 'all') {
    const s = this.state;
    if (!s.project || !this.canEditLayer()) return;
    const ids = this.selectedControls().filter((id) => editLayerAllowed(s.project!, id));
    if (!ids.length) return;
    const next = clone(s.project),
      defaults = forLayer(this.resetProject, s.project.editing),
      drafts = { ...s.drafts };
    let changed = 0;
    // World-space rest targets are solved against current parents, so selected
    // parents (and root, which carries every body control) must settle first.
    const depth = (id: ControlId) => {
      if (id === 'root') return -1;
      let n = 0;
      for (let at: string = id, seen = new Set<string>(); at !== 'world' && !seen.has(at); n++) {
        seen.add(at);
        at = controlParent(next, at as ControlId, s.frame);
      }
      return n;
    };
    ids.sort((a, b) => depth(a) - depth(b));
    for (const id of ids) {
      const raw = clone(drafts[id] ?? sample(next.tracks[id], keyingFrame(next, s.frame))),
        resolved = this.restPose?.(id, kind, next, s.frame, drafts),
        rest =
          resolved ??
          (next.bodyBase ||
          (activeAnimationLayer(next)?.kind !== 'base' && !!next.layers) ||
          next.tracks[id].basis
            ? overlayPose()
            : (attachmentRest(next.tracks[id], keyingFrame(next, s.frame), raw) ??
              defaults.tracks[id]?.keys[0] ??
              overlayPose()));
      const location =
          (resolved || kind !== 'rotation') && raw.p.some((v, i) => Math.abs(v - rest.p[i]) > 1e-8),
        rotation =
          (resolved || kind !== 'location') &&
          Math.abs(raw.q.reduce((sum, v, i) => sum + v * rest.q[i], 0)) < 1 - 1e-10;
      if (!location && !rotation) continue;
      if (resolved || kind !== 'rotation') raw.p = clone(rest.p);
      if (resolved || kind !== 'location') raw.q = clone(rest.q);
      if (resolved?.layerPosition !== undefined) raw.layerPosition = resolved.layerPosition;
      if (s.autoKey) {
        putKey(next.tracks[id], keyingFrame(next, s.frame), raw);
        delete drafts[id];
      } else drafts[id] = raw;
      changed++;
    }
    // Reset is a one-shot command. Repeating it must not toggle the pose, add
    // empty undo entries, create keys, or interrupt playback at an unchanged pose.
    if (!changed) {
      this.patch({ message: 'Selected controllers are already at rest ' + kind });
      return;
    }
    if (s.autoKey) this.commit(next);
    this.patch({
      drafts,
      ...this.poseEditPlayback(),
      message:
        'Reset ' +
        kind +
        ' on ' +
        changed +
        ' selected control(s)' +
        (s.autoKey ? '' : ' · unkeyed preview'),
    });
  }
  showKeyframeMenu(x = innerWidth * 0.5, y = innerHeight * 0.35) {
    this.patch({ keyframeMenu: { x, y } });
  }
  insertKeyingSet(set: KeyingSet) {
    const s = this.state;
    if (!s.project) return;
    const ids =
      set === 'whole'
        ? visibleControls(s.project.editing, s.project).filter(
            (id) => controlEnabled(s.project!, id, s.frame) && id !== 'camera',
          )
        : this.selectedControls();
    const next = clone(s.project),
      drafts = { ...s.drafts };
    let count = 0;
    for (const id of ids) {
      if (!editLayerAllowed(next, id)) continue;
      const value = drafts[id] ?? sample(next.tracks[id], s.frame);
      if (!insertChannels(next.tracks[id], id, keyingFrame(next, s.frame), value, set)) continue;
      count++;
      const actual = sample(next.tracks[id], s.frame);
      if (
        channelsFor(id, next.tracks[id]).every(
          (c) =>
            Math.abs(
              channelValue(value, c, next.tracks[id].rotationOrder) -
                channelValue(actual, c, next.tracks[id].rotationOrder),
            ) < 1e-5,
        )
      )
        delete drafts[id];
    }
    if (count)
      this.commit(
        next,
        'Inserted ' +
          KEYING_SETS.find((k) => k.id === set)!.label +
          ' keys on ' +
          count +
          ' control(s)',
      );
    this.patch({
      drafts,
      keyframeMenu: null,
      ...(!count
        ? {
            message:
              set === 'available'
                ? 'No existing animation channels on the selected controls.'
                : 'Select controls with channels to key.',
          }
        : {}),
    });
  }
  keySelected(ids = this.selectedControls()) {
    const p = this.state.project;
    if (!p || !ids.length || !this.canEditLayer()) return;
    const next = clone(p),
      drafts = { ...this.state.drafts };
    for (const id of ids) {
      if (!editLayerAllowed(next, id)) continue;
      putKey(
        next.tracks[id],
        keyingFrame(next, this.state.frame),
        drafts[id] ?? sample(next.tracks[id], this.state.frame),
      );
      delete drafts[id];
    }
    this.commit(next, 'Keyed ' + ids.length + ' selected control(s)');
    this.patch({ drafts });
  }
  setLayer(layer: RigLayer) {
    if (
      !this.state.project ||
      this.state.project.editing === layer ||
      this.state.project.actionType
    )
      return;
    this.patch({
      timelineSelection: [],
      project: forLayer(this.state.project, layer),
      drafts: {},
      selected: 'hand_l',
      message:
        layer === 'firstPerson'
          ? 'Floating arms · camera-relative animation'
          : 'Full body · third person, legs, and world shadows',
    });
  }
  private liveBase(p: Project) {
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
  // Static layers and unkeyed previews stay live; only timed controller keys pause.
  private poseKeyBlocked(id: ControlId, value: Pose) {
    const p = this.state.project!;
    if (!this.state.autoKey) return false;
    const frame = keyingFrame(p, this.poseEditFrame()),
      track = p.tracks[id],
      prior = sample(track, frame),
      changed = channelsFor(id, track).filter(
        (c) =>
          Math.abs(
            channelValue(value, c, track.rotationOrder) -
              channelValue(prior, c, track.rotationOrder),
          ) > 1e-7,
      );
    if (changed.length && changed.every((c) => !canInsertCurveKey(track, c, frame))) {
      this.patch({
        message:
          'New keys are locked here. Move to an existing key to edit it, or unlock the curve.',
      });
      return true;
    }
    return false;
  }
  private poseChanged(id: ControlId, value: Pose) {
    const p = this.state.project!,
      prior = this.state.drafts[id] ?? sample(p.tracks[id], keyingFrame(p, this.poseEditFrame()));
    return (
      !!value.layerPosition !== !!prior.layerPosition ||
      [...value.p, ...value.q, ...value.grip, value.fov].some(
        (v, i) => Math.abs(v - [...prior.p, ...prior.q, ...prior.grip, prior.fov][i]) > 1e-8,
      )
    );
  }
  poseGestureChanged() {
    return this.gestureChanged;
  }
  poseEditFrame() {
    return this.gestureFrame ?? this.state.frame;
  }
  private poseEditPlayback() {
    return this.state.autoKey &&
      activeAnimationLayer(this.state.project!)?.kind !== 'pose' &&
      !activeAnimationLayer(this.state.project!)?.static
      ? { playing: false, frame: this.poseEditFrame() }
      : {};
  }
  setCameraMotion(enabled: boolean) {
    const p = this.state.project;
    if (p?.cameraBinding && p.cameraBinding.enabled !== enabled)
      this.commit(
        { ...p, cameraBinding: { ...p.cameraBinding, enabled } },
        enabled ? 'Source camera motion enabled' : 'Source camera motion disabled',
      );
  }
  editCameraFov(fov: number) {
    const original = this.state.project;
    if (!original || !Number.isFinite(fov)) return;
    const camera = evaluate(original, this.poseEditFrame(), this.state.drafts).camera;
    fov = Math.max(20, Math.min(120, fov));
    if (Math.abs(camera.fov - fov) < 1e-8) return;
    if (this.state.selected !== 'camera' || this.state.selection.length !== 1)
      this.selectControl('camera');
    // FOV is a direct camera edit: an implicit camera mask must not silently eat it.
    if (!editLayerAllowed(original, 'camera')) {
      let next = clone(original),
        layer = activeAnimationLayer(next);
      if (layer && editLayerAllowed(original) && layer.excluded.includes('camera'))
        layer.excluded = layer.excluded.filter((id) => id !== 'camera');
      else {
        next = addAnimationLayer(next, 'additive');
        layer = activeAnimationLayer(next)!;
        layer.name = 'Camera';
        layer.excluded = IDS.filter((id) => id !== 'camera');
        if (next.layers!.some((l) => l.solo && l.enabled)) layer.solo = true;
      }
      this.commit(next, 'Camera enabled for editing');
    }
    this.editWorld('camera', { ...camera, fov });
  }
  editWorld(id: ControlId, value: Pose) {
    const p = this.state.project;
    if (!p || !this.canEditLayer(id)) return;
    const raw = rawForWorld(p, id, this.poseEditFrame(), value, this.state.drafts);
    if (!this.poseChanged(id, raw) || this.poseKeyBlocked(id, raw)) return;
    if (this.state.autoKey) {
      const next = copyPoseTracks(p, [id]);
      putKey(next.tracks[id], keyingFrame(next, this.poseEditFrame()), raw);
      this.commitTracks(next);
      this.patch({ drafts: {}, ...this.poseEditPlayback() });
    } else
      this.patch({
        drafts: { ...this.state.drafts, [id]: raw },
        message: 'Unkeyed pose — press K to keep it.',
      });
  }
  editLayerOffset(id: ControlId, value: Pose) {
    const p = this.state.project;
    if (
      !p ||
      !p.tracks[id].additive ||
      !this.canEditLayer(id) ||
      !this.poseChanged(id, value) ||
      this.poseKeyBlocked(id, value)
    )
      return;
    if (this.state.autoKey) {
      const next = copyPoseTracks(p, [id]);
      if (
        value.p.some(
          (v, i) =>
            Math.abs(v - sample(p.tracks[id], keyingFrame(p, this.poseEditFrame())).p[i]) > 1e-8,
        ) &&
        authorLayerPosition(next, id)
      )
        value = { ...value, layerPosition: true };
      putKey(next.tracks[id], keyingFrame(next, this.poseEditFrame()), value);
      const drafts = { ...this.state.drafts };
      delete drafts[id];
      this.commit(next);
      this.patch({ drafts, ...this.poseEditPlayback() });
    } else {
      const layer = activeAnimationLayer(p),
        prior = this.state.drafts[id] ?? sample(p.tracks[id], keyingFrame(p, this.poseEditFrame()));
      if (
        layer?.kind !== 'base' &&
        (layer?.spaces?.[id] ?? layer?.space) === 'world' &&
        value.p.some((v, i) => Math.abs(v - prior.p[i]) > 1e-8)
      )
        value = { ...value, layerPosition: true };
      this.patch({
        drafts: { ...this.state.drafts, [id]: clone(value) },
        message: 'Unkeyed layer offset — press K to keep it.',
      });
    }
  }
  currentTransformPose() {
    const { project, selected, drafts } = this.state,
      frame = this.poseEditFrame();
    return project?.tracks[selected].additive
      ? clone(drafts[selected] ?? sample(project.tracks[selected], keyingFrame(project, frame)))
      : this.currentPose();
  }
  editRaw(id: ControlId, value: Pose) {
    const p = this.state.project;
    if (!p || !this.canEditLayer(id)) return;
    if (p.bodyBase || p.layers)
      value = rawForWorld(p, id, this.poseEditFrame(), value, this.state.drafts);
    if (!this.poseChanged(id, value) || this.poseKeyBlocked(id, value)) return;
    if (this.state.autoKey) {
      const next = copyPoseTracks(p, [id]);
      putKey(next.tracks[id], keyingFrame(next, this.poseEditFrame()), value);
      this.commitTracks(next);
      const drafts = { ...this.state.drafts };
      delete drafts[id];
      this.patch({ drafts, ...this.poseEditPlayback() });
    } else
      this.patch({
        drafts: { ...this.state.drafts, [id]: value },
        message: 'Unkeyed pose — press K to keep it.',
      });
  }
  addKey(id = this.state.selected) {
    const p = this.state.project;
    if (!p || !this.canEditLayer(id)) return;
    const next = clone(p);
    putKey(
      next.tracks[id],
      keyingFrame(next, this.state.frame),
      this.state.drafts[id] ?? sample(p.tracks[id], this.state.frame),
    );
    const drafts = { ...this.state.drafts };
    delete drafts[id];
    this.commit(next, 'Pose keyed at frame ' + this.state.frame);
    this.patch({ drafts });
  }
  removeKey(id = this.state.selected, frame = this.state.frame) {
    if (!this.state.project || !this.canEditLayer(id)) return;
    const p = clone(this.state.project),
      t = p.tracks[id];
    let removed = false;
    if (t.keys.length > 1 && t.keys.some((k) => k.frame === frame)) {
      t.keys = t.keys.filter((k) => k.frame !== frame);
      removed = true;
    }
    for (const curve of Object.values(t.curves ?? {}))
      if (curve && curve.keys.length > 1 && curve.keys.some((k) => k.frame === frame)) {
        curve.keys = curve.keys.filter((k) => k.frame !== frame);
        removed = true;
      }
    if (removed) this.commit(p, 'Key removed');
    else
      this.patch({ message: 'No removable key at this frame. Each curve needs at least one key.' });
  }

  selectTimeline(keys: TimelineKey[], mode: 'replace' | 'add' | 'subtract' = 'replace') {
    const incoming = new Set(keys.map(keyToken)),
      old = this.state.timelineSelection;
    const selection =
      mode === 'replace'
        ? keys
        : mode === 'add'
          ? [...old, ...keys]
          : old.filter((k) => !incoming.has(keyToken(k)));
    this.patch({ timelineSelection: uniqueKeys(selection) });
  }
  copyTimeline() {
    const p = this.state.project;
    if (!p) return;
    const clip = copyTimelineKeys(p, this.state.timelineSelection);
    if (clip)
      this.patch({
        keyClipboard: clip,
        message:
          this.state.timelineSelection.length +
          ' keys copied. Switch animations and paste at the playhead.',
      });
  }
  pasteTimeline(clip = this.state.keyClipboard) {
    const p = this.state.project;
    if (!p || !clip) return;
    try {
      const result = pasteTimelineKeys(p, clip, this.state.frame);
      this.commit(result.project, 'Pasted ' + result.selection.length + ' keys');
      const controls = [...new Set(result.selection.map((k) => k.id))];
      this.patch({
        timelineSelection: result.selection,
        selection: controls,
        selected: controls.includes(this.state.selected)
          ? this.state.selected
          : (controls[0] ?? this.state.selected),
        drafts: {},
      });
    } catch (e) {
      this.patch({ message: (e as Error).message });
    }
  }
  moveTimeline(delta: number, selection = this.state.timelineSelection) {
    const p = this.state.project;
    if (!p || !delta) return;
    try {
      const result = moveTimelineKeys(p, selection, delta);
      if (!result.delta) return;
      this.commit(
        result.project,
        'Moved ' + result.selection.length + ' keys by ' + result.delta + ' frames',
      );
      this.patch({ timelineSelection: result.selection, drafts: {} });
    } catch (e) {
      this.patch({ message: (e as Error).message });
    }
  }
  deleteTimeline() {
    const p = this.state.project,
      keys = this.state.timelineSelection;
    if (!p || !keys.length) return;
    try {
      const result = deleteTimelineKeys(p, keys);
      this.commit(
        result.project,
        result.kept
          ? 'Keys deleted; retained one base key per empty channel.'
          : 'Selected keys deleted',
      );
      this.patch({ timelineSelection: [], drafts: {} });
    } catch (e) {
      this.patch({ message: (e as Error).message });
    }
  }
  moveKey(id: ControlId, from: number, to: number) {
    const p = this.state.project;
    if (!p || from === to || !Number.isFinite(to)) return;
    const result = moveTimelineKeys(p, [{ id, frame: from }], to - from);
    if (result.delta) this.commit(result.project, 'Key timing updated');
  }
  follow(parent: ParentId) {
    const p = this.state.project;
    if (!p) return;
    if (!this.canEditLayer(this.state.selected)) return;
    const id = this.state.selected;
    try {
      let base = clone(p);
      for (const [key, value] of Object.entries(this.state.drafts))
        putKey(base.tracks[key as ControlId], keyingFrame(base, this.state.frame), value!);
      const next = switchParent(base, id, parent, this.state.frame);
      this.commit(
        next,
        parent === 'world'
          ? 'Released without changing the pose'
          : 'Attachment saved at frame ' + this.state.frame,
      );
      this.patch({ drafts: {} });
    } catch (e) {
      this.patch({ message: (e as Error).message + ' Choose another attachment.' });
    }
  }
  editCurve(channel: Channel, edit: (curve: Curve) => void, message = 'Curve updated') {
    if (!this.state.project || !this.canEditLayer(this.state.selected)) return;
    const p = clone(this.state.project),
      track = p.tracks[this.state.selected];
    if (isBlendChannel(channel)) {
      if (!activeAnimationLayer(p) || activeAnimationLayer(p)?.kind === 'base') return;
      captureControlLayerReference(p, this.state.selected, this.state.frame);
    }
    try {
      const curve = ensureCurve(track, channel),
        previous = clone(curve.keys);
      edit(curve);
      if (curveKeyLocked(track, channel) && curve.keys.length > previous.length)
        throw Error('New keys are locked on this curve. Edit an existing key or unlock it first.');
      if (curve.loop) {
        if (
          !curve.keys.some((k) => k.frame === curve.loop!.start) ||
          !curve.keys.some((k) => k.frame === curve.loop!.end) ||
          !curve.keys.some((k) => k.interpolation === 'loop')
        ) {
          const explicit = explicitLoopCurve({ ...curve, keys: previous });
          curve.keys = curve.keys.map((k) =>
            k.interpolation === 'loop'
              ? {
                  ...k,
                  interpolation: 'bezier',
                  handle: 'free',
                  left: explicit.keys.find((v) => v.frame === k.frame)?.left,
                  right: explicit.keys.find((v) => v.frame === k.frame)?.right,
                }
              : k,
          );
          delete curve.loop;
        } else syncLoopSeam(curve, previous);
      }
      validateCurves(track);
      this.commit(p, message);
      this.patch({ drafts: {} });
    } catch (e) {
      this.patch({ message: (e as Error).message });
    }
  }
  setCurveKeyLock(channel: Channel, locked: boolean) {
    const p = this.state.project;
    if (!p || !this.canEditLayer(this.state.selected)) return;
    const next = copyPoseTracks(p, [this.state.selected]);
    lockCurveKeys(next.tracks[this.state.selected], this.state.selected, channel, locked);
    this.commitTracks(
      next,
      locked
        ? 'New curve keys locked · existing keys and handles stay editable'
        : 'New curve keys unlocked',
    );
  }
  setControlKeyLock(ids: ControlId[], locked: boolean) {
    const p = this.state.project;
    if (!p) return;
    ids = ids.filter((id) => editLayerAllowed(p, id));
    if (!ids.length) return;
    const next = copyPoseTracks(p, ids);
    for (const id of ids) lockControlKeys(next.tracks[id], id, locked);
    this.commitTracks(
      next,
      locked ? 'New keys locked on ' + ids.length + ' control(s)' : 'New keys unlocked',
    );
  }
  linkMirrors(ids: ControlId[], phase: MirrorLink['phase'], rest: MirrorRest) {
    const p = this.state.project;
    if (!p) return;
    try {
      const links = makeMirrorLinks(p, ids, phase, rest);
      this.commit(
        { ...p, mirrorLinks: { ...p.mirrorLinks, [p.editing]: links } },
        'Live mirror linked · edit the source side' +
          (phase ? ' · opposite side follows half a cycle later' : ''),
      );
      this.patch({ drafts: {}, timelineSelection: [] });
    } catch (e) {
      this.patch({ message: (e as Error).message });
    }
  }
  unlinkMirrors(targets: ControlId[]) {
    const p = this.state.project;
    if (!p) return;
    const links = liveMirrorLinks(p).filter((l) => !targets.includes(l.target));
    this.commit(
      { ...p, mirrorLinks: { ...p.mirrorLinks, [p.editing]: links } },
      'Mirror unlinked · original destination animation restored',
    );
    this.patch({ drafts: {}, timelineSelection: [] });
  }
  setMirrorPhase(targets: ControlId[], phase: MirrorLink['phase']) {
    const p = this.state.project;
    if (!p) return;
    this.commit(
      {
        ...p,
        mirrorLinks: {
          ...p.mirrorLinks,
          [p.editing]: liveMirrorLinks(p).map((l) =>
            targets.includes(l.target) ? { ...l, phase } : l,
          ),
        },
      },
      phase ? 'Mirror follows half a cycle later' : 'Mirror follows at the same frame',
    );
  }
  setCurveKeys(channel: Channel, keys: CurveKey[]) {
    this.editCurve(channel, (curve) => {
      const previous = curve.keys;
      curve.keys = clone(keys).sort((a, b) => a.frame - b.frame);
      syncLoopSeam(curve, previous);
    });
  }
  setCurveInterpolation(
    channel: Channel,
    frames: number[],
    interpolation: CurveKey['interpolation'],
  ) {
    this.editCurve(channel, (curve) => {
      if (interpolation === 'loop') {
        const range = loopRange(this.state.project!);
        closeCurveLoop(curve, range.start, range.end);
      } else {
        if (curve.loop && (frames.includes(curve.loop.start) || frames.includes(curve.loop.end))) {
          curve.keys = explicitLoopCurve(curve).keys;
          delete curve.loop;
        }
        curve.keys = curve.keys.map((k) =>
          frames.includes(k.frame) ? { ...k, interpolation } : k,
        );
      }
    });
  }
  setCurveLoop(channel: Channel, enabled: boolean) {
    this.editCurve(
      channel,
      (curve) => {
        if (enabled) {
          const { start, end } = loopRange(this.state.project!);
          closeCurveLoop(curve, start, end);
        } else {
          curve.keys = explicitLoopCurve(curve).keys;
          delete curve.loop;
        }
      },
      enabled
        ? 'Linked the first and last keys · interior keys unchanged'
        : 'Unlinked loop endpoints',
    );
  }
  applyCurveReduction(source: Project, tracks: Partial<Project['tracks']>) {
    if (this.state.project !== source) {
      this.patch({
        message: 'The animation changed. Analyze the current curves again before applying.',
      });
      return false;
    }
    const ids = Object.keys(tracks) as ControlId[];
    if (!ids.length || ids.some((id) => !this.canEditLayer(id))) return false;
    const next = clone(source);
    for (const id of ids) {
      next.tracks[id] = clone(tracks[id]!);
      validateCurves(next.tracks[id]);
    }
    this.commit(
      next,
      'Reduced ' + ids.length + ' control(s) with fitted curves · undo restores the original keys',
    );
    this.patch({ drafts: {}, timelineSelection: [] });
    return true;
  }
  addCurveKey(channel: Channel, frame = this.state.frame, value?: number) {
    if (!this.state.project) return;
    if (!canInsertCurveKey(this.state.project.tracks[this.state.selected], channel, frame)) {
      this.patch({
        message: 'New keys are locked on this curve. Edit an existing key or unlock it first.',
      });
      return;
    }
    const v =
      value ?? baseCurve(readCurve(this.state.project.tracks[this.state.selected], channel), frame);
    this.editCurve(
      channel,
      (curve) => {
        const previous =
          curve.keys.find((k) => k.frame === frame) ??
          curve.keys.filter((k) => k.frame < frame).at(-1) ??
          curve.keys[0];
        curve.keys = curve.keys
          .filter((k) => k.frame !== frame)
          .concat({
            ...motionOptions(previous),
            frame,
            value: v,
            interpolation: previous.interpolation,
            handle: 'clamped',
          })
          .sort((a, b) => a.frame - b.frame);
      },
      'Channel key inserted',
    );
  }
  addModifier(channel: Channel, type: Modifier['type']) {
    this.editCurve(
      channel,
      (curve) => {
        if (curve.modifiers.length >= 20) throw Error('A channel supports up to 20 modifiers.');
        if (type === 'cycles' && curve.modifiers.some((m) => m.type === 'cycles'))
          throw Error('This channel already has a Cycles modifier.');
        const m = modifier(type),
          range = loopRange(this.state.project!);
        if ((type === 'noise' || type === 'sine') && range.enabled)
          m.loop = { start: range.start, end: range.end };
        type === 'cycles' ? curve.modifiers.unshift(m) : curve.modifiers.push(m);
      },
      'Added ' + type + ' modifier',
    );
  }
  setModifierLoop(channel: Channel, id: string, enabled: boolean) {
    const p = this.state.project;
    if (!p) return;
    const { start, end } = loopRange(p);
    this.updateModifier(channel, id, { loop: enabled ? { start, end } : undefined });
  }
  private syncModifierLoops(p: Project) {
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
  updateModifier(channel: Channel, id: string, value: Partial<Modifier>) {
    this.editCurve(channel, (curve) => {
      const m = curve.modifiers.find((m) => m.id === id);
      if (m) Object.assign(m, value);
    });
  }
  removeModifier(channel: Channel, id: string) {
    this.editCurve(
      channel,
      (curve) => {
        curve.modifiers = curve.modifiers.filter((m) => m.id !== id);
      },
      'Modifier removed',
    );
  }
  moveModifier(channel: Channel, id: string, delta: number) {
    this.editCurve(channel, (curve) => {
      const i = curve.modifiers.findIndex((m) => m.id === id),
        j = i + delta;
      if (
        i < 0 ||
        j < 0 ||
        j >= curve.modifiers.length ||
        curve.modifiers[i].type === 'cycles' ||
        curve.modifiers[j].type === 'cycles'
      )
        return;
      [curve.modifiers[i], curve.modifiers[j]] = [curve.modifiers[j], curve.modifiers[i]];
    });
  }
  copyModifiers(channel: Channel, id?: string) {
    const p = this.state.project;
    if (!p) return;
    const modifiers = readCurve(p.tracks[this.state.selected], channel).modifiers.filter(
      (m) => !id || m.id === id,
    );
    if (!modifiers.length) return;
    this.patch({
      modifierClipboard: {
        modifiers: clone(modifiers),
        source: CHANNEL_LABELS[channel],
        unit: channelUnit(channel),
      },
      message: 'Copied ' + modifiers.length + ' modifier(s)',
    });
  }
  pasteModifiers(channel: Channel) {
    const clip = this.state.modifierClipboard;
    if (!clip?.modifiers.length) return;
    this.editCurve(
      channel,
      (curve) => {
        const { start, end } = loopRange(this.state.project!);
        const pasted = clone(clip.modifiers).map((m) => ({
          ...m,
          id: randomId(),
          ...(m.loop ? { loop: { start, end } } : {}),
        }));
        const cycle = pasted.find((m) => m.type === 'cycles');
        curve.modifiers = [
          ...(cycle ? [cycle] : curve.modifiers.filter((m) => m.type === 'cycles')),
          ...curve.modifiers.filter((m) => m.type !== 'cycles'),
          ...pasted.filter((m) => m.type !== 'cycles'),
        ];
        if (curve.modifiers.length > 20) throw Error('A channel supports up to 20 modifiers.');
      },
      'Pasted ' +
        clip.modifiers.length +
        ' modifier(s) · values use ' +
        (channelUnit(channel) || 'channel units'),
    );
  }
  duplicateModifier(channel: Channel, id: string) {
    this.editCurve(
      channel,
      (curve) => {
        const i = curve.modifiers.findIndex((m) => m.id === id);
        if (i < 0) return;
        if (curve.modifiers[i].type === 'cycles')
          throw Error('A channel has one Cycles modifier. Copy it to another channel instead.');
        curve.modifiers.splice(i + 1, 0, { ...clone(curve.modifiers[i]), id: randomId() });
      },
      'Modifier duplicated',
    );
  }
  bakeCurve(channel: Channel) {
    if (!this.state.project) return;
    const end = this.state.project.end;
    this.editCurve(
      channel,
      (curve) => {
        const keys = Array.from({ length: end + 1 }, (_, frame) => ({
          frame,
          value: sampleCurve(curve, frame),
          interpolation: 'linear' as const,
          handle: 'vector' as const,
        }));
        curve.keys = keys;
        curve.modifiers = [];
      },
      'Channel baked to keys over the animation range. Undo restores its modifiers.',
    );
  }
  copyCurveKeys(channel: Channel, frames: number[]) {
    if (!this.state.project) return;
    const keys = explicitLoopCurve(
      readCurve(this.state.project.tracks[this.state.selected], channel),
    ).keys.filter((k) => frames.includes(k.frame));
    if (!keys.length) return;
    const first = keys[0].frame;
    this.patch({
      curveClipboard: keys.map((k) => ({ ...clone(k), frame: k.frame - first })),
      message: 'Copied ' + keys.length + ' curve key(s).',
    });
  }
  pasteCurveKeys(channel: Channel) {
    const keys = this.state.curveClipboard;
    if (!keys?.length || !this.state.project) return;
    const at = this.state.frame;
    if (
      keys.some(
        (k) =>
          !canInsertCurveKey(
            this.state.project!.tracks[this.state.selected],
            channel,
            k.frame + at,
          ),
      )
    ) {
      this.patch({ message: 'Paste would add keys to a locked curve. Unlock it first.' });
      return;
    }
    if (keys.at(-1)!.frame + at > this.state.project.end) {
      this.patch({ message: 'Extend the animation end frame to fit these keys.' });
      return;
    }
    const before = this.state.project;
    this.editCurve(
      channel,
      (curve) => {
        const next = keys.map((k) => ({ ...clone(k), frame: k.frame + at })),
          frames = new Set(next.map((k) => k.frame));
        curve.keys = curve.keys
          .filter((k) => !frames.has(k.frame))
          .concat(next)
          .sort((a, b) => a.frame - b.frame);
      },
      'Curve keys pasted at frame ' + at,
    );
    return this.state.project !== before ? keys.map((k) => k.frame + at) : undefined;
  }
  setLoop(value: Partial<{ enabled: boolean; start: number; end: number }>) {
    if (!this.state.project) return;
    const p = clone(this.state.project),
      range = { ...loopRange(p), ...value };
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end > p.end ||
      range.start >= range.end
    )
      return;
    p.loop = range;
    this.syncModifierLoops(p);
    this.commit(p, 'Loop range updated');
  }
  matchLoop() {
    if (!this.state.project) return;
    this.commit(
      matchLoopEnd(this.state.project),
      'Matched the end pose. Check the seam and tangents.',
    );
    this.patch({ drafts: {} });
  }
  setInterpolation(value: Interpolation | 'loop') {
    if (!this.state.project) return;
    if (value === 'loop') {
      const id = this.state.selected;
      this.commit(
        applyKeySettings(
          this.state.project,
          [{ id, frame: this.state.project.tracks[id].keys[0].frame }],
          { interpolation: 'loop' },
        ),
        'Loop interpolation closes the playback range with continuous Bézier motion',
      );
      this.patch({ drafts: {} });
      return;
    }
    const p = clone(this.state.project),
      track = p.tracks[this.state.selected];
    track.interpolation = value;
    for (const key of track.keys)
      Object.assign(key, motionOptions(track), { interpolation: value });
    for (const curve of Object.values(track.curves ?? {}))
      if (curve) {
        delete curve.loop;
        for (const key of curve.keys)
          Object.assign(key, motionOptions(track), {
            interpolation: value === 'smooth' ? 'bezier' : value,
          });
      }
    this.commit(p, 'Interpolation applied to this control. Use Curves for individual segments.');
    this.patch({ drafts: {} });
  }
  setMotionOptions(value: MotionOptions) {
    if (!this.state.project) return;
    const p = clone(this.state.project),
      track = p.tracks[this.state.selected];
    Object.assign(track, clone(value));
    try {
      validateMotionOptions(track);
    } catch (e) {
      this.patch({ message: (e as Error).message });
      return;
    }
    for (const key of track.keys)
      if ((key.interpolation ?? track.interpolation) === track.interpolation)
        Object.assign(key, motionOptions(track));
    for (const curve of Object.values(track.curves ?? {}))
      if (curve)
        for (const key of curve.keys)
          if (key.interpolation === track.interpolation) Object.assign(key, motionOptions(track));
    this.commit(p, 'Interpolation settings updated');
    this.patch({ drafts: {} });
  }
  newProject(rest: Partial<Record<ControlId, Pose>>, demo: boolean) {
    this.addAnimation(rest, demo);
  }
  open(input: unknown) {
    this.openValidated(validateLibrary(input));
  }
  openValidated(workspace: AnimationLibrary) {
    this.loadWorkspace(workspace, 'Project opened · ' + workspace.clips.length + ' animation(s)');
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
export const studio = new StudioStore();

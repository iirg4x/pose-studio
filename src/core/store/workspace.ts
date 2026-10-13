import { deleteLibraryAnimation, detachDeletedAnimation } from '../deleteAnimation';
import { randomId } from '../crypto';
import { controllerConstraints, validateControllerConstraints } from '../controllerConstraints';
import type { ControllerConstraint } from '../controllerConstraints';
import {
  readPreference,
  readRecovery,
  RECOVERY,
  isTouch as isAndroid,
} from '../../platform/storage';
import { blankProject, hydratePropTracks, projectProps } from '../assets';
import type { PropAsset } from '../assets';
import { registerPropControl } from '../controls';
import type { RetargetCharacter } from '../retarget';
import {
  IDS,
  clone,
  forLayer,
  createProject,
  createBodyAction,
  createFirstPersonAction,
  validateProject,
} from '../model';
import type { ControlId, RigLayer, Pose, Project } from '../model';
import { entry, library, newId, validateLibrary, refreshBases, sourceWouldCycle } from '../library';
import type { AnimationLibrary } from '../library';
import { SelectionStore } from './selection';
import type { StudioState } from './core';

/** Projects, animation clips, characters, props and body sources. */
export class WorkspaceStore extends SelectionStore {
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
  protected loadWorkspace(workspace: AnimationLibrary, message: string) {
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
  renameWorkspace(name: string) {
    const workspace = this.workspaceSnapshot();
    if (!workspace) return;
    workspace.name = name.slice(0, 100);
    this.patch({ workspace });
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
  newProject(rest: Partial<Record<ControlId, Pose>>, demo: boolean) {
    this.addAnimation(rest, demo);
  }
  open(input: unknown) {
    this.openValidated(validateLibrary(input));
  }
  openValidated(workspace: AnimationLibrary) {
    this.loadWorkspace(workspace, 'Project opened · ' + workspace.clips.length + ' animation(s)');
  }
}

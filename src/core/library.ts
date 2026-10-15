import { randomId } from './crypto';
import { validateFolder } from './animationFolders';
import { inferPoseLinks } from '../../shared/pose-links.mjs';
import { refreshPoseLinks } from './poseReferences';
import { collectPropControlIds, withProposedPropControls } from './controls';
import { projectProps } from './assets';
import { validateCharacters } from './retarget';
import type { RetargetCharacter } from './retarget';
import { keyingFrame } from './layers';
import {
  controlParent,
  clone,
  evaluate,
  IDS,
  matrix,
  putKey,
  rawForWorld,
  validateProject,
  visibleControls,
  limbMode,
} from './model';
import type { LimbId, LimbMode } from './model';
import type { ControlId, Pose, Project, RigLayer, ProjectValidationOptions } from './model';

export type Poses = Partial<Record<ControlId, Pose>>;
export interface PoseStamp {
  mirrorRoot?: Pose;
  modes?: Partial<Record<LimbId, LimbMode>>;
  id: string;
  name: string;
  layer: RigLayer;
  scope: 'control' | 'rig';
  poses: Poses;
}
export interface AnimationEntry {
  previewSync?: 'time' | 'phase';
  folder?: string[];
  previewId?: string;
  id: string;
  project: Project;
  frame: number;
  selected: ControlId;
  drafts: Poses;
}
export interface AnimationLibrary {
  characters?: RetargetCharacter[];
  activeCharacterId?: string;
  previewCharacterId?: string;
  version: 3;
  rig: 'ue5-manny-simple';
  name: string;
  clips: AnimationEntry[];
  activeId: string;
  openIds: string[];
  poses: PoseStamp[];
}
export const newId = () => randomId();
export function entry(project: Project): AnimationEntry {
  return { id: newId(), project: clone(project), frame: 0, selected: 'hand_l', drafts: {} };
}
export function library(project: Project): AnimationLibrary {
  const clip = entry(project);
  return {
    version: 3,
    rig: 'ue5-manny-simple',
    name: 'Manny animation project',
    clips: [clip],
    activeId: clip.id,
    openIds: [clip.id],
    poses: [],
  };
}
export function refreshBases(data: AnimationLibrary) {
  data = inferPoseLinks(data);
  const done = new Set<string>(),
    visiting = new Set<string>(),
    byId = new Map(data.clips.map((c) => [c.id, c])),
    poseCache = new Map<Project, Map<number, Project['tracks']>>();
  const refresh = (clip: AnimationEntry) => {
    if (done.has(clip.id)) return;
    if (visiting.has(clip.id)) throw Error('Animation source links cannot form a cycle.');
    visiting.add(clip.id);
    const linked = refreshPoseLinks(
      clip.project,
      (id) => {
        const source = byId.get(id);
        if (source) refresh(source);
        return source?.project;
      },
      poseCache,
    );
    if (linked !== clip.project) clip.project = linked;
    const base = clip.project.bodyBase,
      source = base && byId.get(base.sourceId);
    if (base && source) {
      if (source.project.editing === clip.project.editing)
        throw Error('Choose an animation of the other view type.');
      refresh(source);
      base.source = clone(source.project);
      base.source.actionType = source.project.editing;
      clip.project.otherTracks = clone(base.source.tracks);
      clip.project.propPreset = base.source.propPreset;
      clip.project.props = {
        ...clone(projectProps(base.source)),
        ...clone(projectProps(clip.project)),
      };
    }
    visiting.delete(clip.id);
    done.add(clip.id);
  };
  for (const clip of data.clips) refresh(clip);
  return data;
}
export function sourceWouldCycle(data: AnimationLibrary, targetId: string, sourceId: string) {
  const seen = new Set<string>(),
    byId = new Map(data.clips.map((c) => [c.id, c.project]));
  const reaches = (id: string): boolean => {
    if (id === targetId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    const p = byId.get(id);
    return (
      !!p &&
      ((!!p.bodyBase && reaches(p.bodyBase.sourceId)) ||
        (p.layers?.[0].poseLinks ?? []).some((link) => reaches(link.clipId)))
    );
  };
  return reaches(sourceId);
}
export function capturePose(
  project: Project,
  frame: number,
  drafts: Poses,
  scope: 'control' | 'rig',
  selected: ControlId,
): PoseStamp {
  const values = evaluate(project, frame, drafts);
  // A rig pose includes props and body controls. Copy camera motion explicitly as a control.
  const ids =
    scope === 'control'
      ? [selected]
      : visibleControls(project.editing, project).filter((id) => id !== 'camera');
  return {
    mirrorRoot: clone(values.root),
    id: newId(),
    name: project.name + ' · frame ' + frame,
    layer: project.editing,
    scope,
    ...(scope === 'rig'
      ? {
          modes: Object.fromEntries(
            (['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const).map((limb) => [
              limb,
              limbMode(project, limb, frame),
            ]),
          ),
        }
      : {}),
    poses: Object.fromEntries(ids.map((id) => [id, clone(values[id])])),
  };
}
export function applyPose(
  project: Project,
  frame: number,
  stamp: PoseStamp,
  selected: ControlId,
  drafts: Poses = {},
  skipMatching = false,
): Project {
  const next = clone(project);
  if (stamp.scope === 'rig' && stamp.modes) {
    next.limbModes ??= {};
    next.limbModes[next.editing] ??= {};
    for (const [limb, mode] of Object.entries(stamp.modes)) {
      const modes = next.limbModes[next.editing]!;
      modes[limb as LimbId] = (modes[limb as LimbId] ?? [])
        .filter((k) => k.frame !== frame)
        .concat({ frame, mode })
        .sort((a, b) => a.frame - b.frame);
    }
  }
  for (const id of IDS)
    if (drafts[id]) putKey(next.tracks[id], keyingFrame(next, frame), drafts[id]!);
  const desired: Poses =
    stamp.scope === 'control' ? { [selected]: Object.values(stamp.poses)[0] } : stamp.poses;
  const done = new Set<ControlId>(),
    visiting = new Set<ControlId>();
  // Solve parents before children so a pasted hand and prop retain their exact world pose.
  const solve = (id: ControlId) => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw Error('Attachment cycle');
    visiting.add(id);
    if (id !== 'root') solve('root');
    const parent = controlParent(next, id, frame);
    if (parent !== 'world') solve(parent);
    const value = desired[id];
    const current = value && skipMatching ? evaluate(next, frame)[id] : null;
    const same =
      current &&
      value &&
      matrix(current)
        .toArray()
        .every((v, i) => Math.abs(v - matrix(value).elements[i]) < 1e-8) &&
      current.grip.every((v, i) => Math.abs(v - value.grip[i]) < 1e-8) &&
      Math.abs(current.fov - value.fov) < 1e-8;
    if (value && !same) {
      const raw = rawForWorld(next, id, frame, value);
      putKey(next.tracks[id], keyingFrame(next, frame), raw);
    }
    visiting.delete(id);
    done.add(id);
  };
  for (const id of IDS) solve(id);
  return next;
}
function validatePoses(input: unknown, gripLimit = 1): Poses {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Invalid saved pose.');
  const poses = input as Poses;
  for (const [id, value] of Object.entries(poses)) {
    const arr = (a: unknown, n: number) =>
      Array.isArray(a) &&
      a.length === n &&
      a.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6);
    if (
      !IDS.includes(id as ControlId) ||
      !value ||
      !arr(value.p, 3) ||
      !arr(value.q, 4) ||
      Math.abs(Math.hypot(...value.q) - 1) > 0.01 ||
      !arr(value.grip, 5) ||
      value.grip.some((v) => v < -gripLimit || v > gripLimit) ||
      !Number.isFinite(value.fov) ||
      value.fov < 20 ||
      value.fov > 120
    )
      throw Error('Invalid saved pose.');
  }
  return clone(poses);
}
export function validateLibrary(
  input: unknown,
  options: ProjectValidationOptions = {},
): AnimationLibrary {
  if (!input || typeof input !== 'object') throw Error('This is not a Manny project.');
  return withProposedPropControls(
    collectPropControlIds(input),
    () => validateLibraryOwned(input, options),
    options.commitPropControls !== false,
  );
}

function validateLibraryOwned(input: unknown, options: ProjectValidationOptions): AnimationLibrary {
  if ((input as { version: number }).version !== 3) return library(validateProject(input, options));
  const raw = input as AnimationLibrary;
  // Validate each project once; embedded model bytes are restored by the file layer.
  const data = {
    version: raw.version,
    rig: raw.rig,
    name: raw.name,
    activeId: raw.activeId,
    openIds: clone(raw.openIds),
    poses: clone(raw.poses),
    characters: clone(raw.characters),
    activeCharacterId: raw.activeCharacterId,
    previewCharacterId: raw.previewCharacterId,
    clips: Array.isArray(raw.clips) ? raw.clips.map((c) => ({ ...c })) : raw.clips,
  } as AnimationLibrary;
  if (
    data.rig !== 'ue5-manny-simple' ||
    typeof data.name !== 'string' ||
    data.name.length > 100 ||
    !Array.isArray(data.clips) ||
    !data.clips.length ||
    !Array.isArray(data.openIds) ||
    !Array.isArray(data.poses) ||
    data.poses.length > 200
  )
    throw Error('Invalid animation library.');
  if (data.characters !== undefined) {
    data.characters = validateCharacters(data.characters);
    if (data.activeCharacterId && !data.characters.some((c) => c.id === data.activeCharacterId))
      throw Error('Invalid active character.');
  }
  if (
    data.previewCharacterId &&
    !(data.characters ?? []).some((c) => c.id === data.previewCharacterId)
  )
    throw Error('Invalid preview model.');
  const ids = new Set<string>();
  for (const clip of data.clips) {
    if (typeof clip.id !== 'string' || !clip.id || clip.id.length > 100 || ids.has(clip.id))
      throw Error('Invalid animation identity.');
    if (clip.folder !== undefined) clip.folder = validateFolder(clip.folder);
    ids.add(clip.id);
    clip.project = validateProject(clip.project, options);
    if (
      !Number.isFinite(clip.frame) ||
      clip.frame < 0 ||
      clip.frame > clip.project.end ||
      !IDS.includes(clip.selected)
    )
      throw Error('Invalid animation view.');
    clip.drafts = validatePoses(
      clip.drafts ?? {},
      clip.project.bodyBase || clip.project.layers ? 2 : 1,
    );
  }
  for (const clip of data.clips)
    if (clip.previewSync !== undefined && !['time', 'phase'].includes(clip.previewSync))
      throw Error('Invalid preview timing.');
  for (const clip of data.clips)
    if (clip.previewId !== undefined) {
      const target = data.clips.find((c) => c.id === clip.previewId);
      if (!target || target.project.editing === clip.project.editing)
        throw Error('Invalid preview animation link.');
    }
  if (
    !ids.has(data.activeId) ||
    !data.openIds.length ||
    new Set(data.openIds).size !== data.openIds.length ||
    !data.openIds.includes(data.activeId) ||
    data.openIds.some((id) => !ids.has(id))
  )
    throw Error('Invalid animation tabs.');
  const poseIds = new Set<string>();
  for (const stamp of data.poses) {
    if (
      typeof stamp.id !== 'string' ||
      !stamp.id ||
      stamp.id.length > 100 ||
      poseIds.has(stamp.id) ||
      typeof stamp.name !== 'string' ||
      !stamp.name.trim() ||
      stamp.name.length > 100 ||
      !['firstPerson', 'body'].includes(stamp.layer) ||
      !['control', 'rig'].includes(stamp.scope)
    )
      throw Error('Invalid pose library.');
    poseIds.add(stamp.id);
    stamp.poses = validatePoses(stamp.poses);
    if (stamp.mirrorRoot) stamp.mirrorRoot = validatePoses({ root: stamp.mirrorRoot }).root;
    if (
      stamp.modes &&
      (typeof stamp.modes !== 'object' ||
        Object.entries(stamp.modes).some(
          ([id, mode]) =>
            !['arm_l', 'arm_r', 'leg_l', 'leg_r'].includes(id) || !['ik', 'fk'].includes(mode),
        ))
    )
      throw Error('Invalid pose rig modes.');
    const keys = Object.keys(stamp.poses);
    if (
      !keys.length ||
      (stamp.scope === 'control' && keys.length !== 1) ||
      (stamp.scope === 'rig' &&
        keys.some(
          (id) =>
            id === 'camera' ||
            (!visibleControls(stamp.layer).includes(id as ControlId) &&
              // Saved poses retain prop transforms even after an asset binding is removed.
              !(id.startsWith('prop:') && IDS.includes(id as ControlId))),
        ))
    )
      throw Error('Invalid pose controls.');
  }
  return refreshBases(data);
}

import { CONTROLS, CONTROL_IDS, registerPropControl } from './controls';
import type { ControlId } from './controls';
import { clone, createProject, pose } from './model';
import type { Project, V3 } from './model';

export interface PropAsset {
  name: string;
  asset: string;
  scale: number;
  rotation: V3;
  offset: V3;
  visible: boolean;
}
export type PropBindings = Partial<Record<ControlId, PropAsset>>;
export const isProp = (id: string) => id === 'rifle' || id === 'magazine' || id.startsWith('prop:');
export function projectProps(p?: Pick<Project, 'props' | 'propPreset'> | null): PropBindings {
  if (!p) return {};
  if (p.props !== undefined) return p.props;
  const make = (name: string, asset: string): PropAsset => ({
    name,
    asset,
    scale: 1,
    rotation: [0, 0, 0],
    offset: [0, 0, 0],
    visible: true,
  });
  return p.propPreset === 'axe'
    ? { rifle: make('Axe', 'builtin-axe') }
    : { rifle: make('Rifle', 'builtin-rifle'), magazine: make('Magazine', 'builtin-magazine') };
}
export function validateProps(props: PropBindings) {
  if (!props || typeof props !== 'object' || Array.isArray(props))
    throw Error('Invalid project props.');
  for (const [id, p] of Object.entries(props)) {
    if (
      !isProp(id) ||
      !p ||
      typeof p.name !== 'string' ||
      !p.name.trim() ||
      p.name.length > 100 ||
      !/^([a-f0-9]{64}|builtin-(axe|rifle|magazine))$/.test(p.asset) ||
      !Number.isFinite(p.scale) ||
      p.scale <= 0 ||
      p.scale > 1e4 ||
      typeof p.visible !== 'boolean' ||
      [p.rotation, p.offset].some(
        (v) =>
          !Array.isArray(v) ||
          v.length !== 3 ||
          v.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e5),
      )
    )
      throw Error('Invalid prop asset.');
    if (id.startsWith('prop:')) registerPropControl(id as ControlId);
  }
}
// Dynamic prop controls are registered once. Old actions and undo states retain
// identity tracks for unused controls; only their own asset bindings are shown.
export function hydratePropTracks(p: Project) {
  if (p.props) validateProps(p.props);
  for (const tracks of [p.tracks, p.otherTracks, ...(p.layers ?? []).map((l) => l.tracks)])
    for (const id of Object.keys(tracks ?? {}))
      if (id.startsWith('prop:')) registerPropControl(id as ControlId);
  const add = (tracks: Project['tracks'] | undefined, additive: boolean) => {
    if (tracks)
      for (const id of CONTROL_IDS)
        if (isProp(id) && !tracks[id])
          tracks[id] = {
            ...(additive ? { additive: true } : {}),
            keys: [
              {
                ...pose(additive ? [0, 0, 0] : [0, 1, 0], [0, 0, 0, 1], [0, 0, 0, 0, 0]),
                frame: 0,
              },
            ],
            spaces: [],
            interpolation: 'smooth',
          };
  };
  add(
    p.tracks,
    !!p.bodyBase || !!p.layers?.find((l) => l.id === p.activeLayerId && l.kind !== 'base'),
  );
  add(p.otherTracks, false);
  for (const layer of p.layers ?? []) add(layer.tracks, layer.kind !== 'base' || !!p.bodyBase);
  if (p.bodyBase) hydratePropTracks(p.bodyBase.source);
  return p;
}
export function blankProject(rest: Parameters<typeof createProject>[0] = {}) {
  const p = createProject(rest, false);
  p.props = {};
  p.name = 'Untitled animation';
  p.actionType = 'body';
  p.editing = 'body';
  p.fps = 30;
  p.end = 90;
  for (const tracks of [p.tracks, p.otherTracks])
    for (const [id, t] of Object.entries(tracks)) {
      t.spaces = [];
      if (CONTROLS[id as ControlId].kind === 'bone' || id.startsWith('hand_'))
        t.keys = [{ ...pose(), grip: [0, 0, 0, 0, 0], frame: 0 }];
    }
  p.limbModes = {
    body: {
      arm_l: [{ frame: 0, mode: 'fk' }],
      arm_r: [{ frame: 0, mode: 'fk' }],
      leg_l: [{ frame: 0, mode: 'fk' }],
      leg_r: [{ frame: 0, mode: 'fk' }],
    },
    firstPerson: { arm_l: [{ frame: 0, mode: 'fk' }], arm_r: [{ frame: 0, mode: 'fk' }] },
  };
  p.otherTracks = clone(p.tracks);
  return p;
}

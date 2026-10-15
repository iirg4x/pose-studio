// Animator controls mapped to the supplied Mr Mannequins Manny Simple template.
type Side = 'l' | 'r';
type Digit = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
export type ControlId =
  | `prop:${string}`
  | 'root'
  | 'hips'
  | 'chest'
  | 'head'
  | 'rifle'
  | 'magazine'
  | 'camera'
  | 'spine_01'
  | 'spine_02'
  | 'spine_04'
  | 'spine_05'
  | 'neck_01'
  | 'neck_02'
  | `${'hand' | 'elbow' | 'shoulder' | 'upperarm' | 'forearm' | 'wrist' | 'foot' | 'knee' | 'thigh' | 'shin' | 'ankle' | 'toe' | 'heel' | 'ball'}_${Side}`
  | `${Digit}_0${1 | 2 | 3}_${Side}`
  | `${Exclude<Digit, 'thumb'>}_palm_${Side}`
  | `${'upperarm' | 'lowerarm' | 'thigh' | 'calf'}_twist_0${1 | 2}_${Side}`;
export type LimbId = `${'arm' | 'leg'}_${Side}`;
export type LimbMode = 'ik' | 'fk';
export interface ControlDefinition {
  label: string;
  group: string;
  bone: string | null;
  source: string | null;
  kind: 'target' | 'bone' | 'pole' | 'pivot';
  limb: LimbId | null;
  only: LimbMode | null;
}

/**
 * Dynamic prop controls are part of a project document, but the editor keeps
 * the runtime control registry process-wide. Validation needs to see proposed
 * controls without exposing them to the live registry until the document has
 * passed every check. The two proxies below provide that document-local view
 * while preserving the existing array/object APIs used by the core.
 */
const globalControls = {} as Record<ControlId, ControlDefinition>;
const globalControlIds: ControlId[] = [];
const MAX_DYNAMIC_PROP_CONTROLS = 256;
let globalDynamicPropCount = 0;
interface ValidationControls {
  ids: ControlId[];
  dynamic: Set<ControlId>;
  proposed: Set<ControlId>;
  definitions: Record<ControlId, ControlDefinition>;
}
let validationControls: ValidationControls | undefined;

const currentControlIds = () => validationControls?.ids ?? globalControlIds;

export const CONTROLS = new Proxy(globalControls, {
  get(target, property, receiver) {
    if (typeof property === 'string' && validationControls?.definitions[property as ControlId])
      return validationControls.definitions[property as ControlId];
    return Reflect.get(target, property, receiver);
  },
  has(target, property) {
    return (
      (typeof property === 'string' && !!validationControls?.definitions[property as ControlId]) ||
      Reflect.has(target, property)
    );
  },
  ownKeys(target) {
    return [
      ...new Set([
        ...Reflect.ownKeys(target),
        ...Object.keys(validationControls?.definitions ?? {}),
      ]),
    ];
  },
  getOwnPropertyDescriptor(target, property) {
    if (typeof property === 'string' && validationControls?.definitions[property as ControlId])
      return {
        configurable: true,
        enumerable: true,
        value: validationControls.definitions[property as ControlId],
        writable: true,
      };
    return Reflect.getOwnPropertyDescriptor(target, property);
  },
}) as Record<ControlId, ControlDefinition>;

export const CONTROL_IDS = new Proxy(globalControlIds, {
  get(_target, property, receiver) {
    const ids = currentControlIds();
    const value = Reflect.get(ids, property, receiver === CONTROL_IDS ? ids : receiver);
    return typeof value === 'function' ? value.bind(ids) : value;
  },
  ownKeys() {
    return Reflect.ownKeys(currentControlIds());
  },
  getOwnPropertyDescriptor(_target, property) {
    return Reflect.getOwnPropertyDescriptor(currentControlIds(), property);
  },
}) as ControlId[];
const add = (
  id: ControlId,
  label: string,
  group: string,
  bone: string | null,
  source: string | null,
  kind: ControlDefinition['kind'] = 'bone',
  limb: LimbId | null = null,
  only: LimbMode | null = null,
) => {
  globalControls[id] = { label, group, bone, source, kind, limb, only };
  globalControlIds.push(id);
};
add('root', 'Root', 'Master', 'root', 'root', 'target');
add('hips', 'Hips', 'Body', 'pelvis', 'ikp_pelvis');
for (const [id, bone, label] of [
  ['spine_01', 'spine_01', 'Lower spine'],
  ['spine_02', 'spine_02', 'Mid spine'],
  ['chest', 'spine_03', 'Chest'],
  ['spine_04', 'spine_04', 'Upper chest'],
  ['spine_05', 'spine_05', 'Shoulder line'],
  ['neck_01', 'neck_01', 'Neck base'],
  ['neck_02', 'neck_02', 'Upper neck'],
  ['head', 'head', 'Head'],
] as const)
  add(id, label, 'Body', bone, bone);
for (const side of ['l', 'r'] as const) {
  const name = side === 'l' ? 'Left' : 'Right',
    arm: LimbId = `arm_${side}`,
    leg: LimbId = `leg_${side}`;
  add(
    `shoulder_${side}`,
    name + ' shoulder',
    name + ' arm',
    'clavicle_' + side,
    'clavicle_' + side,
  );
  add(
    `hand_${side}`,
    name + ' hand IK',
    name + ' arm',
    'hand_' + side,
    'ikt_hand_' + side,
    'target',
    arm,
    'ik',
  );
  add(
    `elbow_${side}`,
    name + ' elbow pole',
    name + ' arm',
    'lowerarm_' + side,
    'pvt_upperarm_' + side,
    'pole',
    arm,
    'ik',
  );
  for (const [stem, bone, label] of [
    ['upperarm', 'upperarm', 'upper arm FK'],
    ['forearm', 'lowerarm', 'forearm FK'],
    ['wrist', 'hand', 'wrist FK'],
  ] as const)
    add(
      `${stem}_${side}`,
      name + ' ' + label,
      name + ' arm',
      bone + '_' + side,
      bone + '_' + side,
      'bone',
      arm,
      'fk',
    );
  for (const digit of ['thumb', 'index', 'middle', 'ring', 'pinky'] as const) {
    if (digit !== 'thumb')
      add(
        `${digit}_palm_${side}`,
        name + ' ' + digit + ' palm',
        name + ' fingers',
        digit + '_metacarpal_' + side,
        digit + '_metacarpal_' + side,
      );
    for (const j of [1, 2, 3] as const)
      add(
        `${digit}_0${j}_${side}`,
        name + ' ' + digit + ' ' + j,
        name + ' fingers',
        `${digit}_0${j}_${side}`,
        `${digit}_0${j}_${side}`,
      );
  }
  add(
    `foot_${side}`,
    name + ' foot IK',
    name + ' leg',
    'foot_' + side,
    'ikp_foot_' + side,
    'target',
    leg,
    'ik',
  );
  add(
    `knee_${side}`,
    name + ' knee pole',
    name + ' leg',
    'calf_' + side,
    'pvt_thigh_' + side,
    'pole',
    leg,
    'ik',
  );
  for (const [stem, bone, label] of [
    ['thigh', 'thigh', 'thigh FK'],
    ['shin', 'calf', 'shin FK'],
    ['ankle', 'foot', 'ankle FK'],
  ] as const)
    add(
      `${stem}_${side}`,
      name + ' ' + label,
      name + ' leg',
      bone + '_' + side,
      bone + '_' + side,
      'bone',
      leg,
      'fk',
    );
  add(`toe_${side}`, name + ' toes', name + ' leg', 'ball_' + side, 'ball_' + side);
  add(
    `heel_${side}`,
    name + ' heel pivot',
    name + ' leg',
    'foot_' + side,
    'rkt_foot_' + side,
    'pivot',
    leg,
    'ik',
  );
  add(
    `ball_${side}`,
    name + ' ball pivot',
    name + ' leg',
    'ball_' + side,
    'rkt_ball_' + side,
    'pivot',
    leg,
    'ik',
  );
  for (const [stem, label, isArm] of [
    ['upperarm', 'upper arm', true],
    ['lowerarm', 'forearm', true],
    ['thigh', 'thigh', false],
    ['calf', 'shin', false],
  ] as const)
    for (const j of [1, 2] as const) {
      const id = `${stem}_twist_0${j}_${side}` as const;
      add(id, name + ' ' + label + ' twist ' + j, name + (isArm ? ' arm' : ' leg'), id, id);
    }
}
add('rifle', 'Rifle', 'Props', null, null, 'target');
add('magazine', 'Magazine', 'Props', null, null, 'target');
add('camera', 'Camera', 'Camera', null, null, 'target');

const PROP_CONTROL_PATTERN = /^prop:[a-zA-Z0-9_-]{1,100}$/;
const propDefinition = (): ControlDefinition => ({
  label: 'Prop',
  group: 'Props',
  bone: null,
  source: null,
  kind: 'target',
  limb: null,
  only: null,
});

function validatePropControlId(id: ControlId) {
  if (!PROP_CONTROL_PATTERN.test(id)) throw Error('Invalid prop control.');
}

function addProposedControl(id: ControlId) {
  validatePropControlId(id);
  if (!validationControls) throw Error('No document validation scope.');
  if (!validationControls.dynamic.has(id)) validationControls.dynamic.add(id);
  if (validationControls.dynamic.size > MAX_DYNAMIC_PROP_CONTROLS)
    throw Error('Import exceeds the project limit of 256 prop controls.');
  if (globalControls[id] || validationControls.proposed.has(id)) return;
  if (globalDynamicPropCount + validationControls.proposed.size >= MAX_DYNAMIC_PROP_CONTROLS)
    throw Error('Import exceeds the project limit of 256 prop controls.');
  validationControls.proposed.add(id);
  validationControls.ids.push(id);
  validationControls.definitions[id] = propDefinition();
}

function commitPropControl(id: ControlId) {
  validatePropControlId(id);
  if (globalControls[id]) return;
  if (globalDynamicPropCount >= MAX_DYNAMIC_PROP_CONTROLS)
    throw Error('Import exceeds the project limit of 256 prop controls.');
  globalControls[id] = propDefinition();
  globalControlIds.push(id);
  globalDynamicPropCount++;
}

/** Register a runtime prop, or add it to the active document-local scope. */
export function registerPropControl(id: ControlId) {
  if (validationControls) {
    addProposedControl(id);
    return;
  }
  commitPropControl(id);
}

/** Register all controls after a successful document validation. */
export function commitPropControls(ids: Iterable<ControlId>) {
  const pending = new Set<ControlId>();
  for (const id of ids) {
    validatePropControlId(id);
    if (!globalControls[id]) pending.add(id);
  }
  if (globalDynamicPropCount + pending.size > MAX_DYNAMIC_PROP_CONTROLS)
    throw Error('Import exceeds the project limit of 256 prop controls.');
  for (const id of pending) commitPropControl(id);
}

/**
 * Collect control identities that can legitimately introduce dynamic props.
 * Saved pose/control maps are intentionally excluded: a pose cannot create an
 * unbound prop identity by itself.
 */
export function collectPropControlIds(input: unknown): ControlId[] {
  const ids = new Set<ControlId>();
  const collectKeys = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const id of Object.keys(value))
      if (id.startsWith('prop:')) {
        ids.add(id as ControlId);
        if (ids.size > MAX_DYNAMIC_PROP_CONTROLS)
          throw Error('Import exceeds the project limit of 256 prop controls.');
      }
  };
  const collectProject = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const project = value as Record<string, unknown>;
    collectKeys(project.props);
    collectKeys(project.tracks);
    collectKeys(project.otherTracks);
    if (Array.isArray(project.layers))
      for (const layer of project.layers) {
        if (layer && typeof layer === 'object')
          collectKeys((layer as Record<string, unknown>).tracks);
      }
    const source = project.bodyBase;
    if (source && typeof source === 'object')
      collectProject((source as Record<string, unknown>).source);
  };
  if (
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    (input as { version?: unknown }).version === 3
  ) {
    const clips = (input as { clips?: unknown }).clips;
    if (Array.isArray(clips))
      for (const clip of clips)
        if (clip && typeof clip === 'object')
          collectProject((clip as Record<string, unknown>).project);
  } else collectProject(input);
  return [...ids];
}

/**
 * Run validation with document-local prop controls. Global registration is
 * committed only when the callback returns successfully.
 */
export function withProposedPropControls<T>(
  ids: Iterable<ControlId>,
  callback: () => T,
  commit = true,
): T {
  const parent = validationControls;
  const proposed = new Set(parent?.proposed ?? []);
  const scope: ValidationControls = {
    ids: [...globalControlIds, ...(parent ? [...parent.proposed] : [])],
    dynamic: new Set(parent?.dynamic ?? []),
    proposed,
    definitions: { ...parent?.definitions } as Record<ControlId, ControlDefinition>,
  };
  for (const id of ids) addProposedControlToScope(scope, id);
  validationControls = scope;
  try {
    const result = callback();
    if (parent) {
      for (const id of scope.dynamic) parent.dynamic.add(id);
      for (const id of scope.proposed) {
        parent.proposed.add(id);
        if (!parent.ids.includes(id)) parent.ids.push(id);
        parent.definitions[id] = scope.definitions[id]!;
      }
    } else if (commit) commitPropControls(scope.proposed);
    return result;
  } finally {
    validationControls = parent;
  }
}

function addProposedControlToScope(scope: ValidationControls, id: ControlId) {
  validatePropControlId(id);
  if (!scope.dynamic.has(id)) scope.dynamic.add(id);
  if (scope.dynamic.size > MAX_DYNAMIC_PROP_CONTROLS)
    throw Error('Import exceeds the project limit of 256 prop controls.');
  if (globalControls[id] || scope.proposed.has(id)) return;
  if (globalDynamicPropCount + scope.proposed.size >= MAX_DYNAMIC_PROP_CONTROLS)
    throw Error('Import exceeds the project limit of 256 prop controls.');
  scope.proposed.add(id);
  scope.ids.push(id);
  scope.definitions[id] = propDefinition();
}

export const BONE_CONTROLS = CONTROL_IDS.filter((id) => CONTROLS[id].kind === 'bone');
export const LEGACY_IDS: ControlId[] = [
  'root',
  'hand_l',
  'hand_r',
  'elbow_l',
  'elbow_r',
  'rifle',
  'magazine',
  'camera',
  'hips',
  'chest',
  'head',
  'foot_l',
  'foot_r',
];
export const isBoneControl = (id: ControlId) => CONTROLS[id].kind === 'bone';
export const isOffsetControl = (id: ControlId) =>
  isBoneControl(id) || CONTROLS[id].kind === 'pivot';
export const isRotationControl = (id: ControlId) =>
  isOffsetControl(id) && !['hips', 'chest', 'head', 'shoulder_l', 'shoulder_r'].includes(id);
export const controlLayerVisible = (id: ControlId, layer: 'firstPerson' | 'body') =>
  layer === 'body'
    ? id !== 'camera'
    : CONTROLS[id].group !== 'Body' && !CONTROLS[id].group.endsWith('leg');

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
export const CONTROLS = {} as Record<ControlId, ControlDefinition>;
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
  CONTROLS[id] = { label, group, bone, source, kind, limb, only };
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
export const CONTROL_IDS = Object.keys(CONTROLS) as ControlId[];
export function registerPropControl(id: ControlId) {
  if (!/^prop:[a-zA-Z0-9_-]{1,100}$/.test(id)) throw Error('Invalid prop control.');
  if (CONTROLS[id]) return;
  add(id, 'Prop', 'Props', null, null, 'target');
  CONTROL_IDS.push(id);
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

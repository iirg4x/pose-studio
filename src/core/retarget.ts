export interface RetargetCharacter {
  id: string;
  name: string;
  asset: string;
  mapping: Record<string, string>;
  hiddenMeshes: string[];
  scale: number;
  facing: number;
  handIK: boolean;
  footIK: boolean;
  offsets: Record<string, [number, number, number]>;
  preserveSkinning?: boolean;
  origin?: 'skeleton';
}
export interface RetargetSlot {
  bone: string;
  label: string;
  group: string;
  required?: boolean;
  aliases: string[];
}
const slot = (
  bone: string,
  label: string,
  group: string,
  aliases: string[],
  required = false,
): RetargetSlot => ({ bone, label, group, aliases: [bone, ...aliases], required });
export const RETARGET_SLOTS: RetargetSlot[] = [
  slot('pelvis', 'Hips', 'Body', ['root.x', 'hips', 'hip', 'RigPelvis', 'Bip01 Pelvis'], true),
  slot('spine_01', 'Lower spine', 'Body', ['spine', 'RigSpine1', 'Bip01 Spine'], true),
  slot('spine_02', 'Mid spine', 'Body', ['spine1', 'RigSpine2', 'Bip01 Spine1']),
  slot('spine_03', 'Chest', 'Body', ['spine2', 'chest', 'RigSpine3', 'Bip01 Spine2']),
  slot('spine_04', 'Upper chest', 'Body', ['spine3', 'upperchest']),
  slot('spine_05', 'Shoulder line', 'Body', ['spine4', 'RigRibcage']),
  slot('neck_01', 'Neck', 'Body', ['neck', 'RigNeck', 'Bip01 Neck']),
  slot('neck_02', 'Upper neck', 'Body', ['neck1']),
  slot('head', 'Head', 'Body', ['RigHead', 'Bip01 Head'], true),
  ...(['l', 'r'] as const).flatMap((side) => {
    const word = side === 'l' ? 'Left' : 'Right',
      letter = side.toUpperCase(),
      group = word + ' arm';
    const bones = [
      slot('clavicle_' + side, word + ' shoulder', group, [
        word + 'Shoulder',
        'Rig' + letter + 'Collarbone',
        'Bip01 ' + letter + ' Clavicle',
      ]),
      slot(
        'upperarm_' + side,
        word + ' upper arm',
        group,
        [
          word + 'Arm',
          word + 'UpperArm',
          'Rig' + letter + 'Upperarm',
          'Bip01 ' + letter + ' UpperArm',
        ],
        true,
      ),
      slot(
        'lowerarm_' + side,
        word + ' forearm',
        group,
        [
          word + 'ForeArm',
          word + 'LowerArm',
          'Rig' + letter + 'Forearm',
          'Bip01 ' + letter + ' Forearm',
        ],
        true,
      ),
      slot(
        'hand_' + side,
        word + ' hand',
        group,
        [word + 'Hand', 'Rig' + letter + 'Palm', 'Bip01 ' + letter + ' Hand'],
        true,
      ),
      slot(
        'thigh_' + side,
        word + ' thigh',
        word + ' leg',
        [word + 'UpLeg', word + 'UpperLeg', 'Rig' + letter + 'Thigh', 'Bip01 ' + letter + ' Thigh'],
        true,
      ),
      slot(
        'calf_' + side,
        word + ' shin',
        word + ' leg',
        [word + 'Leg', word + 'LowerLeg', 'Rig' + letter + 'Calf', 'Bip01 ' + letter + ' Calf'],
        true,
      ),
      slot(
        'foot_' + side,
        word + ' foot',
        word + ' leg',
        [word + 'Foot', 'Rig' + letter + 'Foot', 'Bip01 ' + letter + ' Foot'],
        true,
      ),
      slot('ball_' + side, word + ' toes', word + ' leg', [
        word + 'ToeBase',
        word + 'Toes',
        'Rig' + letter + 'Toe11',
        'Bip01 ' + letter + ' Toe0',
      ]),
    ];
    for (const [i, digit] of ['thumb', 'index', 'middle', 'ring', 'pinky'].entries())
      for (let joint = 1; joint <= 3; joint++)
        bones.push(
          slot(`${digit}_0${joint}_${side}`, `${word} ${digit} ${joint}`, word + ' fingers', [
            `${word}Hand${digit}${joint}`,
            `${word}${digit}${joint}`,
            `Rig${letter}Finger${i + 1}${joint}`,
            `Bip01 ${letter} Finger${i}${joint === 1 ? '' : joint - 1}`,
          ]),
        );
    for (const stem of ['upperarm', 'lowerarm', 'thigh', 'calf'])
      for (const j of [1, 2])
        bones.push(
          slot(
            `${stem}_twist_0${j}_${side}`,
            `${word} ${stem} twist ${j}`,
            word + (stem.includes('arm') ? ' arm' : ' leg'),
            [],
          ),
        );
    return bones;
  }),
];

// Common deform-bone names used by Auto-Rig Pro. Controller bones are avoided
// except finger controls where ARP stores the authored segment motion.
for (const s of RETARGET_SLOTS) {
  const side = s.bone.endsWith('_l') ? 'l' : s.bone.endsWith('_r') ? 'r' : undefined;
  const base = s.bone.replace(/_[lr]$/, '');
  if (side) {
    const aliases: Record<string, string> = {
      clavicle: 'shoulder',
      upperarm: 'arm_stretch',
      lowerarm: 'forearm_stretch',
      hand: 'hand',
      thigh: 'thigh_stretch',
      calf: 'leg_stretch',
      foot: 'foot',
      ball: 'toes_01',
    };
    if (aliases[base]) s.aliases.push(aliases[base] + '.' + side);
    const finger = base.match(/^(thumb|index|middle|ring|pinky)_0([123])$/);
    if (finger)
      s.aliases.push(
        (finger[2] === '1' ? finger[1] + '1' : 'c_' + finger[1] + finger[2]) + '.' + side,
      );
  } else
    s.aliases.push(
      ({ neck_01: 'neck_twist.x', neck_02: 'neck.x', head: 'head.x' } as Record<string, string>)[
        s.bone
      ] ?? s.bone + '.x',
    );
}
const normalizeBone = (name: string) =>
  name
    .replace(/^.*[:|]/, '')
    .replace(/^mixamorig\d*/i, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
export function autoMapBones(names: string[]) {
  const mapping: Record<string, string> = {},
    used = new Set<string>();
  for (const s of RETARGET_SLOTS) {
    const exact = names.find((n) => n === s.bone && !used.has(n)),
      match =
        exact ??
        names.find(
          (n) => !used.has(n) && s.aliases.some((a) => normalizeBone(a) === normalizeBone(n)),
        );
    if (match) {
      mapping[s.bone] = match;
      used.add(match);
    }
  }
  return mapping;
}
export function defaultHiddenMeshes(names: string[], exampleOutfit = false) {
  // Modular packs ship several overlapping bodies in a single FBX. Start with
  // one variant from each numbered family; all parts remain available in UI.
  const seen = new Set<string>(),
    hidden: string[] = [];
  for (const name of [...names].sort()) {
    const family = name.replace(/_/g, ' ').match(/^(\d{2}\s+\D+?)\s+\d+$/)?.[1];
    if (family) {
      if (seen.has(family)) hidden.push(name);
      else seen.add(family);
    }
  }
  if (exampleOutfit) {
    for (const family of ['02_Torso_', '03_Bottom_', '04_Feet_']) {
      const chosen = names.find((n) => n === family + '03');
      if (chosen) {
        const index = hidden.indexOf(chosen);
        if (index >= 0) hidden.splice(index, 1);
        for (const name of names)
          if (name.startsWith(family) && name !== chosen && !hidden.includes(name))
            hidden.push(name);
      }
    }
  }
  return hidden;
}
export function mappingIssues(mapping: Record<string, string>, names: string[]) {
  const known = new Set(names),
    used = new Set<string>(),
    missing: string[] = [],
    duplicates: string[] = [];
  for (const s of RETARGET_SLOTS) {
    const n = mapping[s.bone];
    if (s.required && (!n || !known.has(n))) missing.push(s.label);
    if (n) {
      if (used.has(n)) duplicates.push(n);
      used.add(n);
    }
  }
  return { missing, duplicates, ready: !missing.length && !duplicates.length };
}
export function validateCharacters(input: unknown): RetargetCharacter[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 8) throw Error('Invalid character library.');
  const ids = new Set<string>(),
    allowed = new Set(RETARGET_SLOTS.map((s) => s.bone));
  for (const c of input) {
    if (c.origin !== undefined && c.origin !== 'skeleton') throw Error('Invalid character origin.');
    if (c.preserveSkinning !== undefined && typeof c.preserveSkinning !== 'boolean')
      throw Error('Invalid skinning setting.');
    if (
      !c ||
      typeof c.id !== 'string' ||
      !c.id ||
      c.id.length > 100 ||
      ids.has(c.id) ||
      typeof c.name !== 'string' ||
      !c.name.trim() ||
      c.name.length > 100 ||
      typeof c.asset !== 'string' ||
      !/^([a-f0-9]{64}|example-fantasy-(male|female))$/.test(c.asset)
    )
      throw Error('Invalid retarget character.');
    ids.add(c.id);
    if (
      !c.mapping ||
      typeof c.mapping !== 'object' ||
      Array.isArray(c.mapping) ||
      Object.entries(c.mapping).some(
        ([k, v]) => !allowed.has(k) || typeof v !== 'string' || v.length > 200,
      ) ||
      new Set(Object.values(c.mapping).filter(Boolean)).size !==
        Object.values(c.mapping).filter(Boolean).length
    )
      throw Error('Invalid bone mapping.');
    if (
      !Array.isArray(c.hiddenMeshes) ||
      c.hiddenMeshes.length > 500 ||
      c.hiddenMeshes.some((n: unknown) => typeof n !== 'string' || n.length > 200) ||
      !Number.isFinite(c.scale) ||
      c.scale < 0.01 ||
      c.scale > 100 ||
      !Number.isFinite(c.facing) ||
      Math.abs(c.facing) > 360 ||
      typeof c.handIK !== 'boolean' ||
      typeof c.footIK !== 'boolean'
    )
      throw Error('Invalid retarget settings.');
    if (
      !c.offsets ||
      typeof c.offsets !== 'object' ||
      Object.entries(c.offsets).some(
        ([k, v]) =>
          !allowed.has(k) ||
          !Array.isArray(v) ||
          v.length !== 3 ||
          v.some((n) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 180),
      )
    )
      throw Error('Invalid retarget pose correction.');
  }
  return input;
}

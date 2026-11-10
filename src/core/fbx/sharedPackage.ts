import type { Vector3 } from 'three';
import type { SharedExportItem, SharedExportPlan } from '../sharedExport';
import { safeName, sharedAnimationFbx, sharedCharacterFbx, sharedPropFbx } from './unreal';

/** Reject a plan that could not be written as a consistent package. */
export function validatePlan(p: SharedExportPlan): SharedExportPlan {
  const label = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 160;
  if (
    !p ||
    p.version !== 2 ||
    !label(p.name) ||
    !Array.isArray(p.characters) ||
    !p.characters.length ||
    p.characters.length > 100 ||
    p.characters[0]?.id !== 'manny' ||
    !Array.isArray(p.clips) ||
    !p.clips.length ||
    !Array.isArray(p.sockets) ||
    !Array.isArray(p.props)
  )
    throw Error('Invalid shared export plan.');
  for (const list of [p.characters, p.clips, p.sockets, p.props])
    if (new Set(list.map((v) => v.id)).size !== list.length)
      throw Error('Duplicate export identity.');
  for (const c of p.characters)
    if (!label(c.id) || !label(c.name)) throw Error('Invalid character identity.');
  for (const s of p.sockets)
    if (
      !label(s.id) ||
      !/^pose_prop_[a-f0-9]{8}$/.test(s.bone) ||
      !/^prop_[a-f0-9]{8}$/.test(s.socket) ||
      !['root', 'hand_r', 'hand_l'].includes(s.parent)
    )
      throw Error('Invalid prop socket.');
  if (new Set(p.sockets.map((s) => s.bone)).size !== p.sockets.length)
    throw Error('Conflicting prop socket names.');
  for (const v of p.props) {
    const s = v.settings;
    if (
      !label(v.id) ||
      !s ||
      !label(s.name) ||
      typeof s.asset !== 'string' ||
      !Number.isFinite(s.scale) ||
      s.scale <= 0 ||
      s.scale > 1e4 ||
      [s.offset, s.rotation].some(
        (a) =>
          !Array.isArray(a) ||
          a.length !== 3 ||
          a.some((x) => !Number.isFinite(x) || Math.abs(x) > 1e5),
      )
    )
      throw Error('Invalid prop settings.');
  }
  for (const c of p.clips) {
    if (
      !label(c.id) ||
      !label(c.name) ||
      !['body', 'firstPerson'].includes(c.type) ||
      !Number.isInteger(c.fps) ||
      c.fps < 1 ||
      c.fps > 120 ||
      !Number.isInteger(c.end) ||
      c.end < 1 ||
      c.end > 2400 ||
      !Array.isArray(c.props)
    )
      throw Error('Invalid animation.');
    for (const b of c.props)
      if (
        !p.sockets.some((s) => s.id === b.slot) ||
        !p.props.some((v) => v.id === b.asset) ||
        typeof b.visible !== 'boolean'
      )
        throw Error('Invalid animation prop binding.');
  }
  return structuredClone(p);
}
/** A clip may be sampled at a whole multiple of its frame rate, up to 64 times. */
export function validateSampleRate(clip: { fps: number }, rate: number) {
  if (!Number.isInteger(rate) || rate < clip.fps || rate > clip.fps * 64 || rate % clip.fps !== 0)
    throw Error('Invalid animation sample rate.');
  return rate;
}

const README = `POSE — SHARED UNREAL SKELETON (UE 5.6+)

1. Enable Python Editor Script Plugin and Editor Scripting Utilities in Unreal.
2. Choose Tools > Execute Python Script and select import_shared_unreal.py.
   The script imports the meshes and one animation set, assigns one Skeleton,
   configures translation modes and creates prop sockets. No script edits.

Every character has Body, Arms and Legs meshes using the same bone hierarchy.
Each mesh keeps its own inverse bind pose, height and shoulder width.
Animations/ contains ONE file per source clip. Use these same AnimSequences
and your normal Animation Blueprint on every character. No IK Retargeter,
extra source component, or per-character copies are required.

Translation modes on the shared Skeleton preserve the playing mesh's lengths:
- Skeleton for bones with fixed local translations.
- AnimationScaled for the pelvis.
- AnimationRelative for clavicles: retain authored offsets without rotating
  them toward each mesh's different shoulder vector.
- OrientAndScale for authored translation offsets on other deform bones.
- Animation for root motion, IK markers and prop attachment bones.
The exact per-bone modes are in manifest.json (translationModes).

Body and Legs use full-body clips. Arms can play first-person clips.
Use separate Skeletal Mesh Components when arms and legs play different clips.
For first-person playback, attach the arms component to the player camera at
its authored placement.

Props are STATIC meshes. Attach the component to its manifest socket with
Snap to Target (location and rotation), unit relative scale. Each prop
socket has its own animated attachment bone under root. This preserves camera-
authored gun motion and magazine release without inheriting retargeted wrists. Each clip's props list identifies the mesh.
Bone-length adaptation shares motion, not exact end-effector positions: for
precise two-hand contact on differently proportioned arms, use hand IK in your
Animation Blueprint. Foot locking likewise belongs in your gameplay IK setup.

Manual import: import Manny Body first, then choose its Skeleton for every
other mesh and animation. Leave Update Skeleton Reference Pose and Use T0 As
Ref Pose OFF. Preserve Local Transform ON; use the exported sample rate.
In the Skeleton Tree enable Show Retargeting Options and set the modes listed
in manifest.json. Add each socket on its manifest bone at identity transform.
Do not recursively force Animation mode: that stretches meshes to Manny.

The importer verifies the shared Skeleton assignments and translation modes.
If your engine prevents writing modes, imported assets are retained; follow
the manual steps and rerun the script to verify and finish setup.
`;

type Hierarchy = { name: string; parent: string | null }[];
/**
 * Builds a shared-skeleton package for Unreal from the baked meshes and clips:
 * FBX files, textures, the import script, a readme and the manifest tying them together.
 */
export class SharedPackage {
  private plan: SharedExportPlan;
  private files: string[] = [];
  private hierarchy?: Hierarchy;
  private offsets?: Record<string, Vector3>;
  private characters: unknown[] = [];
  private animations: unknown[] = [];
  private translated = new Set<string>();
  private pending: { index: number; data: Uint8Array }[] = [];
  private written = new Set<string>();
  constructor(
    plan: SharedExportPlan,
    private write: (path: string, data: Uint8Array) => Promise<void>,
  ) {
    this.plan = validatePlan(plan);
  }
  private async put(path: string, data: Uint8Array) {
    await this.write(path, data);
    if (!this.files.includes(path)) this.files.push(path);
  }
  private check(actual: Hierarchy) {
    if (!this.hierarchy) {
      if (actual.filter((b) => b.parent === null).length !== 1 || actual[0]?.name !== 'root')
        throw Error('The shared skeleton must have one root bone.');
      this.hierarchy = actual;
    } else if (JSON.stringify(actual) !== JSON.stringify(this.hierarchy))
      throw Error('Skeleton hierarchy changed between export items.');
    for (const socket of this.plan.sockets)
      if (!actual.some((b) => b.name === socket.bone))
        throw Error('Missing prop attachment bone: ' + socket.bone);
  }
  /** Add one baked character mesh or clip, as a GLB. */
  async add(item: SharedExportItem, glb: Uint8Array) {
    const ci = this.plan.characters.findIndex((c) => c.id === item?.characterId),
      ai = this.plan.clips.findIndex((c) => c.id === item?.clipId);
    if (ci >= 0 === ai >= 0 || (item?.characterId !== undefined && item?.clipId !== undefined))
      throw Error('Unknown shared export item.');
    if (ai < 0 && item.sampleRate !== undefined)
      throw Error('Sample rates apply to animations only.');
    if (ai >= 0) {
      const clip = this.plan.clips[ai];
      clip.sampleRate = validateSampleRate(clip, item.sampleRate ?? clip.fps);
      this.written.add('clip:' + ai);
      // Clips are measured against the first character's skeleton, so they wait for it.
      if (this.offsets) await this.animation(ai, glb);
      else this.pending.push({ index: ai, data: glb });
      return;
    }
    const character = this.plan.characters[ci],
      label = safeName(character.name) + '_' + ci,
      result = await sharedCharacterFbx(glb, label);
    this.check(result.hierarchy);
    for (const file of result.textures) await this.put(file.path, file.data);
    const meshes: Record<string, string> = {};
    for (const file of result.files) {
      await this.put(file.path, file.data);
      meshes[file.variant] = file.path;
    }
    this.characters[ci] = {
      id: character.id,
      name: character.name,
      meshes,
      referencePose: result.referencePose,
    };
    if (ci === 0) this.offsets = result.offsets;
    this.written.add('character:' + ci);
  }
  private async animation(index: number, glb: Uint8Array) {
    const clip = this.plan.clips[index],
      rate = clip.sampleRate ?? clip.fps,
      result = await sharedAnimationFbx(glb, rate, clip.end * (rate / clip.fps), this.offsets!);
    this.check(result.hierarchy);
    for (const name of result.translated) this.translated.add(name);
    const file = 'Animations/A_' + safeName(clip.name) + '_' + index + '.fbx';
    await this.put(file, result.data);
    this.animations[index] = {
      ...clip,
      file,
      preview: clip.type === 'firstPerson' ? 'arms' : 'body',
    };
  }
  /** Write the props and the package notes. Returns every file of the package. */
  async finish(asset: (id: string) => Promise<Uint8Array>, script: string) {
    for (let c = 0; c < this.plan.characters.length; c++)
      if (!this.written.has('character:' + c)) throw Error('A character mesh is missing.');
    for (let a = 0; a < this.plan.clips.length; a++)
      if (!this.written.has('clip:' + a)) throw Error('A shared animation is missing.');
    for (const item of this.pending.splice(0)) await this.animation(item.index, item.data);
    // Fixed lengths come from the playing mesh. Animated offsets keep their motion
    // while adapting the source translation vector to that mesh's reference vector.
    const translationModes = Object.fromEntries(
      this.hierarchy!.map((b) => [
        b.name,
        b.name === 'root' || /^(ik_|pose_prop_)/.test(b.name)
          ? 'ANIMATION'
          : b.name.startsWith('clavicle_')
            ? 'ANIMATION_RELATIVE'
            : b.name === 'pelvis'
              ? 'ANIMATION_SCALED'
              : this.translated.has(b.name)
                ? 'ORIENT_AND_SCALE'
                : 'SKELETON',
      ]),
    );
    // Prop geometry keeps its physical size and pivot. Motion is carried by the
    // shared skeleton's animated attachment bone, so no prop skeletal mesh is made.
    const props: unknown[] = [];
    for (const [index, prop] of this.plan.props.entries()) {
      const settings = prop.settings,
        result = await sharedPropFbx(
          await asset(settings.asset),
          settings,
          safeName(settings.name) + '_' + index,
        );
      for (const file of result.textures) await this.put(file.path, file.data);
      await this.put(result.path, result.data);
      props.push({ id: prop.id, name: settings.name, file: result.path });
    }
    const text = (value: string) => new TextEncoder().encode(value);
    await this.put('import_shared_unreal.py', text(script));
    await this.put('UNREAL-IMPORT.txt', text(README));
    this.files.push('manifest.json');
    await this.write(
      'manifest.json',
      text(
        JSON.stringify(
          {
            version: 2,
            complete: true,
            name: this.plan.name,
            skeleton: 'SKEL_PoseShared',
            hierarchy: this.hierarchy,
            characters: this.characters,
            animations: this.animations,
            props,
            translationModes,
            sockets: this.plan.sockets,
            coordinateSystem: 'FBX X-forward Z-up; centimeters',
            animationPolicy: 'one canonical animation set; per-mesh reference translations',
            files: this.files,
          },
          null,
          2,
        ),
      ),
    );
    return this.files;
  }
}

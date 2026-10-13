import { Bone, Matrix4 } from 'three';
import { controllerConstraints } from '../core/controllerConstraints';
import { boneFollowing } from '../core/boneFollowing';
import { evaluate, limbMode, matrix } from '../core/model';
import type { ControlId, Pose, Project } from '../core/model';
import { poseRig } from './rig';
import type { MannyRig } from './rig';
import type { sharedRuntimeRig } from './sharedRuntimeRig';

const CONTROLLER_INPUTS = [
  'hand_l',
  'hand_r',
  'elbow_l',
  'elbow_r',
  'foot_l',
  'foot_r',
  'knee_l',
  'knee_r',
] as const;
export interface SharedRuntimeInputLayout {
  version: 2;
  space: 'source-component';
  carrier: string;
  reference: { driver: string; bone: string }[];
  calibration: { driver: string; bone: string }[];
  controllers: { control: ControlId; bone: string }[];
  camera: string;
  /** Translation XYZ stores partial source, first-person clip, FK-reference
   * flags as 0/1. These are dimensionless values carried in meter channels;
   * a centimeter runtime divides the imported translation by 100. */
  settings: string;
}

/** Source reference, frame-zero calibration and evaluated controller targets
 * travel inside the one shared animation. They are ordinary unweighted bones,
 * so FBX and AnimSequence preserve them without a sidecar animation or plugin.
 * The carrier cancels the animated root: these are source-component transforms,
 * not points that should inherit another copy of root motion.
 *
 * This stream belongs to the runtime format, never the translation-only export.
 * The runtime importer must retain Animation translation mode for these bones.
 */
export function sharedRuntimeInputs(output: ReturnType<typeof sharedRuntimeRig>) {
  const layout: SharedRuntimeInputLayout = {
    version: 2,
    space: 'source-component',
    carrier: 'pose_input_space',
    reference: output.bindings.map(({ driver }) => ({ driver, bone: 'pose_reference_' + driver })),
    calibration: output.bindings.map(({ driver }) => ({
      driver,
      bone: 'pose_calibration_' + driver,
    })),
    controllers: CONTROLLER_INPUTS.map((control) => ({ control, bone: 'pose_input_' + control })),
    camera: 'pose_input_camera',
    settings: 'pose_input_settings',
  };
  const names = [
    layout.carrier,
    ...layout.reference.map((x) => x.bone),
    ...layout.calibration.map((x) => x.bone),
    ...layout.controllers.map((x) => x.bone),
    layout.camera,
    layout.settings,
  ];
  if (names.some((n) => output.bones.has(n)))
    throw Error('Shared runtime input bone name conflicts with the exported rig.');
  const skeletons = new Set([...output.variants.map((m) => m.skeleton), output.dummy.skeleton]);
  for (const skeleton of skeletons)
    if (skeleton.bones.length + names.length > 65536)
      throw Error('The shared runtime inputs exceed the glTF joint-index range.');
  const bones = new Map<string, Bone>();
  const root = output.bones.get('root')!;
  for (const name of names) {
    const bone = new Bone();
    bone.name = name;
    bones.set(name, bone);
    (name === layout.carrier ? root : bones.get(layout.carrier)!).add(bone);
    output.bones.set(name, bone);
  }
  const carrier = bones.get(layout.carrier)!;
  root.updateWorldMatrix(true, false);
  root.matrixWorld.clone().invert().decompose(carrier.position, carrier.quaternion, carrier.scale);
  carrier.updateMatrixWorld(true);
  for (const skeleton of skeletons) {
    skeleton.bones.push(...bones.values());
    skeleton.boneInverses.push(...[...bones.values()].map((b) => b.matrixWorld.clone().invert()));
    skeleton.init();
  }
  output.hierarchy.push(...[...bones].map(([name, b]) => ({ name, parent: b.parent!.name })));
  output.root.userData = { ...output.root.userData, poseRuntimeInputs: layout };
  let project: Project | undefined,
    referenceRig: MannyRig | undefined,
    revision = -1;
  const reference = new Map<string, Matrix4>(),
    calibration = new Map<string, Matrix4>();
  const setWorld = (bone: Bone, world: Matrix4) => {
    bone.parent!.updateWorldMatrix(true, false);
    bone
      .parent!.matrixWorld.clone()
      .invert()
      .multiply(world)
      .decompose(bone.position, bone.quaternion, bone.scale);
    bone.updateWorldMatrix(false, false);
  };
  const identity = new Matrix4();
  return {
    layout,
    /** Call after output.sync and sampleSource. Sampling another frame never
     * changes the calibration. Replacing the project or source rest invalidates
     * it; export projects are immutable for the lifetime of a bake. */
    sync(source: MannyRig, p: Project, values: Record<ControlId, Pose>, camera: Matrix4) {
      if (project !== p || referenceRig !== source || revision !== source.motionRevision) {
        const nextReference = new Map<string, Matrix4>(),
          nextCalibration = new Map<string, Matrix4>();
        for (const { driver } of layout.reference) {
          const rest = source.rest.get(driver);
          if (!rest) throw Error('Missing source reference bone: ' + driver);
          nextReference.set(driver, rest.world.clone());
        }
        // Match ProportionalRig.floatingCalibration: evaluate frame zero on a
        // separate source rig, before retarget/contact adaptation. Do not seek or
        // mutate the currently sampled source to obtain this reference.
        const donor = poseRig(source),
          zero = evaluate(p, 0);
        donor.setMotionRig(p.motionRig);
        donor.apply(
          zero,
          Object.fromEntries(
            (['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const).map((id) => [id, limbMode(p, id, 0)]),
          ),
          boneFollowing(p, 0),
          p.ikReference === 'fk',
          controllerConstraints(p),
        );
        for (const { driver } of layout.calibration) {
          const b = donor.bones.get(driver);
          if (!b) throw Error('Missing source calibration bone: ' + driver);
          nextCalibration.set(driver, b.matrixWorld.clone());
        }
        reference.clear();
        calibration.clear();
        for (const [name, value] of nextReference) reference.set(name, value);
        for (const [name, value] of nextCalibration) calibration.set(name, value);
        setWorld(carrier, identity);
        for (const { driver, bone } of layout.reference)
          setWorld(bones.get(bone)!, reference.get(driver)!);
        for (const { driver, bone } of layout.calibration)
          setWorld(bones.get(bone)!, calibration.get(driver)!);
        setWorld(
          bones.get(layout.settings)!,
          new Matrix4().makeTranslation(
            p.motionRig?.partial ? 1 : 0,
            p.editing === 'firstPerson' ? 1 : 0,
            p.ikReference === 'fk' ? 1 : 0,
          ),
        );
        project = p;
        referenceRig = source;
        revision = source.motionRevision;
      }
      setWorld(carrier, identity);
      // References stay fixed in source-component space. Updating the carrier
      // restores their world transforms after root motion without rewriting every
      // constant reference/calibration channel on every subframe.
      carrier.updateMatrixWorld(true);
      for (const { control, bone } of layout.controllers) {
        if (!values[control]) throw Error('Missing shared controller input: ' + control);
        setWorld(bones.get(bone)!, matrix(values[control]));
      }
      setWorld(bones.get(layout.camera)!, camera);
    },
  };
}

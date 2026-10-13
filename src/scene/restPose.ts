import { CONTROLS } from '../core/controls';
import { boneFollowing } from '../core/boneFollowing';
import { controllerConstraints } from '../core/controllerConstraints';
import { IDS, pose, evaluate, matrix, fromMatrix, rawForWorld, limbMode } from '../core/model';
import type { ControlId, Pose, Project, V3 } from '../core/model';
import { MannyRig, poseRig } from './rig';
import { AttachmentSolver } from './attachments';

/** Rest targets are skeleton transforms, not zeroes or the demo's grip pose.
 * Solve on isolated bones so reset never disturbs the visible scene. */
export class RestPoseSampler {
  private rest: MannyRig;
  private current: MannyRig;
  private attachments = new AttachmentSolver();
  constructor(reference: MannyRig) {
    this.rest = poseRig(reference);
    this.current = poseRig(reference);
  }
  sample = (
    id: ControlId,
    kind: 'location' | 'rotation' | 'all',
    project: Project,
    frame: number,
    drafts: Partial<Record<ControlId, Pose>>,
  ): Pose | undefined => {
    const control = CONTROLS[id];
    if (!control.limb || !['target', 'pole'].includes(control.kind)) return;
    const values = evaluate(project, frame, drafts),
      floating = project.editing === 'firstPerson' && project.bodyBase?.source.editing !== 'body';
    for (const rig of [this.rest, this.current]) {
      rig.floating = floating;
      rig.setMotionRig(project.motionRig);
    }
    const restValues = Object.fromEntries(IDS.map((key) => [key, pose()])) as Record<
      ControlId,
      Pose
    >;
    restValues.root = values.root;
    this.rest.apply(restValues, { arm_l: 'fk', arm_r: 'fk', leg_l: 'fk', leg_r: 'fk' });
    this.current.apply(
      values,
      Object.fromEntries(
        (['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const).map((limb) => [
          limb,
          limbMode(project, limb, frame),
        ]),
      ),
      boneFollowing(project, frame),
      project.ikReference === 'fk',
      controllerConstraints(project),
    );
    this.attachments.apply(this.current, values, project, frame);
    const target = fromMatrix(this.rest.bodyBone(id).matrixWorld, values[id]);
    if (control.kind === 'pole') {
      const arm = control.limb.startsWith('arm'),
        side = id.at(-1)!,
        start = this.rest.position((arm ? 'upperarm_' : 'thigh_') + side),
        mid = this.rest.position((arm ? 'lowerarm_' : 'calf_') + side),
        end = this.rest.position((arm ? 'hand_' : 'foot_') + side),
        axis = end.clone().sub(start).normalize();
      const bend = mid.clone().sub(start).addScaledVector(axis, -mid.clone().sub(start).dot(axis));
      if (bend.lengthSq() < 1e-10) {
        bend.set(0, 0, 1).transformDirection(matrix(values.root));
        bend.addScaledVector(axis, -bend.dot(axis));
        if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0).addScaledVector(axis, -axis.x);
      }
      target.p = mid.addScaledVector(bend.normalize(), 0.35).toArray() as V3;
      target.q = [0, 0, 0, 1];
    }
    const desired = {
      ...values[id],
      p: kind === 'rotation' ? values[id].p : target.p,
      q: kind === 'location' ? values[id].q : target.q,
    };
    const input = this.attachments.input(id, matrix(desired)) ?? matrix(desired);
    return rawForWorld(project, id, frame, fromMatrix(input, desired), drafts);
  };
}

import {Matrix4} from 'three';
import {CAMERA_REFERENCE,matrix} from '../core/model';
import type {Pose,Project} from '../core/model';
import type {MannyRig} from './rig';

/** An authored socket drives the lens relative to the first-person mesh.
 * The ordinary camera control still positions the entire player rig. Keeping
 * those two transforms separate prevents head motion cancelling itself out. */
export function animationCamera(project:Project,rig:MannyRig,camera:Pose){
 const binding=project.cameraBinding,bone=binding?.enabled&&rig.bones.get(binding.bone);
 if(!binding||!bone)return matrix(camera);
 bone.updateWorldMatrix(true,false);
 const parent=rig.root.parent?.matrixWorld??new Matrix4();
 const socket=parent.clone().invert().multiply(bone.matrixWorld).multiply(new Matrix4().fromArray(binding.offset));
 return matrix(camera).multiply(matrix(CAMERA_REFERENCE).invert()).multiply(socket);
}

/** Convert a lens gizmo edit back to the editable player-rig transform. */
export function cameraControl(project:Project,rig:MannyRig,lens:Matrix4,camera:Pose){
 return lens.clone().multiply(animationCamera(project,rig,camera).invert()).multiply(matrix(camera));
}

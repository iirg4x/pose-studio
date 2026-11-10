import { Matrix4, Quaternion, Vector3 } from 'three';

const position = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);
/** The joint each limb bone points at. */
const NEXT: Record<string, string> = {
  clavicle: 'upperarm',
  upperarm: 'lowerarm',
  lowerarm: 'hand',
  thigh: 'calf',
  calf: 'foot',
  hand: 'middle_01',
};

/**
 * The finger that spans the palm together with the index finger. Skeletons being
 * compared must measure the palm the same way, so this is the outermost finger
 * that every one of them has: a three-fingered hand has no pinky.
 */
export function palmFinger(side: string, ...has: ((bone: string) => boolean)[]) {
  return ['pinky', 'ring', 'middle'].find((digit) => has.every((h) => h(`${digit}_01_${side}`)));
}

/**
 * World orientation of a bone described by anatomy rather than by its own axes:
 * X along the bone, Z towards "up" (the back of the hand for hands and fingers).
 * Two skeletons in different rest poses are aligned by comparing these frames.
 *
 * Animation import and character binding both use this one definition. A clip
 * imported from a character's own skeleton then plays back on that character
 * exactly as authored; two separate rules leave a constant twist on every bone
 * where they disagree.
 *
 * Twist bones use the frame of the segment they belong to.
 *
 * Bones without a frame (spine, neck, head, feet, toes) transfer their motion as
 * a plain difference from rest. A foot keeps its sole flat: its bone is tilted
 * differently in every skeleton, so pointing it along another skeleton's foot
 * bone would tip the whole foot.
 */
export function anatomicalFrame(
  name: string,
  worlds: { get(bone: string): Matrix4 | undefined },
  palm?: string,
): Quaternion | null {
  // A twist bone lies along its limb segment and has to turn with it. Left to a
  // plain rest difference it keeps the other skeleton's arm angle: on an A-pose
  // target driven from a T-pose source, every twist bone sat about 50 degrees
  // away from the arm it deforms.
  const twist = /^(upperarm|lowerarm|thigh|calf)_twist_\d+(_[lr])$/.exec(name);
  if (twist) return worlds.get(name) ? anatomicalFrame(twist[1] + twist[2], worlds, palm) : null;
  const current = worlds.get(name);
  if (!current) return null;
  const side = name.endsWith('_l') ? 'l' : 'r',
    stem = name.slice(0, -2),
    next = NEXT[stem],
    target = next && worlds.get(next + '_' + side);
  const digit = /^(thumb|index|middle|ring|pinky)_0([123])_[lr]$/.exec(name);
  let direction: Vector3 | undefined;
  if (target) direction = position(target).sub(position(current));
  else if (digit) {
    const joint = Number(digit[2]),
      other = worlds.get(digit[1] + '_0' + (joint === 3 ? 2 : joint + 1) + '_' + side);
    if (other) {
      direction =
        joint === 3
          ? position(current).sub(position(other))
          : position(other).sub(position(current));
      if (joint === 3 && direction.lengthSq() > 1e-12) {
        // A terminal phalanx has no child joint. Its predecessor describes the
        // middle phalanx, not this bone's axis; using it transfers bind-pose curl.
        const previous = direction.clone().normalize(),
          axes = [0, 1, 2].map((i) => new Vector3().setFromMatrixColumn(current, i).normalize());
        axes.sort((a, b) => Math.abs(b.dot(previous)) - Math.abs(a.dot(previous)));
        if (Math.abs(axes[0].dot(previous)) > 0.85)
          direction = axes[0].multiplyScalar(Math.sign(axes[0].dot(previous)));
      }
    }
  }
  if (!direction || direction.lengthSq() < 1e-12) return null;
  const x = direction.normalize();
  let up = new Vector3(0, 0, 1);
  if (stem === 'hand' || digit) {
    const hand = worlds.get('hand_' + side),
      index = worlds.get('index_01_' + side),
      outer = palm && palm !== 'index' ? worlds.get(palm + '_01_' + side) : undefined;
    if (hand && index && outer) {
      const normal = position(index)
        .sub(position(hand))
        .cross(position(outer).sub(position(hand)));
      if (normal.lengthSq() > 1e-12) up = normal.normalize();
    }
  }
  if (Math.abs(up.dot(x)) > 0.98) up.set(0, 1, 0);
  const z = up.addScaledVector(x, -up.dot(x)).normalize(),
    y = z.clone().cross(x).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

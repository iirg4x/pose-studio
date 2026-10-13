import { Euler, Matrix4, Quaternion } from 'three';
import { clone, fromMatrix, matrix, pose, trackMatrix } from './model';
import type { ControlId, Pose, Project } from './model';
import { isOffsetControl } from './controls';
import { mirrorControlPose, mirrorDestination } from './mirrorPose';
import { channelValue, channelsFor } from './curves';
import type { Channel, Curve } from './curves';
import type { KeyClipboard } from './timelineKeys';
export type MirrorRest = (id: ControlId) => { world: Matrix4; parent: Matrix4 };
const angle = (v: number) => v - Math.round(v / 360) * 360;
export function mirrorTimelineClipboard(
  clipboard: KeyClipboard,
  project: Project,
  rest: MirrorRest,
): KeyClipboard {
  const items: KeyClipboard['items'] = [];
  for (const item of clipboard.items) {
    const target = mirrorDestination(item.id);
    if (!target) continue;
    const source = item.track,
      destination = project.tracks[target],
      a = rest(item.id),
      b = rest(target),
      offset = isOffsetControl(item.id),
      additive = !!source.additive;
    const convert = (value: Pose) => {
      const p = fromMatrix(trackMatrix(source, value), value),
        mirrored = mirrorControlPose(
          p,
          additive && !offset ? new Matrix4() : a.world,
          additive && !offset ? new Matrix4() : b.world,
          offset || additive,
          offset ? a.parent : undefined,
          offset ? b.parent : undefined,
        );
      return destination.basis
        ? fromMatrix(
            new Matrix4()
              .fromArray(destination.basis.pre)
              .invert()
              .multiply(matrix(mirrored))
              .multiply(new Matrix4().fromArray(destination.basis.post).invert()),
            mirrored,
          )
        : mirrored;
    };
    const track = {
      ...clone(source),
      basis: clone(destination.basis),
      rotationOrder: destination.rotationOrder,
      rotationMode: destination.rotationMode,
      keys: source.keys.map((k) => ({ ...k, ...convert(k) })),
      curves: {} as Partial<Record<Channel, Curve>>,
    };
    if (source.layerReference) {
      const r = source.layerReference,
        identity = new Matrix4(),
        reflect = new Matrix4().makeScale(-1, 1, 1);
      const flip = (v: Pose) => mirrorControlPose(v, identity, identity, false);
      track.layerReference = {
        ...clone(r),
        value: mirrorControlPose(
          r.value,
          offset ? a.world : identity,
          offset ? b.world : identity,
          offset,
          offset ? a.parent : undefined,
          offset ? b.parent : undefined,
        ),
        root: flip(r.root),
        parent: r.parent ? flip(r.parent) : undefined,
      };
      if (r.basis) {
        const rotation = (m: Matrix4) => new Matrix4().extractRotation(m),
          parent = reflect
            .clone()
            .multiply(new Matrix4().makeRotationFromQuaternion(new Quaternion(...r.basis.parent)))
            .multiply(rotation(a.parent).invert())
            .multiply(reflect)
            .multiply(rotation(b.parent)),
          local = b.parent.clone().invert().multiply(b.world);
        track.layerReference.basis = {
          parent: new Quaternion().setFromRotationMatrix(parent).normalize().toArray(),
          rest: new Quaternion().setFromRotationMatrix(rotation(local)).normalize().toArray(),
          parentPosition: r.basis.parentPosition
            ? [-r.basis.parentPosition[0], r.basis.parentPosition[1], r.basis.parentPosition[2]]
            : undefined,
          restPosition: [local.elements[12], local.elements[13], local.elements[14]],
        };
      }
    }
    const sourceOrder = source.rotationOrder ?? 'XYZ',
      targetOrder = destination.rotationOrder ?? 'XYZ';
    const groups: Channel[][] = [
      ['px', 'py', 'pz'],
      source.rotationMode === 'quaternion' ? ['qx', 'qy', 'qz', 'qw'] : ['rx', 'ry', 'rz'],
    ];
    if ((source.rotationMode ?? 'euler') !== (destination.rotationMode ?? 'euler'))
      throw Error('Mirrored keys need matching rotation modes on both controls.');
    for (const channels of groups) {
      if (
        !channels.some(
          (c) =>
            source.curves?.[c] ||
            source.curves?.[('blendWeight_' + c) as Channel] ||
            source.curves?.[('blendReplace_' + c) as Channel],
        )
      )
        continue;
      const quaternion = channels[0] === 'qx',
        base = convert(pose()),
        outputs = channels;
      let qColumns: Quaternion[] = [];
      if (quaternion) {
        qColumns = channels.map((_, i) => {
          const q = [0, 0, 0, 0];
          q[i] = 1;
          return new Quaternion(...convert(pose(undefined, q as Pose['q'])).q);
        });
        for (let i = 1; i < 4; i++) {
          const q = [0, 0, 0, 0];
          q[0] = q[i] = Math.SQRT1_2;
          const expected = new Quaternion(...convert(pose(undefined, q as Pose['q'])).q),
            sum = new Quaternion(
              ...(qColumns[0].toArray().map((v, k) => v + qColumns[i].toArray()[k]) as Pose['q']),
            ).normalize();
          if (Math.abs(sum.dot(expected)) < 0.999)
            qColumns[i].set(...(qColumns[i].toArray().map((v) => -v) as Pose['q']));
        }
      }
      for (const out of outputs) {
        const outIndex = outputs.indexOf(out),
          baseline = quaternion ? 0 : channelValue(base, out, targetOrder),
          coefficients = channels.map((input, i) => {
            if (quaternion) return qColumns[i].toArray()[outIndex];
            const p = pose();
            if (input.startsWith('p')) p.p[i] = 0.01;
            else {
              const e = [0, 0, 0];
              e[i] = 0.4;
              p.q = new Quaternion()
                .setFromEuler(new Euler(...(e as [number, number, number]), sourceOrder))
                .toArray();
            }
            const raw = channelValue(convert(p), out, targetOrder) - baseline;
            return out.startsWith('r') ? angle(raw) / ((0.4 * 180) / Math.PI) : raw;
          }),
          used = coefficients.flatMap((v, i) => (Math.abs(v) > 1e-4 ? [i] : []));
        if (used.length !== 1 || Math.abs(Math.abs(coefficients[used[0]]) - 1) > 1e-3)
          throw Error(
            'These imported control axes do not match. Mirror a pose to transfer it between different rig spaces.',
          );
        const input = channels[used[0]];
        if (/^[pr][xyz]$/.test(out))
          for (const kind of ['blendWeight_', 'blendReplace_']) {
            const c = source.curves?.[(kind + input) as Channel];
            if (c) track.curves[(kind + out) as Channel] = clone(c);
          }
        const curve = source.curves?.[input];
        if (!curve) continue;
        const factor = Math.sign(coefficients[used[0]]);
        track.curves[out] = {
          ...clone(curve),
          keys: curve.keys.map((k) => ({
            ...clone(k),
            value: k.value * factor + baseline,
            left: k.left ? [k.left[0], k.left[1] * factor] : undefined,
            right: k.right ? [k.right[0], k.right[1] * factor] : undefined,
          })),
        };
      }
    }
    for (const channel of channelsFor(item.id, source).filter(
      (c) => !/^(p[xyz]|r[xyz]|q[xyzw]|blend(?:Weight|Replace)_[pr][xyz])$/.test(c),
    ))
      if (source.curves?.[channel]) track.curves[channel] = clone(source.curves[channel]);
    // Mirror parent identities and captured attachment frames along with the keys.
    const mirroredId = (id: string) => mirrorDestination(id as ControlId) ?? id;
    const reflect = new Matrix4().makeScale(-1, 1, 1),
      rotation = (m: Matrix4) => new Matrix4().extractRotation(m);
    const rightFrame = (id: string) => {
      const other = mirrorDestination(id as ControlId);
      if (!other) return reflect.clone();
      return rotation(rest(id as ControlId).world)
        .invert()
        .multiply(reflect)
        .multiply(rotation(rest(other).world));
    };
    const childFrame = rightFrame(item.id),
      worldFrame = (v: number[], id: string) =>
        reflect.clone().multiply(new Matrix4().fromArray(v)).multiply(rightFrame(id)).toArray();
    track.spaces = track.spaces.map((s) => ({
      ...s,
      parent: mirroredId(s.parent) as typeof s.parent,
      base:
        offset || additive
          ? matrix(
              mirrorControlPose(
                fromMatrix(new Matrix4().fromArray(s.base)),
                additive && !offset ? new Matrix4() : a.world,
                additive && !offset ? new Matrix4() : b.world,
                true,
                offset ? a.parent : undefined,
                offset ? b.parent : undefined,
              ),
            ).toArray()
          : worldFrame(s.base, item.id),
      offset: rightFrame(s.parent)
        .invert()
        .multiply(new Matrix4().fromArray(s.offset))
        .multiply(childFrame)
        .toArray(),
      ...(s.sourceParent
        ? {
            sourceParent: mirroredId(s.sourceParent) as typeof s.sourceParent,
            sourceParentMatrix: worldFrame(s.sourceParentMatrix!, s.sourceParent),
          }
        : {}),
    }));
    if (track.following)
      track.following = track.following.map((f) => {
        const parentFrame =
          f.target && f.target !== 'native'
            ? rightFrame(f.target)
            : rotation(a.parent).invert().multiply(reflect).multiply(rotation(b.parent));
        return {
          ...f,
          target: f.target ? (mirroredId(f.target) as typeof f.target) : undefined,
          world: worldFrame(f.world, item.id),
          local: parentFrame
            .clone()
            .invert()
            .multiply(new Matrix4().fromArray(f.local))
            .multiply(childFrame)
            .toArray(),
          parent: reflect
            .clone()
            .multiply(new Matrix4().fromArray(f.parent))
            .multiply(parentFrame)
            .toArray(),
        };
      });
    items.push({ id: target, frames: [...item.frames], track });
  }
  if (!items.length) throw Error('The copied keys have no matching controls to mirror.');
  return { ...clipboard, items };
}

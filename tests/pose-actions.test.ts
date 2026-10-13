import { describe, it, expect } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { mirrorControlPose, mirrorDestination } from '../src/core/mirrorPose';
import { propControlShape } from '../src/scene/propControlShape';
import { Box3 } from 'three';
import { StudioStore } from '../src/core/store';
import { createProject, clone, evaluate, pose, matrix } from '../src/core/model';
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
const turn = (x: number, y: number, z: number, r: number) =>
  new Matrix4().makeRotationFromQuaternion(
    new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), r),
  );
describe('Pose actions', () => {
  it('maps opposite controls without treating a prop name as a bone', () => {
    expect(mirrorDestination('hand_l')).toBe('hand_r');
    expect(mirrorDestination('thumb_03_r')).toBe('thumb_03_l');
    expect(mirrorDestination('head')).toBe('head');
    expect(mirrorDestination('rifle')).toBeUndefined();
    expect(mirrorDestination('prop:tool_l')).toBeUndefined();
  });
  it('mirrors target position about the moving character root and preserves a double mirror', () => {
    const a = turn(1, 0, 0, 0.6),
      b = turn(0, 0, 1, -0.4),
      root = turn(0, 1, 0, 1.1).setPosition(2, 0, 3),
      local = pose([0.3, 1.2, 0.4], [0.1, 0.2, 0.3, Math.sqrt(0.86)]),
      world = matrix(local).premultiply(root),
      q = new Quaternion(),
      p = new Vector3();
    world.decompose(p, q, new Vector3());
    const value = pose(p.toArray(), q.toArray());
    const mirrored = mirrorControlPose(value, a, b, false, undefined, undefined, root);
    near(
      new Vector3(...mirrored.p).applyMatrix4(root.clone().invert()).toArray(),
      [-0.3, 1.2, 0.4],
    );
    near(
      matrix(mirrorControlPose(mirrored, b, a, false, undefined, undefined, root)).toArray(),
      matrix(value).toArray(),
    );
  });
  it('keeps zero bone offsets neutral with differing rest axes and mirrors offsets reversibly', () => {
    const a = turn(1, 1, 0, 0.8),
      b = turn(0, 1, 1, -1.3),
      pa = turn(1, 0, 1, 0.9),
      pb = turn(1, 1, 0, -0.2),
      value = pose([0.03, 0.02, -0.01], [0.1, 0.2, 0.3, Math.sqrt(0.86)]);
    near(matrix(mirrorControlPose(pose(), a, b, true, pa, pb)).toArray(), new Matrix4().toArray());
    const result = mirrorControlPose(value, a, b, true, pa, pb);
    near(matrix(mirrorControlPose(result, b, a, true, pb, pa)).toArray(), matrix(value).toArray());
  });
  it('pastes to the active layer as an unkeyed preview, then keys and undoes it', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    s.patch({ selected: 'hand_l' });
    s.copySelectedPose();
    const expected = clone(evaluate(s.state.project!, 0).hand_l);
    s.addLayer('additive');
    s.patch({ selected: 'hand_r', autoKey: false });
    s.setFrame(12);
    const before = clone(s.state.project!);
    s.pastePose(s.state.clipboard, true);
    expect(s.state.project).toEqual(before);
    near(evaluate(s.state.project!, 12, s.state.drafts).hand_r.p, expected.p);
    expect(s.state.drafts.hand_r).toBeDefined();
    s.keySelected();
    expect(s.state.project!.tracks.hand_r.keys.some((k) => k.frame === 12)).toBe(true);
    s.undo();
    expect(s.state.project).toEqual(before);
  });
  it('keys pose-layer pastes at its single pose frame and ignores excluded destinations', () => {
    const s = new StudioStore();
    s.open(createProject({}, false));
    s.patch({ selected: 'hand_l' });
    s.copySelectedPose();
    s.addLayer('pose');
    s.patch({ selected: 'hand_r' });
    s.setFrame(20);
    s.pastePose(s.state.clipboard, true);
    expect(s.state.project!.tracks.hand_r.keys.map((k) => k.frame)).toEqual([0]);
    const id = s.state.project!.activeLayerId!;
    s.configureLayer(id, { excluded: ['hand_r'] });
    const before = clone(s.state.project);
    s.pastePose(s.state.clipboard, true);
    expect(s.state.project).toEqual(before);
  });
});
describe('Volumetric prop controls', () => {
  it('has twelve edges, eight corners, and encloses the padded mesh in all three dimensions', () => {
    const box = new Box3(new Vector3(-0.01, -0.08, -0.04), new Vector3(0.01, 0.09, 0.05)),
      positions = propControlShape(box);
    expect(positions).toHaveLength(72);
    const points = Array.from({ length: 24 }, (_, i) => new Vector3().fromArray(positions, i * 3));
    expect(new Set(points.map((p) => p.toArray().join(','))).size).toBe(8);
    const cage = new Box3().setFromPoints(points);
    expect(cage.containsBox(box)).toBe(true);
    near(cage.getSize(new Vector3()).toArray(), [0.034, 0.184, 0.104]);
  });
  it('follows prop scale, placement and rotation without changing bounds or rig transforms', () => {
    const bounds = new Box3(new Vector3(-1, -2, -3), new Vector3(1, 2, 3)),
      before = bounds.clone(),
      placement = turn(0, 1, 0, 0.5).setPosition(4, 5, 6),
      original = placement.clone(),
      points = propControlShape(bounds, placement, 0);
    for (let i = 0; i < points.length; i += 3) {
      const p = new Vector3().fromArray(points, i).applyMatrix4(placement.clone().invert());
      expect(Math.abs(p.x)).toBeCloseTo(1);
      expect(Math.abs(p.y)).toBeCloseTo(2);
      expect(Math.abs(p.z)).toBeCloseTo(3);
    }
    expect(bounds.equals(before)).toBe(true);
    expect(placement.equals(original)).toBe(true);
  });
});

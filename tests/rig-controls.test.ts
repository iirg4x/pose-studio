import { rigLoader } from './rig-loader';
import { describe, it, expect, beforeAll } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import fs from 'node:fs/promises';
import { MannyRig } from '../src/scene/rig';
import {
  createProject,
  evaluate,
  forLayer,
  pose,
  putKey,
  limbMode,
  validateProject,
  clone,
  IDS,
} from '../src/core/model';
import { CONTROLS, LEGACY_IDS, isRotationControl } from '../src/core/controls';
import { matchLimb } from '../src/core/rigMatching';
import { StudioStore } from '../src/core/store';
import { ControlVisual, pickControl } from '../src/scene/controlVisual';
import { PerspectiveCamera } from 'three';
import { addAnimationLayer } from '../src/core/layers';
import { capturePose, applyPose } from '../src/core/library';
let rig: MannyRig;
const near = (a: number[], b: number[], precision = 6) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], precision));
beforeAll(async () => {
  const bytes = await fs.readFile('public/assets/manny.glb');
  rig = new MannyRig(
    (
      await rigLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      )
    ).scene,
  );
});
const apply = (p: ReturnType<typeof createProject>, frame = 0) =>
  rig.apply(
    evaluate(p, frame),
    Object.fromEntries(
      (['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const).map((id) => [id, limbMode(p, id, frame)]),
    ),
  );
describe('Mr Mannequins animator controls', () => {
  it('migrates old projects with neutral offsets and preserves existing animation data', () => {
    const p = createProject(rig.restControls);
    const old = clone(p);
    for (const tracks of [old.tracks, old.otherTracks])
      for (const id of IDS) if (!LEGACY_IDS.includes(id)) delete tracks[id];
    const next = validateProject(old);
    for (const id of LEGACY_IDS) expect(next.tracks[id]).toEqual(p.tracks[id]);
    expect(IDS).toHaveLength(95);
    for (const id of IDS)
      if (CONTROLS[id].bone) expect(rig.bones.has(CONTROLS[id].bone!)).toBe(true);
  });
  it('matches all four limbs IK to FK and back without moving deform bones', () => {
    for (const limb of ['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const) {
      let p = forLayer(createProject(rig.restControls, false), 'body');
      putKey(
        p.tracks.root,
        0,
        pose(
          [0.5, 0.2, -0.3],
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7).toArray(),
        ),
      );
      apply(p);
      const before = rig.deformation();
      p = matchLimb(p, 0, limb, 'fk', rig);
      apply(p);
      for (const [name, m] of Object.entries(rig.deformation()))
        expect(
          Math.max(...m.map((v, i) => Math.abs(v - before[name][i]))),
          limb + ' ' + name,
        ).toBeLessThan(0.0001);
      p = matchLimb(p, 0, limb, 'ik', rig);
      apply(p);
      for (const [name, m] of Object.entries(rig.deformation()))
        expect(
          Math.max(...m.map((v, i) => Math.abs(v - before[name][i]))),
          limb + ' ' + name,
        ).toBeLessThan(0.0001);
      expect(validateProject(p).limbModes).toEqual(p.limbModes);
    }
  });
  it('matches IK and FK through nonidentity curve bases on reconstructed source actions', () => {
    let p = forLayer(createProject(rig.restControls, false), 'body');
    p.ikReference = 'fk';
    for (const id of ['upperarm_l', 'forearm_l', 'wrist_l'] as const)
      p.tracks[id].basis = {
        pre: new Matrix4().toArray(),
        post: new Matrix4().makeRotationX(0.3).toArray(),
      };
    const render = () =>
      rig.apply(
        evaluate(p, 0),
        Object.fromEntries(
          (['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const).map((id) => [id, limbMode(p, id, 0)]),
        ),
        {},
        true,
      );
    render();
    const before = rig.deformation();
    p = matchLimb(p, 0, 'arm_l', 'fk', rig);
    render();
    for (const name of ['upperarm_l', 'lowerarm_l', 'hand_l'])
      expect(
        Math.max(...rig.deformation()[name].map((v, i) => Math.abs(v - before[name][i]))),
      ).toBeLessThan(0.00001);
    p = matchLimb(p, 0, 'arm_l', 'ik', rig);
    render();
    for (const name of ['upperarm_l', 'lowerarm_l', 'hand_l'])
      expect(
        Math.max(...rig.deformation()[name].map((v, i) => Math.abs(v - before[name][i]))),
      ).toBeLessThan(0.00001);
  });
  it('independently poses shoulder, finger joint, neck, knee pole, and foot pivots', () => {
    let p = forLayer(createProject(rig.restControls, false), 'body');
    apply(p);
    const before = rig.deformation();
    const turn = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.25).toArray();
    for (const id of ['shoulder_l', 'index_02_l', 'neck_01', 'ball_l'] as const)
      putKey(p.tracks[id], 0, pose([0, 0, 0], turn));
    putKey(p.tracks.knee_r, 0, pose([-0.5, 0.4, 0.5]));
    apply(p);
    for (const name of ['clavicle_l', 'index_02_l', 'neck_01', 'foot_l', 'calf_r'])
      expect(rig.deformation()[name]).not.toEqual(before[name]);
    for (const m of Object.values(rig.deformation())) expect(m.every(Number.isFinite)).toBe(true);
  });
  it('translates both shoulders on body pose layers while hand IK remains planted', () => {
    for (const side of ['l', 'r'] as const) {
      const id = `shoulder_${side}` as const;
      expect(isRotationControl(id)).toBe(false);
      const p = addAnimationLayer(forLayer(createProject(rig.restControls, false), 'body'), 'pose'),
        s = new StudioStore();
      s.patch({ project: p, selected: id, selection: [id], frame: 12, autoKey: true });
      apply(p, 12);
      const before = rig.position('clavicle_' + side),
        hand = rig.position('hand_' + side),
        parentQ = rig.bodyBone(id).parent!.getWorldQuaternion(new Quaternion()),
        delta = new Vector3(0.015, 0.01, -0.005);
      s.editRaw(id, { ...s.currentPose()!, p: delta.toArray() });
      apply(s.state.project!, 12);
      near(
        rig
          .position('clavicle_' + side)
          .sub(before)
          .toArray(),
        delta.clone().applyQuaternion(parentQ).toArray(),
      );
      near(rig.position('hand_' + side).toArray(), hand.toArray(), 5);
      expect(s.state.project!.tracks[id].keys.map((k) => k.frame)).toEqual([0]);
      s.undo();
      apply(s.state.project!, 12);
      near(rig.position('clavicle_' + side).toArray(), before.toArray());
    }
  });
  it('removes the floating-arm placement offset when converting a dragged shoulder back to keys', () => {
    const floating = new MannyRig(rig.root, true),
      p = createProject(floating.restControls, false),
      id = 'shoulder_l';
    putKey(p.tracks[id], 0, pose([0.015, 0.01, -0.005]));
    const values = evaluate(p, 0);
    floating.apply(values);
    near(
      floating.bodyBone(id).position.clone().sub(floating.offsetPositionBase(id)).toArray(),
      values[id].p,
    );
    rig.reset();
  });
  it('keys mode changes in time and keeps the two rigs independent', () => {
    const p = createProject(rig.restControls, false);
    apply(p);
    const next = matchLimb(p, 12, 'arm_l', 'fk', rig);
    expect(limbMode(next, 'arm_l', 11)).toBe('ik');
    expect(limbMode(next, 'arm_l', 12)).toBe('fk');
    expect(limbMode(forLayer(next, 'body'), 'arm_l', 12)).toBe('ik');
    const bad = clone(next);
    bad.limbModes!.firstPerson!.arm_l!.push({ frame: 12, mode: 'ik' });
    expect(() => validateProject(bad)).toThrow();
  });
  it('copies FK mode with the whole pose and creates a spring/bounce export exercise', async () => {
    let p = forLayer(createProject(rig.restControls, false), 'body');
    p.name = 'Rig and motion exercise';
    p.end = 24;
    apply(p);
    p = matchLimb(p, 0, 'arm_l', 'fk', rig);
    putKey(p.tracks.root, 24, pose([0.2, 0.04, 0.3]));
    putKey(
      p.tracks.shoulder_l,
      24,
      pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.2).toArray()),
    );
    p.tracks.shoulder_l.interpolation = 'spring';
    p.tracks.shoulder_l.spring = { strength: 1, oscillations: 2.5, damping: 5 };
    putKey(
      p.tracks.index_02_l,
      24,
      pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.7).toArray()),
    );
    p.tracks.index_02_l.interpolation = 'bounce';
    p.tracks.index_02_l.bounce = { bounces: 3, height: 0.4, decay: 0.5, impact: 0.35 };
    const fp = forLayer(p, 'firstPerson'),
      start = fp.tracks.rifle.keys[0];
    putKey(fp.tracks.rifle, 24, { ...start, p: [start.p[0], start.p[1] + 0.1, start.p[2] - 0.05] });
    fp.tracks.rifle.interpolation = 'spring';
    const stamp = capturePose(p, 12, {}, 'rig', 'root'),
      copy = applyPose(forLayer(createProject(rig.restControls, false), 'body'), 0, stamp, 'root');
    expect(limbMode(copy, 'arm_l', 0)).toBe('fk');
    apply(p, 12);
    const before = rig.deformation();
    apply(copy, 0);
    for (const [name, m] of Object.entries(rig.deformation())) near(m, before[name], 6);
  });
});
describe('selection and Blender resets', () => {
  it('selects visible active controls, hides per rig, and supports Shift selection', () => {
    const s = new StudioStore();
    s.patch({ project: createProject({}, false) });
    s.selectAll();
    expect(s.state.selection).toContain('root');
    expect(s.state.selection).not.toContain('upperarm_l');
    expect(s.state.selection).not.toContain('head');
    s.hideSelected();
    s.selectAll();
    expect(s.state.selection).toEqual([]);
    s.setLayer('body');
    expect(s.controlVisible('hand_l')).toBe(true);
    s.selectControl('hand_l');
    s.selectControl('hand_r', true);
    expect(s.state.selection).toEqual(['hand_l', 'hand_r']);
    s.selectControl('hand_l', true);
    expect(s.state.selection).toEqual(['hand_r']);
    s.deselectAll();
    expect(s.selectedControls()).toEqual([]);
  });
  it('resets rotation across selection in one undo step without changing locations', () => {
    const s = new StudioStore();
    const p = createProject({}, false);
    for (const id of ['root', 'shoulder_l'] as const)
      putKey(
        p.tracks[id],
        0,
        pose(
          [0.1, 0.2, 0.3],
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4).toArray(),
        ),
      );
    s.patch({ project: p, selection: ['root', 'shoulder_l'], selected: 'root' });
    s.resetSelected('rotation');
    for (const id of ['root', 'shoulder_l'] as const) {
      expect(s.state.project!.tracks[id].keys[0].q).toEqual([0, 0, 0, 1]);
      expect(s.state.project!.tracks[id].keys[0].p).toEqual([0.1, 0.2, 0.3]);
    }
    s.undo();
    expect(s.state.project).toEqual(p);
    s.redo();
    s.resetSelected('location');
    expect(s.state.project!.tracks.root.keys[0].p).toEqual([0, 0, 0]);
  });
  it('keeps resets as drafts with Auto key off, and I keys the selected controls', () => {
    const s = new StudioStore(),
      p = createProject({}, false);
    for (const id of ['root', 'shoulder_l'] as const)
      putKey(
        p.tracks[id],
        0,
        pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4).toArray()),
      );
    s.patch({ project: p, autoKey: false, selection: ['root', 'shoulder_l'], selected: 'root' });
    s.setFrame(12);
    s.resetSelected('rotation');
    expect(s.state.project!.tracks.root.keys).toHaveLength(1);
    expect(Object.keys(s.state.drafts)).toHaveLength(2);
    s.keySelected();
    expect(s.state.project!.tracks.root.keys.at(-1)!.frame).toBe(12);
    expect(s.state.project!.tracks.shoulder_l.keys.at(-1)!.frame).toBe(12);
    s.undo();
    expect(s.state.project!.tracks.root.keys).toHaveLength(1);
  });
  it('picks within an 11-pixel margin and ignores hidden controls', () => {
    const camera = new PerspectiveCamera(45, 1, 0.01, 20);
    camera.position.set(0, 0, 2);
    camera.updateMatrixWorld();
    const visual = new ControlVisual('rifle');
    visual.updateMatrixWorld();
    const p = visual.points
        .map((v) => v.clone().project(camera))
        .reduce((a, b) => (a.x > b.x ? a : b)),
      x = (p.x + 1) * 400,
      y = (1 - p.y) * 400;
    expect(pickControl([visual], camera, 800, 800, x + 8, y, () => true)[0]?.id).toBe('rifle');
    expect(pickControl([visual], camera, 800, 800, x + 30, y, () => true)).toHaveLength(0);
    visual.visible = false;
    expect(pickControl([visual], camera, 800, 800, x, y, () => true)).toHaveLength(0);
    visual.dispose();
  });
});

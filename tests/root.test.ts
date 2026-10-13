import type { ControlId } from '../src/core/controls';
import { rigLoader } from './rig-loader';
import { describe, it, expect } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MannyRig } from '../src/scene/rig';
import {
  createProject,
  evaluate,
  forLayer,
  pose,
  matrix,
  putKey,
  rawForWorld,
  switchParent,
  validateProject,
  clone,
  IDS,
  rootChild,
  rigLocal,
} from '../src/core/model';
import { capturePose, applyPose, library, validateLibrary } from '../src/core/library';
import { rootMotionFrame } from '../src/core/rootMotion';
import { createRifle, createMagazine, geometryData } from '../scripts/example-props';
import { StudioStore } from '../src/core/store';
const near = (a: number[], b: number[], precision = 7) =>
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], precision));
const turn = pose(
  [0.35, 0.08, 0.6],
  new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 3).toArray(),
);
describe('root control', () => {
  it('moves all spatial controls together while keeping pose offsets and camera local', () => {
    const p = forLayer(createProject({}, false), 'body'),
      base = evaluate(p, 0);
    putKey(p.tracks.root, 0, turn);
    const moved = evaluate(p, 0),
      m = matrix(turn);
    for (const id of IDS)
      near(
        matrix(moved[id]).toArray(),
        (rootChild(id)
          ? m.clone().multiply(matrix(base[id]))
          : id === 'root'
            ? m
            : matrix(base[id])
        ).toArray(),
      );
    const local = rigLocal(moved);
    for (const id of IDS.filter(rootChild))
      near(matrix(local[id]).toArray(), matrix(base[id]).toArray());
  });
  it('keeps floating root and body root independent', () => {
    const p = createProject({}, false),
      body = clone(forLayer(p, 'body').tracks);
    putKey(p.tracks.root, 12, turn);
    expect(forLayer(p, 'body').tracks).toEqual(body);
  });
  it('round trips held and free target edits through a moved root', () => {
    let p = createProject({}, false);
    putKey(p.tracks.root, 0, turn);
    for (const id of ['hand_r', 'rifle', 'foot_l'] as const) {
      const desired = pose([0.7, 1.2, 1.4]);
      putKey(p.tracks[id], 0, rawForWorld(p, id, 0, desired));
      near(matrix(evaluate(p, 0)[id]).toArray(), matrix(desired).toArray());
    }
    for (const parent of ['world', 'magazine', 'rifle'] as const) {
      const before = evaluate(p, 0).hand_l;
      p = switchParent(p, 'hand_l', parent, 0);
      near(matrix(evaluate(p, 0).hand_l).toArray(), matrix(before).toArray());
    }
  });
  it('copies a whole pose with the root and resolves parents first', () => {
    const source = forLayer(createProject({}, false), 'body');
    putKey(source.tracks.root, 0, turn);
    const stamp = capturePose(source, 0, {}, 'rig', 'root'),
      target = forLayer(createProject(), 'body');
    putKey(target.tracks.root, 0, pose([4, 0, -3]));
    const pasted = applyPose(target, 48, stamp, 'hand_l');
    for (const id of Object.keys(stamp.poses) as ControlId[])
      near(matrix(evaluate(pasted, 48)[id]).toArray(), matrix(stamp.poses[id]!).toArray());
  });
  it('upgrades old libraries without changing an existing pose', () => {
    const p = createProject(),
      before = evaluate(p, 42),
      old = clone(p) as any;
    delete old.tracks.root;
    delete old.otherTracks.root;
    const upgraded = validateLibrary(library(old)).clips[0].project;
    for (const id of IDS)
      near(matrix(evaluate(upgraded, 42)[id]).toArray(), matrix(before[id]).toArray());
    const bad = clone(p);
    bad.tracks.root.spaces = [clone(p.tracks.hand_r.spaces[0])];
    expect(() => validateProject(bad)).toThrow(/Root/);
    expect(() => switchParent(p, 'root', 'rifle', 0)).toThrow(/Root/);
  });
  it('keys root drafts and supports undo, curves, and cycle offsets', () => {
    const s = new StudioStore();
    s.patch({ project: createProject({}, false), ready: true, selected: 'root', autoKey: false });
    s.setFrame(12);
    s.editWorld('root', turn);
    near(evaluate(s.state.project!, 12, s.state.drafts).root.p, turn.p);
    s.addKey();
    s.undo();
    near(evaluate(s.state.project!, 12).root.p, [0, 0, 0]);
    s.redo();
    near(evaluate(s.state.project!, 12).root.p, turn.p);
    s.addModifier('pz', 'cycles');
    const curve = s.state.project!.tracks.root.curves!.pz!;
    s.updateModifier('pz', curve.modifiers[0].id, { after: 'offset' } as any);
    expect(evaluate(s.state.project!, 24).root.p[2]).toBeCloseTo(1.2);
  });
  it('keeps props aligned under extracted root motion including an offset starting root', () => {
    const start = matrix(
      pose([2, 0, 1], new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5).toArray()),
    ).toArray();
    const root = matrix(turn),
      prop = root.clone().multiply(new Matrix4().makeTranslation(0.1, 1.5, 0.4));
    const bones = { root: root.toArray(), hand: prop.toArray() },
      props = { rifle: prop.toArray(), magazine: prop.toArray() };
    const kept = rootMotionFrame(bones, props, start, 'keep');
    expect(kept.bones).toBe(bones);
    const out = rootMotionFrame(bones, props, start, 'extract');
    const actor = new Matrix4().fromArray(out.bones.root);
    near(
      actor.multiply(new Matrix4().fromArray(out.props.rifle)).toArray(),
      new Matrix4().fromArray(start).invert().multiply(prop).toArray(),
    );
    const first = rootMotionFrame({ root: start }, props, start, 'extract');
    near(first.bones.root, new Matrix4().toArray());
  });
  it('transforms every real Manny bone once and exports a turning root fixture', async () => {
    const bytes = await fs.readFile('public/assets/manny.glb'),
      gltf = await rigLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      );
    const rig = new MannyRig(gltf.scene),
      p = forLayer(createProject(rig.restControls, false), 'body');
    p.name = 'Root motion turn';
    p.end = 24;
    p.loop = { enabled: false, start: 0, end: 24 };
    rig.apply(evaluate(p, 0));
    const base = rig.deformation();
    putKey(p.tracks.root, 24, turn);
    rig.apply(evaluate(p, 24));
    const moved = rig.deformation();
    for (const [id, m] of Object.entries(moved))
      near(m, matrix(turn).multiply(new Matrix4().fromArray(base[id])).toArray(), 6);
    near(moved.root, matrix(turn).toArray(), 6);
    rig.apply(evaluate(p, 24));
    for (const [id, m] of Object.entries(rig.deformation())) near(m, moved[id], 8);
    const frames = [];
    for (let f = 0; f <= p.end; f++) {
      const v = evaluate(p, f);
      rig.apply(v);
      const world = rootMotionFrame(
        rig.deformation(),
        { rifle: matrix(v.rifle).toArray(), magazine: matrix(v.magazine).toArray() },
        matrix(evaluate(p, 0).root).toArray(),
        'extract',
      );
      frames.push({
        frame: f,
        bodyBones: world.bones,
        bodyProps: world.props,
        bones: base,
        props: {
          rifle: matrix(evaluate(forLayer(p, 'firstPerson'), f).rifle).toArray(),
          magazine: matrix(evaluate(forLayer(p, 'firstPerson'), f).magazine).toArray(),
        },
        camera: {
          matrix: matrix(evaluate(forLayer(p, 'firstPerson'), f).camera).toArray(),
          fov: 65,
        },
      });
    }
    const fixture = {
      version: 2,
      rootMotion: 'extract',
      rig: p.rig,
      name: p.name,
      fps: p.fps,
      end: p.end,
      frames,
      geometry: { rifle: geometryData(createRifle()), magazine: geometryData(createMagazine()) },
      project: p,
      cameraReference: matrix(evaluate(forLayer(p, 'firstPerson'), 0).camera).toArray(),
    };
    // Blender FBX checks read this; set POSE_FIXTURE_DIR to write it (e.g. ../../work).
    const folder = process.env.POSE_FIXTURE_DIR;
    if (folder) {
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, 'root-export-fixture.json'), JSON.stringify(fixture));
    }
  }, 20000);
});

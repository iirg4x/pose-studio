import { controllerConstraints } from '../src/core/controllerConstraints';
import { AttachmentSolver } from '../src/scene/attachments';
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { Bone, Matrix4, Quaternion, SkinnedMesh, Vector3 } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { RetargetRig } from '../src/scene/RetargetRig';
import { MannyCharacter } from '../src/scene/MannyCharacter';
import { autoMapBones, defaultHiddenMeshes } from '../src/core/retarget';
import type { RetargetCharacter } from '../src/core/retarget';
import {
  createProject,
  forLayer,
  evaluate,
  pose,
  putKey,
  matrix,
  switchParent,
  limbMode,
} from '../src/core/model';
import type { ControlId, Project } from '../src/core/model';
import { StudioStore } from '../src/core/store';
import { validateLibrary } from '../src/core/library';
import { projectSaveSignature } from '../src/core/projectSaving';
import { boneFollowing } from '../src/core/boneFollowing';

async function load(asset: string) {
  const b = await fs.readFile('public/assets/' + asset + '.glb');
  return (
    await rigLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
  ).scene;
}
let source: MannyRig, male: MannyCharacter, female: MannyCharacter;
async function character(sex: string) {
  const asset = 'example-fantasy-' + sex,
    raw = new RetargetRig(await load(asset));
  const config: RetargetCharacter = {
    id: sex,
    name: sex,
    asset,
    mapping: autoMapBones([...raw.bones.keys()]),
    hiddenMeshes: defaultHiddenMeshes(
      raw.meshes.map((m) => m.name),
      true,
    ),
    scale: 1,
    facing: 0,
    handIK: true,
    footIK: true,
    offsets: {},
  };
  return new MannyCharacter(raw, source, config);
}
beforeAll(async () => {
  source = new MannyRig(await load('manny'));
  male = await character('male');
  female = await character('female');
});
const restPoint = (rig: MannyRig, name: string) =>
  new Vector3().setFromMatrixPosition(rig.rest.get(name)!.world);
function sample(c: MannyCharacter, p: Project, frame: number) {
  const values = evaluate(p, frame);
  source.apply(
    values,
    Object.fromEntries(
      ['arm_l', 'arm_r', 'leg_l', 'leg_r'].map((id) => [id, limbMode(p, id as 'arm_l', frame)]),
    ),
    boneFollowing(p, frame),
  );
  c.body.sample(source, values, p, frame, c.config);
  return values;
}

describe('shared Manny skeleton preview models', () => {
  it('offers a keyed ground pose from each preview character own sole', () => {
    const p = forLayer(createProject(source.restControls, false), 'body');
    const foot = evaluate(p, 0).foot_l;
    putKey(p.tracks.foot_l, 0, { ...foot, p: [foot.p[0], 0.3, foot.p[2]] });
    const v = evaluate(p, 0);
    source.apply(v, {}, {}, false, controllerConstraints(p));
    new AttachmentSolver().apply(source, v, p, 0);
    for (const c of [male, female]) {
      c.body.sample(source, v, p, 0, c.config);
      for (const [id, world] of c.body.groundPose('foot_l')) {
        const bone = c.body.bodyBone(id);
        bone
          .parent!.matrixWorld.clone()
          .invert()
          .multiply(world)
          .decompose(bone.position, bone.quaternion, bone.scale);
        bone.updateMatrixWorld(true);
      }
      expect(c.body.meshMinimum('foot_l')).toBeCloseTo(0, 5);
      const world = c.body.bones.get('foot_l')!.matrixWorld;
      for (const contact of ['heel', 'ball'] as const)
        expect(c.body.pivotPoint('l', contact).applyMatrix4(world).y).toBeGreaterThanOrEqual(
          -0.001,
        );
    }
  });
  it('binds male and female meshes to the same 89 Manny bones and hierarchy', () => {
    for (const c of [male, female]) {
      expect([...c.body.bones.keys()]).toEqual([...source.bones.keys()]);
      for (const [name, b] of source.bones) {
        const target = c.body.bones.get(name)!;
        expect(target.parent instanceof Bone ? target.parent.name : null).toBe(
          b.parent instanceof Bone ? b.parent.name : null,
        );
      }
      for (const mesh of c.meshes) {
        expect(mesh).toBeInstanceOf(SkinnedMesh);
        expect(mesh.skeleton.bones.map((b) => b.name)).toEqual([...source.bones.keys()]);
        const index = mesh.geometry.getAttribute('skinIndex');
        for (let i = 0; i < index.count; i += 53)
          for (let k = 0; k < 4; k++) expect(index.getComponent(i, k)).toBeLessThan(89);
      }
    }
  });
  it('keeps target height and shoulder width instead of scaling Manny uniformly', () => {
    const width = (r: MannyRig) =>
        restPoint(r, 'upperarm_l').distanceTo(restPoint(r, 'upperarm_r')),
      height = (r: MannyRig) => restPoint(r, 'head').y;
    expect(height(male.body)).toBeLessThan(height(source));
    expect(height(female.body)).toBeLessThan(height(source));
    expect(width(male.body) / height(male.body)).toBeGreaterThan(
      (width(source) / height(source)) * 1.05,
    );
    for (const c of [male, female]) {
      const originalL = c.raw.bones.get(c.config.mapping.upperarm_l)!,
        originalR = c.raw.bones.get(c.config.mapping.upperarm_r)!;
      expect(width(c.body)).toBeCloseTo(
        originalL
          .getWorldPosition(new Vector3())
          .distanceTo(originalR.getWorldPosition(new Vector3())),
        5,
      );
    }
  });
  it('preserves the aligned mesh shape when rebinding skin weights to Manny', () => {
    for (const c of [male, female]) {
      c.body.reset();
      const raw = c.raw.meshes.find((m) => m.visible && m instanceof SkinnedMesh) as SkinnedMesh,
        target = c.meshes.find((m) => m.name === raw.name)!;
      raw.skeleton.update();
      target.skeleton.update();
      const rawP = raw.geometry.getAttribute('position'),
        targetP = target.geometry.getAttribute('position'),
        offset = restPoint(c.body, 'pelvis').sub(
          c.raw.bones.get(c.config.mapping.pelvis)!.getWorldPosition(new Vector3()),
        );
      for (let i = 0; i < rawP.count; i += 17) {
        const original = raw
            .applyBoneTransform(i, new Vector3().fromBufferAttribute(rawP, i))
            .applyMatrix4(raw.matrixWorld)
            .add(offset),
          rebound = target
            .applyBoneTransform(i, new Vector3().fromBufferAttribute(targetP, i))
            .applyMatrix4(target.matrixWorld);
        expect(original.distanceTo(rebound)).toBeLessThan(1e-5);
      }
    }
  });
  it('preserves every visible mesh in its native bind pose, including shoulder and wrist vertices', () => {
    for (const c of [male, female]) {
      c.raw.resetToBind();
      c.body.root.updateMatrixWorld(true);
      const offset = new Vector3()
        .setFromMatrixPosition(
          new Matrix4().fromArray(c.body.bones.get('pelvis')!.userData.nativeBind),
        )
        .sub(c.raw.bones.get(c.config.mapping.pelvis)!.getWorldPosition(new Vector3()));
      for (const b of c.body.bones.values()) {
        const world = new Matrix4().fromArray(b.userData.nativeBind);
        b.parent!.matrixWorld.clone()
          .invert()
          .multiply(world)
          .decompose(b.position, b.quaternion, b.scale);
        b.updateMatrixWorld(true);
      }
      for (const raw of c.raw.meshes.filter(
        (m) => m.visible && m instanceof SkinnedMesh,
      ) as SkinnedMesh[]) {
        const mesh = c.meshes.find((m) => m.name === raw.name)!;
        raw.skeleton.update();
        mesh.skeleton.update();
        const a = raw.geometry.getAttribute('position'),
          b = mesh.geometry.getAttribute('position');
        for (let i = 0; i < a.count; i++) {
          const expected = raw
              .applyBoneTransform(i, new Vector3().fromBufferAttribute(a, i))
              .applyMatrix4(raw.matrixWorld)
              .add(offset),
            actual = mesh
              .applyBoneTransform(i, new Vector3().fromBufferAttribute(b, i))
              .applyMatrix4(mesh.matrixWorld);
          expect(actual.distanceTo(expected), raw.name + ' vertex ' + i).toBeLessThan(1e-5);
        }
      }
      c.raw.apply(true);
      c.body.reset();
    }
  });
  it('does not aim the ribcage at the short backward neck offset', () => {
    for (const c of [male, female])
      for (const name of [
        'pelvis',
        'spine_01',
        'spine_02',
        'spine_03',
        'spine_05',
        'neck_01',
        'head',
      ]) {
        const mapped = c.config.mapping[name],
          original = new Quaternion();
        c.raw.rest.get(mapped)!.world.decompose(new Vector3(), original, new Vector3());
        expect(
          c.raw.bones
            .get(mapped)!
            .getWorldQuaternion(new Quaternion())
            .normalize()
            .angleTo(original.normalize()),
        ).toBeLessThan(0.00001);
      }
  });
  it('weights the forearm twist deformers and keeps skin weights normalized', () => {
    for (const c of [male, female]) {
      const used = new Set<string>();
      for (const mesh of c.meshes) {
        const si = mesh.geometry.getAttribute('skinIndex'),
          sw = mesh.geometry.getAttribute('skinWeight');
        for (let i = 0; i < si.count; i++) {
          let sum = 0;
          for (let k = 0; k < 4; k++) {
            const w = sw.getComponent(i, k);
            sum += w;
            if (w > 0) used.add(mesh.skeleton.bones[si.getComponent(i, k)].name);
          }
          expect(sum).toBeCloseTo(1, 5);
        }
      }
      for (const side of ['l', 'r'])
        for (const n of ['01', '02'])
          expect(used.has('lowerarm_twist_' + n + '_' + side)).toBe(true);
    }
  });
  it('preserves imported skin weights and authored twist deformation when requested', async () => {
    const raw = new RetargetRig(await load('manny')),
      config: RetargetCharacter = {
        id: 'original',
        name: 'Original',
        asset: 'manny',
        mapping: autoMapBones([...raw.bones.keys()]),
        hiddenMeshes: [],
        scale: 1,
        facing: 0,
        handIK: false,
        footIK: false,
        preserveSkinning: true,
        offsets: {},
      },
      character = new MannyCharacter(raw, source, config),
      p = forLayer(createProject(source.restControls, false), 'body');
    p.ikReference = 'fk';
    p.limbModes = {
      body: {
        arm_l: [{ frame: 0, mode: 'fk' }],
        arm_r: [{ frame: 0, mode: 'fk' }],
        leg_l: [{ frame: 0, mode: 'fk' }],
        leg_r: [{ frame: 0, mode: 'fk' }],
      },
    };
    putKey(
      p.tracks.lowerarm_twist_01_l,
      0,
      pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.7).toArray()),
    );
    const values = evaluate(p, 0);
    source.apply(values, { arm_l: 'fk', arm_r: 'fk', leg_l: 'fk', leg_r: 'fk' }, {}, true);
    character.body.sample(source, values, p, 0, config);
    const originals: SkinnedMesh[] = [];
    source.root.traverse((o) => {
      if (o instanceof SkinnedMesh) originals.push(o);
    });
    const target = character.meshes.find((m) => m.name === originals[0].name)!,
      original = originals[0],
      shift = character.body.position('pelvis').sub(source.position('pelvis'));
    for (let i = 0; i < original.geometry.attributes.position.count; i += 17) {
      const a = original
          .getVertexPosition(i, new Vector3())
          .applyMatrix4(original.matrixWorld)
          .add(shift),
        b = target.getVertexPosition(i, new Vector3()).applyMatrix4(target.matrixWorld);
      expect(a.distanceTo(b)).toBeLessThan(0.00001);
    }
    character.dispose();
  });
  it('adapts free-hand reach relative to the character shoulder and arm length', () => {
    let p = forLayer(createProject(source.restControls, false), 'body');
    p = switchParent(p, 'hand_l', 'world', 0);
    p = switchParent(p, 'hand_r', 'world', 0);
    for (const c of [male, female]) {
      const v = sample(c, p, 0);
      for (const side of ['l', 'r']) {
        const expected = new Vector3(...v[('hand_' + side) as ControlId].p)
          .sub(source.position('upperarm_' + side))
          .multiplyScalar(c.body.armScale[side])
          .add(c.body.position('upperarm_' + side));
        expect(c.body.position('hand_' + side).distanceTo(expected)).toBeLessThan(0.002);
        expect(
          c.body
            .position('hand_' + side)
            .distanceTo(source.position('hand_' + side).multiplyScalar(c.body.motionScale)),
        ).toBeGreaterThan(0.02);
      }
    }
  });
  it('keeps the model stance and original limb lengths while moving the root', () => {
    const p = forLayer(createProject(source.restControls, false), 'body');
    for (const c of [male, female]) {
      sample(c, p, 0);
      const feet = ['l', 'r'].map((side) => c.body.position('foot_' + side)),
        hip = c.body.position('pelvis');
      putKey(p.tracks.root, 0, pose([0.3, 0.1, -0.2]));
      sample(c, p, 0);
      expect(
        c.body
          .position('pelvis')
          .sub(hip)
          .distanceTo(new Vector3(0.3, 0.1, -0.2).multiplyScalar(c.body.motionScale)),
      ).toBeLessThan(1e-5);
      for (const [i, side] of ['l', 'r'].entries()) {
        expect(
          c.body
            .position('foot_' + side)
            .sub(feet[i])
            .distanceTo(new Vector3(0.3, 0.1, -0.2).multiplyScalar(c.body.motionScale)),
        ).toBeLessThan(0.002);
        for (const name of ['lowerarm_', 'hand_', 'calf_', 'foot_'])
          expect(
            c.body.bones.get(name + side)!.position.distanceTo(c.body.rest.get(name + side)!.p),
          ).toBeLessThan(1e-5);
      }
      putKey(p.tracks.root, 0, pose());
    }
  });
  it('keeps prop scale unchanged and contact hands attached over the reload action', () => {
    const p = forLayer(createProject(source.restControls), 'body');
    let maxContactError = 0;
    for (const c of [male, female])
      for (let f = 0; f <= p.end; f += 4) {
        const values = sample(c, p, f),
          prop = c.body.props.rifle;
        expect(
          new Vector3().setFromMatrixScale(prop).distanceTo(new Vector3(1, 1, 1)),
        ).toBeLessThan(1e-5);
        const desired = new Matrix4()
          .copy(prop)
          .multiply(matrix(values.rifle).invert())
          .multiply(c.body.gripMatrix('r', source));
        maxContactError = Math.max(
          maxContactError,
          new Vector3()
            .setFromMatrixPosition(desired)
            .distanceTo(new Vector3().setFromMatrixPosition(c.body.gripMatrix('r'))),
        );
        for (const b of c.body.bones.values())
          expect(b.matrixWorld.elements.every(Number.isFinite)).toBe(true);
      }
    expect(maxContactError).toBeLessThan(0.005);
  });
  it('approaches and releases a grip without a discontinuity at the attachment frame', () => {
    let p = forLayer(createProject(source.restControls, false), 'body');
    p = switchParent(p, 'hand_l', 'world', 0);
    p = switchParent(p, 'hand_l', 'rifle', 12);
    p = switchParent(p, 'hand_l', 'world', 20);
    for (const c of [male, female])
      for (const boundary of [12, 20]) {
        sample(c, p, boundary - 0.001);
        const before = c.body.position('hand_l');
        sample(c, p, boundary);
        expect(c.body.position('hand_l').distanceTo(before)).toBeLessThan(0.0002);
        sample(c, p, boundary + 0.001);
        expect(c.body.position('hand_l').distanceTo(before)).toBeLessThan(0.0004);
      }
  });
  it('keeps real Axe wrist and twist rotations continuous through the equip motion', async () => {
    const library = validateLibrary(
        JSON.parse(await fs.readFile('examples/Axe equip and idle.manny.json', 'utf8')),
      ),
      p = forLayer(library.clips[0].project, 'body');
    for (const c of [male, female]) {
      const previous = new Map<string, Quaternion>();
      for (let step = 0; step <= p.end * 10; step++) {
        sample(c, p, step / 10);
        for (const side of ['l', 'r'])
          for (const stem of ['hand_', 'lowerarm_twist_01_', 'lowerarm_twist_02_']) {
            const name = stem + side,
              q = c.body.bones.get(name)!.getWorldQuaternion(new Quaternion()).normalize(),
              last = previous.get(name);
            if (last) expect(q.angleTo(last), name + ' at ' + step / 10).toBeLessThan(0.08);
            previous.set(name, q);
          }
      }
    }
  });
  it('retains FK animation and normalized finger rotations on the compatible skeleton', () => {
    const p = forLayer(createProject(source.restControls, false), 'body');
    p.limbModes = { body: { arm_l: [{ frame: 0, mode: 'fk' }] } };
    putKey(
      p.tracks.upperarm_l,
      0,
      pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4).toArray()),
    );
    putKey(
      p.tracks.index_02_l,
      0,
      pose([0, 0, 0], new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.3).toArray()),
    );
    for (const c of [male, female]) {
      sample(c, p, 0);
      expect(
        c.body.bones
          .get('upperarm_l')!
          .getWorldQuaternion(new Quaternion())
          .normalize()
          .angleTo(
            source.bones.get('upperarm_l')!.getWorldQuaternion(new Quaternion()).normalize(),
          ),
      ).toBeLessThan(1e-5);
      expect(
        c.body.bones
          .get('index_02_l')!
          .quaternion.clone()
          .normalize()
          .angleTo(source.bones.get('index_02_l')!.quaternion.clone().normalize()),
      ).toBeLessThan(1e-5);
    }
  });
  it('keeps detached head position and rotation independent of body movement', () => {
    const p = forLayer(createProject(source.restControls, false), 'body');
    source.apply(evaluate(p, 0));
    p.tracks.head.following = [source.captureFollowing('head', 0, false, false)];
    putKey(
      p.tracks.hips,
      10,
      pose([0.1, 0.05, 0], new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4).toArray()),
    );
    for (const c of [male, female]) {
      sample(c, p, 0);
      const position = c.body.position('head'),
        q = c.body.bones.get('head')!.getWorldQuaternion(new Quaternion()).normalize();
      sample(c, p, 10);
      expect(c.body.position('head').distanceTo(position)).toBeLessThan(1e-5);
      expect(
        c.body.bones.get('head')!.getWorldQuaternion(new Quaternion()).normalize().angleTo(q),
      ).toBeLessThan(1e-5);
    }
  });
  it('changes only the preview selection, retaining keys, layers, drafts and undo', () => {
    const store = new StudioStore();
    store.init(source.restControls);
    store.addCharacter(male.config);
    store.addCharacter(female.config);
    store.updateProject({ name: 'Preview preservation' });
    const before = store.snapshot()!,
      signature = projectSaveSignature(before),
      project = JSON.stringify(before.clips);
    store.selectPreviewCharacter('male');
    store.selectPreviewCharacter('female');
    store.selectPreviewCharacter('');
    const after = store.snapshot()!;
    expect(JSON.stringify(after.clips)).toBe(project);
    expect(projectSaveSignature(after)).toBe(signature);
    expect(after.previewCharacterId).toBeUndefined();
    store.undo();
    expect(store.state.project!.name).not.toBe('Preview preservation');
    store.selectPreviewCharacter('male');
    expect(validateLibrary(store.snapshot()).previewCharacterId).toBe('male');
  });
  it('creates arm-only player meshes using the same Manny skin indices', () => {
    for (const c of [male, female]) {
      let triangles = 0;
      c.first.root.traverse((o) => {
        if (o instanceof SkinnedMesh) triangles += (o.geometry.index?.count ?? 0) / 3;
      });
      expect(triangles).toBeGreaterThan(100);
      expect(triangles).toBeLessThan(
        c.meshes.reduce((n, m) => n + (m.geometry.index?.count ?? 0) / 3, 0),
      );
      expect(c.first.bones.size).toBe(89);
    }
  });
});

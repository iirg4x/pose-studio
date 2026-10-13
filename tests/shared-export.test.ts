import { beforeAll, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  Bone,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SkinnedMesh,
  Uint8BufferAttribute,
  Vector3,
} from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { MannyCharacter } from '../src/scene/MannyCharacter';
import { RetargetRig } from '../src/scene/RetargetRig';
import {
  sharedExportRig,
  sharedMeshGLB,
  SharedPoseSampler,
} from '../src/scene/sharedSkeletonExport';
import { sharedRuntimeRig } from '../src/scene/sharedRuntimeRig';
import { skinSets } from '../src/scene/skinInfluences';
import { sharedExportPlan } from '../src/core/sharedExport';
import { autoMapBones, defaultHiddenMeshes } from '../src/core/retarget';
import { library, entry, validateLibrary } from '../src/core/library';
import { createProject, forLayer, putKey, pose, clone, evaluate, matrix } from '../src/core/model';
import type { ControlId } from '../src/core/model';
import { createRequire } from 'node:module';
const { createSharedExporter, validatePlan, validateGLB } = createRequire(import.meta.url)(
  '../electron/shared-export.cjs',
);
let source: MannyRig, male: MannyCharacter, female: MannyCharacter;
async function load(name: string) {
  const b = await fs.readFile('public/assets/' + name + '.glb');
  return (
    await rigLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
  ).scene;
}
beforeAll(async () => {
  source = new MannyRig(await load('manny'));
  const make = async (sex: string) => {
    const raw = new RetargetRig(await load('example-fantasy-' + sex));
    return new MannyCharacter(raw, source, {
      id: sex,
      name: sex,
      asset: 'example-fantasy-' + sex,
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
    });
  };
  male = await make('male');
  female = await make('female');
});
describe('shared Unreal skeleton export', () => {
  it('includes every character, separates prop geometry variants and keeps sockets stable across clips', () => {
    const w = library(createProject({}, false));
    w.characters = [male.config, female.config];
    const other = clone(w.clips[0].project);
    other.name = 'Other';
    other.propPreset = 'axe';
    w.clips.push(entry(other));
    const p = sharedExportPlan(w);
    expect(p.characters.map((c) => c.id)).toEqual(['manny', 'male', 'female']);
    expect(p.clips).toHaveLength(2);
    expect(p.sockets.filter((s) => s.id === 'rifle')).toHaveLength(1);
    expect(p.sockets.every((s) => s.parent === 'root')).toBe(true);
    expect(p.props).toHaveLength(3);
    expect(validatePlan(p)).toEqual(p);
    expect(sharedExportPlan(w, false).clips).toHaveLength(1);
  });
  it('exports all three mesh variants with identical bones while preserving each character skin', () => {
    const slots = sharedExportPlan(library(createProject({}, false))).sockets;
    let hierarchy: unknown;
    for (const target of [undefined, male, female]) {
      const rig = target?.body ?? source;
      rig.reset();
      const saved = [...rig.bones].map(([n, b]) => [
        n,
        b.parent instanceof Bone ? b.parent.name : null,
      ]);
      const out = sharedExportRig(rig, slots, target?.first);
      try {
        if (!hierarchy) hierarchy = out.hierarchy;
        expect(out.hierarchy).toEqual(hierarchy);
        expect(new Set(out.variants.map((m) => m.userData.variant))).toEqual(
          new Set(['body', 'arms', 'legs']),
        );
        expect(out.bones.size).toBe(89 + slots.length);
        const originals: SkinnedMesh[] = [];
        rig.root.traverse((o) => {
          if (o instanceof SkinnedMesh && o.visible) originals.push(o);
        });
        for (const mesh of originals) {
          const result = out.variants.find((m) => m.name === 'Body__' + mesh.name)!;
          mesh.skeleton.update();
          result.skeleton.update();
          for (let i = 0; i < mesh.geometry.getAttribute('position').count; i += 79) {
            const a = mesh
                .applyBoneTransform(
                  i,
                  new Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), i),
                )
                .applyMatrix4(mesh.matrixWorld),
              b = result
                .applyBoneTransform(
                  i,
                  new Vector3().fromBufferAttribute(result.geometry.getAttribute('position'), i),
                )
                .applyMatrix4(result.matrixWorld);
            expect(a.distanceTo(b)).toBeLessThan(1e-5);
          }
        }
        for (const variant of ['body', 'arms', 'legs'])
          for (const mesh of out.variants.filter((m) => m.userData.variant === variant))
            expect(mesh.skeleton.bones.map((b) => b.name)).toEqual([...out.bones.keys()]);
        expect(
          [...rig.bones].map(([n, b]) => [n, b.parent instanceof Bone ? b.parent.name : null]),
        ).toEqual(saved);
      } finally {
        out.dispose();
      }
    }
  });
  it('preserves evaluated motion and animated prop sockets through contacts and root movement', async () => {
    const workspace = validateLibrary(
        JSON.parse(await fs.readFile('tests/fixtures/axe-equip-idle.json', 'utf8')),
      ),
      p = forLayer(workspace.clips[0].project, 'body');
    putKey(
      p.tracks.root,
      0,
      pose([0.3, 0, -0.2], new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3).toArray()),
    );
    const slots = sharedExportPlan(workspace).sockets,
      sampler = new SharedPoseSampler(source);
    for (const character of [male, female]) {
      const out = sharedExportRig(character.body, slots, character.first);
      try {
        for (const f of [0, 12, 13, 20]) {
          const value = sampler.sample(p, f, character.body, character);
          out.sync(value.rig, value.props);
          for (const name of ['pelvis', 'hand_l', 'hand_r', 'foot_l', 'foot_r'])
            expect(
              new Vector3()
                .setFromMatrixPosition(out.bones.get(name)!.matrixWorld)
                .distanceTo(character.body.position(name)),
            ).toBeLessThan(1e-5);
          for (const slot of slots) {
            const actual = out.bones.get(slot.bone)!.matrixWorld,
              expected = value.props(slot.id as ControlId);
            actual.elements.forEach((v, i) => expect(v).toBeCloseTo(expected.elements[i], 4));
          }
          const original = character.meshes.find((m) => m.visible)!,
            copy = out.variants.find((m) => m.name === 'Body__' + original.name)!;
          original.skeleton.update();
          copy.skeleton.update();
          for (let i = 0; i < original.geometry.getAttribute('position').count; i += 71) {
            const a = original.applyBoneTransform(
                i,
                new Vector3().fromBufferAttribute(original.geometry.getAttribute('position'), i),
              ),
              b = copy.applyBoneTransform(
                i,
                new Vector3().fromBufferAttribute(copy.geometry.getAttribute('position'), i),
              );
            expect(a.distanceTo(b)).toBeLessThan(1e-5);
          }
        }
      } finally {
        out.dispose();
      }
    }
  });
  it('rejects invalid export data before writing an FBX', () => {
    const p = sharedExportPlan(library(createProject({}, false)));
    p.sockets[0].bone = '../bad';
    expect(() => validatePlan(p)).toThrow();
    expect(() => validateGLB(new Uint8Array(30))).toThrow();
  });
  it('source-only sampling preserves source bones and prop motion independently of the preview character', async () => {
    const workspace = validateLibrary(
        JSON.parse(await fs.readFile('tests/fixtures/axe-equip-idle.json', 'utf8')),
      ),
      p = forLayer(workspace.clips[0].project, 'body'),
      sampler = new SharedPoseSampler(source);
    try {
      for (const f of [0, 12.25, 20]) {
        sampler.sample(p, f, male.body, male);
        const before = [...source.bones].map(
            ([name, b]) => [name, b.matrixWorld.toArray()] as const,
          ),
          value = sampler.sampleSource(p, f);
        expect(value.rig).toBe(source);
        for (const [name, expected] of before)
          source.bones
            .get(name)!
            .matrixWorld.elements.forEach((n, i) => expect(n).toBeCloseTo(expected[i], 9));
        expect(value.props('rifle').elements).toEqual(matrix(evaluate(p, f).rifle).elements);
      }
    } finally {
      sampler.dispose();
    }
  });
  it('separates native mesh binds from shared animation drivers without losing any influence set', () => {
    const slots = sharedExportPlan(library(createProject({}, false))).sockets;
    let hierarchy: unknown;
    let multipleSets = false;
    for (const character of [undefined, male, female]) {
      const rig = character?.body ?? source;
      rig.reset();
      const legacy = sharedExportRig(rig, slots, character?.first),
        runtime = sharedRuntimeRig(rig, slots, character?.first);
      try {
        expect(runtime.bones.size).toBe(178 + slots.length);
        expect(runtime.bindings).toHaveLength(89);
        if (!hierarchy) hierarchy = runtime.hierarchy;
        expect(runtime.hierarchy).toEqual(hierarchy);
        for (const { driver, deform } of runtime.bindings) {
          expect(runtime.bones.get(deform)!.parent).toBe(runtime.bones.get(driver));
          const skeleton = legacy.variants[0].skeleton,
            index = skeleton.bones.findIndex((b) => b.name === driver);
          const bind = skeleton.boneInverses[index].clone().invert();
          // Imported inverse binds carry float32 basis noise; decomposition into
          // glTF TRS must keep the native reference within 0.01 mm / 1e-5 basis units.
          runtime.bones
            .get(deform)!
            .matrixWorld.elements.forEach((v, i) =>
              expect(Math.abs(v - bind.elements[i])).toBeLessThan(1e-5),
            );
        }
        for (const mesh of legacy.variants) {
          const copy = runtime.variants.find((m) => m.name === mesh.name)!;
          for (const name of ['position', 'normal', 'uv'])
            expect(copy.geometry.getAttribute(name)?.array).toEqual(
              mesh.geometry.getAttribute(name)?.array,
            );
          expect(copy.geometry.index?.array).toEqual(mesh.geometry.index?.array);
          const before = skinSets(mesh.geometry),
            after = skinSets(copy.geometry);
          multipleSets ||= before.length > 1;
          expect(after.length).toBe(before.length);
          for (const [set, a] of before.entries()) {
            const b = after[set];
            expect(b.weight.array).toEqual(a.weight.array);
            for (let vertex = 0; vertex < a.index.count; vertex++)
              for (let k = 0; k < 4; k++) {
                const old = mesh.skeleton.bones[a.index.getComponent(vertex, k)].name;
                const actual = copy.skeleton.bones[b.index.getComponent(vertex, k)].name;
                if (actual !== 'pose_deform_' + old)
                  throw Error(`Lost influence ${set}:${vertex}:${k} on ${mesh.name}`);
              }
          }
        }
        for (const slot of slots)
          expect(runtime.bones.get(slot.bone)!.parent!.name).toBe(slot.parent);
      } finally {
        legacy.dispose();
        runtime.dispose();
      }
    }
    expect(multipleSets).toBe(true);
  }, 20000);
  it('preserves complete skin matrices and prop trajectories after runtime driver sampling', async () => {
    const workspace = validateLibrary(
      JSON.parse(await fs.readFile('tests/fixtures/axe-equip-idle.json', 'utf8')),
    );
    const project = forLayer(workspace.clips[0].project, 'body'),
      slots = sharedExportPlan(workspace).sockets,
      sampler = new SharedPoseSampler(source);
    putKey(
      project.tracks.root,
      0,
      pose(
        [0.3, 0.1, -0.2],
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.3).toArray(),
      ),
    );
    try {
      for (const character of [undefined, male, female]) {
        const rig = character?.body ?? source;
        rig.reset();
        const legacy = sharedExportRig(rig, slots, character?.first),
          runtime = sharedRuntimeRig(rig, slots, character?.first);
        try {
          for (const frame of [0, 12.25, 20]) {
            const value = sampler.sample(project, frame, character?.body, character);
            legacy.sync(value.rig, value.props);
            runtime.sync(value.rig, value.props);
            for (const [i, old] of legacy.variants[0].skeleton.bones.entries()) {
              const a = old.matrixWorld
                .clone()
                .multiply(legacy.variants[0].skeleton.boneInverses[i]);
              const name = runtime.helpers.get(old.name)?.name ?? old.name,
                sk = runtime.variants[0].skeleton,
                j = sk.bones.findIndex((b) => b.name === name);
              const b = sk.bones[j].matrixWorld.clone().multiply(sk.boneInverses[j]);
              a.elements.forEach((n, k) => expect(n).toBeCloseTo(b.elements[k], 10));
            }
            for (const slot of slots)
              expect(runtime.bones.get(slot.bone)!.matrixWorld.elements).toEqual(
                legacy.bones.get(slot.bone)!.matrixWorld.elements,
              );
            for (const helper of runtime.helpers.values())
              expect(helper.matrix.elements).toEqual(new Matrix4().elements);
          }
        } finally {
          legacy.dispose();
          runtime.dispose();
        }
      }
    } finally {
      sampler.dispose();
    }
  });
  it('encodes native deformation binds and every skin set in the shared runtime GLB', async () => {
    source.setMotionRig();
    source.reset();
    const runtime = sharedRuntimeRig(source, []),
      material = new MeshBasicMaterial();
    vi.stubGlobal(
      'FileReader',
      class {
        result?: ArrayBuffer;
        onloadend?: () => void;
        onerror?: (e: unknown) => void;
        readAsArrayBuffer(blob: Blob) {
          blob
            .arrayBuffer()
            .then((data) => {
              this.result = data;
              this.onloadend?.();
            })
            .catch((e) => this.onerror?.(e));
        }
      },
    );
    try {
      for (const mesh of runtime.variants) mesh.material = material;
      const bytes = await sharedMeshGLB(runtime),
        view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        length = view.getUint32(12, true);
      const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
      const nodeNames = gltf.nodes.map((n: { name: string }) => n.name);
      for (const binding of runtime.bindings) {
        expect(nodeNames).toContain(binding.driver);
        expect(nodeNames).toContain(binding.deform);
      }
      for (const skin of gltf.skins) expect(skin.joints).toHaveLength(runtime.bones.size);
      expect(
        gltf.meshes.some((m: { primitives: { attributes: Record<string, number> }[] }) =>
          m.primitives.some(
            (p) => p.attributes.JOINTS_1 !== undefined && p.attributes.WEIGHTS_1 !== undefined,
          ),
        ),
      ).toBe(true);
      const decoded = (
        await rigLoader().parseAsync(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          '',
        )
      ).scene;
      decoded.updateMatrixWorld(true);
      decoded.traverse((o) => {
        if (o instanceof SkinnedMesh) {
          for (const [i, b] of o.skeleton.bones.entries())
            b.matrixWorld
              .clone()
              .multiply(o.skeleton.boneInverses[i])
              .elements.forEach((v, j) => expect(v).toBeCloseTo(new Matrix4().elements[j], 5));
          const original = runtime.variants.find((m) => m.name === o.name)!;
          expect(original).toBeDefined();
          for (const [set, s] of skinSets(o.geometry).entries())
            for (let i = 0; i < s.weight.count; i += 79)
              for (let k = 0; k < 4; k++)
                expect(s.weight.getComponent(i, k)).toBeCloseTo(
                  skinSets(original.geometry)[set].weight.getComponent(i, k),
                  7,
                );
        }
      });
    } finally {
      vi.unstubAllGlobals();
      runtime.dispose();
      material.dispose();
    }
  });
  it('keeps byte-indexed skins correct when a large prop collection pushes deformation indices above 255', () => {
    source.setMotionRig();
    source.reset();
    let mesh: SkinnedMesh | undefined;
    source.root.traverse((o) => {
      if (!mesh && o instanceof SkinnedMesh && o.visible) mesh = o;
    });
    const geometry = mesh!.geometry,
      original = geometry.getAttribute('skinIndex');
    geometry.setAttribute('skinIndex', new Uint8BufferAttribute(Array.from(original.array), 4));
    const slots = Array.from({ length: 180 }, (_, i) => ({
      id: 'slot' + i,
      bone: 'pose_prop_' + i,
      socket: 'prop_' + i,
      parent: 'root',
    }));
    try {
      const runtime = sharedRuntimeRig(source, slots);
      try {
        const body = runtime.variants.find((m) => m.name === 'Body__' + mesh!.name)!,
          indices = body.geometry.getAttribute('skinIndex');
        let large = false;
        for (let vertex = 0; vertex < indices.count; vertex += 79)
          for (let k = 0; k < 4; k++) {
            const n = indices.getComponent(vertex, k);
            large ||= n > 255;
            expect(body.skeleton.bones[n].name).toBe(
              'pose_deform_' + mesh!.skeleton.bones[original.getComponent(vertex, k)].name,
            );
          }
        expect(large).toBe(true);
        expect(indices.array).toBeInstanceOf(Uint16Array);
      } finally {
        runtime.dispose();
      }
    } finally {
      geometry.setAttribute('skinIndex', original);
    }
  });
  it('rejects incompatible native binds without changing the character', () => {
    source.setMotionRig();
    source.reset();
    let mesh: SkinnedMesh | undefined;
    source.root.traverse((o) => {
      if (!mesh && o instanceof SkinnedMesh && o.visible) mesh = o;
    });
    const extra = mesh!.clone();
    extra.name = 'Incompatible skin';
    extra.skeleton = mesh!.skeleton.clone();
    extra.skeleton.boneInverses = extra.skeleton.boneInverses.map((m) => m.clone());
    extra.skeleton.boneInverses[0].elements[12] += 0.1;
    const original = mesh!.skeleton.boneInverses[0].elements.slice();
    mesh!.parent!.add(extra);
    try {
      expect(() => sharedRuntimeRig(source, [])).toThrow('different bind transforms');
      expect(mesh!.skeleton.boneInverses[0].elements).toEqual(original);
    } finally {
      extra.removeFromParent();
      extra.skeleton.dispose();
    }
  });
});
it('stages every clip once regardless of character count and rejects mixed item identities', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pose-shared-test-'));
  try {
    const w = library(createProject({}, false));
    w.characters = [male.config, female.config];
    w.clips.push(entry(clone(w.clips[0].project)));
    const plan = sharedExportPlan(w),
      writer = createSharedExporter('', () => ''),
      session = await writer.begin(directory, plan);
    const bytes = Buffer.alloc(20);
    bytes.writeUInt32LE(0x46546c67, 0);
    bytes.writeUInt32LE(2, 4);
    bytes.writeUInt32LE(20, 8);
    for (const c of plan.characters) await writer.write(session.id, { characterId: c.id }, bytes);
    await expect(writer.finish(session.id, null)).rejects.toThrow('shared animation is missing');
    for (const c of plan.clips) await writer.write(session.id, { clipId: c.id }, bytes);
    expect((await fs.readdir(path.join(session.directory, '.source'))).sort()).toEqual([
      'animation_0.glb',
      'animation_1.glb',
      'mesh_0.glb',
      'mesh_1.glb',
      'mesh_2.glb',
    ]);
    await expect(
      writer.write(session.id, { characterId: 'manny', clipId: plan.clips[0].id }, bytes),
    ).rejects.toThrow('Unknown');
    await expect(
      writer.write(session.id, { clipId: plan.clips[0].id, sampleRate: 31 }, bytes),
    ).rejects.toThrow('sample rate');
    await expect(
      writer.write(session.id, { characterId: 'manny', sampleRate: 120 }, bytes),
    ).rejects.toThrow('animations only');
    await expect(writer.finish(session.id, null)).rejects.toThrow('Choose Blender');
    await writer.cancel(session.id);
  } finally {
    if (
      path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir()) &&
      path.basename(directory).startsWith('pose-shared-test-')
    )
      await fs.rm(directory, { recursive: true, force: true });
  }
});

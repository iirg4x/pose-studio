import { beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { Object3D } from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { unzipSync } from 'three/addons/libs/fflate.module.js';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { MannyCharacter } from '../src/scene/MannyCharacter';
import { RetargetRig } from '../src/scene/RetargetRig';
import {
  sharedAnimationGLB,
  sharedExportRig,
  sharedMeshGLB,
  SharedPoseSampler,
} from '../src/scene/sharedSkeletonExport';
import { exportRetargetGLB } from '../src/scene/retargetExport';
import { sharedExportPlan } from '../src/core/sharedExport';
import type { SharedExportItem, SharedExportPlan } from '../src/core/sharedExport';
import { autoMapBones, defaultHiddenMeshes } from '../src/core/retarget';
import { validateLibrary } from '../src/core/library';
import type { AnimationLibrary } from '../src/core/library';
import { CAMERA_REFERENCE, createProject, evaluate, forLayer, matrix } from '../src/core/model';
import { createMagazine, createRifle, geometryData } from '../scripts/example-props';
import { SharedPackage } from '../src/core/fbx/sharedPackage';
import { clipExportFiles } from '../src/core/fbx/clip';
import type { ClipBake } from '../src/core/fbx/clip';
import { retargetFbx } from '../src/core/fbx/unreal';
import { readFbxScene, sampleRig } from '../src/core/fbx/scene';
import { readFbxMeshes } from '../src/core/fbx/mesh';
import { GltfAnimation, readGlb } from '../src/core/fbx/gltf';
import { GltfScene } from '../src/core/fbx/gltfScene';
import { createZipExports } from '../src/platform/exportZip';
import skeleton from '../src/unreal/manny-skeleton.json';

// GLTFExporter reads its output through FileReader, which Node does not have.
vi.stubGlobal(
  'FileReader',
  class {
    result?: ArrayBuffer;
    onloadend?: () => void;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((data) => {
        this.result = data;
        this.onloadend?.();
      });
    }
  },
);
const file = async (name: string) => new Uint8Array(await fs.readFile(name));
async function load(name: string) {
  const b = await fs.readFile('public/assets/' + name + '.glb');
  return (
    await rigLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
  ).scene;
}
// Headless textures have no pixels to write.
const plain = (root: Object3D) =>
  root.traverse((o) => {
    if (o instanceof Mesh) o.material = new MeshBasicMaterial();
  });
const text = (data: Uint8Array) => new TextDecoder().decode(data);

let source: MannyRig, male: MannyCharacter, workspace: AnimationLibrary, plan: SharedExportPlan;
const staged: { item: SharedExportItem; data: Uint8Array }[] = [];
beforeAll(async () => {
  source = new MannyRig(await load('manny'));
  const raw = new RetargetRig(await load('example-fantasy-male'));
  male = new MannyCharacter(raw, source, {
    id: 'male',
    name: 'male',
    asset: 'example-fantasy-male',
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
  workspace = validateLibrary(
    JSON.parse(await fs.readFile('tests/fixtures/axe-equip-idle.json', 'utf8')),
  );
  workspace.characters = [male.config];
  // Short clips keep the adaptive sampler quick; the first stays long enough to move.
  for (const [index, clip] of workspace.clips.entries()) clip.project.end = index ? 4 : 10;
  plan = sharedExportPlan(workspace);
  // The same items the export dialog receives from the scene, in the same order.
  for (const character of [undefined, male]) {
    source.reset();
    const out = sharedExportRig(character?.body ?? source, plan.sockets, character?.first);
    plain(out.root);
    staged.push({
      item: { characterId: character ? 'male' : 'manny' },
      data: await sharedMeshGLB(out),
    });
    out.dispose();
  }
  source.reset();
  const sampler = new SharedPoseSampler(source),
    out = sharedExportRig(source, plan.sockets);
  for (const clip of plan.clips) {
    const project = workspace.clips.find((v) => v.id === clip.id)!.project;
    let sampleRate = clip.fps;
    const data = await sharedAnimationGLB(
      out,
      clip.name,
      clip.fps,
      clip.end,
      (f) => {
        const s = sampler.sample(project, f);
        out.sync(s.rig, (id) =>
          clip.props.some((p) => p.slot === id)
            ? s.props(id)
            : s.rig.bones.get('root')!.matrixWorld,
        );
      },
      () => {},
      (info) => {
        sampleRate = info.sampleRate;
      },
    );
    staged.push({ item: { clipId: clip.id, sampleRate }, data });
  }
  out.dispose();
}, 120000);

describe('shared skeleton package', () => {
  it('writes meshes, clips, props and notes that read back with one skeleton', async () => {
    const written = new Map<string, Uint8Array>(),
      pack = new SharedPackage(structuredClone(plan), async (path, data) => {
        written.set(path, data);
      });
    for (const { item, data } of staged) await pack.add(item, data);
    const files = await pack.finish(
      (id) => file('public/assets/' + id + '.glb'),
      await fs.readFile('src/unreal/import_shared_unreal.py', 'utf8'),
    );
    expect(new Set(files)).toEqual(new Set(written.keys()));
    const manifest = JSON.parse(text(written.get('manifest.json')!));
    expect(manifest.characters.map((c: { id: string }) => c.id)).toEqual(['manny', 'male']);
    expect(manifest.animations).toHaveLength(plan.clips.length);
    expect(text(written.get('import_shared_unreal.py')!)).toContain('unreal');
    const names = (path: string) => {
      const scene = readFbxScene(written.get(path)!);
      expect(scene.rigs).toHaveLength(1);
      return scene.rigs[0].bones.map((b) => b.name);
    };
    const bones = names(manifest.characters[0].meshes.body);
    expect(bones[0]).toBe('root');
    expect(bones).toHaveLength(89 + plan.sockets.length);
    for (const character of manifest.characters)
      for (const path of Object.values(character.meshes as Record<string, string>)) {
        expect(names(path)).toEqual(bones);
        const meshes = readFbxMeshes(readFbxScene(written.get(path)!));
        expect(meshes.length).toBeGreaterThan(0);
      }
    for (const animation of manifest.animations) {
      expect(names(animation.file)).toEqual(bones);
      expect(Object.keys(manifest.translationModes)).toEqual(bones);
    }
    for (const prop of manifest.props)
      expect(readFbxMeshes(readFbxScene(written.get(prop.file)!)).length).toBeGreaterThan(0);
  }, 120000);

  it('keeps the motion of a clip: bone distances match the baked source at every sample', async () => {
    const clip = staged.find((s) => s.item.clipId)!,
      written = new Map<string, Uint8Array>(),
      pack = new SharedPackage(structuredClone(plan), async (path, data) => {
        written.set(path, data);
      });
    // Clips may arrive before the meshes they are measured against.
    for (const { item, data } of [...staged].reverse()) await pack.add(item, data);
    const files = await pack.finish((id) => file('public/assets/' + id + '.glb'), ''),
      path = files.find((f) => /^Animations\/.*_0\.fbx$/.test(f))!,
      fbx = readFbxScene(written.get(path)!),
      rig = fbx.rigs[0],
      action = rig.actions[0],
      gltf = readGlb(clip.data),
      scene = new GltfScene(gltf, { unit: 1 }),
      animation = new GltfAnimation(gltf, 0),
      rate = clip.item.sampleRate!,
      count = Math.round(animation.duration * rate);
    expect(action.end - action.start).toBeCloseTo(animation.duration, 4);
    const index = (name: string) => rig.bones.findIndex((b) => b.name === name),
      origin = (m: { elements: ArrayLike<number> }) =>
        new Vector3(m.elements[12], m.elements[13], m.elements[14]);
    for (let f = 0; f <= count; f += Math.max(1, Math.floor(count / 12))) {
      const mine = sampleRig(fbx, rig, action, action.start + f / rate),
        theirs = scene.pose(animation, f / rate),
        bone = (name: string) =>
          origin(theirs[scene.armature!.bones.findIndex((b) => b.name === name)]);
      for (const [a, b] of [
        ['root', 'hand_r'],
        ['pelvis', 'hand_l'],
        ['head', 'foot_l'],
      ])
        expect(
          origin(mine[index(a)]).distanceTo(origin(mine[index(b)])),
          `${a}–${b} at sample ${f}`,
        ).toBeCloseTo(bone(a).distanceTo(bone(b)), 3);
    }
  }, 120000);

  it('adds every clip once and rejects mixed or incomplete items', async () => {
    const pack = new SharedPackage(structuredClone(plan), async () => {}),
      clip = staged.find((s) => s.item.clipId)!;
    await expect(
      pack.add(
        { characterId: 'manny', clipId: plan.clips[0].id } as unknown as SharedExportItem,
        staged[0].data,
      ),
    ).rejects.toThrow('Unknown');
    await expect(pack.add({ clipId: plan.clips[0].id, sampleRate: 31 }, clip.data)).rejects.toThrow(
      'sample rate',
    );
    await expect(
      pack.add(
        { characterId: 'manny', sampleRate: 120 } as unknown as SharedExportItem,
        staged[0].data,
      ),
    ).rejects.toThrow('animations only');
    await pack.add(staged[0].item, staged[0].data);
    await expect(pack.finish(async () => new Uint8Array(), '')).rejects.toThrow(
      'character mesh is missing',
    );
    await pack.add(staged[1].item, staged[1].data);
    await expect(pack.finish(async () => new Uint8Array(), '')).rejects.toThrow(
      'shared animation is missing',
    );
  }, 120000);
});

describe('single clip export', () => {
  it('writes the arms, each prop and the notes, and the FBX files read back', async () => {
    const model = await load('manny'),
      rig = new MannyRig(model, true),
      bodyRig = new MannyRig(cloneSkeleton(model) as typeof model),
      project = { ...createProject(rig.restControls), end: 12 },
      frames = [];
    for (let f = 0; f <= project.end; f++) {
      const values = evaluate(project, f),
        bodyValues = evaluate(forLayer(project, 'body'), f);
      rig.apply(values);
      bodyRig.apply(bodyValues);
      frames.push({
        frame: f,
        bones: rig.deformation(),
        bodyBones: bodyRig.deformation(),
        bodyProps: {
          rifle: matrix(bodyValues.rifle).toArray(),
          magazine: matrix(bodyValues.magazine).toArray(),
        },
        props: {
          rifle: matrix(values.rifle).toArray(),
          magazine: matrix(values.magazine).toArray(),
        },
        camera: { matrix: matrix(values.camera).toArray(), fov: values.camera.fov },
      });
    }
    const bake = {
      version: 2,
      cameraReference: matrix(CAMERA_REFERENCE).toArray(),
      name: project.name,
      fps: project.fps,
      end: project.end,
      frames,
      geometry: { rifle: geometryData(createRifle()), magazine: geometryData(createMagazine()) },
      project,
    } as unknown as ClipBake;
    const files = await clipExportFiles(bake, {
        includeMesh: true,
        skeleton,
        manny: () => file('public/assets/manny.glb'),
        asset: (id) => file('public/assets/' + id + '.glb'),
      }),
      paths = files.map((f) => f.path);
    expect(paths).toContain('Manny_FP_Arms.fbx');
    expect(paths).toContain('camera-and-contacts.json');
    expect(paths).toContain('manifest.json');
    expect(paths.filter((p) => p.startsWith('Textures/')).length).toBeGreaterThan(0);
    const fbx = files.filter((f) => f.path.endsWith('.fbx'));
    expect(fbx.length).toBeGreaterThan(1);
    for (const f of fbx) {
      const scene = readFbxScene(f.data),
        action = scene.rigs[0].actions[0];
      expect(scene.fps).toBe(project.fps);
      expect(action.end - action.start).toBeCloseTo(project.end / project.fps, 4);
      expect(readFbxMeshes(scene).length).toBeGreaterThan(0);
    }
    const arms = readFbxScene(fbx.find((f) => f.path === 'Manny_FP_Arms.fbx')!.data);
    expect(arms.rigs[0].bones.map((b) => b.name)).toEqual(skeleton.bones.map((b) => b.name));
    const bare = await clipExportFiles(bake, {
      includeMesh: false,
      skeleton,
      manny: async () => {
        throw Error('The mesh is not needed.');
      },
      asset: (id) => file('public/assets/' + id + '.glb'),
    });
    expect(
      readFbxMeshes(readFbxScene(bare.find((f) => f.path === 'Manny_FP_Arms.fbx')!.data)),
    ).toHaveLength(0);
  }, 120000);
});

describe('retargeted character export', () => {
  it('turns the baked GLB into an FBX with the same bones and length', async () => {
    const project = workspace.clips[0].project,
      sampler = new SharedPoseSampler(source);
    plain(male.body.root);
    const glb = await exportRetargetGLB(
        male.body,
        project.name,
        project.fps,
        project.end,
        (f) => {
          sampler.sample(project, f, male.body, male);
        },
        () => {},
      ),
      fbx = readFbxScene(await retargetFbx(glb, project.fps, project.end, 'male')),
      scene = new GltfScene(readGlb(glb), { unit: 1 });
    expect(fbx.rigs[0].bones.map((b) => b.name)).toEqual(scene.armature!.bones.map((b) => b.name));
    const action = fbx.rigs[0].actions[0];
    expect(action.end - action.start).toBeCloseTo(project.end / project.fps, 4);
    expect(readFbxMeshes(fbx).length).toBeGreaterThan(0);
  }, 120000);
});

describe('zip export for the web and Android apps', () => {
  it('gathers the files of one export into a single archive', async () => {
    let saved: { data: Uint8Array; name: string } | undefined;
    const exports = createZipExports(async (data, name) => {
        saved = { data, name };
        return name;
      }),
      session = await exports.beginExport('My clip: one', true);
    await exports.writeExport(session.id, 'Animations/A.fbx', new Uint8Array([1, 2, 3]));
    await exports.writeExport(session.id, 'manifest.json', new Uint8Array([4]));
    await expect(exports.writeExport('other', 'a.fbx', new Uint8Array(1))).rejects.toThrow(
      'expired',
    );
    const result = await exports.finishExport(session.id);
    expect(result).toEqual({
      directory: 'My_clip_one_Shared.zip',
      files: ['Animations/A.fbx', 'manifest.json'],
    });
    expect(saved!.name).toBe('My_clip_one_Shared.zip');
    const entries = unzipSync(saved!.data);
    expect([...entries['Animations/A.fbx']]).toEqual([1, 2, 3]);
    expect([...entries['manifest.json']]).toEqual([4]);
    await expect(exports.finishExport(session.id)).rejects.toThrow('expired');
  });
});

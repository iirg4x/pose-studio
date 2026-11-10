import { Euler, Matrix4, Vector3 } from 'three';
import { writeFbx } from './export';
import type { ExportArmature, ExportMaterial, ExportMesh, ExportPose } from './export';
import { readGlb } from './gltf';
import { GltfScene, joinMeshes, transformMesh } from './gltfScene';
import type { SceneMesh } from './gltfScene';
import { CREATOR, FORWARD_X, Materials, exportMesh, safeName } from './unreal';
import type { TextureFile } from './unreal';

/** One baked frame of a clip: world-space changes from the rest pose, column by column. */
interface BakedFrame {
  frame: number;
  bones: Record<string, number[]>;
  bodyBones: Record<string, number[]>;
  props: Record<string, number[]>;
  bodyProps: Record<string, number[]>;
  camera: { matrix: number[]; fov: number };
}
interface PropSettings {
  name?: string;
  asset: string;
  offset: number[];
  rotation: number[];
  scale: number;
}
interface SpaceEvent {
  frame: number;
  parent: string;
}
interface Tracks {
  [name: string]: { spaces: SpaceEvent[] };
}
export interface ClipBake {
  name: string;
  fps: number;
  end: number;
  rootMotion?: 'keep' | 'extract';
  cameraReference: number[];
  sourceRange?: { start: number; end: number };
  frames: BakedFrame[];
  geometry: Record<string, { vertices: number[][]; indices: number[]; color: number[] }[]>;
  project: {
    editing: 'firstPerson' | 'body';
    actionType?: 'firstPerson' | 'body';
    fps: number;
    end: number;
    tracks: Tracks;
    otherTracks: Tracks;
    props?: Record<string, PropSettings>;
    loop?: unknown;
    bodyBase?: {
      enabled?: boolean;
      excluded: string[];
      source: { fps: number; tracks: Tracks };
    };
  };
}
export interface Skeleton {
  bones: { name: string; parent: string | null; matrix: number[][] }[];
}
export interface ExportFile {
  path: string;
  data: Uint8Array;
}

/** The app's Y-up metres → the Z-up scene the FBX is written from. */
const UP = new Matrix4().makeRotationX(Math.PI / 2),
  DOWN = new Matrix4().makeRotationX(-Math.PI / 2);
const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));

/** Keeps the triangles whose corners all pass, and only the points those use. */
function maskMesh(mesh: SceneMesh, name: string, keep: (point: number) => boolean): SceneMesh {
  const points = mesh.points.length / 3,
    remap = new Int32Array(points).fill(-1);
  let count = 0;
  for (let p = 0; p < points; p++) if (keep(p)) remap[p] = count++;
  const triangles: number[] = [];
  for (let t = 0; t < mesh.slots.length; t++)
    if ([0, 1, 2].every((k) => remap[mesh.corners[t * 3 + k]] >= 0)) triangles.push(t);
  const pick = <T extends Float32Array | Uint8Array | Int32Array | Uint32Array>(
    a: T,
    size: number,
  ) => {
    const out = a.slice(0, triangles.length * size) as T;
    triangles.forEach((t, i) => out.set(a.subarray(t * size, t * size + size), i * size));
    return out;
  };
  const kept = new Float32Array(count * 3);
  for (let p = 0; p < points; p++)
    if (remap[p] >= 0) kept.set(mesh.points.subarray(p * 3, p * 3 + 3), remap[p] * 3);
  return {
    ...mesh,
    name,
    points: kept,
    corners: pick(mesh.corners, 3).map((p) => remap[p]),
    normals: pick(mesh.normals, 9),
    uv: mesh.uv && pick(mesh.uv, 6),
    color: mesh.color && pick(mesh.color, 12),
    smooth: pick(mesh.smooth, 1),
    slots: pick(mesh.slots, 1),
    groups:
      mesh.groups?.map(
        (group) => new Map([...group].flatMap(([p, w]) => (remap[p] < 0 ? [] : [[remap[p], w]]))),
      ) ?? null,
  };
}

/** A prop drawn by the app itself: flat-coloured parts with smooth shading. */
function builtInProp(id: string, parts: ClipBake['geometry'][string]) {
  const points: number[] = [],
    corners: number[] = [],
    slots: number[] = [],
    materials: ExportMaterial[] = [];
  parts.forEach((part, index) => {
    const offset = points.length / 3;
    for (const [x, y, z] of part.vertices) points.push(x, -z, y);
    for (let i = 0; i + 2 < part.indices.length; i += 3) {
      corners.push(...part.indices.slice(i, i + 3).map((v) => v + offset));
      slots.push(index);
    }
    materials.push({
      name: id + '_' + index,
      color: part.color as [number, number, number],
      emissive: [0, 0, 0],
      emissiveStrength: 0,
      roughness: 0.4,
      metallic: 0.55,
      textures: [],
    });
  });
  // Point normals: every triangle adds its own normal, weighted by its angle at the point.
  const sums = new Float64Array(points.length),
    at = [new Vector3(), new Vector3(), new Vector3()],
    a = new Vector3(),
    b = new Vector3(),
    n = new Vector3();
  for (let t = 0; t < corners.length; t += 3) {
    for (let k = 0; k < 3; k++) at[k].fromArray(points, corners[t + k] * 3);
    n.crossVectors(a.subVectors(at[1], at[0]), b.subVectors(at[2], at[0])).normalize();
    for (let k = 0; k < 3; k++) {
      a.subVectors(at[(k + 1) % 3], at[k]).normalize();
      b.subVectors(at[(k + 2) % 3], at[k]).normalize();
      const angle = Math.acos(Math.min(1, Math.max(-1, a.dot(b)))),
        p = corners[t + k] * 3;
      sums[p] += n.x * angle;
      sums[p + 1] += n.y * angle;
      sums[p + 2] += n.z * angle;
    }
  }
  const normals = new Float32Array(corners.length * 3);
  corners.forEach((p, i) => {
    n.fromArray(sums, p * 3).normalize();
    normals.set([n.x, n.y, n.z], i * 3);
  });
  return (armature: ExportArmature): ExportMesh => ({
    kind: 'mesh',
    name: id,
    data: id + '_Mesh',
    world: new Matrix4(),
    points: Float64Array.from(points),
    triangles: Uint32Array.from(corners),
    normals,
    uv: null,
    color: null,
    smoothing: new Uint8Array(slots.length).fill(1),
    materials,
    slots: materials.length > 1 ? slots : null,
    skin: {
      armature,
      groups: [
        {
          indexes: points.map((_, i) => i).slice(0, points.length / 3),
          weights: new Array(points.length / 3).fill(1),
        },
      ],
    },
  });
}

/**
 * The files of a single-clip Unreal export: the Manny skeleton (with its mesh
 * when asked), one small rig per prop, and the camera, contact and project notes.
 */
export async function clipExportFiles(
  data: ClipBake,
  options: {
    includeMesh: boolean;
    skeleton: Skeleton;
    /** The Manny model, read only when the mesh is exported. */
    manny: () => Promise<Uint8Array>;
    /** Bytes of an imported prop model. */
    asset: (id: string) => Promise<Uint8Array>;
  },
): Promise<ExportFile[]> {
  const project = data.project,
    action = project.actionType ?? project.editing,
    files: ExportFile[] = [],
    textures = new Map<string, TextureFile>(),
    count = data.frames.length,
    // Scenes are in metres under the dim grey ambient light earlier exports recorded.
    scene = { global: FORWARD_X, unit: 100, fps: data.fps, ambient: 0.05087608844041824 };
  const write = async (
    name: string,
    objects: (ExportArmature | ExportMesh)[],
    boneSize: number,
    sample: (frame: number) => Matrix4[],
    images: Materials | null,
  ) => {
    const pose = (frame: number): ExportPose => ({
      objects: objects.map((o) => o.world),
      bones: [sample(frame)],
    });
    for (const file of images?.files.values() ?? [])
      if (!textures.has(file.path)) {
        textures.set(file.path, file);
        files.push(file);
      }
    files.push({
      path: name + '.fbx',
      data: await writeFbx(
        {
          ...scene,
          objects,
          boneSize,
          media: name + '.fbm',
          pose: pose(0),
          // Keys start on frame 1, as clips exported by earlier versions do.
          animation: { name: 'Scene', first: 1, count, sample: pose },
        },
        CREATOR,
      ),
    });
  };

  // The skeleton's own rest pose, and the baked change from it on every frame.
  const bones = options.skeleton.bones,
    rest = bones.map((b) => new Matrix4().set(...(b.matrix.flat() as Parameters<Matrix4['set']>))),
    rig: ExportArmature = {
      kind: 'armature',
      name: 'Armature',
      world: new Matrix4(),
      bones: bones.map((b, i) => ({
        name: b.name,
        parent: bones.findIndex((p) => p.name === b.parent),
        rest: rest[i],
      })),
    };
  const moved = (field: 'bones' | 'bodyBones') => (frame: number) =>
    bones.map((b, i) =>
      UP.clone()
        .multiply(new Matrix4().fromArray(data.frames[frame][field][b.name]))
        .multiply(DOWN)
        .multiply(rest[i]),
    );
  let images: Materials | null = null,
    mesh: SceneMesh | null = null;
  if (options.includeMesh) {
    const gltf = readGlb(await options.manny()),
      source = new GltfScene(gltf, { unit: 1 });
    if (!source.armature || source.skinned.length !== 1) throw Error('The Manny model is damaged.');
    // Weights follow bone names, so the model's own joint order does not matter.
    const order = source.armature.bones.map((b) => bones.findIndex((v) => v.name === b.name)),
      groups = bones.map(() => new Map<number, number>());
    source.skinned[0].groups!.forEach((group, i) => {
      if (order[i] >= 0) groups[order[i]] = group;
    });
    mesh = { ...source.skinned[0], groups, world: new Matrix4() };
    mesh.smooth = new Uint8Array(mesh.smooth.length).fill(1);
    // The mesh carries one colour layer, black throughout, which Unreal reads as unpainted.
    mesh.color = new Float32Array(mesh.corners.length * 4);
    for (let i = 3; i < mesh.color.length; i += 4) mesh.color[i] = 1;
    images = new Materials(gltf);
  }
  const names = { uv: 'DiffuseUV', color: 'Attribute' },
    weighted = (pattern: RegExp) => {
      const picked = bones.flatMap((b, i) => (pattern.test(b.name) ? [i] : []));
      return (point: number) =>
        picked.reduce((sum, i) => sum + (mesh!.groups![i].get(point) ?? 0), 0) > 0.45;
    },
    skinned = (part: SceneMesh) => exportMesh(part, rig, images!, true, names);
  if (action === 'body') {
    await write(
      'Manny_Body',
      mesh ? [rig, skinned({ ...mesh, name: 'SKM_Manny_Simple' })] : [rig],
      0.033,
      moved('bodyBones'),
      images,
    );
    if (mesh)
      await write(
        'Manny_Legs',
        [
          rig,
          skinned(maskMesh(mesh, 'Manny_Player_Legs', weighted(/^(pelvis|thigh|calf|foot|ball)/))),
        ],
        0.033,
        moved('bodyBones'),
        images,
      );
  } else
    await write(
      'Manny_FP_Arms',
      mesh
        ? [
            rig,
            skinned(
              maskMesh(
                mesh,
                'Manny_FP_Arms',
                weighted(/^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)/),
              ),
            ),
          ]
        : [rig],
      0.033,
      moved('bones'),
      images,
    );

  // Every prop gets a one-bone rig whose root carries the baked placement.
  const layer = action === 'firstPerson' ? 'FP' : 'World',
    field = action === 'firstPerson' ? 'props' : 'bodyProps',
    ids = Object.keys(data.geometry);
  for (const [index, id] of ids.entries()) {
    const settings = project.props?.[id],
      armature: ExportArmature = {
        kind: 'armature',
        name: layer + '_' + id + '_Armature',
        world: new Matrix4(),
        bones: [{ name: 'root', parent: -1, rest: new Matrix4() }],
      };
    let prop: ExportMesh,
      propImages: Materials | null = null;
    if (settings) {
      const gltf = readGlb(await options.asset(settings.asset)),
        source = new GltfScene(gltf, { unit: 1 }),
        parts = [...source.skinned, ...source.statics],
        rad = Math.PI / 180,
        place = UP.clone()
          .multiply(
            new Matrix4().makeTranslation(
              settings.offset[0],
              settings.offset[1],
              settings.offset[2],
            ),
          )
          .multiply(
            new Matrix4().makeRotationFromEuler(
              new Euler(
                settings.rotation[0] * rad,
                settings.rotation[1] * rad,
                settings.rotation[2] * rad,
              ),
            ),
          )
          .multiply(new Matrix4().makeScale(settings.scale, settings.scale, settings.scale))
          .multiply(DOWN);
      if (!parts.length) throw Error('Imported prop has no mesh: ' + id);
      const joined = joinMeshes(
        parts.map((p) => transformMesh({ ...p, groups: null }, place.clone().multiply(p.world))),
        id,
      );
      joined.groups = [new Map(Array.from({ length: joined.points.length / 3 }, (_, p) => [p, 1]))];
      propImages = new Materials(gltf);
      prop = exportMesh(joined, armature, propImages, true);
    } else prop = builtInProp(id, data.geometry[id])(armature);
    await write(
      layer +
        '_' +
        safeName(settings?.name ?? id, id).replace(/[^a-zA-Z0-9_-]/g, '_') +
        '_' +
        (index + 1),
      [armature, prop],
      3.300000049173832,
      (frame) => [
        UP.clone().multiply(new Matrix4().fromArray(data.frames[frame][field][id])).multiply(DOWN),
      ],
      propImages,
    );
  }

  files.push(
    { path: 'camera-and-contacts.json', data: text(profile(data, action)) },
    { path: 'project.manny.json', data: text(project) },
  );
  files.push({
    path: 'manifest.json',
    data: text({
      files: files.map((f) => f.path),
      rig: 'ue5-manny-simple',
      actionType: action,
      bonesPerRig: bones.length,
      independentRigs: 1,
      fps: data.fps,
      frames: count,
      fbxForward: 'X',
      fbxUp: 'Z',
      rootMotion: data.rootMotion ?? 'keep',
    }),
  });
  return files;
}

/** Camera path, contact events and component notes for setting the clip up in Unreal. */
function profile(data: ClipBake, action: string) {
  const project = data.project,
    first = project.editing === 'firstPerson' ? project.tracks : project.otherTracks;
  let body = project.editing === 'body' ? project.tracks : project.otherTracks;
  if (project.bodyBase?.enabled) {
    // A linked body clip contributes the contacts that come before this clip's own.
    const link = project.bodyBase,
      scale = project.fps / link.source.fps;
    body = Object.fromEntries(
      Object.entries(body).map(([name, track]) => {
        if (link.excluded.includes(name)) return [name, track];
        const own = track.spaces,
          start = own.length ? own[0].frame : Infinity,
          inherited = (link.source.tracks[name]?.spaces ?? [])
            .filter((e) => e.frame * scale < start && !link.excluded.includes(e.parent))
            .map((e) => ({ ...e, frame: e.frame * scale }));
        return [name, { ...track, spaces: [...inherited, ...own] }];
      }),
    );
  }
  const range = data.sourceRange ?? { start: 0, end: data.end };
  const contacts = (tracks: Tracks) => {
    const result: Record<string, SpaceEvent[]> = {};
    for (const [name, track] of Object.entries(tracks)) {
      const prior = track.spaces.filter((s) => s.frame <= range.start).slice(-1),
        events = [
          ...prior,
          ...track.spaces.filter((s) => range.start < s.frame && s.frame <= range.end),
        ];
      if (events.length)
        result[name] = events.map((s) => ({ ...s, frame: Math.max(0, s.frame - range.start) }));
    }
    return result;
  };
  const unreal = (v: Vector3, scale = 1) => [v.z * scale, -v.x * scale, v.y * scale],
    extract = (data.rootMotion ?? 'keep') === 'extract';
  return {
    version: 2,
    rootMotion: {
      mode: extract ? 'extract' : 'keep',
      bone: 'root',
      enableOnBody: extract,
      enableOnFirstPersonArms: false,
      enableOnProps: false,
      rootLock: extract ? 'Ref Pose' : null,
      bodyStartsAtOrigin: extract,
      worldPropsSpace: extract ? 'Actor; body root removed' : 'Component; body root retained',
      bodyRootFrames: data.frames.map((f) => ({ frame: f.frame, matrix: f.bodyBones.root })),
    },
    fps: data.fps,
    startFrame: 0,
    endFrame: data.end,
    coordinates: {
      units: 'meters',
      up: '+Y',
      forward: '+Z',
      matrixOrder: 'column-major',
      cameraLooksAlong: 'local -Z',
      unrealPointConversion: 'UE centimeters = (Three.z * 100, -Three.x * 100, Three.y * 100)',
    },
    cameraReference: data.cameraReference,
    frames: data.frames.map((f) => {
      const m = new Matrix4().fromArray(f.camera.matrix);
      return {
        frame: f.frame,
        ...f.camera,
        unreal: {
          locationCm: unreal(new Vector3().setFromMatrixPosition(m), 100),
          forward: unreal(new Vector3(0, 0, -1).transformDirection(m)),
          up: unreal(new Vector3(0, 1, 0).transformDirection(m)),
        },
      };
    }),
    sourceRange: range,
    loop: project.loop ?? { enabled: true, start: 0, end: project.end },
    endpointIncluded: true,
    contacts: { firstPerson: contacts(first), body: contacts(body) },
    unrealComponents: {
      FPArms: {
        parent: 'Camera',
        relativeLocationCm: [0, 0, -165],
        relativeRotationDegrees: [0, 0, 0],
        onlyOwnerSee: true,
        castShadow: false,
      },
      FPProps: {
        parent: 'Camera',
        relativeLocationCm: [0, 0, -165],
        castShadow: false,
        note: 'Baked prop roots already contain the animated placement. Do not also attach them to animated hand sockets.',
      },
      Body: {
        ownerNoSee: true,
        castShadow: true,
        castHiddenShadow: true,
        purpose: 'Third person and world shadows',
      },
      Legs: {
        onlyOwnerSee: true,
        castShadow: false,
        poseSource: 'Body; Copy Pose From Mesh or Leader Pose',
      },
      WorldProps: {
        ownerNoSee: true,
        castShadow: true,
        castHiddenShadow: true,
        parent: 'Actor; baked roots contain placement',
        rootMotionRemoved: extract,
      },
    },
    notes: [
      'First-person and body tracks are independent; start them on the same frame and play rate.',
      'For newer Unreal first-person rendering, map player arms/props to FirstPerson and the full body/world props to WorldSpaceRepresentation.',
      'No Unreal project was modified by this exporter.',
    ],
    actionType: action,
  };
}

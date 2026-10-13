import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AndroidAnimationImport } from './androidAnimation';

// A two-joint GLB with a one-second linear translation, in metres/Y-up.
function motionGLB() {
  const binary = new Uint8Array(140);
  binary.set(
    new Uint8Array(
      new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 2, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0,
      ]).buffer,
    ),
  );
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 2] }],
    nodes: [
      { name: 'root', translation: [0, 1, 0], children: [1] },
      { name: 'hand', translation: [0, 1, 0] },
      { mesh: 0, skin: 0 },
    ],
    skins: [{ joints: [0, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, WEIGHTS_0: 3, JOINTS_0: 4 } }] }],
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 8 },
      { buffer: 0, byteOffset: 44, byteLength: 24 },
      { buffer: 0, byteOffset: 68, byteLength: 48 },
      { buffer: 0, byteOffset: 116, byteLength: 24 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
      { bufferView: 2, componentType: 5126, count: 2, type: 'VEC3' },
      { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 4, componentType: 5123, count: 3, type: 'VEC4' },
    ],
    animations: [
      {
        name: 'Reach',
        samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
      },
    ],
  };
  const raw = new TextEncoder().encode(JSON.stringify(json)),
    size = Math.ceil(raw.length / 4) * 4,
    data = new Uint8Array(28 + size + binary.byteLength),
    v = new DataView(data.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, data.length, true);
  v.setUint32(12, size, true);
  v.setUint32(16, 0x4e4f534a, true);
  data.fill(32, 20, 20 + size);
  data.set(raw, 20);
  v.setUint32(20 + size, binary.byteLength, true);
  v.setUint32(24 + size, 0x004e4942, true);
  data.set(new Uint8Array(binary.buffer), 28 + size);
  return data;
}
beforeAll(() => {
  if (!globalThis.ProgressEvent)
    vi.stubGlobal(
      'ProgressEvent',
      class extends Event {
        constructor(type: string) {
          super(type);
        }
      },
    );
});
afterAll(() => vi.unstubAllGlobals());
describe('Android animated GLB import', () => {
  it('samples hierarchy, metre translations and interpolation without contaminating the rest pose', async () => {
    const importer = new AndroidAnimationImport(async () => ({
        name: 'Reach.glb',
        data: motionGLB(),
      })),
      inspection = (await importer.inspect())!;
    expect(inspection.rigs[0].bones).toEqual(['root', 'hand']);
    expect(inspection.rigs[0].actions[0]).toMatchObject({ start: 0, end: 30 });
    const motion = await importer.sample(inspection.token, {
      action: '0',
      fps: 60,
      start: 0,
      end: 30,
    });
    expect(motion.frames).toHaveLength(61);
    expect(motion.bones[1].parent).toBe('root');
    expect(motion.bones[1].rest.slice(12, 15)).toEqual([0, 2, 0]);
    expect(motion.frames[30][1].slice(12, 15)).toEqual([1, 2, 0]);
    expect(motion.frames[60][1].slice(12, 15)).toEqual([2, 2, 0]);
    const repeat = await importer.sample(inspection.token, {
      action: '0',
      fps: 60,
      start: 0,
      end: 30,
    });
    expect(repeat).toEqual(motion);
  });
  it('handles cancellation and rejects invalid sample requests', async () => {
    expect(await new AndroidAnimationImport(async () => null).inspect()).toBeNull();
    const importer = new AndroidAnimationImport(async () => ({
        name: 'Reach.glb',
        data: motionGLB(),
      })),
      inspection = (await importer.inspect())!;
    await expect(
      importer.sample('expired', { action: 0, fps: 60, start: 0, end: 30 }),
    ).rejects.toThrow('again');
    await expect(
      importer.sample(inspection.token, { action: 0, fps: 0, start: 0, end: 30 }),
    ).rejects.toThrow('range');
  });
});

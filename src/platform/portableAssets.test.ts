import { describe, it, expect, vi } from 'vitest';
import {
  assetHash,
  assertGLBSize,
  decode64,
  encode64,
  MAX_GLB_BYTES,
  validateGLB,
  embedAssets,
  restoreAssets,
  builtInAsset,
} from './portableAssets';
function glb(json: unknown = { asset: { version: '2.0' } }) {
  const raw = new TextEncoder().encode(JSON.stringify(json)),
    size = Math.ceil(raw.length / 4) * 4,
    bytes = new Uint8Array(20 + size),
    v = new DataView(bytes.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, bytes.length, true);
  v.setUint32(12, size, true);
  v.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20);
  bytes.set(raw, 20);
  return bytes;
}
describe('browser and Android portable assets', () => {
  it('shares the 32 MiB GLB ceiling with metadata preflight callers', () => {
    expect(() => assertGLBSize(MAX_GLB_BYTES)).not.toThrow();
    expect(() => assertGLBSize(MAX_GLB_BYTES + 1)).toThrow('below 32 MB');
  });
  it('round trips binary across native bridge chunk boundaries', () => {
    const bytes = Uint8Array.from({ length: 800003 }, (_, i) => i % 256);
    expect(decode64(encode64(bytes))).toEqual(bytes);
  });
  it('rejects truncated GLB and external resources before parsing', () => {
    expect(() => validateGLB(glb().slice(0, -1))).toThrow();
    expect(() => validateGLB(glb({ buffers: [{ uri: 'https://example.com/mesh.bin' }] }))).toThrow(
      'Pack textures',
    );
  });
  it('embeds shared character/prop bytes once and restores unchanged', async () => {
    const bytes = glb(),
      id = await assetHash(bytes),
      p = {
        characters: [{ asset: id }],
        clips: [{ project: { props: { weapon: { asset: id } } } }],
      },
      cached = new Map();
    let reads = 0;
    const portable = await embedAssets(p, async () => {
      reads++;
      return bytes;
    });
    expect(reads).toBe(1);
    expect(Object.keys(portable.characterAssets as object)).toEqual([id]);
    expect(
      await restoreAssets(portable, async (k, v) => {
        cached.set(k, v);
      }),
    ).toEqual(p);
    expect(cached.get(id)).toEqual(bytes);
    expect(p).not.toHaveProperty('characterAssets');
  });
  it('rejects corrupt assets before writing any to the cache', async () => {
    const bytes = glb(),
      id = await assetHash(bytes),
      bad = '0'.repeat(64),
      writes: string[] = [];
    await expect(
      restoreAssets(
        {
          characters: [{ asset: id }, { asset: bad }],
          characterAssets: { [id]: encode64(bytes), [bad]: encode64(bytes) },
        },
        async (k) => {
          writes.push(k);
        },
      ),
    ).rejects.toThrow('checksum');
    expect(writes).toEqual([]);
  });
  it('validates every imported asset before invoking one batch write', async () => {
    const first = glb({ asset: { version: '2.0' }, name: 'first' });
    const second = glb({ asset: { version: '2.0' }, name: 'second' });
    const firstId = await assetHash(first);
    const secondId = await assetHash(second);
    const batch = vi.fn(async (_entries: readonly (readonly [string, Uint8Array])[]) => {});
    const write = vi.fn(async (_id: string, _data: Uint8Array) => {});
    await restoreAssets(
      {
        characters: [{ asset: firstId }, { asset: secondId }, { asset: 'builtin-rifle' }],
        characterAssets: {
          [firstId]: encode64(first),
          [secondId]: encode64(second),
          'builtin-rifle': encode64(first),
        },
      },
      write,
      batch,
    );
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0].map(([id]) => id)).toEqual([firstId, secondId]);
    expect(write).not.toHaveBeenCalled();
  });
  it('does not invoke a batch write when a later asset fails validation', async () => {
    const bytes = glb(),
      id = await assetHash(bytes),
      invalidId = '0'.repeat(64),
      batch = vi.fn(async (_entries: readonly (readonly [string, Uint8Array])[]) => {}),
      write = vi.fn(async (_asset: string, _data: Uint8Array) => {});
    await expect(
      restoreAssets(
        {
          characters: [{ asset: id }, { asset: invalidId }],
          characterAssets: { [id]: encode64(bytes), [invalidId]: encode64(bytes) },
        },
        write,
        batch,
      ),
    ).rejects.toThrow('checksum');
    expect(batch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it.each(['builtin-axe', 'builtin-rifle', 'builtin-magazine', 'builtin-unreal-fp-gun'])(
    'restores %s from a portable project using the bundled asset',
    async (id) => {
      const bytes = glb(),
        p = { clips: [{ project: { props: { 'prop:weapon': { asset: id } } } }] },
        writes: string[] = [];
      expect(builtInAsset(id)).toBe(true);
      const portable = await embedAssets(p, async (asset) => {
        expect(asset).toBe(id);
        return bytes;
      });
      expect(portable.characterAssets).toEqual({ [id]: encode64(bytes) });
      expect(
        await restoreAssets(portable, async (asset) => {
          writes.push(asset);
        }),
      ).toEqual(p);
      expect(writes).toEqual([]);
    },
  );
  it('does not treat arbitrary built-in-looking IDs as bundled assets', () => {
    for (const id of [
      'builtin-unreal-fp-gun.glb',
      'builtin-unreal-fp-gun/../rifle',
      'builtin-unknown',
    ])
      expect(builtInAsset(id)).toBe(false);
  });
});

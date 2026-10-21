import { afterEach, describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { PropAssetCache } from '../src/scene/PropAssetCache';

function fixture() {
  const geometry = new BoxGeometry(1, 1, 1),
    material = new MeshBasicMaterial(),
    source = new Group();
  source.add(new Mesh(geometry, material));
  return { source, geometry, material };
}

function disposed(object: { addEventListener: (type: 'dispose', listener: () => void) => void }) {
  let count = 0;
  object.addEventListener('dispose', () => count++);
  return () => count;
}

describe('PropAssetCache', () => {
  const caches: PropAssetCache[] = [];
  afterEach(() => {
    for (const cache of caches) cache.dispose();
    caches.length = 0;
  });

  it('deduplicates an in-flight parse and disposes after the last lease', async () => {
    let loads = 0;
    let resolve!: (source: Group) => void;
    const cache = new PropAssetCache(() => {
      loads++;
      return new Promise<Group>((done) => (resolve = done));
    });
    caches.push(cache);
    const first = cache.acquire('builtin-rifle'),
      second = cache.acquire('builtin-rifle'),
      source = fixture(),
      geometryDisposed = disposed(source.geometry),
      materialDisposed = disposed(source.material);
    await Promise.resolve();
    resolve(source.source);
    const [a, b] = await Promise.all([first, second]);

    expect(loads).toBe(1);
    expect(a.source).toBe(b.source);
    expect(geometryDisposed()).toBe(0);
    a.release();
    a.release();
    expect(geometryDisposed()).toBe(0);
    b.release();
    expect(geometryDisposed()).toBe(1);
    expect(materialDisposed()).toBe(1);
    expect(cache.size).toBe(0);
  });

  it('removes failed entries and releases every failed acquisition', async () => {
    let loads = 0;
    const cache = new PropAssetCache(async () => {
      loads++;
      throw Error('unavailable');
    });
    caches.push(cache);
    const results = await Promise.allSettled([cache.acquire('missing'), cache.acquire('missing')]);

    expect(loads).toBe(1);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(cache.size).toBe(0);
  });

  it('keeps a disposed cache source alive until its active lease releases', async () => {
    const cache = new PropAssetCache(async () => fixture().source);
    caches.push(cache);
    const lease = await cache.acquire('builtin-rifle');
    const geometry = lease.source.children[0] as Mesh;
    const geometryDisposed = disposed(geometry.geometry);

    cache.dispose();
    expect(geometryDisposed()).toBe(0);
    lease.release();
    expect(geometryDisposed()).toBe(1);
    expect(cache.size).toBe(0);
  });
});

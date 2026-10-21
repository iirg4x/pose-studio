import * as T from 'three';
import { fullSkinLoader } from './skinInfluences';

/** A parsed prop scene and the bounds used by its control outline. */
type PropAssetTemplate = {
  readonly source: T.Group;
  readonly bounds: T.Box3;
};

/** A reference to a cached prop template. Each lease must be released once. */
export type PropAssetLease = PropAssetTemplate & {
  release: () => void;
};

export type PropAssetSourceLoader = (asset: string) => Promise<T.Group>;

type Entry = {
  readonly asset: string;
  refs: number;
  state: 'loading' | 'ready' | 'failed';
  template?: PropAssetTemplate;
  pending: Promise<PropAssetTemplate>;
  disposed: boolean;
};

/**
 * Shared parsed prop ownership for one StudioScene.
 *
 * Project and preview prop placements retain separate leases while sharing the
 * parsed scene's geometry and textures. Materials are still cloned by the
 * placement owner; the parsed template is disposed only after its last lease
 * is released.
 */
export class PropAssetCache {
  private entries = new Map<string, Entry>();
  private disposed = false;

  constructor(
    private readonly loadSource: PropAssetSourceLoader = async (asset) => {
      const bytes = await window.studioDesktop!.readCharacter(asset);
      const gltf = await fullSkinLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        '',
      );
      return gltf.scene;
    },
  ) {}

  get size() {
    return this.entries.size;
  }

  acquire(asset: string): Promise<PropAssetLease> {
    if (this.disposed) return Promise.reject(new Error('Prop asset cache is disposed.'));

    let entry = this.entries.get(asset);
    if (!entry) {
      entry = this.createEntry(asset);
      this.entries.set(asset, entry);
    }
    entry.refs++;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.release(entry!);
    };

    return entry.pending.then(
      (template) => ({
        source: template.source,
        bounds: template.bounds.clone(),
        release,
      }),
      (error) => {
        release();
        throw error;
      },
    );
  }

  /** Prevent new acquisitions and release templates after active leases finish. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) {
      if (entry.refs === 0 && entry.state !== 'loading') this.finishEntry(entry);
    }
  }

  private createEntry(asset: string): Entry {
    let entry!: Entry;
    const pending = Promise.resolve()
      .then(() => this.loadSource(asset))
      .then(
        (source) => {
          try {
            const bounds = new T.Box3().setFromObject(source);
            if (bounds.isEmpty()) throw Error('No mesh found.');
            entry.state = 'ready';
            const template = { source, bounds };
            entry.template = template;
            if (entry.refs === 0) this.finishEntry(entry);
            return template;
          } catch (error) {
            disposeProp(source);
            entry.state = 'failed';
            this.finishEntry(entry);
            throw error;
          }
        },
        (error) => {
          entry.state = 'failed';
          this.finishEntry(entry);
          throw error;
        },
      );
    entry = {
      asset,
      refs: 0,
      state: 'loading',
      pending,
      disposed: false,
    };
    return entry;
  }

  private release(entry: Entry) {
    entry.refs = Math.max(0, entry.refs - 1);
    if (
      entry.refs === 0 &&
      (entry.state === 'ready' || (this.disposed && entry.state !== 'loading'))
    )
      this.finishEntry(entry);
  }

  private finishEntry(entry: Entry) {
    if (entry.disposed) return;
    entry.disposed = true;
    if (this.entries.get(entry.asset) === entry) this.entries.delete(entry.asset);
    if (entry.template) {
      disposeProp(entry.template.source);
      entry.template = undefined;
    }
  }
}

/** Dispose a complete parsed prop scene, including source textures. */
export function disposeProp(root: T.Object3D) {
  const textures = new Set<T.Texture>(),
    skeletons = new Set<T.Skeleton>(),
    geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  root.traverse((o) => {
    if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton);
    if (o instanceof T.Mesh) {
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
      }
    }
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
  for (const t of textures) t.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}

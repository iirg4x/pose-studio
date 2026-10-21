import { propControlShape } from './propControlShape';
import * as T from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { projectProps } from '../core/assets';
import type { PropAsset } from '../core/assets';
import { matrix, evaluate } from '../core/model';
import type { ControlId, Pose, Project, Track, RigLayer } from '../core/model';
import { PropAssetCache, type PropAssetLease } from './PropAssetCache';

type Instance = {
  first: T.Group;
  world: T.Group;
  targetFirst: T.Group;
  targetWorld: T.Group;
  signature: string;
  loaded: boolean;
  version: number;
  resources?: T.Group;
  lease?: PropAssetLease;
  asset: PropAsset;
  pending?: Promise<void>;
  error?: Error;
  bounds?: T.Box3;
  outline?: number[];
  placementKey?: string;
};
export { disposeProp } from './PropAssetCache';
export class ProjectProps {
  entries = new Map<ControlId, Instance>();
  private disposed = false;
  private readonly ownsCache: boolean;
  private readonly cache: PropAssetCache;
  private gunOutline?: { key: string; rifle: Track; magazine: Track; positions: number[] };
  constructor(
    private scene: T.Scene,
    private firstRoot: T.Group,
    private worldMaterials: Set<T.Material>,
    private report: (error: string) => void,
    private changed: () => void = () => {},
    cache?: PropAssetCache,
  ) {
    this.cache = cache ?? new PropAssetCache();
    this.ownsCache = !cache;
  }
  private entry(id: ControlId, asset: PropAsset) {
    let e = this.entries.get(id);
    if (!e) {
      e = {
        first: new T.Group(),
        world: new T.Group(),
        targetFirst: new T.Group(),
        targetWorld: new T.Group(),
        signature: '',
        loaded: false,
        version: 0,
        asset,
      };
      this.entries.set(id, e);
      this.firstRoot.add(e.first);
      this.scene.add(e.world, e.targetWorld);
      for (const g of this.groups(e)) {
        g.name = id;
        g.userData.control = id;
        g.visible = false;
      }
    }
    return e;
  }
  private groups(e: Instance) {
    return [e.first, e.world, e.targetFirst, e.targetWorld];
  }
  private placement(e: Instance) {
    if (!e.bounds || !e.first.children.length) return;
    const key = [e.asset.scale, ...e.asset.offset, ...e.asset.rotation].join(':');
    if (e.placementKey === key) return;
    e.placementKey = key;
    for (const g of this.groups(e)) {
      const placement = g.children[0];
      if (!placement) continue;
      placement.scale.setScalar(e.asset.scale);
      placement.position.fromArray(e.asset.offset);
      placement.rotation.set(
        ...(e.asset.rotation.map(T.MathUtils.degToRad) as [number, number, number]),
      );
      placement.updateMatrixWorld(true);
    }
    const placement = e.first.children[0];
    if (e.bounds && placement)
      e.outline = propControlShape(e.bounds, placement.matrix, 0.007 / e.asset.scale);
  }
  // Keep the weapon handle around its magazine socket, even during a reload.
  // The magazine and other props each get a cage fitted to their own mesh.
  controlOutline(id: ControlId, p: Project): number[] | undefined {
    const entry = this.entries.get(id);
    if (id !== 'rifle' || !entry?.outline) return entry?.outline;
    const mag = this.entries.get('magazine'),
      source = p.bodyBase?.enabled ? p.bodyBase.source : p;
    const base = source.layers?.find((layer) => layer.kind === 'base'),
      tracks = base?.tracks ?? source.tracks,
      track = tracks.magazine;
    const contact = track?.spaces.find((space) => space.parent === 'rifle');
    if (!mag?.bounds || !mag.outline || !contact) return entry.outline;
    const key = [entry.signature, mag.signature, mag.placementKey].join(':');
    if (
      this.gunOutline?.key !== key ||
      this.gunOutline.rifle !== tracks.rifle ||
      this.gunOutline.magazine !== track
    ) {
      const values = evaluate(
        base ? { ...source, tracks, layers: [base], activeLayerId: base.id } : source,
        contact.frame,
      );
      const socket = matrix(values.rifle)
        .invert()
        .multiply(matrix(values.magazine))
        .multiply(mag.first.children[0].matrix);
      this.gunOutline = {
        key,
        rifle: tracks.rifle,
        magazine: track,
        positions: propControlShape(mag.bounds, socket, 0.022 / mag.asset.scale),
      };
    }
    return this.gunOutline.positions;
  }

  private clear(e: Instance) {
    const skeletons = new Set<T.Skeleton>();
    for (const g of this.groups(e)) {
      g.traverse((o) => {
        if (o instanceof T.SkinnedMesh) skeletons.add(o.skeleton);
        if (o instanceof T.Mesh)
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            this.worldMaterials.delete(m);
            m.dispose();
          }
      });
      g.clear();
    }
    for (const skeleton of skeletons) skeleton.dispose();
    e.lease?.release();
    e.lease = undefined;
    e.resources = undefined;
    e.bounds = undefined;
    e.outline = undefined;
    e.placementKey = undefined;
    e.loaded = false;
    this.gunOutline = undefined;
  }
  sync(p: Project) {
    const bindings = projectProps(p);
    for (const [id, e] of this.entries)
      if (!bindings[id]) {
        e.version++;
        this.clear(e);
        for (const g of this.groups(e)) g.removeFromParent();
        this.entries.delete(id);
      }
    for (const [id, asset] of Object.entries(bindings) as [ControlId, PropAsset][]) {
      const e = this.entry(id, asset);
      e.asset = asset;
      if (e.signature === asset.asset) {
        this.placement(e);
        continue;
      }
      e.signature = asset.asset;
      const version = ++e.version;
      this.clear(e);
      e.error = undefined;
      e.pending = (async () => {
        let lease: PropAssetLease | undefined;
        try {
          lease = await this.cache.acquire(asset.asset);
          if (this.disposed || e.version !== version) {
            lease.release();
            return;
          }
          e.lease = lease;
          e.resources = lease.source;
          e.bounds = lease.bounds;
          const source = lease.source;
          for (const [g, world] of [
            [e.first, false],
            [e.world, true],
            [e.targetFirst, false],
            [e.targetWorld, true],
          ] as const) {
            const placement = new T.Group(),
              instance = cloneSkeleton(source);
            instance.traverse((o) => {
              o.userData.control = id;
              o.layers.enable(1);
              if (o instanceof T.Mesh) {
                o.material = Array.isArray(o.material)
                  ? o.material.map((m) => m.clone())
                  : o.material.clone();
                o.castShadow = world;
                o.receiveShadow = world;
                o.frustumCulled = false;
                if (world)
                  for (const m of Array.isArray(o.material) ? o.material : [o.material])
                    this.worldMaterials.add(m);
              }
            });
            placement.add(instance);
            g.add(placement);
          }
          this.placement(e);
          e.loaded = true;
          this.changed();
        } catch (error) {
          if (lease && e.lease === lease) this.clear(e);
          else lease?.release();
          if (e.version === version) {
            e.error = error as Error;
            this.report('Could not load ' + asset.name + ': ' + e.error.message);
          }
        }
      })();
    }
  }
  async ready(p: Project) {
    this.sync(p);
    await Promise.all([...this.entries.values()].map((e) => e.pending));
    for (const e of this.entries.values()) if (e.error) throw e.error;
  }
  apply(
    fp: Record<ControlId, Pose>,
    body: Record<ControlId, Pose>,
    target?: {
      fpRoot: T.Group;
      first: (id: ControlId) => T.Matrix4;
      body: (id: ControlId) => T.Matrix4;
    },
  ) {
    for (const [id, e] of this.entries) {
      matrix(fp[id]).decompose(e.first.position, e.first.quaternion, e.first.scale);
      matrix(body[id]).decompose(e.world.position, e.world.quaternion, e.world.scale);
      if (target) {
        if (e.targetFirst.parent !== target.fpRoot) target.fpRoot.add(e.targetFirst);
        target
          .first(id)
          .decompose(e.targetFirst.position, e.targetFirst.quaternion, e.targetFirst.scale);
        target
          .body(id)
          .decompose(e.targetWorld.position, e.targetWorld.quaternion, e.targetWorld.scale);
      }
    }
  }
  show(
    p: Project,
    first: boolean,
    target: boolean,
    reference: boolean,
    player = false,
    only?: RigLayer,
  ) {
    const bindings = projectProps(p);
    for (const [id, e] of this.entries) {
      const visible = e.loaded && bindings[id]?.visible && !reference;
      e.first.visible = only !== 'body' && !!visible && !target && (first || player);
      e.world.visible = only !== 'firstPerson' && !!visible && !target && (!first || player);
      e.targetFirst.visible = only !== 'body' && !!visible && target && (first || player);
      e.targetWorld.visible = only !== 'firstPerson' && !!visible && target && (!first || player);
    }
  }
  objects(first: boolean) {
    return [...this.entries.values()]
      .flatMap((e) => (first ? [e.first, e.targetFirst] : [e.world, e.targetWorld]))
      .filter((g) => g.visible);
  }
  dispose() {
    this.disposed = true;
    for (const e of this.entries.values()) {
      e.version++;
      this.clear(e);
      for (const g of this.groups(e)) g.removeFromParent();
    }
    this.entries.clear();
    if (this.ownsCache) this.cache.dispose();
  }
}

import { randomId } from '../../core/crypto';
import { disposeProp } from '../ProjectProps';
import { RetargetRig } from '../RetargetRig';
import { MannyCharacter, mannyPreviewConfig } from '../MannyCharacter';
import type { RetargetCharacter } from '../../core/retarget';
import { autoMapBones, defaultHiddenMeshes } from '../../core/retarget';
import { exportRetargetGLB } from '../retargetExport';
import * as T from 'three';
import { bakeSharedSkeleton } from '../sharedSkeletonExport';
import type { SharedExportPlan, SharedExportItem } from '../../core/sharedExport';
import { fullSkinLoader } from '../skinInfluences';
import { clone } from '../../core/model';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { SceneCore } from './core';

/** Preview characters: loading, retarget preview and baking onto them. */
export abstract class RetargetScene extends SceneCore {
  async validateProp(data: Uint8Array) {
    const g = await fullSkinLoader().parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      '',
    );
    let count = 0;
    g.scene.traverse((o) => {
      if (o instanceof T.Mesh) count++;
    });
    disposeProp(g.scene);
    if (!count) throw Error('This file contains no meshes.');
  }
  protected async parseCharacter(data: Uint8Array) {
    const buffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
    const gltf = await fullSkinLoader().parseAsync(buffer, '');
    return new RetargetRig(gltf.scene);
  }
  async addRetargetCharacter(asset: string, name: string, data?: Uint8Array) {
    if (!window.studioDesktop) throw Error('Import characters in the desktop app.');
    const existing = this.store.state.workspace?.characters?.find((c) => c.asset === asset);
    if (existing) {
      this.store.selectCharacter(existing.id);
      return;
    }
    const rig = await this.parseCharacter(
      data ?? (await window.studioDesktop.readCharacter(asset)),
    );
    try {
      const bones = [...rig.bones.keys()],
        meshes = rig.meshes.map((m) => m.name);
      this.store.addCharacter({
        id: randomId(),
        name: name.slice(0, 100),
        asset,
        mapping: autoMapBones(bones),
        hiddenMeshes: defaultHiddenMeshes(meshes, asset.startsWith('example-')),
        scale: 1,
        facing: 0,
        handIK: true,
        footIK: true,
        origin: 'skeleton',
        offsets: {},
      });
    } finally {
      rig.dispose();
    }
  }
  protected currentCharacter(): RetargetCharacter | undefined {
    const s = this.store.state,
      c = s.workspace?.characters?.find(
        (c) =>
          c.id ===
          (s.retargetMode ? s.workspace?.activeCharacterId : s.workspace?.previewCharacterId),
      );
    if (c) return c;
    if (s.project?.motionRig && this.canonicalRig) return mannyPreviewConfig(this.canonicalRig);
  }
  protected clearPreview() {
    this.targetFirstRifle.removeFromParent();
    this.targetFirstMagazine.removeFromParent();
    this.previewCharacter?.dispose();
    this.previewCharacter = undefined;
    this.previewSignature = '';
    this.previewControlWorlds.clear();
  }
  protected preparePreview() {
    const raw = this.retargetRig,
      c = this.currentCharacter();
    if (!raw || !c || !this.bodyRig || this.store.state.retargetLoading) return;
    raw.configure(this.canonicalRig!, c);
    if (!raw.ready) {
      this.clearPreview();
      return;
    }
    const signature = JSON.stringify([
      c.asset,
      c.mapping,
      c.scale,
      c.facing,
      c.offsets,
      c.preserveSkinning,
      c.origin,
    ]);
    if (signature !== this.previewSignature) {
      this.clearPreview();
      const preview = new MannyCharacter(raw, this.canonicalRig!, c);
      this.previewCharacter = preview;
      this.previewSignature = signature;
      this.scene.add(preview.body.root, preview.fpGroup);
      preview.fpGroup.add(this.targetFirstRifle, this.targetFirstMagazine);
    }
    this.previewCharacter?.updateParts(c);
  }
  protected syncRetarget() {
    const c = this.currentCharacter(),
      asset = c?.asset ?? '';
    if (asset === this.targetAsset) return;
    this.targetAsset = asset;
    const generation = ++this.targetLoad;
    this.store.patch({
      retargetLoading: !!asset,
      retargetError: '',
      retargetBones: [],
      retargetMeshes: [],
    });
    if (!asset) {
      this.clearPreview();
      this.retargetRig?.dispose();
      this.retargetRig = undefined;
      return;
    }
    const load = async () => {
      try {
        if (!window.studioDesktop) throw Error('Open the desktop app to load characters.');
        const rig =
          asset === 'manny'
            ? this.mannySource
              ? new RetargetRig(cloneSkeleton(this.mannySource) as T.Group, {
                  ownsResources: false,
                })
              : new RetargetRig(
                  (
                    await fullSkinLoader().loadAsync(
                      new URL('assets/manny.glb', document.baseURI).href,
                    )
                  ).scene,
                )
            : await this.parseCharacter(await window.studioDesktop.readCharacter(asset));
        if (generation !== this.targetLoad || this.disposed) {
          rig.dispose();
          return;
        }
        this.clearPreview();
        this.retargetRig?.dispose();
        this.retargetRig = rig;
        this.store.patch({
          retargetLoading: false,
          retargetBones: [...rig.bones.keys()],
          retargetMeshes: rig.meshes.map((m) => m.name),
        });
      } catch (e) {
        if (generation === this.targetLoad)
          this.store.patch({ retargetLoading: false, retargetError: (e as Error).message });
      }
    };
    void load();
  }
  get shoulderAdaptation() {
    const c = this.previewCharacter;
    if (!c || this.store.state.project?.editing !== 'firstPerson') return null;
    return {
      characterId: c.config.id,
      left: c.first.shoulderAdjustments.l * 100,
      right: c.first.shoulderAdjustments.r * 100,
    };
  }
  async bakeShared(
    plan: SharedExportPlan,
    write: (item: SharedExportItem, data: Uint8Array) => Promise<void>,
    progress: (value: number, label: string) => void,
  ) {
    const workspace = this.store.documentSnapshot();
    if (!workspace || this.recording) throw Error('Wait for the current recording or export.');
    const old = this.store.state;
    this.recording = true;
    this.store.patch({ playing: false });
    try {
      await bakeSharedSkeleton(workspace, plan, write, progress);
    } finally {
      this.recording = false;
      this.store.patch({ playing: old.playing });
      this.wasPlaying = false;
      this.apply(old.frame);
    }
  }
  async bakeRetarget(onProgress: (value: number) => void) {
    const s = this.store.state,
      rig =
        s.project?.editing === 'firstPerson'
          ? this.previewCharacter?.first
          : this.previewCharacter?.body;
    if (!s.project || !rig || this.recording)
      throw Error('Complete the required bone mapping before exporting.');
    const p = clone(s.project);
    this.recording = true;
    this.store.patch({ playing: false, retargetRest: false });
    try {
      return await exportRetargetGLB(
        rig,
        p.name,
        p.fps,
        p.end,
        (frame) => {
          this.apply(frame, p, false);
          for (const leg of this.previewCharacter?.legs ?? []) leg.visible = false;
        },
        onProgress,
      );
    } finally {
      this.recording = false;
      this.store.patch({ playing: s.playing, retargetRest: s.retargetRest });
      this.wasPlaying = false;
      this.apply(s.frame);
    }
  }
}

import { syncLoopSeam } from '../loopInterpolation';
import {
  captureControlLayerReference,
  activeAnimationLayer,
  addAnimationLayer,
  ensureLayers,
  selectAnimationLayer,
  syncLayers,
  keyingFrame,
} from '../layers';
import type { AnimationLayer, PoseLink } from '../layers';
import type { BlendChannel } from '../blendChannels';
import { blendValue } from '../layerBlend';
import { clone, putKey } from '../model';
import type { ControlId } from '../model';
import { newId } from '../library';
import { ensureCurve, validateCurves } from '../curves';
import type { CurveKey } from '../curves';
import { WorkspaceStore } from './workspace';

/** Animation layers and their per-control settings. */
export class LayerStore extends WorkspaceStore {
  addLayer(kind: 'pose' | 'additive') {
    const p = this.state.project;
    if (!p || (p.layers?.length ?? 1) >= 32) return;
    this.commit(
      addAnimationLayer(p, kind),
      kind === 'pose'
        ? 'Static body pose layer · edits apply to the whole action'
        : 'Adjustment layer · key your changes on this layer',
    );
    this.patch({ drafts: {}, timelineSelection: [] });
  }
  openPoseSource(link: PoseLink) {
    const source = this.state.workspace?.clips.find((c) => c.id === link.clipId);
    if (!source) {
      this.patch({ message: 'Source pose is not loaded. The saved base pose is still available.' });
      return;
    }
    this.activate(link.clipId);
    this.setFrame(link.frame);
    this.patch({ message: 'Editing shared pose · changes apply to every linked animation' });
  }
  selectLayer(id: string) {
    const p = this.state.project;
    if (!p) return;
    const linked = p.layers?.find((l) => l.id === id)?.poseLinks?.[0];
    if (linked) {
      this.openPoseSource(linked);
      return;
    }
    const next = clone(p);
    for (const [control, value] of Object.entries(this.state.drafts))
      putKey(next.tracks[control as ControlId], keyingFrame(next, this.state.frame), value!);
    selectAnimationLayer(next, id);
    this.patch({
      project: next,
      drafts: {},
      timelineSelection: [],
      message: 'Editing ' + activeAnimationLayer(next)?.name,
    });
  }
  configureLayer(
    id: string,
    value: Partial<
      Pick<
        AnimationLayer,
        'name' | 'enabled' | 'solo' | 'weight' | 'excluded' | 'contacts' | 'space' | 'spaces'
      >
    >,
  ) {
    const p = this.state.project;
    if (!p) return;
    const next = ensureLayers(clone(p)),
      layer = next.layers!.find((l) => l.id === id);
    if (!layer || (layer.kind === 'base' && Object.keys(value).some((k) => k !== 'name'))) return;
    if (value.name !== undefined) value.name = value.name.trim().slice(0, 100) || layer.name;
    if (
      Object.entries(value).every(
        ([k, v]) => JSON.stringify(layer[k as keyof AnimationLayer]) === JSON.stringify(v),
      )
    )
      return;
    Object.assign(layer, value);
    this.commit(next, 'Layer updated');
  }
  setControlLayerSetting(
    channel: BlendChannel,
    value: number,
    animated: boolean,
    transition = 0,
    easing: 'bezier' | 'linear' | 'step' = 'bezier',
    ids = this.selectedControls(),
  ) {
    const source = this.state.project,
      layer = source && activeAnimationLayer(source);
    if (!source || !layer || layer.kind === 'base' || !Number.isFinite(value)) return;
    const p = clone(source),
      frame = Math.round(this.state.frame),
      end = Math.min(p.end, frame + Math.max(0, Math.round(transition)));
    for (const id of ids) {
      captureControlLayerReference(p, id, frame);
      const track = p.tracks[id],
        current = blendValue(track, channel, frame),
        curve = ensureCurve(track, channel);
      const key = (at: number, v: number): CurveKey => ({
        frame: at,
        value: Math.max(0, Math.min(100, v)),
        interpolation: easing,
        handle: 'flat',
      });
      if (!animated) {
        curve.keys = [key(0, value)];
        curve.modifiers = [];
        delete curve.loop;
      } else if (end > frame) {
        curve.keys = curve.keys
          .filter((k) => k.frame < frame || k.frame > end)
          .concat(key(frame, current), key(end, value))
          .sort((a, b) => a.frame - b.frame);
        delete curve.loop;
      } else {
        curve.keys = curve.keys
          .filter((k) => k.frame !== frame)
          .concat(key(frame, value))
          .sort((a, b) => a.frame - b.frame);
        if (curve.loop) syncLoopSeam(curve);
      }
      validateCurves(track);
    }
    this.commit(
      p,
      animated
        ? end > frame
          ? 'Layer blend transition · frames ' + frame + '–' + end
          : 'Layer blend keyed at frame ' + frame
        : 'Layer blend updated',
    );
    this.patch({ drafts: {} });
  }
  keyControlLayerSettings(ids = this.selectedControls()) {
    const p = this.state.project;
    if (!p) return;
    this.beginGesture();
    for (const channel of [
      'blendWeight',
      ...(['px', 'py', 'pz', 'rx', 'ry', 'rz'] as const).flatMap((axis) => [
        'blendWeight_' + axis,
        'blendReplace_' + axis,
      ]),
    ] as BlendChannel[])
      for (const id of ids)
        this.setControlLayerSetting(
          channel,
          blendValue(p.tracks[id], channel, this.state.frame),
          true,
          0,
          'bezier',
          [id],
        );
    this.endGesture();
  }
  recaptureLayerReference(ids = this.selectedControls()) {
    const p = this.state.project;
    if (!p || activeAnimationLayer(p)?.kind === 'base') return;
    const next = clone(p);
    for (const id of ids) {
      delete next.tracks[id].layerReference;
      captureControlLayerReference(next, id, this.state.frame);
    }
    this.commit(next, 'Replacement pose captured at frame ' + this.state.frame);
  }
  moveLayer(id: string, direction: -1 | 1) {
    const p = this.state.project;
    if (!p?.layers) return;
    const next = clone(p),
      i = next.layers!.findIndex((l) => l.id === id),
      j = i + direction;
    if (i < 1 || j < 1 || j >= next.layers!.length) return;
    [next.layers![i], next.layers![j]] = [next.layers![j], next.layers![i]];
    this.commit(next, 'Layer order updated');
  }
  removeLayer(id: string) {
    const p = this.state.project;
    if (!p?.layers || p.layers[0].id === id) return;
    const next = clone(p),
      i = next.layers!.findIndex((l) => l.id === id);
    if (i < 1) return;
    syncLayers(next);
    next.layers!.splice(i, 1);
    if (next.activeLayerId === id) selectAnimationLayer(next, next.layers![Math.max(0, i - 1)].id);
    this.commit(next, 'Layer removed');
    this.patch({ drafts: {}, timelineSelection: [] });
  }
  duplicateLayer(id: string) {
    const p = this.state.project;
    if (!p?.layers || p.layers.length >= 32) return;
    const next = syncLayers(clone(p)),
      i = next.layers!.findIndex((l) => l.id === id);
    if (i < 1) return;
    const layer = {
      ...clone(next.layers![i]),
      id: newId(),
      name: next.layers![i].name + ' copy',
      solo: false,
    };
    next.layers!.splice(i + 1, 0, layer);
    selectAnimationLayer(next, layer.id);
    this.commit(next, 'Layer duplicated');
    this.patch({ drafts: {}, timelineSelection: [] });
  }
}

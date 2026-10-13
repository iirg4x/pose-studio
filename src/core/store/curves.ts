import { syncLoopSeam } from '../loopInterpolation';
import { curveKeyLocked, canInsertCurveKey, lockCurveKeys } from '../curveLocks';
import { randomId } from '../crypto';
import { copyPoseTracks } from '../poseEdits';
import { captureControlLayerReference, activeAnimationLayer } from '../layers';
import { isBlendChannel } from '../blendChannels';
import { CHANNEL_LABELS, channelUnit } from '../curves';
import { motionOptions } from '../interpolation';
import { clone } from '../model';
import type { ControlId, Project } from '../model';
import {
  ensureCurve,
  readCurve,
  baseCurve,
  closeCurveLoop,
  explicitLoopCurve,
  modifier,
  sampleCurve,
  validateCurves,
} from '../curves';
import type { Channel, Curve, CurveKey, Modifier } from '../curves';
import { loopRange } from '../loops';
import { KeyframeStore } from './keyframes';

/** Graph editor curves, curve keys and modifiers. */
export class CurveStore extends KeyframeStore {
  editCurve(channel: Channel, edit: (curve: Curve) => void, message = 'Curve updated') {
    if (!this.state.project || !this.canEditLayer(this.state.selected)) return;
    const p = clone(this.state.project),
      track = p.tracks[this.state.selected];
    if (isBlendChannel(channel)) {
      if (!activeAnimationLayer(p) || activeAnimationLayer(p)?.kind === 'base') return;
      captureControlLayerReference(p, this.state.selected, this.state.frame);
    }
    try {
      const curve = ensureCurve(track, channel),
        previous = clone(curve.keys);
      edit(curve);
      if (curveKeyLocked(track, channel) && curve.keys.length > previous.length)
        throw Error('New keys are locked on this curve. Edit an existing key or unlock it first.');
      if (curve.loop) {
        if (
          !curve.keys.some((k) => k.frame === curve.loop!.start) ||
          !curve.keys.some((k) => k.frame === curve.loop!.end) ||
          !curve.keys.some((k) => k.interpolation === 'loop')
        ) {
          const explicit = explicitLoopCurve({ ...curve, keys: previous });
          curve.keys = curve.keys.map((k) =>
            k.interpolation === 'loop'
              ? {
                  ...k,
                  interpolation: 'bezier',
                  handle: 'free',
                  left: explicit.keys.find((v) => v.frame === k.frame)?.left,
                  right: explicit.keys.find((v) => v.frame === k.frame)?.right,
                }
              : k,
          );
          delete curve.loop;
        } else syncLoopSeam(curve, previous);
      }
      validateCurves(track);
      this.commit(p, message);
      this.patch({ drafts: {} });
    } catch (e) {
      this.patch({ message: (e as Error).message });
    }
  }
  setCurveKeyLock(channel: Channel, locked: boolean) {
    const p = this.state.project;
    if (!p || !this.canEditLayer(this.state.selected)) return;
    const next = copyPoseTracks(p, [this.state.selected]);
    lockCurveKeys(next.tracks[this.state.selected], this.state.selected, channel, locked);
    this.commitTracks(
      next,
      locked
        ? 'New curve keys locked · existing keys and handles stay editable'
        : 'New curve keys unlocked',
    );
  }
  setCurveKeys(channel: Channel, keys: CurveKey[]) {
    this.editCurve(channel, (curve) => {
      const previous = curve.keys;
      curve.keys = clone(keys).sort((a, b) => a.frame - b.frame);
      syncLoopSeam(curve, previous);
    });
  }
  setCurveInterpolation(
    channel: Channel,
    frames: number[],
    interpolation: CurveKey['interpolation'],
  ) {
    this.editCurve(channel, (curve) => {
      if (interpolation === 'loop') {
        const range = loopRange(this.state.project!);
        closeCurveLoop(curve, range.start, range.end);
      } else {
        if (curve.loop && (frames.includes(curve.loop.start) || frames.includes(curve.loop.end))) {
          curve.keys = explicitLoopCurve(curve).keys;
          delete curve.loop;
        }
        curve.keys = curve.keys.map((k) =>
          frames.includes(k.frame) ? { ...k, interpolation } : k,
        );
      }
    });
  }
  setCurveLoop(channel: Channel, enabled: boolean) {
    this.editCurve(
      channel,
      (curve) => {
        if (enabled) {
          const { start, end } = loopRange(this.state.project!);
          closeCurveLoop(curve, start, end);
        } else {
          curve.keys = explicitLoopCurve(curve).keys;
          delete curve.loop;
        }
      },
      enabled
        ? 'Linked the first and last keys · interior keys unchanged'
        : 'Unlinked loop endpoints',
    );
  }
  applyCurveReduction(source: Project, tracks: Partial<Project['tracks']>) {
    if (this.state.project !== source) {
      this.patch({
        message: 'The animation changed. Analyze the current curves again before applying.',
      });
      return false;
    }
    const ids = Object.keys(tracks) as ControlId[];
    if (!ids.length || ids.some((id) => !this.canEditLayer(id))) return false;
    const next = clone(source);
    for (const id of ids) {
      next.tracks[id] = clone(tracks[id]!);
      validateCurves(next.tracks[id]);
    }
    this.commit(
      next,
      'Reduced ' + ids.length + ' control(s) with fitted curves · undo restores the original keys',
    );
    this.patch({ drafts: {}, timelineSelection: [] });
    return true;
  }
  addCurveKey(channel: Channel, frame = this.state.frame, value?: number) {
    if (!this.state.project) return;
    if (!canInsertCurveKey(this.state.project.tracks[this.state.selected], channel, frame)) {
      this.patch({
        message: 'New keys are locked on this curve. Edit an existing key or unlock it first.',
      });
      return;
    }
    const v =
      value ?? baseCurve(readCurve(this.state.project.tracks[this.state.selected], channel), frame);
    this.editCurve(
      channel,
      (curve) => {
        const previous =
          curve.keys.find((k) => k.frame === frame) ??
          curve.keys.filter((k) => k.frame < frame).at(-1) ??
          curve.keys[0];
        curve.keys = curve.keys
          .filter((k) => k.frame !== frame)
          .concat({
            ...motionOptions(previous),
            frame,
            value: v,
            interpolation: previous.interpolation,
            handle: 'clamped',
          })
          .sort((a, b) => a.frame - b.frame);
      },
      'Channel key inserted',
    );
  }
  addModifier(channel: Channel, type: Modifier['type']) {
    this.editCurve(
      channel,
      (curve) => {
        if (curve.modifiers.length >= 20) throw Error('A channel supports up to 20 modifiers.');
        if (type === 'cycles' && curve.modifiers.some((m) => m.type === 'cycles'))
          throw Error('This channel already has a Cycles modifier.');
        const m = modifier(type),
          range = loopRange(this.state.project!);
        if ((type === 'noise' || type === 'sine') && range.enabled)
          m.loop = { start: range.start, end: range.end };
        type === 'cycles' ? curve.modifiers.unshift(m) : curve.modifiers.push(m);
      },
      'Added ' + type + ' modifier',
    );
  }
  setModifierLoop(channel: Channel, id: string, enabled: boolean) {
    const p = this.state.project;
    if (!p) return;
    const { start, end } = loopRange(p);
    this.updateModifier(channel, id, { loop: enabled ? { start, end } : undefined });
  }
  updateModifier(channel: Channel, id: string, value: Partial<Modifier>) {
    this.editCurve(channel, (curve) => {
      const m = curve.modifiers.find((m) => m.id === id);
      if (m) Object.assign(m, value);
    });
  }
  removeModifier(channel: Channel, id: string) {
    this.editCurve(
      channel,
      (curve) => {
        curve.modifiers = curve.modifiers.filter((m) => m.id !== id);
      },
      'Modifier removed',
    );
  }
  moveModifier(channel: Channel, id: string, delta: number) {
    this.editCurve(channel, (curve) => {
      const i = curve.modifiers.findIndex((m) => m.id === id),
        j = i + delta;
      if (
        i < 0 ||
        j < 0 ||
        j >= curve.modifiers.length ||
        curve.modifiers[i].type === 'cycles' ||
        curve.modifiers[j].type === 'cycles'
      )
        return;
      [curve.modifiers[i], curve.modifiers[j]] = [curve.modifiers[j], curve.modifiers[i]];
    });
  }
  copyModifiers(channel: Channel, id?: string) {
    const p = this.state.project;
    if (!p) return;
    const modifiers = readCurve(p.tracks[this.state.selected], channel).modifiers.filter(
      (m) => !id || m.id === id,
    );
    if (!modifiers.length) return;
    this.patch({
      modifierClipboard: {
        modifiers: clone(modifiers),
        source: CHANNEL_LABELS[channel],
        unit: channelUnit(channel),
      },
      message: 'Copied ' + modifiers.length + ' modifier(s)',
    });
  }
  pasteModifiers(channel: Channel) {
    const clip = this.state.modifierClipboard;
    if (!clip?.modifiers.length) return;
    this.editCurve(
      channel,
      (curve) => {
        const { start, end } = loopRange(this.state.project!);
        const pasted = clone(clip.modifiers).map((m) => ({
          ...m,
          id: randomId(),
          ...(m.loop ? { loop: { start, end } } : {}),
        }));
        const cycle = pasted.find((m) => m.type === 'cycles');
        curve.modifiers = [
          ...(cycle ? [cycle] : curve.modifiers.filter((m) => m.type === 'cycles')),
          ...curve.modifiers.filter((m) => m.type !== 'cycles'),
          ...pasted.filter((m) => m.type !== 'cycles'),
        ];
        if (curve.modifiers.length > 20) throw Error('A channel supports up to 20 modifiers.');
      },
      'Pasted ' +
        clip.modifiers.length +
        ' modifier(s) · values use ' +
        (channelUnit(channel) || 'channel units'),
    );
  }
  duplicateModifier(channel: Channel, id: string) {
    this.editCurve(
      channel,
      (curve) => {
        const i = curve.modifiers.findIndex((m) => m.id === id);
        if (i < 0) return;
        if (curve.modifiers[i].type === 'cycles')
          throw Error('A channel has one Cycles modifier. Copy it to another channel instead.');
        curve.modifiers.splice(i + 1, 0, { ...clone(curve.modifiers[i]), id: randomId() });
      },
      'Modifier duplicated',
    );
  }
  bakeCurve(channel: Channel) {
    if (!this.state.project) return;
    const end = this.state.project.end;
    this.editCurve(
      channel,
      (curve) => {
        const keys = Array.from({ length: end + 1 }, (_, frame) => ({
          frame,
          value: sampleCurve(curve, frame),
          interpolation: 'linear' as const,
          handle: 'vector' as const,
        }));
        curve.keys = keys;
        curve.modifiers = [];
      },
      'Channel baked to keys over the animation range. Undo restores its modifiers.',
    );
  }
  copyCurveKeys(channel: Channel, frames: number[]) {
    if (!this.state.project) return;
    const keys = explicitLoopCurve(
      readCurve(this.state.project.tracks[this.state.selected], channel),
    ).keys.filter((k) => frames.includes(k.frame));
    if (!keys.length) return;
    const first = keys[0].frame;
    this.patch({
      curveClipboard: keys.map((k) => ({ ...clone(k), frame: k.frame - first })),
      message: 'Copied ' + keys.length + ' curve key(s).',
    });
  }
  pasteCurveKeys(channel: Channel) {
    const keys = this.state.curveClipboard;
    if (!keys?.length || !this.state.project) return;
    const at = this.state.frame;
    if (
      keys.some(
        (k) =>
          !canInsertCurveKey(
            this.state.project!.tracks[this.state.selected],
            channel,
            k.frame + at,
          ),
      )
    ) {
      this.patch({ message: 'Paste would add keys to a locked curve. Unlock it first.' });
      return;
    }
    if (keys.at(-1)!.frame + at > this.state.project.end) {
      this.patch({ message: 'Extend the animation end frame to fit these keys.' });
      return;
    }
    const before = this.state.project;
    this.editCurve(
      channel,
      (curve) => {
        const next = keys.map((k) => ({ ...clone(k), frame: k.frame + at })),
          frames = new Set(next.map((k) => k.frame));
        curve.keys = curve.keys
          .filter((k) => !frames.has(k.frame))
          .concat(next)
          .sort((a, b) => a.frame - b.frame);
      },
      'Curve keys pasted at frame ' + at,
    );
    return this.state.project !== before ? keys.map((k) => k.frame + at) : undefined;
  }
}

import { lockControlKeys } from '../curveLocks';
import { copyPoseTracks } from '../poseEdits';
import { keyingFrame, editLayerAllowed } from '../layers';
import { applyKeySettings, curveMotionOptions } from '../timelineSettings';
import type { KeySettings } from '../timelineSettings';
import { insertChannels, KEYING_SETS } from '../keying';
import type { KeyingSet } from '../keying';
import { channelsFor, channelValue } from '../curves';
import type { Channel } from '../curves';
import { motionOptions, validateMotionOptions } from '../interpolation';
import type { MotionOptions } from '../interpolation';
import { visibleControls, clone, putKey, sample, controlEnabled } from '../model';
import type { ControlId, Interpolation } from '../model';
import { loopRange, matchLoopEnd } from '../loops';
import {
  copyTimelineKeys,
  pasteTimelineKeys,
  moveTimelineKeys,
  deleteTimelineKeys,
  validKeys,
  uniqueKeys,
  keyToken,
} from '../timelineKeys';
import type { TimelineKey } from '../timelineKeys';
import { PosingStore } from './posing';

/** Timeline keys, keying sets, loops and interpolation. */
export class KeyframeStore extends PosingStore {
  setTimelineKeySettings(settings: KeySettings) {
    const p = this.state.project;
    if (!p) return;
    const selection = validKeys(p, this.state.timelineSelection);
    if (selection.length)
      this.commit(
        applyKeySettings(p, selection, settings),
        'Updated ' + selection.length + ' selected key(s)',
      );
  }
  showKeyframeMenu(x = innerWidth * 0.5, y = innerHeight * 0.35) {
    this.patch({ keyframeMenu: { x, y } });
  }
  insertKeyingSet(set: KeyingSet) {
    const s = this.state;
    if (!s.project) return;
    const ids =
      set === 'whole'
        ? visibleControls(s.project.editing, s.project).filter(
            (id) => controlEnabled(s.project!, id, s.frame) && id !== 'camera',
          )
        : this.selectedControls();
    const next = clone(s.project),
      drafts = { ...s.drafts };
    let count = 0;
    for (const id of ids) {
      if (!editLayerAllowed(next, id)) continue;
      const value = drafts[id] ?? sample(next.tracks[id], s.frame);
      if (!insertChannels(next.tracks[id], id, keyingFrame(next, s.frame), value, set)) continue;
      count++;
      const actual = sample(next.tracks[id], s.frame);
      if (
        channelsFor(id, next.tracks[id]).every(
          (c) =>
            Math.abs(
              channelValue(value, c, next.tracks[id].rotationOrder) -
                channelValue(actual, c, next.tracks[id].rotationOrder),
            ) < 1e-5,
        )
      )
        delete drafts[id];
    }
    if (count)
      this.commit(
        next,
        'Inserted ' +
          KEYING_SETS.find((k) => k.id === set)!.label +
          ' keys on ' +
          count +
          ' control(s)',
      );
    this.patch({
      drafts,
      keyframeMenu: null,
      ...(!count
        ? {
            message:
              set === 'available'
                ? 'No existing animation channels on the selected controls.'
                : 'Select controls with channels to key.',
          }
        : {}),
    });
  }
  keySelected(ids = this.selectedControls()) {
    const p = this.state.project;
    if (!p || !ids.length || !this.canEditLayer()) return;
    const next = clone(p),
      drafts = { ...this.state.drafts };
    for (const id of ids) {
      if (!editLayerAllowed(next, id)) continue;
      putKey(
        next.tracks[id],
        keyingFrame(next, this.state.frame),
        drafts[id] ?? sample(next.tracks[id], this.state.frame),
      );
      delete drafts[id];
    }
    this.commit(next, 'Keyed ' + ids.length + ' selected control(s)');
    this.patch({ drafts });
  }
  addKey(id = this.state.selected) {
    const p = this.state.project;
    if (!p || !this.canEditLayer(id)) return;
    const next = clone(p);
    putKey(
      next.tracks[id],
      keyingFrame(next, this.state.frame),
      this.state.drafts[id] ?? sample(p.tracks[id], this.state.frame),
    );
    const drafts = { ...this.state.drafts };
    delete drafts[id];
    this.commit(next, 'Pose keyed at frame ' + this.state.frame);
    this.patch({ drafts });
  }
  removeKey(id = this.state.selected, frame = this.state.frame) {
    if (!this.state.project || !this.canEditLayer(id)) return;
    const p = clone(this.state.project),
      t = p.tracks[id];
    let removed = false;
    if (t.keys.length > 1 && t.keys.some((k) => k.frame === frame)) {
      t.keys = t.keys.filter((k) => k.frame !== frame);
      removed = true;
    }
    for (const curve of Object.values(t.curves ?? {}))
      if (curve && curve.keys.length > 1 && curve.keys.some((k) => k.frame === frame)) {
        curve.keys = curve.keys.filter((k) => k.frame !== frame);
        removed = true;
      }
    if (removed) this.commit(p, 'Key removed');
    else
      this.patch({ message: 'No removable key at this frame. Each curve needs at least one key.' });
  }
  selectTimeline(keys: TimelineKey[], mode: 'replace' | 'add' | 'subtract' = 'replace') {
    const incoming = new Set(keys.map(keyToken)),
      old = this.state.timelineSelection;
    const selection =
      mode === 'replace'
        ? keys
        : mode === 'add'
          ? [...old, ...keys]
          : old.filter((k) => !incoming.has(keyToken(k)));
    this.patch({ timelineSelection: uniqueKeys(selection) });
  }
  copyTimeline() {
    const p = this.state.project;
    if (!p) return;
    const clip = copyTimelineKeys(p, this.state.timelineSelection);
    if (clip)
      this.patch({
        keyClipboard: clip,
        message:
          this.state.timelineSelection.length +
          ' keys copied. Switch animations and paste at the playhead.',
      });
  }
  pasteTimeline(clip = this.state.keyClipboard) {
    const p = this.state.project;
    if (!p || !clip) return;
    try {
      const result = pasteTimelineKeys(p, clip, this.state.frame);
      this.commit(result.project, 'Pasted ' + result.selection.length + ' keys');
      const controls = [...new Set(result.selection.map((k) => k.id))];
      this.patch({
        timelineSelection: result.selection,
        selection: controls,
        selected: controls.includes(this.state.selected)
          ? this.state.selected
          : (controls[0] ?? this.state.selected),
        drafts: {},
      });
    } catch (e) {
      this.patch({ message: (e as Error).message });
    }
  }
  moveTimeline(delta: number, selection = this.state.timelineSelection) {
    const p = this.state.project;
    if (!p || !delta) return;
    try {
      const result = moveTimelineKeys(p, selection, delta);
      if (!result.delta) return;
      this.commit(
        result.project,
        'Moved ' + result.selection.length + ' keys by ' + result.delta + ' frames',
      );
      this.patch({ timelineSelection: result.selection, drafts: {} });
    } catch (e) {
      this.patch({ message: (e as Error).message });
    }
  }
  deleteTimeline() {
    const p = this.state.project,
      keys = this.state.timelineSelection;
    if (!p || !keys.length) return;
    try {
      const result = deleteTimelineKeys(p, keys);
      this.commit(
        result.project,
        result.kept
          ? 'Keys deleted; retained one base key per empty channel.'
          : 'Selected keys deleted',
      );
      this.patch({ timelineSelection: [], drafts: {} });
    } catch (e) {
      this.patch({ message: (e as Error).message });
    }
  }
  moveKey(id: ControlId, from: number, to: number) {
    const p = this.state.project;
    if (!p || from === to || !Number.isFinite(to)) return;
    const result = moveTimelineKeys(p, [{ id, frame: from }], to - from);
    if (result.delta) this.commit(result.project, 'Key timing updated');
  }
  setControlKeyLock(ids: ControlId[], locked: boolean) {
    const p = this.state.project;
    if (!p) return;
    ids = ids.filter((id) => editLayerAllowed(p, id));
    if (!ids.length) return;
    const next = copyPoseTracks(p, ids);
    for (const id of ids) lockControlKeys(next.tracks[id], id, locked);
    this.commitTracks(
      next,
      locked ? 'New keys locked on ' + ids.length + ' control(s)' : 'New keys unlocked',
    );
  }
  setLoop(value: Partial<{ enabled: boolean; start: number; end: number }>) {
    if (!this.state.project) return;
    const p = clone(this.state.project),
      range = { ...loopRange(p), ...value };
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end > p.end ||
      range.start >= range.end
    )
      return;
    p.loop = range;
    this.syncModifierLoops(p);
    this.commit(p, 'Loop range updated');
  }
  matchLoop() {
    if (!this.state.project) return;
    this.commit(
      matchLoopEnd(this.state.project),
      'Matched the end pose. Check the seam and tangents.',
    );
    this.patch({ drafts: {} });
  }
  setInterpolation(value: Interpolation | 'loop') {
    if (!this.state.project) return;
    if (value === 'loop') {
      const id = this.state.selected;
      this.commit(
        applyKeySettings(
          this.state.project,
          [{ id, frame: this.state.project.tracks[id].keys[0].frame }],
          { interpolation: 'loop' },
        ),
        'Loop interpolation closes the playback range with continuous Bézier motion',
      );
      this.patch({ drafts: {} });
      return;
    }
    const p = clone(this.state.project),
      track = p.tracks[this.state.selected];
    track.interpolation = value;
    for (const key of track.keys)
      Object.assign(key, motionOptions(track), { interpolation: value });
    for (const [channel, curve] of Object.entries(track.curves ?? {}))
      if (curve) {
        const projected = curveMotionOptions(track, channel as Channel);
        delete curve.loop;
        for (const key of curve.keys)
          Object.assign(key, clone(projected), {
            interpolation: value === 'smooth' ? 'bezier' : value,
          });
      }
    this.commit(p, 'Interpolation applied to this control. Use Curves for individual segments.');
    this.patch({ drafts: {} });
  }
  setMotionOptions(value: MotionOptions) {
    if (!this.state.project) return;
    const p = clone(this.state.project),
      track = p.tracks[this.state.selected];
    Object.assign(track, clone(value));
    try {
      validateMotionOptions(track);
    } catch (e) {
      this.patch({ message: (e as Error).message });
      return;
    }
    for (const key of track.keys)
      if ((key.interpolation ?? track.interpolation) === track.interpolation)
        Object.assign(key, motionOptions(track));
    for (const [channel, curve] of Object.entries(track.curves ?? {}))
      if (curve) {
        const projected = curveMotionOptions(track, channel as Channel);
        for (const key of curve.keys)
          if (key.interpolation === track.interpolation) Object.assign(key, clone(projected));
      }
    this.commit(p, 'Interpolation settings updated');
    this.patch({ drafts: {} });
  }
}

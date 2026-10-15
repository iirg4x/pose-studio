import { liveMirrorLinks, makeMirrorLinks } from '../liveMirror';
import type { MirrorLink } from '../liveMirror';
import type { MirrorRest } from '../mirrorTimeline';
import { canInsertCurveKey } from '../curveLocks';
import { copyPoseTracks } from '../poseEdits';
import {
  authorLayerPosition,
  activeAnimationLayer,
  addAnimationLayer,
  keyingFrame,
  editLayerAllowed,
} from '../layers';
import { channelsFor, channelValue } from '../curves';
import {
  IDS,
  controlParent,
  attachmentRest,
  clone,
  forLayer,
  overlayPose,
  evaluate,
  putKey,
  rawForWorld,
  sample,
  switchParent,
} from '../model';
import type { ControlId, ParentId, Pose } from '../model';
import { applyPose, capturePose } from '../library';
import { LayerStore } from './layers';

/** Pose edits: world/raw/layer edits, copy and paste, mirroring and rest reset. */
export class PosingStore extends LayerStore {
  copyPose(scope: 'control' | 'rig' = 'rig') {
    const s = this.state;
    if (!s.project) return;
    this.patch({
      clipboard: capturePose(s.project, s.frame, s.drafts, scope, s.selected),
      message:
        scope === 'rig'
          ? 'Rig pose copied, including props. Paste it into any animation.'
          : 'Control pose copied.',
    });
  }
  copySelectedPose() {
    const s = this.state,
      p = s.project,
      ids = this.selectedControls();
    if (!p || !ids.length) return;
    if (ids.length === 1) {
      this.copyPose('control');
      return;
    }
    const stamp = capturePose(p, s.frame, s.drafts, 'rig', s.selected),
      values = evaluate(p, s.frame, s.drafts);
    stamp.poses = Object.fromEntries(ids.map((id) => [id, clone(values[id])]));
    delete stamp.modes;
    this.patch({ clipboard: stamp, message: 'Copied ' + ids.length + ' selected controls' });
  }
  pastePose(stamp = this.state.clipboard, respectAutoKey = false) {
    const s = this.state;
    if (!s.project || !stamp || !this.canEditLayer()) return;
    if (stamp.scope === 'rig' && stamp.layer !== s.project.editing) {
      this.patch({
        message:
          'Switch to ' +
          (stamp.layer === 'firstPerson' ? 'First person' : 'Full body') +
          ' to paste this rig pose.',
      });
      return;
    }
    const desired =
      stamp.scope === 'control' ? { [s.selected]: Object.values(stamp.poses)[0] } : stamp.poses;
    const poses = Object.fromEntries(
      Object.entries(desired).filter(([id]) => editLayerAllowed(s.project!, id as ControlId)),
    );
    if (!Object.keys(poses).length) return;
    const next = applyPose(
      s.project,
      s.frame,
      { ...stamp, scope: 'rig', poses },
      s.selected,
      s.drafts,
    );
    if (respectAutoKey && !s.autoKey) {
      const drafts = { ...s.drafts };
      for (const id of Object.keys(poses) as ControlId[])
        drafts[id] = sample(next.tracks[id], keyingFrame(next, s.frame));
      this.patch({ drafts, message: 'Pasted pose · unkeyed preview' });
    } else {
      this.commit(next, 'Pasted and keyed pose at frame ' + keyingFrame(next, s.frame));
      this.patch({ drafts: {}, ...this.poseEditPlayback() });
    }
  }
  savePose(name: string, scope: 'control' | 'rig' = 'rig') {
    const workspace = this.workspaceSnapshot(),
      s = this.state;
    if (!workspace || !s.project || !name.trim()) return;
    if (workspace.poses.length >= 200) {
      this.patch({ message: 'This project supports up to 200 saved poses.' });
      return;
    }
    const stamp = capturePose(s.project, s.frame, s.drafts, scope, s.selected);
    stamp.name = name.trim().slice(0, 100);
    workspace.poses.push(stamp);
    this.patch({ workspace, message: 'Saved pose “' + stamp.name + '” in this project.' });
  }
  removePose(id: string) {
    const workspace = this.workspaceSnapshot();
    const removed = workspace?.poses.find((pose) => pose.id === id);
    if (!workspace || !removed) return;
    this.beginWorkspaceHistoryEdit(workspace);
    workspace.poses = workspace.poses.filter((p) => p.id !== id);
    this.patch({ workspace, message: 'Saved pose removed · Undo to restore' });
  }
  resetSelected(kind: 'location' | 'rotation' | 'all') {
    const s = this.state;
    if (!s.project || !this.canEditLayer()) return;
    const ids = this.selectedControls().filter((id) => editLayerAllowed(s.project!, id));
    if (!ids.length) return;
    const next = clone(s.project),
      defaults = forLayer(this.resetProject, s.project.editing),
      drafts = { ...s.drafts };
    let changed = 0;
    // World-space rest targets are solved against current parents, so selected
    // parents (and root, which carries every body control) must settle first.
    const depth = (id: ControlId) => {
      if (id === 'root') return -1;
      let n = 0;
      for (let at: string = id, seen = new Set<string>(); at !== 'world' && !seen.has(at); n++) {
        seen.add(at);
        at = controlParent(next, at as ControlId, s.frame);
      }
      return n;
    };
    ids.sort((a, b) => depth(a) - depth(b));
    for (const id of ids) {
      const raw = clone(drafts[id] ?? sample(next.tracks[id], keyingFrame(next, s.frame))),
        resolved = this.restPose?.(id, kind, next, s.frame, drafts),
        rest =
          resolved ??
          (next.bodyBase ||
          (activeAnimationLayer(next)?.kind !== 'base' && !!next.layers) ||
          next.tracks[id].basis
            ? overlayPose()
            : (attachmentRest(next.tracks[id], keyingFrame(next, s.frame), raw) ??
              defaults.tracks[id]?.keys[0] ??
              overlayPose()));
      const location =
          (resolved || kind !== 'rotation') && raw.p.some((v, i) => Math.abs(v - rest.p[i]) > 1e-8),
        rotation =
          (resolved || kind !== 'location') &&
          Math.abs(raw.q.reduce((sum, v, i) => sum + v * rest.q[i], 0)) < 1 - 1e-10;
      if (!location && !rotation) continue;
      if (resolved || kind !== 'rotation') raw.p = clone(rest.p);
      if (resolved || kind !== 'location') raw.q = clone(rest.q);
      if (resolved?.layerPosition !== undefined) raw.layerPosition = resolved.layerPosition;
      if (s.autoKey) {
        putKey(next.tracks[id], keyingFrame(next, s.frame), raw);
        delete drafts[id];
      } else drafts[id] = raw;
      changed++;
    }
    // Reset is a one-shot command. Repeating it must not toggle the pose, add
    // empty undo entries, create keys, or interrupt playback at an unchanged pose.
    if (!changed) {
      this.patch({ message: 'Selected controllers are already at rest ' + kind });
      return;
    }
    if (s.autoKey) this.commit(next);
    this.patch({
      drafts,
      ...this.poseEditPlayback(),
      message:
        'Reset ' +
        kind +
        ' on ' +
        changed +
        ' selected control(s)' +
        (s.autoKey ? '' : ' · unkeyed preview'),
    });
  }
  // Static layers and unkeyed previews stay live; only timed controller keys pause.
  protected poseKeyBlocked(id: ControlId, value: Pose) {
    const p = this.state.project!;
    if (!this.state.autoKey) return false;
    const frame = keyingFrame(p, this.poseEditFrame()),
      track = p.tracks[id],
      prior = sample(track, frame),
      changed = channelsFor(id, track).filter(
        (c) =>
          Math.abs(
            channelValue(value, c, track.rotationOrder) -
              channelValue(prior, c, track.rotationOrder),
          ) > 1e-7,
      );
    if (changed.length && changed.every((c) => !canInsertCurveKey(track, c, frame))) {
      this.patch({
        message:
          'New keys are locked here. Move to an existing key to edit it, or unlock the curve.',
      });
      return true;
    }
    return false;
  }
  protected poseChanged(id: ControlId, value: Pose) {
    const p = this.state.project!,
      prior = this.state.drafts[id] ?? sample(p.tracks[id], keyingFrame(p, this.poseEditFrame()));
    return (
      !!value.layerPosition !== !!prior.layerPosition ||
      [...value.p, ...value.q, ...value.grip, value.fov].some(
        (v, i) => Math.abs(v - [...prior.p, ...prior.q, ...prior.grip, prior.fov][i]) > 1e-8,
      )
    );
  }
  poseGestureChanged() {
    return this.gestureChanged;
  }
  setCameraMotion(enabled: boolean) {
    const p = this.state.project;
    if (p?.cameraBinding && p.cameraBinding.enabled !== enabled)
      this.commit(
        { ...p, cameraBinding: { ...p.cameraBinding, enabled } },
        enabled ? 'Source camera motion enabled' : 'Source camera motion disabled',
      );
  }
  editCameraFov(fov: number) {
    const original = this.state.project;
    if (!original || !Number.isFinite(fov)) return;
    const camera = evaluate(original, this.poseEditFrame(), this.state.drafts).camera;
    fov = Math.max(20, Math.min(120, fov));
    if (Math.abs(camera.fov - fov) < 1e-8) return;
    if (this.state.selected !== 'camera' || this.state.selection.length !== 1)
      this.selectControl('camera');
    // FOV is a direct camera edit: an implicit camera mask must not silently eat it.
    if (!editLayerAllowed(original, 'camera')) {
      let next = clone(original),
        layer = activeAnimationLayer(next);
      if (layer && editLayerAllowed(original) && layer.excluded.includes('camera'))
        layer.excluded = layer.excluded.filter((id) => id !== 'camera');
      else {
        next = addAnimationLayer(next, 'additive');
        layer = activeAnimationLayer(next)!;
        layer.name = 'Camera';
        layer.excluded = IDS.filter((id) => id !== 'camera');
        if (next.layers!.some((l) => l.solo && l.enabled)) layer.solo = true;
      }
      this.commit(next, 'Camera enabled for editing');
    }
    this.editWorld('camera', { ...camera, fov });
  }
  editWorld(id: ControlId, value: Pose) {
    const p = this.state.project;
    if (!p || !this.canEditLayer(id)) return;
    const raw = rawForWorld(p, id, this.poseEditFrame(), value, this.state.drafts);
    if (!this.poseChanged(id, raw) || this.poseKeyBlocked(id, raw)) return;
    if (this.state.autoKey) {
      const next = copyPoseTracks(p, [id]);
      putKey(next.tracks[id], keyingFrame(next, this.poseEditFrame()), raw);
      this.commitTracks(next);
      this.patch({ drafts: {}, ...this.poseEditPlayback() });
    } else
      this.patch({
        drafts: { ...this.state.drafts, [id]: raw },
        message: 'Unkeyed pose — press K to keep it.',
      });
  }
  editLayerOffset(id: ControlId, value: Pose) {
    const p = this.state.project;
    if (
      !p ||
      !p.tracks[id].additive ||
      !this.canEditLayer(id) ||
      !this.poseChanged(id, value) ||
      this.poseKeyBlocked(id, value)
    )
      return;
    if (this.state.autoKey) {
      const next = copyPoseTracks(p, [id]);
      if (
        value.p.some(
          (v, i) =>
            Math.abs(v - sample(p.tracks[id], keyingFrame(p, this.poseEditFrame())).p[i]) > 1e-8,
        ) &&
        authorLayerPosition(next, id)
      )
        value = { ...value, layerPosition: true };
      putKey(next.tracks[id], keyingFrame(next, this.poseEditFrame()), value);
      const drafts = { ...this.state.drafts };
      delete drafts[id];
      this.commit(next);
      this.patch({ drafts, ...this.poseEditPlayback() });
    } else {
      const layer = activeAnimationLayer(p),
        prior = this.state.drafts[id] ?? sample(p.tracks[id], keyingFrame(p, this.poseEditFrame()));
      if (
        layer?.kind !== 'base' &&
        (layer?.spaces?.[id] ?? layer?.space) === 'world' &&
        value.p.some((v, i) => Math.abs(v - prior.p[i]) > 1e-8)
      )
        value = { ...value, layerPosition: true };
      this.patch({
        drafts: { ...this.state.drafts, [id]: clone(value) },
        message: 'Unkeyed layer offset — press K to keep it.',
      });
    }
  }
  currentTransformPose() {
    const { project, selected, drafts } = this.state,
      frame = this.poseEditFrame();
    return project?.tracks[selected].additive
      ? clone(drafts[selected] ?? sample(project.tracks[selected], keyingFrame(project, frame)))
      : this.currentPose();
  }
  editRaw(id: ControlId, value: Pose) {
    const p = this.state.project;
    if (!p || !this.canEditLayer(id)) return;
    if (p.bodyBase || p.layers)
      value = rawForWorld(p, id, this.poseEditFrame(), value, this.state.drafts);
    if (!this.poseChanged(id, value) || this.poseKeyBlocked(id, value)) return;
    if (this.state.autoKey) {
      const next = copyPoseTracks(p, [id]);
      putKey(next.tracks[id], keyingFrame(next, this.poseEditFrame()), value);
      this.commitTracks(next);
      const drafts = { ...this.state.drafts };
      delete drafts[id];
      this.patch({ drafts, ...this.poseEditPlayback() });
    } else
      this.patch({
        drafts: { ...this.state.drafts, [id]: value },
        message: 'Unkeyed pose — press K to keep it.',
      });
  }
  follow(parent: ParentId) {
    const p = this.state.project;
    if (!p) return;
    if (!this.canEditLayer(this.state.selected)) return;
    const id = this.state.selected;
    try {
      let base = clone(p);
      for (const [key, value] of Object.entries(this.state.drafts))
        putKey(base.tracks[key as ControlId], keyingFrame(base, this.state.frame), value!);
      const next = switchParent(base, id, parent, this.state.frame);
      this.commit(
        next,
        parent === 'world'
          ? 'Released without changing the pose'
          : 'Attachment saved at frame ' + this.state.frame,
      );
      this.patch({ drafts: {} });
    } catch (e) {
      this.patch({ message: (e as Error).message + ' Choose another attachment.' });
    }
  }
  linkMirrors(ids: ControlId[], phase: MirrorLink['phase'], rest: MirrorRest) {
    const p = this.state.project;
    if (!p) return;
    try {
      const links = makeMirrorLinks(p, ids, phase, rest);
      this.commit(
        { ...p, mirrorLinks: { ...p.mirrorLinks, [p.editing]: links } },
        'Live mirror linked · edit the source side' +
          (phase ? ' · opposite side follows half a cycle later' : ''),
      );
      this.patch({ drafts: {}, timelineSelection: [] });
    } catch (e) {
      this.patch({ message: (e as Error).message });
    }
  }
  unlinkMirrors(targets: ControlId[]) {
    const p = this.state.project;
    if (!p) return;
    const links = liveMirrorLinks(p).filter((l) => !targets.includes(l.target));
    this.commit(
      { ...p, mirrorLinks: { ...p.mirrorLinks, [p.editing]: links } },
      'Mirror unlinked · original destination animation restored',
    );
    this.patch({ drafts: {}, timelineSelection: [] });
  }
  setMirrorPhase(targets: ControlId[], phase: MirrorLink['phase']) {
    const p = this.state.project;
    if (!p) return;
    this.commit(
      {
        ...p,
        mirrorLinks: {
          ...p.mirrorLinks,
          [p.editing]: liveMirrorLinks(p).map((l) =>
            targets.includes(l.target) ? { ...l, phase } : l,
          ),
        },
      },
      phase ? 'Mirror follows half a cycle later' : 'Mirror follows at the same frame',
    );
  }
}

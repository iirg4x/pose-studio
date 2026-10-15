import { mirrorTimelineClipboard } from '../../core/mirrorTimeline';
import { controllerConstraints, groundingClearance } from '../../core/controllerConstraints';
import { mirrorControlPose, mirrorControlPoses, mirrorDestination } from '../../core/mirrorPose';
import { editLayerAllowed } from '../../core/layers';
import type { AttachmentTarget } from '../attachments';
import * as T from 'three';
import { evaluate, matrix, forLayer, limbMode, controlEnabled, clone } from '../../core/model';
import type { ControlId, Pose } from '../../core/model';
import { CONTROLS, isBoneControl } from '../../core/controls';
import type { LimbId, LimbMode } from '../../core/controls';
import { matchLimb } from '../../core/rigMatching';
import { keyingFrame } from '../../core/layers';
import { putKey } from '../../core/model';
import { TransformScene } from './transform';

/** Pose and view commands: mirror, ground, attach, limb switch, framing. */
export abstract class CommandScene extends TransformScene {
  protected pasteMirroredKeys = () => {
    const s = this.store.state,
      p = s.project,
      clip = s.keyClipboard;
    if (!p || !clip || !this.rig || !this.bodyRig) return;
    this.apply(s.frame);
    const rig = p.editing === 'body' ? this.bodyRig : this.rig;
    try {
      this.store.pasteTimeline(
        mirrorTimelineClipboard(clip, p, (id) => {
          const name = CONTROLS[id].bone,
            r = name && rig.rest.get(name);
          return r
            ? {
                world: r.world,
                parent: r.world.clone().multiply(new T.Matrix4().compose(r.p, r.q, r.s).invert()),
              }
            : { world: new T.Matrix4(), parent: new T.Matrix4() };
        }),
      );
    } catch (e) {
      this.store.patch({ message: (e as Error).message });
    }
  };
  protected linkAnimationMirror = (event: Event) => {
    const p = this.store.state.project,
      detail = (event as CustomEvent<{ ids: ControlId[]; phase: 0 | 0.5 }>).detail;
    if (!p || !detail || !this.rig || !this.bodyRig) return;
    this.apply(this.store.state.frame);
    const rig = p.editing === 'body' ? this.bodyRig : this.rig;
    this.store.linkMirrors(detail.ids, detail.phase, (id) => {
      const name = CONTROLS[id].bone,
        r = name && rig.rest.get(name);
      return r
        ? {
            world: r.world,
            parent: r.world.clone().multiply(new T.Matrix4().compose(r.p, r.q, r.s).invert()),
          }
        : { world: new T.Matrix4(), parent: new T.Matrix4() };
    });
  };
  protected groundSelection = (event: Event) =>
    this.groundSelected((event as CustomEvent<ControlId[]>).detail || undefined);
  groundSelected(ids = this.store.selectedControls()) {
    const s = this.store.state,
      p = s.project;
    if (!p || !this.rig || !this.bodyRig || !this.store.canEditLayer()) return;
    ids = [
      ...new Set(
        ids.map((id) =>
          /^(heel|ball)_[lr]$/.test(id) ? (('foot_' + id.at(-1)) as ControlId) : id,
        ),
      ),
    ];
    ids = ids.filter(
      (id) => id !== 'camera' && controlEnabled(p, id, s.frame) && editLayerAllowed(p, id),
    );
    if (!ids.length) return;
    const authored = new Set<ControlId>();
    this.store.beginGesture();
    try {
      this.store.batch(() => {
        this.store.patch({ autoKey: true });
        // Retargeted mesh proportions can make one source-to-preview conversion
        // slightly inexact. Refine only this keyed pose, never the intervening frames.
        for (let pass = 0; pass < 3; pass++) {
          this.apply(this.store.poseEditFrame());
          const first = p.editing === 'firstPerson',
            rig =
              (first ? this.previewCharacter?.first : this.previewCharacter?.body) ??
              (first ? this.rig! : this.bodyRig!),
            targets = new Map<ControlId, T.Matrix4>();
          for (const id of ids) {
            const clearance = groundingClearance(p, id);
            if (CONTROLS[id].bone) {
              for (const [groundKey, world] of rig.groundPose(id, clearance)) {
                const key =
                  /^foot_[lr]$/.test(groundKey) &&
                  limbMode(p, ('leg_' + groundKey.at(-1)) as LimbId, s.frame) === 'fk'
                    ? (('ankle_' + groundKey.at(-1)) as ControlId)
                    : groundKey;
                if (!editLayerAllowed(p, key)) continue;
                // Ground the visible endpoint while preserving its keyed heel/ball roll.
                // IK controls describe a target before those pivots, not the bone matrix.
                if (/^(hand|foot)_[lr]$/.test(key)) {
                  const control =
                    this.previewControlWorlds.get(key) ?? this.sourceControlWorlds.get(key);
                  if (control)
                    world
                      .multiply(rig.bodyBone(key).matrixWorld.clone().invert())
                      .multiply(control);
                }
                targets.set(key, world);
              }
            } else {
              const world = (this.previewControlWorlds.get(id) ??
                  this.sourceControlWorlds.get(id))!.clone(),
                position = new T.Vector3().setFromMatrixPosition(world);
              position.y = clearance;
              targets.set(id, world.setPosition(position));
            }
          }
          for (const id of targets.keys()) authored.add(id);
          this.applyTransformTargets(
            this.store.state.project!,
            this.store.state.drafts,
            targets,
            true,
          );
        }
        this.store.keySelected([...authored]);
      });
    } finally {
      this.store.patch({ autoKey: s.autoKey, selected: s.selected, selection: s.selection });
      this.store.endGesture();
      this.apply(this.store.state.frame);
    }
    const current = this.store.state.project!,
      rig =
        (current.editing === 'firstPerson'
          ? this.previewCharacter?.first
          : this.previewCharacter?.body) ??
        (current.editing === 'firstPerson' ? this.rig : this.bodyRig),
      limited = ids.some((id) => {
        const tip = /^(toe|ankle)_[lr]$/.test(id) ? (('foot_' + id.at(-1)) as ControlId) : id;
        if (!/^(hand|foot)_[lr]$/.test(tip) || controllerConstraints(current)[tip]?.stretch)
          return false;
        const minimum = rig.meshMinimum(id);
        return minimum !== undefined && Math.abs(minimum - groundingClearance(current, id)) > 0.001;
      });
    this.store.patch({
      message: limited
        ? 'Floor target keyed; fixed IK reach limits contact. Move the body closer or enable Stretch.'
        : 'Grounded and keyed ' +
          ids.length +
          ' control(s) at frame ' +
          keyingFrame(current, this.store.state.frame),
    });
  }
  protected activateControl = (e: Event) => {
    const id = (e as CustomEvent<ControlId>).detail,
      d = CONTROLS[id];
    if (d?.limb && d.only) this.switchLimb(d.limb, d.only);
  };
  pickAttachment() {
    this.pickingAttachment = true;
    this.gizmo.detach();
    this.renderer.domElement.style.cursor = 'crosshair';
    this.renderer.domElement.focus();
    this.store.patch({ message: 'Pick a parent bone or prop · Esc cancels' });
  }
  setAttachment(target: AttachmentTarget, position = true, rotation = true) {
    const s = this.store.state,
      id = s.selected;
    if (!s.project || !this.rig || !this.bodyRig || !this.store.canEditLayer(id)) return;
    try {
      const next = clone(s.project);
      for (const [key, value] of Object.entries(s.drafts))
        putKey(next.tracks[key as ControlId], keyingFrame(next, s.frame), value!);
      this.apply(s.frame, next);
      const body = next.editing === 'body',
        rig = body ? this.bodyRig : this.rig,
        solver = body ? this.attachmentBody : this.attachmentFirst,
        values = evaluate(next, s.frame, s.drafts),
        event = solver.capture(rig, values, id, target, s.frame, position, rotation);
      const track = next.tracks[id];
      track.following = (track.following ?? [])
        .filter((k) => k.frame !== s.frame)
        .concat(event)
        .sort((a, b) => a.frame - b.frame);
      for (const f of new Set([
        s.frame,
        ...(next.layers ?? [{ tracks: next.tracks }]).flatMap((l) =>
          Object.values(l.tracks).flatMap((t) => (t.following ?? []).map((k) => k.frame)),
        ),
      ]))
        this.apply(f, next);
      this.apply(s.frame, next);
      this.store.commit(next, 'Attachment keyed at frame ' + s.frame);
      this.store.patch({ drafts: {} });
    } catch (e) {
      this.store.patch({ message: (e as Error).message });
      this.apply(s.frame);
    }
  }
  switchLimb(limb: LimbId, mode: LimbMode) {
    const s = this.store.state;
    if (!s.project || !this.rig || !this.bodyRig) return;
    this.apply(s.frame);
    const rig = s.project.editing === 'firstPerson' ? this.rig : this.bodyRig,
      worldToRig =
        s.project.editing === 'firstPerson' ? this.cameraDelta.clone().invert() : new T.Matrix4();
    this.store.commit(
      matchLimb(s.project, s.frame, limb, mode, rig, worldToRig, s.drafts),
      'Matched ' +
        limb.replace('_l', ' left').replace('_r', ' right') +
        ' to ' +
        mode.toUpperCase() +
        ' at frame ' +
        s.frame,
    );
    this.store.patch({ drafts: {} });
    if (CONTROLS[s.selected].limb === limb && CONTROLS[s.selected].only !== mode)
      this.store.selectControl(
        ((limb.startsWith('arm')
          ? mode === 'fk'
            ? 'wrist_'
            : 'hand_'
          : mode === 'fk'
            ? 'ankle_'
            : 'foot_') + limb.at(-1)) as ControlId,
      );
  }
  pasteMirroredPose() {
    const s = this.store.state,
      p = s.project,
      stamp = s.clipboard;
    if (!p || !stamp || !this.rig || !this.bodyRig || !this.store.canEditLayer()) return;
    if (stamp.layer !== p.editing) {
      this.store.patch({ message: 'Switch to the copied pose’s view type to paste mirrored.' });
      return;
    }
    this.apply(s.frame);
    const rig = p.editing === 'firstPerson' ? this.rig : this.bodyRig,
      poses: Partial<Record<ControlId, Pose>> = {},
      root = matrix(stamp.mirrorRoot ?? evaluate(p, s.frame, s.drafts).root);
    const rest = (id: ControlId) => {
      const name = CONTROLS[id].bone,
        r = name && rig.rest.get(name);
      return r
        ? {
            world: r.world,
            parent: r.world.clone().multiply(new T.Matrix4().compose(r.p, r.q, r.s).invert()),
          }
        : { world: new T.Matrix4(), parent: new T.Matrix4() };
    };
    for (const [key, value] of Object.entries(stamp.poses)) {
      const id = key as ControlId,
        target = mirrorDestination(id);
      if (!value || !target || !controlEnabled(p, target, s.frame)) continue;
      const a = rest(id),
        b = rest(target);
      poses[target] = mirrorControlPose(
        value,
        a.world,
        b.world,
        isBoneControl(id) || CONTROLS[id].kind === 'pivot',
        a.parent,
        b.parent,
        root,
      );
    }
    if (!Object.keys(poses).length) {
      this.store.patch({ message: 'The copied pose has no matching controls to mirror.' });
      return;
    }
    const modes = stamp.modes
      ? Object.fromEntries(
          Object.entries(stamp.modes).map(([id, mode]) => [
            id.slice(0, -1) + (id.endsWith('l') ? 'r' : 'l'),
            mode,
          ]),
        )
      : undefined;
    this.store.pastePose({ ...stamp, scope: 'rig', poses, modes }, true);
    this.store.patch({ message: 'Pasted mirrored pose' + (s.autoKey ? '' : ' · unkeyed preview') });
  }
  mirrorSelectedPose() {
    const s = this.store.state,
      p = s.project;
    if (!p || !this.rig || !this.bodyRig || !this.store.canEditLayer()) return;
    this.apply(s.frame);
    const rig = p.editing === 'firstPerson' ? this.rig : this.bodyRig,
      values = evaluate(p, s.frame, s.drafts);
    const rest = (id: ControlId) => {
      const bone = CONTROLS[id].bone,
        r = bone && rig.rest.get(bone);
      return r
        ? {
            world: r.world,
            parent: r.world.clone().multiply(new T.Matrix4().compose(r.p, r.q, r.s).invert()),
          }
        : { world: new T.Matrix4(), parent: new T.Matrix4() };
    };
    const poses = mirrorControlPoses(
      values,
      this.store.selectedControls().filter((id) => {
        const target = mirrorDestination(id);
        return !!target && controlEnabled(p, target, s.frame);
      }),
      rest,
      matrix(values.root),
    );
    if (!Object.keys(poses).length) {
      this.store.patch({ message: 'Select matching IK or FK controls on both sides to mirror.' });
      return;
    }
    this.store.pastePose(
      { id: 'mirror', name: 'Mirrored pose', layer: p.editing, scope: 'rig', poses },
      true,
    );
    this.store.patch({
      message:
        'Mirrored ' +
        Object.keys(poses).length +
        ' control(s) to the opposite side' +
        (s.autoKey ? '' : ' · unkeyed preview'),
    });
  }
  toggleGameView() {
    if (this.modal) this.finishTransform(true);
    this.clearBox();
    this.tooltip.hidden = true;
    this.hovered = null;
    this.store.patch({ gameView: !this.store.state.gameView });
  }
  frameScene() {
    const first = this.store.state.project?.editing === 'firstPerson',
      ids = first
        ? ['hand_l', 'hand_r', 'upperarm_l', 'upperarm_r', 'elbow_l', 'elbow_r', 'rifle']
        : ['hips', 'head', 'hand_l', 'hand_r', 'foot_l', 'foot_r'];
    const box = new T.Box3();
    for (const id of ids) {
      const marker = this.markers.get(id as ControlId);
      if (marker) box.expandByPoint(marker.position);
    }
    if (box.isEmpty()) {
      this.resetView();
      return;
    }
    const center = box.getCenter(new T.Vector3()),
      radius = Math.max(0.25, box.getSize(new T.Vector3()).length() * 0.5),
      fov =
        2 *
        Math.atan(
          Math.tan(T.MathUtils.degToRad(this.camera.fov) / 2) * Math.min(1, this.camera.aspect),
        ),
      distance = T.MathUtils.clamp(
        (radius / Math.sin(fov / 2)) * 1.12,
        0.5,
        this.orbit.maxDistance,
      ),
      direction = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.orbit.update();
    this.drawDirty = true;
  }
  frameSelected() {
    const ids = this.store.selectedControls();
    if (!ids.length) return;
    const box = new T.Box3();
    for (const id of ids) box.expandByPoint(this.markers.get(id)!.position);
    const p = box.getCenter(new T.Vector3()),
      distance = Math.max(0.45, box.getSize(new T.Vector3()).length() * 1.5);
    this.orbit.target.copy(p);
    this.camera.position
      .copy(p)
      .add(new T.Vector3(0.6, 0.3, 0.8).normalize().multiplyScalar(distance));
    this.orbit.update();
  }
  resetView() {
    if (this.store.state.retargetMode) {
      this.orbit.target.set(0, 0.9, 0);
      this.camera.position.copy(this.orbit.target).add(new T.Vector3(2, 1, 4));
      this.orbit.update();
      return;
    }
    if (this.store.state.project?.editing === 'firstPerson') {
      this.orbit.target.set(-0.08, 1.5, 0.52);
      this.camera.position.set(0.8, 1.78, 2.02);
    } else {
      const p = this.store.state.project,
        root = p ? new T.Vector3(...evaluate(p, this.store.state.frame).root.p) : new T.Vector3();
      this.orbit.target.copy(root).add(new T.Vector3(0, 0.92, 0.16));
      this.camera.position.copy(root).add(new T.Vector3(2.2, 1.7, 3.1));
    }
    this.orbit.update();
  }
  gripThumbnails() {
    if (!this.rig || !this.store.state.project) return [];
    const project = this.store.state.project,
      frame = this.store.state.frame,
      visible = [this.rifle.visible, this.magazine.visible, this.gizmoHelper.visible];
    this.rifle.visible = false;
    this.magazine.visible = false;
    this.worldRifle.visible = false;
    this.worldMagazine.visible = false;
    if (this.bodyRoot) this.bodyRoot.visible = false;
    this.fpGroup.visible = true;
    this.fpGroup.matrix.identity();
    this.fpGroup.updateMatrixWorld(true);
    this.gizmoHelper.visible = false;
    for (const m of this.markers.values()) m.visible = false;
    const target = new T.WebGLRenderTarget(200, 140),
      cam = new T.PerspectiveCamera(28, 200 / 140, 0.01, 10),
      result: string[] = [];
    const values = evaluate(forLayer(project, 'firstPerson'), 0),
      grips = [
        [0.05, 0.05, 0.08, 0.09, 0.1],
        [0.45, 0.5, 0.72, 0.76, 0.76],
        [0.65, 0.65, 0.18, 0.18, 0.18],
      ];
    for (const grip of grips) {
      values.hand_r.grip = grip;
      this.rig.apply(values);
      const p = this.rig.position('hand_r');
      cam.position.copy(p).add(new T.Vector3(-0.25, 0.09, 0.25));
      cam.lookAt(p.clone().add(new T.Vector3(0, -0.04, 0)));
      this.renderer.setRenderTarget(target);
      this.renderer.setScissorTest(false);
      this.renderer.render(this.scene, cam);
      const pixels = new Uint8Array(200 * 140 * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, 200, 140, pixels);
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 140;
      const ctx = canvas.getContext('2d')!,
        data = ctx.createImageData(200, 140);
      for (let y = 0; y < 140; y++)
        data.data.set(pixels.subarray((139 - y) * 800, (140 - y) * 800), y * 800);
      ctx.putImageData(data, 0, 0);
      result.push(canvas.toDataURL('image/png'));
    }
    this.renderer.setRenderTarget(null);
    target.dispose();
    this.rifle.visible = visible[0];
    this.magazine.visible = visible[1];
    this.gizmoHelper.visible = visible[2];
    this.apply(frame);
    return result;
  }
  diagnostics() {
    return {
      bones: this.rig?.bones.size,
      handL: this.rig?.position('hand_l').toArray(),
      handR: this.rig?.position('hand_r').toArray(),
      targetL: this.store.state.project
        ? evaluate(this.store.state.project, this.store.state.frame).hand_l.p
        : null,
    };
  }
}

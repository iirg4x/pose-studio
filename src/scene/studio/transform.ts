import { coordinatePose, coordinateWorld } from '../coordinates';
import type { CoordinateSpace, CoordinateSnapshot } from '../coordinates';
import { controllerConstraints } from '../../core/controllerConstraints';
import { cameraControl } from '../animationCamera';
import { copyPoseTracks } from '../../core/poseEdits';
import { authorLayerPosition } from '../../core/layers';
import { pivotPoint, transformedControl, orientationQuaternion } from '../transformOptions';
import type { TransformPivot } from '../transformOptions';
import { transformAxis } from '../selection';
import * as T from 'three';
import { evaluate, fromMatrix, clone, controlParent } from '../../core/model';
import type { ControlId, Pose, Project, Q4, V3 } from '../../core/model';
import { CONTROLS, isBoneControl, isRotationControl } from '../../core/controls';
import { boneFollowing } from '../../core/boneFollowing';
import { RetargetScene } from './retarget';

/** Gizmo transforms and typed coordinate edits. */
export abstract class TransformScene extends RetargetScene {
  protected gizmoDrag: null | {
    project: Project;
    drafts: Partial<Record<ControlId, Pose>>;
    worlds: Map<ControlId, T.Matrix4>;
    proxy: T.Matrix4;
    mode: 'translate' | 'rotate';
    pivot: TransformPivot;
    localOrientation?: T.Quaternion;
  } = null;
  protected contactRotationActive(mode = this.store.state.mode) {
    const s = this.store.state;
    return (
      mode === 'rotate' &&
      s.footPivot !== 'ankle' &&
      s.selection.length === 1 &&
      /^foot_[lr]$/.test(s.selected)
    );
  }
  protected transformPivotMode(mode = this.store.state.mode) {
    return this.contactRotationActive(mode) ? ('median' as const) : this.store.state.transformPivot;
  }
  protected rotationPivot(worlds: Map<ControlId, T.Matrix4>, mode = this.store.state.mode) {
    const s = this.store.state;
    if (this.contactRotationActive(mode)) {
      const first = s.project?.editing === 'firstPerson',
        rig =
          (first ? this.previewCharacter?.first : this.previewCharacter?.body) ??
          (first ? this.rig : this.bodyRig);
      if (rig)
        return rig.footContactPoint(
          s.selected.at(-1)!,
          s.footPivot as 'sole' | 'heel' | 'ball' | 'toe',
        );
    }
    return pivotPoint(
      [...worlds.values()].map((m) => new T.Vector3().setFromMatrixPosition(m)),
      this.markers.get(s.selected)!.position,
      s.transformPivot,
      new T.Vector3(...s.cursorPosition),
    );
  }
  protected selectedWorlds(mode: 'translate' | 'rotate') {
    let ids = this.store.selectedControls();
    if (ids.includes('root')) ids = ['root'];
    if (mode === 'translate') ids = ids.filter((id) => !isRotationControl(id));
    return new Map(
      ids.map((id) => {
        const m = this.markers.get(id)!;
        return [id, new T.Matrix4().compose(m.position, m.quaternion, new T.Vector3(1, 1, 1))];
      }),
    );
  }
  protected coordinateSnapshot: CoordinateSnapshot | null = null;
  protected coordinateListeners = new Set<() => void>();
  subscribeCoordinates = (listener: () => void) => {
    this.coordinateListeners.add(listener);
    this.forcePose = true;
    this.drawDirty = true;
    return () => {
      this.coordinateListeners.delete(listener);
    };
  };
  getCoordinates = () => this.coordinateSnapshot;
  protected coordinateState(): CoordinateSnapshot | null {
    const { project, selected: id, frame } = this.store.state;
    if (!project || !this.rig || !this.bodyRig) return null;
    const first = project.editing === 'firstPerson',
      rig =
        (first ? this.previewCharacter?.first : this.previewCharacter?.body) ??
        (first ? this.rig : this.bodyRig),
      worldFor = (id: ControlId) =>
        (this.previewControlWorlds.get(id) ?? this.sourceControlWorlds.get(id))?.clone() ??
        new T.Matrix4(),
      world = worldFor(id),
      key = boneFollowing(project, frame)[id];
    const native = () =>
      CONTROLS[id].kind === 'bone' || id === 'root'
        ? rig.bodyBone(id).parent!.matrixWorld.clone()
        : id === 'camera'
          ? this.previewBodyRoot.clone()
          : worldFor('root');
    const parent =
      key?.target === 'world'
        ? new T.Matrix4()
        : key?.target === 'native'
          ? native()
          : key?.target
            ? worldFor(key.target)
            : isBoneControl(id) || id === 'root'
              ? native()
              : (() => {
                  const target = controlParent(project, id, frame);
                  return target === 'world' ? new T.Matrix4() : worldFor(target);
                })();
    return { id, world, parent, root: id === 'root' ? new T.Matrix4() : worldFor('root') };
  }
  protected publishCoordinates() {
    if (!this.coordinateListeners.size) return;
    const next = this.coordinateState(),
      old = this.coordinateSnapshot;
    if (
      !next ||
      (old?.id === next.id &&
        (['world', 'parent', 'root'] as const).every((k) =>
          old[k].elements.every((v, i) => Math.abs(v - next[k].elements[i]) < 1e-8),
        ))
    )
      return;
    this.coordinateSnapshot = next;
    for (const listener of this.coordinateListeners) listener();
  }
  editCoordinate(
    space: Exclude<CoordinateSpace, 'local'>,
    axis: number,
    value: number,
    rotation: boolean,
  ) {
    const s = this.store.state;
    if (
      !s.project ||
      !Number.isFinite(value) ||
      axis < 0 ||
      axis > 2 ||
      !this.store.canEditLayer(s.selected)
    )
      return;
    this.apply(this.store.poseEditFrame());
    const snapshot = this.coordinateState();
    if (!snapshot) return;
    const pose = coordinatePose(snapshot, space, this.store.currentPose()!);
    if (rotation) {
      const e = new T.Euler().setFromQuaternion(new T.Quaternion(...pose.q), 'XYZ'),
        angles = [e.x, e.y, e.z];
      angles[axis] = T.MathUtils.degToRad(value);
      pose.q = new T.Quaternion()
        .setFromEuler(new T.Euler(...(angles as V3), 'XYZ'))
        .toArray() as Q4;
    } else pose.p[axis] = value / 100;
    this.applyTransformTargets(
      s.project,
      s.drafts,
      new Map([[s.selected, coordinateWorld(snapshot, space, pose)]]),
      true,
    );
    this.apply(this.store.poseEditFrame());
  }
  protected transformInputCache?: {
    project: Project;
    drafts: Partial<Record<ControlId, Pose>>;
    id: ControlId;
    frame: number;
    ownsPosition: boolean;
    bonePosition: boolean;
    commit: () => void;
  };
  protected applyTransformTargets(
    project: Project,
    drafts: Partial<Record<ControlId, Pose>>,
    targets: Map<ControlId, T.Matrix4>,
    bonePosition = false,
    floorContact = false,
  ) {
    if (floorContact && this.contactRotationActive()) {
      const id = this.store.state.selected,
        first = project.editing === 'firstPerson',
        rig =
          (first ? this.previewCharacter?.first : this.previewCharacter?.body) ??
          (first ? this.rig : this.bodyRig),
        control = this.previewControlWorlds.get(id) ?? this.sourceControlWorlds.get(id),
        target = targets.get(id);
      if (rig && control && target) {
        const bone = rig.bodyBone(id).matrixWorld,
          desired = target.clone().multiply(control.clone().invert()).multiply(bone),
          safe = rig.floorRotation(id, desired, controllerConstraints(project)[id]?.clearance ?? 0);
        targets.set(id, safe.multiply(bone.clone().invert()).multiply(control));
      }
    }
    if (
      !this.store.poseGestureChanged() &&
      [...targets].every(([id, target]) => {
        const start = this.gizmoDrag?.worlds.get(id) ?? this.modal?.worlds.get(id);
        return start && start.elements.every((v, i) => Math.abs(v - target.elements[i]) < 1e-8);
      })
    )
      return;
    this.store.batch(() => {
      const authored = copyPoseTracks(project, targets.keys());
      let ownsPosition = false;
      for (const [id, target] of targets) {
        const marker = this.markers.get(id),
          start = this.gizmoDrag?.worlds.get(id) ?? this.modal?.worlds.get(id),
          position = start ? new T.Vector3().setFromMatrixPosition(start) : marker?.position;
        if (position && position.distanceTo(new T.Vector3().setFromMatrixPosition(target)) > 1e-8)
          ownsPosition = !!authorLayerPosition(authored, id) || ownsPosition;
      }
      this.store.patch({ project: authored, drafts: clone(drafts) });
      const selected = this.store.state.selected,
        wasDragging = this.dragging;
      const depth = (id: ControlId, seen = new Set<ControlId>()): number => {
        if (seen.has(id)) return 0;
        seen.add(id);
        const parent = controlParent(project, id, this.store.state.frame);
        let n = parent !== 'world' ? 1 + depth(parent, seen) : 0;
        if (isBoneControl(id)) {
          let bone = (project.editing === 'body' ? this.bodyRig! : this.rig!).bodyBone(id).parent;
          while (bone) {
            n++;
            bone = bone.parent;
          }
        }
        return n;
      };
      this.dragging = true;
      for (const id of [...targets.keys()].sort((a, b) => depth(a) - depth(b))) {
        const frame = this.store.poseEditFrame(),
          cached = targets.size === 1 ? this.transformInputCache : undefined;
        this.store.patch({ selected: id, selection: this.store.state.selection });
        let commit =
          cached &&
          cached.project === project &&
          cached.drafts === drafts &&
          cached.id === id &&
          cached.frame === frame &&
          cached.ownsPosition === ownsPosition &&
          cached.bonePosition === bonePosition
            ? cached.commit
            : undefined;
        if (!commit) {
          this.apply(frame);
          commit = this.captureControlProxy(bonePosition);
          if (targets.size === 1 && commit)
            this.transformInputCache = {
              project,
              drafts,
              id,
              frame,
              ownsPosition,
              bonePosition,
              commit,
            };
        }
        targets.get(id)!.decompose(this.proxy.position, this.proxy.quaternion, this.proxy.scale);
        commit?.();
      }
      this.dragging = wasDragging;
      if (!this.store.state.autoKey) this.store.patch({ project });
      this.store.patch({ selected, selection: this.store.state.selection });
    });
  }
  protected updateGizmoDrag() {
    const d = this.gizmoDrag;
    if (!d || !this.dragging) return;
    const current = new T.Matrix4().compose(
        this.proxy.position,
        this.proxy.quaternion,
        new T.Vector3(1, 1, 1),
      ),
      delta = current.clone().multiply(d.proxy.clone().invert());
    this.applyTransformTargets(
      d.project,
      d.drafts,
      new Map(
        [...d.worlds].map(([id, m]) => [
          id,
          transformedControl(m, delta, d.mode, d.pivot, d.localOrientation),
        ]),
      ),
      false,
      d.mode === 'rotate',
    );
    current.decompose(this.proxy.position, this.proxy.quaternion, this.proxy.scale);
  }
  protected captureControlProxy(bonePosition = false) {
    if (!this.rig || !this.store.state.project) return;
    const state = { ...this.store.state, frame: this.store.poseEditFrame() },
      id = state.selected,
      world = this.store.currentPose()!,
      first = state.project!.editing === 'firstPerson';
    const source = this.sourceControlWorlds.get(id),
      display = this.previewControlWorlds.get(id),
      preview = first ? this.previewCharacter?.first : this.previewCharacter?.body;
    const sp = new T.Vector3(),
      sq = new T.Quaternion(),
      dp = new T.Vector3(),
      dq = new T.Quaternion(),
      adapt = !!(source && display && preview),
      ratio = preview?.ratioFor(id) ?? 1;
    if (adapt) {
      source!.decompose(sp, sq, new T.Vector3());
      display!.decompose(dp, dq, new T.Vector3());
      dq.invert();
    }
    const rig = first ? this.rig : this.bodyRig!,
      bone = isBoneControl(id),
      pivot = CONTROLS[id].kind === 'pivot',
      attached = (first ? this.attachmentFirst : this.attachmentBody).captureInput(id),
      input = bone ? rig.captureWorldInput(id) : undefined;
    const positionBase = bone ? rig.offsetPositionBase(id) : new T.Vector3(),
      rotationBase = bone ? rig.offsetBase(id).invert() : new T.Quaternion(),
      pivotRotation = pivot
        ? new T.Quaternion().setFromRotationMatrix(source ?? rig.pivotWorld(id)).invert()
        : new T.Quaternion();
    const sceneInverse = first
        ? id === 'camera'
          ? this.previewBodyRoot.clone().invert()
          : this.cameraDelta.clone().invert()
        : new T.Matrix4(),
      rootInverse = rig.rest.get('root')!.world.clone().invert();
    const lensInput =
      first && id === 'camera'
        ? cameraControl(state.project!, rig, new T.Matrix4(), world)
        : undefined;
    return () => {
      const p = this.proxy.position.clone(),
        q = this.proxy.quaternion.clone();
      if (adapt) {
        p.sub(dp).divideScalar(ratio).add(sp);
        q.multiply(dq).multiply(sq);
      }
      const desired = new T.Matrix4().compose(p, q, new T.Vector3(1, 1, 1));
      if (bone) {
        const local = attached?.(desired) ?? input!(desired);
        local.decompose(p, q, new T.Vector3());
        this.store.editRaw(id, {
          ...world,
          p:
            isRotationControl(id) && !bonePosition
              ? world.p
              : (p.sub(positionBase).toArray() as V3),
          q: rotationBase.clone().multiply(q).normalize().toArray() as Q4,
        });
      } else if (pivot)
        this.store.editRaw(id, {
          ...world,
          q: new T.Quaternion(...world.q)
            .multiply(pivotRotation.clone().multiply(q))
            .toArray() as Q4,
        });
      else {
        desired.premultiply(sceneInverse);
        if (id === 'root') desired.multiply(rootInverse);
        if (lensInput) desired.multiply(lensInput);
        this.store.editWorld(id, fromMatrix(attached?.(desired) ?? desired, world));
      }
    };
  }
  beginTransform(mode: 'translate' | 'rotate') {
    if (this.store.state.gameView) return;
    const s = this.store.state;
    if (!s.project || !this.rig || !this.bodyRig || this.modal) return;
    let ids = this.store.selectedControls();
    if (ids.includes('root')) ids = ['root'];
    if (mode === 'translate') ids = ids.filter((id) => !isRotationControl(id));
    if (!ids.length) {
      this.store.patch({
        message:
          mode === 'translate'
            ? 'Select a movable control. Joint controls use R to rotate.'
            : 'Select a control first.',
      });
      return;
    }
    this.apply(s.frame);
    const values = evaluate(s.project, s.frame, s.drafts),
      poses: Partial<Record<ControlId, Pose>> = {},
      worlds = new Map<ControlId, T.Matrix4>(),
      pivot = new T.Vector3();
    for (const id of ids) {
      poses[id] = clone(values[id]);
      const m = this.markers.get(id)!;
      const world = new T.Matrix4().compose(m.position, m.quaternion, new T.Vector3(1, 1, 1));
      worlds.set(id, world);
      pivot.add(m.position);
    }
    pivot.copy(this.rotationPivot(worlds, mode));
    this.modal = {
      space: s.transformSpace,
      pivotMode: this.transformPivotMode(mode),
      orientation: orientationQuaternion(
        s.transformSpace,
        this.markers.get(s.selected)!.quaternion,
        this.viewCamera().quaternion,
      ),
      mode,
      axis: null,
      numeric: '',
      start: { ...this.pointer },
      project: clone(s.project),
      drafts: clone(s.drafts),
      poses,
      worlds,
      pivot,
    };
    this.store.beginGesture();
    this.store.patch({ mode });
    this.orbit.enabled = false;
    this.gizmo.detach();
    this.tooltip.hidden = true;
  }
  handleTransformKey(e: KeyboardEvent) {
    if (this.pickingAttachment && e.key === 'Escape') {
      this.pickingAttachment = false;
      this.renderer.domElement.style.cursor = '';
      this.store.patch({ message: 'Attachment picking cancelled' });
      return true;
    }
    if ((this.boxArmed || this.boxStart) && e.key === 'Escape') {
      e.preventDefault();
      this.clearBox();
      return true;
    }
    const m = this.modal;
    if (!m) return false;
    const key = e.key.toLowerCase();
    e.preventDefault();
    if (key === 'escape') {
      this.finishTransform(true);
      return true;
    }
    if (key === 'enter') {
      this.finishTransform(false);
      return true;
    }
    if (['x', 'y', 'z'].includes(key)) m.axis = m.axis === key ? null : (key as 'x' | 'y' | 'z');
    else if (key === 'g' || key === 'r') {
      m.mode = key === 'g' ? 'translate' : 'rotate';
      m.numeric = '';
    } else if (/^[0-9.\-]$/.test(key)) {
      if (key === '-' && m.numeric.includes('-')) m.numeric = m.numeric.replace('-', '');
      else if (key === '-') m.numeric = '-' + m.numeric;
      else if (key !== '.' || !m.numeric.includes('.')) m.numeric += key;
    } else if (key === 'backspace') m.numeric = m.numeric.slice(0, -1);
    this.updateTransform();
    return true;
  }
  protected updateTransform() {
    const m = this.modal;
    if (!m) return;
    const dx = this.pointer.x - m.start.x,
      dy = this.pointer.y - m.start.y,
      numeric = m.numeric !== '' && Number.isFinite(Number(m.numeric)),
      right = new T.Vector3(1, 0, 0).applyQuaternion(this.viewCamera().quaternion),
      up = new T.Vector3(0, 1, 0).applyQuaternion(this.viewCamera().quaternion);
    // Displayed axes use Unreal convention: X forward, Y right, Z up.
    const axis = m.axis ? transformAxis(m.axis, m.orientation) : null;
    const delta = new T.Matrix4();
    let amount = 0;
    if (m.mode === 'translate') {
      const scale =
        (2 *
          Math.tan(T.MathUtils.degToRad(this.viewCamera().fov) / 2) *
          this.viewCamera().position.distanceTo(m.pivot)) /
        this.viewRect().h;
      let v = right.multiplyScalar(dx * scale).add(up.multiplyScalar(-dy * scale));
      if (axis) {
        amount = numeric ? Number(m.numeric) / 100 : v.dot(axis);
        v = axis.clone().multiplyScalar(amount);
      } else if (numeric) {
        v =
          v.lengthSq() > 1e-10
            ? v.normalize()
            : new T.Vector3(1, 0, 0).applyQuaternion(this.viewCamera().quaternion);
        v.multiplyScalar(Number(m.numeric) / 100);
      }
      delta.makeTranslation(...v.toArray());
      amount = v.length() * 100;
    } else {
      amount = numeric ? Number(m.numeric) : (dx - dy) * 0.4;
      const q = new T.Quaternion().setFromAxisAngle(
        axis ?? new T.Vector3(0, 0, 1).applyQuaternion(this.viewCamera().quaternion),
        T.MathUtils.degToRad(amount),
      );
      delta
        .makeTranslation(...m.pivot.toArray())
        .multiply(new T.Matrix4().makeRotationFromQuaternion(q))
        .multiply(new T.Matrix4().makeTranslation(...m.pivot.clone().negate().toArray()));
    }
    this.applyTransformTargets(
      m.project,
      m.drafts,
      new Map(
        [...m.worlds]
          .filter(([id]) => m.mode !== 'translate' || !isRotationControl(id))
          .map(([id, world]) => [
            id,
            transformedControl(
              world,
              delta,
              m.mode,
              m.pivotMode,
              m.space === 'local' ? m.orientation : undefined,
            ),
          ]),
      ),
      false,
      m.mode === 'rotate',
    );
    this.store.patch({
      message:
        (m.mode === 'translate' ? 'Move' : 'Rotate') +
        (m.axis ? ' ' + m.axis.toUpperCase() : '') +
        ' · ' +
        m.space +
        ' · ' +
        (m.numeric || amount.toFixed(1)) +
        (m.mode === 'translate' ? ' cm' : '°') +
        ' · MMB or X/Y/Z axis · Enter confirm · Esc cancel',
    });
  }
  protected finishTransform(cancel = false) {
    const m = this.modal;
    if (!m) return;
    this.modal = null;
    this.middleAxis = false;
    if (cancel) {
      this.store.cancelGesture();
      this.store.patch({ drafts: m.drafts, message: 'Transform cancelled' });
    } else {
      this.store.endGesture();
      this.store.patch({ message: 'Transform confirmed' });
    }
    this.orbit.enabled = true;
    this.apply(this.store.state.frame);
  }
}

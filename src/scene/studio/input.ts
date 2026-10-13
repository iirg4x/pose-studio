import { TouchGestures } from '../touchGestures';
import type { TouchPoint } from '../touchGestures';
import { boneControl } from '../attachments';
import { transformedControl } from '../transformOptions';
import { boxControls, mouseAxis } from '../selection';
import * as T from 'three';
import { skinSets } from '../skinInfluences';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { controlEnabled, controlLabel, clone } from '../../core/model';
import type { ControlId, Pose, Project, V3 } from '../../core/model';
import { isRotationControl } from '../../core/controls';
import { pickControl } from '../controlVisual';
import { CommandScene } from './commands';

/** Mouse, keyboard, touch and box selection input. */
export abstract class InputScene extends CommandScene {
  protected suppressPointerUp = false;
  protected selectionKeys = (e: KeyboardEvent) => {
    if (e.key !== 'Shift') return;
    const pressed =
      e.type === 'keydown' &&
      !(
        e.target instanceof HTMLElement &&
        e.target.closest('input,textarea,select,[contenteditable="true"]')
      );
    if (pressed !== this.selectionModifier) {
      this.selectionModifier = pressed;
      this.drawDirty = true;
    }
  };
  protected clearSelectionModifier = () => {
    if (this.selectionModifier) {
      this.selectionModifier = false;
      this.drawDirty = true;
    }
  };
  protected clickStart = [0, 0];
  protected pendingTouch?: TouchPoint;
  protected touchCandidate?: {
    kind: 'gizmo' | 'direct';
    id: ControlId;
    toggle?: boolean;
    axis?: NonNullable<TransformControls['axis']>;
  };
  protected touchPose?: {
    kind: 'gizmo' | 'direct';
    start: TouchPoint;
    project: Project;
    drafts: Partial<Record<ControlId, Pose>>;
    right: T.Vector3;
    up: T.Vector3;
    units: number;
  };
  protected touch = new TouchGestures({
    beginPose: (p) => this.beginTouchPose(p),
    startPose: (p) => this.startTouchPose(p),
    movePose: (p) => this.moveTouchPose(p),
    finishPose: (cancel) => this.finishTouchPose(cancel),
    tap: (p) => this.tapTouch(p),
    orbit: (x, y) => this.orbitTouch(x, y),
    panZoom: (x, y, scale) => this.panTouch(x, y, scale),
  });
  beginBoxSelection() {
    if (this.modal || this.store.state.gameView || this.store.state.retargetMode) return;
    if (this.boxArmed) {
      this.clearBox();
      return;
    }
    this.touch.cancel();
    this.boxArmed = true;
    this.renderer.domElement.focus();
    this.renderer.domElement.style.cursor = 'crosshair';
    this.store.patch({
      boxSelection: 'replace',
      message: 'Box select · drag around controls · Esc cancels',
    });
  }
  protected drawBox(p: { x: number; y: number }) {
    const b = this.boxStart;
    if (!b) return;
    this.marquee.hidden = false;
    Object.assign(this.marquee.style, {
      left: Math.min(b.x, p.x) + 'px',
      top: Math.min(b.y, p.y) + 'px',
      width: Math.abs(b.x - p.x) + 'px',
      height: Math.abs(b.y - p.y) + 'px',
    });
  }
  protected finishBox(x: number, y: number) {
    const b = this.boxStart,
      state = this.store.state,
      v = this.preview,
      view = this.viewRect();
    if (!b) return false;
    if (Math.hypot(x - b.x, y - b.y) <= 4) {
      this.clearBox();
      return false;
    }
    const hits = boxControls(
      this.markers.values(),
      this.viewCamera(),
      view.w,
      view.h,
      {
        left: Math.min(x, b.x) - view.x,
        right: Math.max(x, b.x) - view.x,
        top: Math.min(y, b.y) - view.y,
        bottom: Math.max(y, b.y) - view.y,
      },
      (id) =>
        !!state.project &&
        this.store.controlVisible(id) &&
        controlEnabled(state.project, id, state.frame),
      state.cameraPreview && !state.playerView
        ? { left: v.x, right: v.x + v.w, top: v.y, bottom: v.y + v.h }
        : undefined,
    );
    const selection =
      b.mode === 'replace'
        ? hits
        : b.mode === 'add'
          ? [...new Set([...state.selection, ...hits])]
          : state.selection.filter((id) => !hits.includes(id));
    this.store.patch({
      selection,
      selected: selection.at(-1) ?? state.selected,
      message: selection.length + ' controls selected',
    });
    this.clearBox();
    return true;
  }
  protected touchPoint(e: PointerEvent): TouchPoint {
    const r = this.renderer.domElement.getBoundingClientRect();
    return {
      id: e.pointerId,
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      kind: e.pointerType === 'pen' ? 'pen' : 'touch',
    };
  }
  protected touchPointer(p: TouchPoint, button = 0) {
    return {
      x: (p.x / this.width) * 2 - 1,
      y: 1 - (p.y / this.height) * 2,
      button,
    } as PointerEvent;
  }
  protected beginTouchPose(p: TouchPoint) {
    this.touchCandidate = undefined;
    const state = this.store.state;
    if (
      !state.project ||
      !state.ready ||
      state.gameView ||
      state.retargetMode ||
      this.pickingAttachment
    )
      return false;
    this.apply(state.frame);
    this.overlays.updateMatrixWorld(true);
    this.gizmo.axis = null;
    this.gizmo.pointerHover(this.touchPointer(p));
    const hit = this.hitControls(p.x, p.y)[0],
      directHandle = hit && hit.id !== state.selected && hit.distance <= 7;
    if (this.gizmo.axis && this.gizmo.object && !directHandle) {
      this.touchCandidate = { kind: 'gizmo', id: state.selected, axis: this.gizmo.axis };
      return true;
    }
    if (!hit) return false;
    this.gizmo.axis = null;
    if (!state.multiSelect && !state.selection.includes(hit.id)) this.store.selectControl(hit.id);
    this.touchCandidate = { kind: 'direct', id: hit.id, toggle: state.multiSelect };
    return true;
  }
  protected startTouchPose(p: TouchPoint) {
    const candidate = this.touchCandidate;
    if (candidate?.toggle) {
      candidate.toggle = false;
      if (!this.store.state.selection.includes(candidate.id))
        this.store.selectControl(candidate.id, true);
    }
    const state = this.store.state;
    if (
      !candidate ||
      !state.project ||
      !state.selection.includes(candidate.id) ||
      !controlEnabled(state.project, candidate.id, state.frame) ||
      !this.store.canEditLayer(candidate.id)
    )
      return;
    // Capture the pose and edit frame only once a
    // deliberate drag starts. A held tap can keep following live playback.
    this.apply(state.frame);
    this.overlays.updateMatrixWorld(true);
    const project = state.project,
      drafts = clone(state.drafts);
    if (candidate.kind === 'gizmo') {
      this.gizmo.axis = candidate.axis!;
      this.gizmo.pointerDown(this.touchPointer(p));
      if (this.dragging)
        this.touchPose = {
          kind: 'gizmo',
          start: p,
          project,
          drafts,
          right: new T.Vector3(),
          up: new T.Vector3(),
          units: 0,
        };
      return;
    }
    const mode =
        isRotationControl(candidate.id) || state.mode === 'rotate' ? 'rotate' : 'translate',
      worlds = this.selectedWorlds(mode),
      pivot = this.proxy.position.clone(),
      view = this.viewCamera();
    this.gizmoDrag = {
      project,
      drafts,
      worlds,
      proxy: new T.Matrix4().compose(pivot, this.proxy.quaternion, new T.Vector3(1, 1, 1)),
      mode,
      pivot: this.transformPivotMode(mode),
      localOrientation:
        state.transformSpace === 'local'
          ? this.markers.get(candidate.id)!.quaternion.clone()
          : undefined,
    };
    this.touchPose = {
      kind: 'direct',
      start: p,
      project,
      drafts,
      right: new T.Vector3(1, 0, 0).applyQuaternion(view.quaternion),
      up: new T.Vector3(0, 1, 0).applyQuaternion(view.quaternion),
      units:
        (2 * pivot.distanceTo(view.position) * Math.tan(T.MathUtils.degToRad(view.fov) / 2)) /
        this.height,
    };
    this.dragging = true;
    this.orbit.enabled = false;
    this.store.beginGesture();
  }
  protected moveTouchPose(p: TouchPoint) {
    if (!this.touchPose) return;
    this.pendingTouch = p;
    this.drawDirty = true;
  }
  protected applyTouchPose(p: TouchPoint) {
    const touch = this.touchPose;
    if (!touch) return;
    if (touch.kind === 'gizmo') {
      this.gizmo.pointerMove(this.touchPointer(p, -1));
      this.drawDirty = true;
      return;
    }
    const d = this.gizmoDrag;
    if (!d) return;
    const dx = p.x - touch.start.x,
      dy = p.y - touch.start.y,
      delta = new T.Matrix4();
    if (d.mode === 'translate')
      delta.makeTranslation(
        ...(touch.right
          .clone()
          .multiplyScalar(dx * touch.units)
          .addScaledVector(touch.up, -dy * touch.units)
          .toArray() as V3),
      );
    else {
      const q = new T.Quaternion()
          .setFromAxisAngle(touch.up, dx * 0.008)
          .multiply(new T.Quaternion().setFromAxisAngle(touch.right, dy * 0.008)),
        pivot = new T.Vector3().setFromMatrixPosition(d.proxy);
      delta
        .makeTranslation(...(pivot.toArray() as V3))
        .multiply(new T.Matrix4().makeRotationFromQuaternion(q))
        .multiply(new T.Matrix4().makeTranslation(...(pivot.negate().toArray() as V3)));
    }
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
    this.drawDirty = true;
  }
  protected finishTouchPose(cancel: boolean) {
    const candidate = this.touchCandidate;
    this.touchCandidate = undefined;
    const touch = this.touchPose;
    if (!touch) {
      if (!cancel && candidate?.toggle) this.store.selectControl(candidate.id, true);
      this.pendingTouch = undefined;
      this.gizmo.axis = null;
      this.drawDirty = true;
      return;
    }
    if (!cancel && this.pendingTouch) this.applyTouchPose(this.pendingTouch);
    this.pendingTouch = undefined;
    if (cancel) {
      this.store.cancelGesture();
      this.store.patch({ drafts: touch.drafts });
    }
    if (touch.kind === 'gizmo') this.gizmo.pointerUp({ button: 0 } as PointerEvent);
    else this.store.endGesture();
    this.touchPose = undefined;
    this.gizmoDrag = null;
    this.dragging = false;
    this.orbit.enabled = true;
    this.gizmo.axis = null;
    this.forcePose = true;
    this.drawDirty = true;
  }
  protected tapTouch(p: TouchPoint) {
    if (this.pickingAttachment) {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.pointerUp({
        pointerType: 'mouse',
        button: 0,
        clientX: p.x + r.left,
        clientY: p.y + r.top,
      } as PointerEvent);
      return;
    }
    if (this.store.state.gameView || this.store.state.retargetMode) return;
    const preview = this.preview;
    if (
      this.store.state.cameraPreview &&
      !this.store.state.playerView &&
      p.x > preview.x &&
      p.x < preview.x + preview.w &&
      p.y > preview.y &&
      p.y < preview.y + preview.h
    )
      return;
    const ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2((p.x / this.width) * 2 - 1, 1 - (p.y / this.height) * 2),
      this.viewCamera(),
    );
    const hit = ray.intersectObjects(
      this.projectObjects.objects(this.store.state.project?.editing === 'firstPerson'),
      true,
    )[0];
    if (hit?.object.userData.control)
      this.store.selectControl(hit.object.userData.control, this.store.state.multiSelect);
    else this.store.deselectAll();
  }
  protected orbitTouch(dx: number, dy: number) {
    if (this.store.state.playerView) this.store.patch({ playerView: false });
    const offset = this.camera.position.clone().sub(this.orbit.target),
      spherical = new T.Spherical().setFromVector3(offset);
    spherical.theta -= (dx * 2 * Math.PI) / this.height;
    spherical.phi = T.MathUtils.clamp(
      spherical.phi - (dy * 2 * Math.PI) / this.height,
      0.03,
      this.orbit.maxPolarAngle,
    );
    this.camera.position.copy(this.orbit.target).add(offset.setFromSpherical(spherical));
    this.orbit.update();
    this.drawDirty = true;
  }
  protected panTouch(dx: number, dy: number, scale: number) {
    if (this.store.state.playerView) this.store.patch({ playerView: false });
    const offset = this.camera.position.clone().sub(this.orbit.target),
      units =
        (2 * offset.length() * Math.tan(T.MathUtils.degToRad(this.camera.fov) / 2)) / this.height,
      delta = new T.Vector3(-dx * units, dy * units, 0).applyQuaternion(this.camera.quaternion);
    this.orbit.target.add(delta);
    offset.setLength(
      T.MathUtils.clamp(offset.length() * scale, this.orbit.minDistance, this.orbit.maxDistance),
    );
    this.camera.position.copy(this.orbit.target).add(offset);
    this.orbit.update();
    this.drawDirty = true;
  }
  protected pointerCancel = (e: PointerEvent) => {
    if (this.boxPointer !== undefined) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.clearBox();
      return;
    }
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.touch.cancel(e.pointerId);
      return;
    }
    this.gizmo.reset();
    this.gizmo.pointerUp(null);
    this.clearBox();
    if (this.modal) this.finishTransform(true);
  };
  protected pointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.renderer.domElement.focus({ preventScroll: true });
      this.tooltip.hidden = true;
      if (this.boxArmed) {
        if (this.boxPointer !== undefined) return;
        const p = this.touchPoint(e),
          v = this.preview;
        if (
          this.store.state.cameraPreview &&
          !this.store.state.playerView &&
          p.x > v.x &&
          p.x < v.x + v.w &&
          p.y > v.y &&
          p.y < v.y + v.h
        )
          return;
        this.boxPointer = e.pointerId;
        this.boxStart = { x: p.x, y: p.y, mode: this.store.state.boxSelection ?? 'replace' };
        this.orbit.enabled = false;
        return;
      }
      this.touch.down(this.touchPoint(e));
      return;
    }
    if (this.store.state.retargetMode) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (this.pickingAttachment && e.button === 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.clickStart = [e.clientX, e.clientY];
      return;
    }
    if (this.modal) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.suppressPointerUp = true;
      if (e.button === 1) {
        this.middleAxis = true;
        this.renderer.domElement.setPointerCapture(e.pointerId);
        this.lockMouseAxis();
        this.updateTransform();
      } else if (e.button === 0 || e.button === 2) this.finishTransform(e.button === 2);
      return;
    }
    if (!this.store.state.gameView && e.button === 2 && e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const ray = new T.Raycaster();
      const view = this.viewRect();
      ray.setFromCamera(
        new T.Vector2(
          ((this.pointer.x - view.x) / view.w) * 2 - 1,
          1 - ((this.pointer.y - view.y) / view.h) * 2,
        ),
        this.viewCamera(),
      );
      const plane = new T.Plane().setFromNormalAndCoplanarPoint(
          this.viewCamera().getWorldDirection(new T.Vector3()),
          this.store.state.playerView ? this.proxy.position : this.orbit.target,
        ),
        point = ray.ray.intersectPlane(plane, new T.Vector3());
      if (point) {
        this.store.setTransformOptions({
          cursorPosition: point.toArray() as V3,
          transformPivot: 'cursor',
        });
        this.store.patch({ message: '3D cursor placed on the view plane' });
      }
      this.suppressPointerUp = true;
      return;
    }
    if (this.store.state.playerView && e.button === 1)
      this.store.patch({ playerView: false, message: 'Orbit view' });
    if (this.store.state.gameView) return;
    this.renderer.domElement.focus({ preventScroll: true });
    this.clickStart = [e.clientX, e.clientY];
    const directHandle =
      e.button === 0 && !this.boxArmed
        ? this.hitControls(this.pointer.x, this.pointer.y)[0]
        : undefined;
    if (
      this.gizmo.axis &&
      directHandle &&
      directHandle.id !== this.store.state.selected &&
      directHandle.distance <= 5
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.gizmo.axis = null;
      this.store.selectControl(directHandle.id, e.shiftKey || this.store.state.multiSelect);
      this.suppressPointerUp = true;
      return;
    }
    if (
      e.button === 0 &&
      (this.boxArmed ||
        (!this.gizmo.axis && !this.hitControls(this.pointer.x, this.pointer.y).length))
    ) {
      const v = this.preview;
      if (
        this.store.state.cameraPreview &&
        !this.store.state.playerView &&
        this.pointer.x > v.x &&
        this.pointer.x < v.x + v.w &&
        this.pointer.y > v.y &&
        this.pointer.y < v.y + v.h
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.drawDirty = true;
      this.boxStart = {
        ...this.pointer,
        mode:
          e.ctrlKey || e.altKey
            ? 'subtract'
            : e.shiftKey
              ? 'add'
              : (this.store.state.boxSelection ?? 'replace'),
      };
      this.orbit.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
      this.tooltip.hidden = true;
    }
  };
  protected contextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (this.modal) this.finishTransform(true);
    if (this.boxArmed || this.boxStart) this.clearBox();
    if (this.pickingAttachment) {
      this.pickingAttachment = false;
      this.drawDirty = true;
      this.renderer.domElement.style.cursor = '';
    }
  };
  protected pointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.boxArmed) {
        if (e.pointerId === this.boxPointer) this.drawBox(this.touchPoint(e));
        return;
      }
      this.touch.move(this.touchPoint(e));
      return;
    }
    if (this.store.state.retargetMode) return;
    if (this.store.state.gameView) {
      this.tooltip.hidden = true;
      return;
    }
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (this.modal) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (this.middleAxis) this.lockMouseAxis();
      this.updateTransform();
      return;
    }
    if (this.boxStart) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const b = this.boxStart;
      this.marquee.hidden = false;
      Object.assign(this.marquee.style, {
        left: Math.min(b.x, this.pointer.x) + 'px',
        top: Math.min(b.y, this.pointer.y) + 'px',
        width: Math.abs(b.x - this.pointer.x) + 'px',
        height: Math.abs(b.y - this.pointer.y) + 'px',
      });
      return;
    }
    if (this.boxArmed || e.buttons || this.dragging) return;
    const hit = this.hitControls(this.pointer.x, this.pointer.y)[0];
    this.hovered = hit?.id ?? null;
    this.drawDirty = true;
    this.tooltip.hidden = !hit;
    if (hit) {
      this.tooltip.textContent =
        controlLabel(hit.id, this.store.state.project) + ' · Shift-click to add';
      this.tooltip.style.left = Math.min(this.width - 170, this.pointer.x + 16) + 'px';
      this.tooltip.style.top = Math.max(6, this.pointer.y - 30) + 'px';
    }
    this.renderer.domElement.style.cursor = this.pickingAttachment
      ? 'crosshair'
      : hit
        ? 'pointer'
        : '';
  };
  protected lockMouseAxis() {
    const m = this.modal;
    if (!m) return;
    const axis = mouseAxis(
      this.viewCamera(),
      m.pivot,
      this.viewRect().w,
      this.viewRect().h,
      this.pointer.x - m.start.x,
      this.pointer.y - m.start.y,
      m.orientation,
    );
    if (axis) m.axis = axis;
  }
  protected hitControls(x: number, y: number) {
    if (this.store.state.gameView) return [];
    if (
      this.store.state.cameraPreview &&
      !this.store.state.playerView &&
      x > this.preview.x &&
      x < this.preview.x + this.preview.w &&
      y > this.preview.y &&
      y < this.preview.y + this.preview.h
    )
      return [];
    const r = this.viewRect();
    return pickControl(
      this.markers.values(),
      this.viewCamera(),
      r.w,
      r.h,
      x - r.x,
      y - r.y,
      () => !!this.store.state.project,
    );
  }
  protected pointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.pointerId === this.boxPointer) {
        const p = this.touchPoint(e);
        this.finishBox(p.x, p.y);
      } else this.touch.up(this.touchPoint(e));
      if (this.renderer.domElement.hasPointerCapture(e.pointerId))
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      return;
    }
    if (this.store.state.retargetMode) return;
    if (this.store.state.gameView) return;
    if (this.pickingAttachment && e.button === 0) {
      const r = this.renderer.domElement.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top;
      let id: ControlId | undefined = this.hitControls(x, y)[0]?.id;
      if (!id) {
        const ray = new T.Raycaster(),
          v = this.viewRect();
        ray.setFromCamera(
          new T.Vector2(((x - v.x) / v.w) * 2 - 1, 1 - ((y - v.y) / v.h) * 2),
          this.viewCamera(),
        );
        const hit = ray.intersectObjects(this.scene.children, true).find((h) => {
          let o: T.Object3D | null = h.object;
          while (o) {
            if (!o.visible) return false;
            o = o.parent;
          }
          return h.object instanceof T.SkinnedMesh || !!h.object.userData.control;
        });
        if (hit?.object.userData.control) id = hit.object.userData.control;
        if (hit && hit.object instanceof T.SkinnedMesh && hit.face) {
          const mesh = hit.object,
            vertex = hit.face.a;
          let largest = -1;
          for (const { index, weight } of skinSets(mesh.geometry))
            for (let k = 0; k < 4; k++)
              if (weight.getComponent(vertex, k) > largest) {
                largest = weight.getComponent(vertex, k);
                id = boneControl(mesh.skeleton.bones[index.getComponent(vertex, k)].name);
              }
        }
      }
      if (id) {
        this.pickingAttachment = false;
        this.renderer.domElement.style.cursor = '';
        this.setAttachment(id);
      }
      return;
    }
    if (this.boxStart) {
      const r = this.renderer.domElement.getBoundingClientRect();
      if (this.finishBox(e.clientX - r.left, e.clientY - r.top)) return;
    }
    if (e.button === 1 && this.middleAxis) {
      this.middleAxis = false;
      this.suppressPointerUp = false;
      return;
    }
    if (this.suppressPointerUp) {
      this.suppressPointerUp = false;
      return;
    }
    if (
      this.dragging ||
      this.gizmo.axis ||
      Math.hypot(e.clientX - this.clickStart[0], e.clientY - this.clickStart[1]) > 4 ||
      e.button !== 0
    )
      return;
    const rect = this.renderer.domElement.getBoundingClientRect(),
      x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    if (
      this.store.state.cameraPreview &&
      !this.store.state.playerView &&
      x > this.preview.x &&
      x < this.preview.x + this.preview.w &&
      y > this.preview.y &&
      y < this.preview.y + this.preview.h
    )
      return;
    const hits = this.hitControls(x, y);
    if (hits.length) {
      this.store.selectControl(
        hits[e.altKey && hits.length > 1 ? 1 : 0].id,
        e.shiftKey || this.store.state.multiSelect,
      );
      return;
    }
    const ray = new T.Raycaster();
    const view = this.viewRect();
    ray.setFromCamera(
      new T.Vector2(((x - view.x) / view.w) * 2 - 1, 1 - ((y - view.y) / view.h) * 2),
      this.viewCamera(),
    );
    const first = this.store.state.project?.editing === 'firstPerson';
    const hit = ray.intersectObjects(this.projectObjects.objects(!!first), true)[0];
    if (hit?.object.userData.control)
      this.store.selectControl(
        hit.object.userData.control,
        e.shiftKey || this.store.state.multiSelect,
      );
    else if (!e.shiftKey) this.store.deselectAll();
  };
}

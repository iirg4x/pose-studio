import { DisplayCadence, RenderBudget, tabletPixelRatio } from '../renderBudget';
import { isTouch as isAndroid } from '../../platform/storage';
import { AttachmentSolver } from '../attachments';
import { ProjectProps } from '../ProjectProps';
import { RetargetRig } from '../RetargetRig';
import { MannyCharacter } from '../MannyCharacter';
import { StudioReflections } from '../reflections';
import type { TransformOrientation, TransformPivot } from '../transformOptions';
import { createStudioBackdrop } from '../studioBackdrop';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createStudioFloor } from '../grid';
import { MannyRig } from '../rig';
import { createMagazine, createMainProp } from '../props';
import { matrix } from '../../core/model';
import type { ControlId, Pose, Project } from '../../core/model';
import { CONTROLS } from '../../core/controls';
import { ControlVisual } from '../controlVisual';
import type { StudioState, StudioStore } from '../../core/store';

/** Renderer, scene graph, rigs, cameras, controls and shared interaction state. */
export abstract class SceneCore {
  declare store: StudioStore;
  declare protected host: HTMLElement;
  declare protected onReady: () => void;
  abstract apply(frame: number, project?: Project | null, usePreview?: boolean): void;
  protected abstract updateControls(frame: number): void;

  canonicalRig?: MannyRig;
  retargetRig?: RetargetRig;
  previewCharacter?: MannyCharacter;
  protected previewSignature = '';
  protected targetAsset = '';
  protected targetLoad = 0;
  protected sourceControlWorlds = new Map<ControlId, T.Matrix4>();
  protected previewControlWorlds = new Map<ControlId, T.Matrix4>();
  protected targetRifle = createMainProp();
  protected targetMagazine = createMagazine();
  protected targetFirstRifle = createMainProp();
  protected targetFirstMagazine = createMagazine();
  protected attachmentFirst = new AttachmentSolver();
  protected attachmentBody = new AttachmentSolver();
  protected pickingAttachment = false;
  protected recording = false;
  protected projectObjects!: ProjectProps;
  protected previewObjects!: ProjectProps;
  protected previewProject?: Project;
  protected previewBodyRoot = new T.Matrix4();
  renderer!: T.WebGLRenderer;
  scene = new T.Scene();
  protected overlays = new T.Scene();
  protected reflections?: StudioReflections;
  protected playerEffects?: StudioReflections;
  camera = new T.PerspectiveCamera(36, 1, 0.01, 100);
  playerCamera = new T.PerspectiveCamera(70, 16 / 9, 0.035, 100);
  orbit!: OrbitControls;
  gizmo!: TransformControls;
  gizmoHelper!: T.Object3D;
  proxy = new T.Object3D();
  rifle = createMainProp();
  magazine = createMagazine();
  rig?: MannyRig;
  bodyRig?: MannyRig;
  fpGroup = new T.Group();
  bodyRoot?: T.Group;
  worldRifle = createMainProp();
  worldMagazine = createMagazine();
  protected bodyLegs: T.SkinnedMesh[] = [];
  protected worldMaterials = new Set<T.Material>();
  protected cameraDelta = new T.Matrix4();
  markers = new Map<ControlId, ControlVisual>();
  restControls: Partial<Record<ControlId, Pose>> = {};
  protected hovered: ControlId | null = null;
  protected tooltip = document.createElement('div');
  protected pointer = { x: 0, y: 0 };
  protected selectionModifier = false;
  protected middleAxis = false;
  protected boxPointer?: number;
  protected boxArmed = false;
  protected boxStart: null | { x: number; y: number; mode: 'replace' | 'add' | 'subtract' } = null;
  protected marquee = document.createElement('div');
  protected modal: null | {
    orientation?: T.Quaternion;
    space: TransformOrientation;
    pivotMode: TransformPivot;
    mode: 'translate' | 'rotate';
    axis: 'x' | 'y' | 'z' | null;
    numeric: string;
    start: { x: number; y: number };
    project: Project;
    drafts: Partial<Record<ControlId, Pose>>;
    poses: Partial<Record<ControlId, Pose>>;
    worlds: Map<ControlId, T.Matrix4>;
    pivot: T.Vector3;
  } = null;
  protected cursorMarker = new T.Group();
  protected observer!: ResizeObserver;
  protected raf = 0;
  protected disposed = false;
  protected dragging = false;
  protected started = 0;
  protected startFrame = 0;
  protected wasPlaying = false;
  protected lastPlaybackSeek = -1;
  protected lastPlaybackClip = '';
  protected lastSelected = '';
  protected lastLayer = '';
  protected unsubscribe!: () => void;
  protected env!: T.WebGLRenderTarget;
  protected backdrop = createStudioBackdrop();
  protected floor = createStudioFloor(this.backdrop);
  protected width = 1;
  protected height = 1;
  protected resizePending = true;
  protected preview = { x: 20, y: 38, w: 330, h: 186 };
  protected materialCache = new Set<T.Material>();
  protected fitOnApply = false;
  protected drawDirty = true;
  protected forcePose = true;
  protected lastPoseState?: StudioState;
  protected lastPoseFrame = -1;
  protected renderBudget = new RenderBudget();
  protected lastActiveDraw = 0;
  protected cadence = new DisplayCadence();
  protected invalidate = () => {
    this.drawDirty = true;
  };
  protected resize() {
    this.resizePending = false;
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    if (isAndroid) {
      const ratio = tabletPixelRatio(
        this.width,
        this.height,
        devicePixelRatio,
        this.renderBudget.quality,
      );
      if (ratio !== this.renderer.getPixelRatio()) this.renderer.setPixelRatio(ratio);
    }
    // Panel transitions change projection, not the authored skeleton. Re-solving
    // retargeting/IK on every animated layout pixel starves the UI compositor.
    this.drawDirty = true;
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.setViewOffset(
      this.width,
      this.height,
      isAndroid ? 0 : -this.width * 0.08,
      0,
      this.width,
      this.height,
    );
    this.camera.updateProjectionMatrix();
    const w = Math.min(380, Math.max(210, this.width * 0.32));
    this.preview = { x: isAndroid ? 80 : 20, y: isAndroid ? 84 : 38, w, h: (w * 9) / 16 };
    this.host.style.setProperty('--preview-x', this.preview.x + 'px');
    this.host.style.setProperty('--preview-y', this.preview.y + 'px');
    this.host.style.setProperty('--preview-w', w + 'px');
    this.host.style.setProperty('--preview-h', (w * 9) / 16 + 'px');
  }
  protected controlWorld(
    id: ControlId,
    values: Record<ControlId, Pose>,
    rig: MannyRig,
    first: boolean,
    bodyRoot: Pose,
    fk = false,
  ) {
    const d = CONTROLS[id];
    if (d.kind === 'pivot') return rig.pivotWorld(id);
    if (d.kind === 'bone' || id === 'root') return rig.bodyBone(id).matrixWorld.clone();
    // An IK handle on a limb posed in FK rides the FK chain, where switching to IK
    // would put it, instead of resting at its own (possibly never-set) value.
    if (fk && d.limb && (d.kind === 'target' || d.kind === 'pole')) return this.fkHandle(id, rig);
    const m = matrix(values[id]);
    if (d.kind === 'pole') m.makeTranslation(...values[id].p);
    if (first) m.premultiply(id === 'camera' ? matrix(bodyRoot) : this.cameraDelta);
    return m;
  }
  private fkHandle(id: ControlId, rig: MannyRig) {
    const side = id.at(-1),
      arm = CONTROLS[id].limb!.startsWith('arm'),
      [a, b, c] = (arm ? ['upperarm', 'forearm', 'wrist'] : ['thigh', 'shin', 'ankle']).map(
        (stem) => rig.bodyBone((stem + '_' + side) as ControlId).matrixWorld,
      );
    if (CONTROLS[id].kind === 'target') return c.clone();
    // Same placement as matchLimb: off the middle joint, along the bend.
    const start = new T.Vector3().setFromMatrixPosition(a),
      mid = new T.Vector3().setFromMatrixPosition(b),
      axis = new T.Vector3().setFromMatrixPosition(c).sub(start).normalize(),
      bend = mid.clone().sub(start);
    bend.addScaledVector(axis, -bend.dot(axis));
    if (bend.lengthSq() < 1e-10) bend.set(0, 0, 1).addScaledVector(axis, -axis.z);
    return new T.Matrix4().makeTranslation(mid.addScaledVector(bend.normalize(), 0.35));
  }
  protected viewCamera() {
    return this.store.state.playerView ? this.playerCamera : this.camera;
  }
  protected viewRect() {
    return { x: 0, y: 0, w: this.width, h: this.height };
  }
  protected renderControls(camera: T.PerspectiveCamera) {
    if (this.store.state.gameView || this.store.state.retargetMode) return;
    const clear = this.renderer.autoClear,
      mask = camera.layers.mask;
    camera.layers.enable(0);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.overlays, camera);
    this.renderer.autoClear = clear;
    camera.layers.mask = mask;
  }
  protected clearBox() {
    this.drawDirty = true;
    this.boxArmed = false;
    this.boxPointer = undefined;
    this.boxStart = null;
    this.marquee.hidden = true;
    this.orbit.enabled = true;
    this.renderer.domElement.style.cursor = '';
    if (this.store.state.boxSelection) this.store.patch({ boxSelection: null });
  }
  protected updateAxes() {
    const inv = this.viewCamera().quaternion.clone().invert();
    for (const [name, dir] of [
      ['X', new T.Vector3(0, 0, 1)],
      ['Y', new T.Vector3(-1, 0, 0)],
      ['Z', new T.Vector3(0, 1, 0)],
    ] as [string, T.Vector3][]) {
      dir.applyQuaternion(inv);
      const el = this.host.querySelector('[data-axis="' + name + '"]');
      if (!el) continue;
      const x = 40 + dir.x * 25,
        y = 40 - dir.y * 25,
        line = el.querySelector('line')!,
        label = el.querySelector('text')!;
      line.setAttribute('x2', String(x));
      line.setAttribute('y2', String(y));
      label.setAttribute('x', String(40 + dir.x * 34));
      label.setAttribute('y', String(44 - dir.y * 34));
    }
  }
  /** Cinematic frames render the scene several times (beauty, reflection and AO
   * passes, preview camera). Transforms do not change between those passes, so world
   * and skinning matrices are computed once per frame instead of once per pass. */
  protected render() {
    const skeletons = new Set<T.Skeleton>();
    try {
      this.renderPasses(skeletons);
    } finally {
      this.scene.matrixWorldAutoUpdate = true;
      for (const skeleton of skeletons) delete (skeleton as { update?: unknown }).update;
    }
  }
  private freezeMatrices(skeletons: Set<T.Skeleton>) {
    this.scene.updateMatrixWorld();
    this.scene.matrixWorldAutoUpdate = false;
    this.scene.traverse((o) => {
      const skeleton = (o as T.SkinnedMesh).isSkinnedMesh ? (o as T.SkinnedMesh).skeleton : null;
      if (!skeleton || skeletons.has(skeleton)) return;
      skeleton.update();
      skeletons.add(skeleton);
      skeleton.update = () => {};
    });
  }
  private renderPasses(skeletons: Set<T.Skeleton>) {
    const character = this.previewCharacter,
      reference = this.store.state.retargetMode && this.store.state.retargetRest;
    const first = !reference && this.store.state.project?.editing !== 'body',
      hasMagazine = this.store.state.project?.propPreset !== 'axe';
    this.magazine.visible = hasMagazine;
    this.fpGroup.visible = !character && first;
    if (this.bodyRoot) this.bodyRoot.visible = !character && !first;
    this.worldRifle.visible = !character && !first;
    this.worldMagazine.visible = !character && !first && hasMagazine;
    for (const leg of this.bodyLegs) leg.visible = false;
    this.targetRifle.visible = !!character && !first && !reference;
    this.targetMagazine.visible = this.targetRifle.visible && hasMagazine;
    this.targetFirstRifle.visible = !reference;
    this.targetFirstMagazine.visible = !reference && hasMagazine;
    if (character) {
      character.body.root.visible = !first;
      character.fpGroup.visible = first;
      for (const leg of character.legs) leg.visible = false;
    }
    if (this.store.state.project) {
      this.projectObjects.show(
        this.store.state.project,
        first,
        !!character,
        reference,
        false,
        this.store.state.project.editing,
      );
      if (this.previewProject)
        this.previewObjects.show(
          this.previewProject,
          first,
          !!character,
          reference,
          false,
          this.previewProject.editing,
        );
    }
    this.freezeMatrices(skeletons);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.width, this.height);
    if (!this.store.state.playerView) {
      if (this.store.state.cinematic)
        (this.reflections ??= new StudioReflections(this.renderer, this.scene, this.camera)).render(
          this.scene,
          this.camera,
          { x: 0, y: 0, w: this.width, h: this.height },
        );
      else this.renderer.render(this.scene, this.camera);
      this.renderControls(this.camera);
    }
    if (
      this.store.state.retargetMode ||
      (!this.store.state.playerView &&
        (!this.store.state.cameraPreview || this.store.state.gameView))
    )
      return;
    this.fpGroup.visible = !character;
    if (this.bodyRoot) this.bodyRoot.visible = !character;
    this.worldRifle.visible = !character;
    this.worldMagazine.visible = !character && hasMagazine;
    for (const leg of this.bodyLegs) leg.visible = !character;
    if (character) {
      character.body.root.visible = true;
      character.fpGroup.visible = true;
      for (const leg of character.legs)
        leg.visible = !character.config.hiddenMeshes.includes(leg.name);
      this.targetRifle.visible = true;
      this.targetMagazine.visible = hasMagazine;
    }
    if (this.store.state.project) {
      this.projectObjects.show(
        this.store.state.project,
        true,
        !!character,
        reference,
        true,
        this.store.state.project.editing,
      );
      if (this.previewProject)
        this.previewObjects.show(
          this.previewProject,
          true,
          !!character,
          reference,
          true,
          this.previewProject.editing,
        );
    }
    // Only the chosen model contributes to the player view and its world shadow.
    const hiddenMaterials = [...this.worldMaterials, ...(character?.worldMaterials ?? [])];
    for (const m of hiddenMaterials) {
      m.colorWrite = false;
      m.depthWrite = false;
    }
    const p = this.store.state.playerView ? this.viewRect() : this.preview;
    if (this.store.state.playerView) {
      this.renderer.setClearColor('#10151c', 1);
      this.renderer.clear();
    }
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(p.x, this.height - p.y - p.h, p.w, p.h);
    this.renderer.setViewport(p.x, this.height - p.y - p.h, p.w, p.h);
    this.renderer.clearDepth();
    if (this.store.state.cinematic)
      (this.playerEffects ??= new StudioReflections(
        this.renderer,
        this.scene,
        this.playerCamera,
      )).render(this.scene, this.playerCamera, {
        x: p.x,
        y: this.height - p.y - p.h,
        w: p.w,
        h: p.h,
      });
    else this.renderer.render(this.scene, this.playerCamera);
    if (this.store.state.playerView) this.renderControls(this.playerCamera);
    this.renderer.setScissorTest(false);
    for (const m of hiddenMaterials) {
      m.colorWrite = true;
      m.depthWrite = true;
    }
  }
}

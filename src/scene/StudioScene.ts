import { RestPoseSampler } from './restPose';
import { randomId } from '../core/crypto';
import { coordinatePose, coordinateWorld } from './coordinates';
import type { CoordinateSpace, CoordinateSnapshot } from './coordinates';
import { mirrorTimelineClipboard } from '../core/mirrorTimeline';
import { previewViews } from '../core/previewLinks';
import { controllerConstraints, groundingClearance } from '../core/controllerConstraints';
import { animationCamera, cameraControl } from './animationCamera';
import { mirrorControlPose, mirrorDestination } from '../core/mirrorPose';
import { TrailSamples } from './trailSampling';
import { copyPoseTracks } from '../core/poseEdits';
import { TouchGestures } from './touchGestures';
import type { TouchPoint } from './touchGestures';
import { DisplayCadence, RenderBudget, tabletPixelRatio } from './renderBudget';
import { isTouch as isAndroid } from '../platform/storage';
import { BodySourceSampler } from './BodySourceSampler';
import { setBodySourceResolver } from '../core/model';
import { editLayerAllowed, authorLayerPosition } from '../core/layers';
import { AttachmentSolver, boneControl } from './attachments';
import type { AttachmentTarget } from './attachments';
import { setLayerBasisProvider } from '../core/layerSpaces';
import { ProjectProps, disposeProp } from './ProjectProps';
import { projectProps, isProp } from '../core/assets';
import { RetargetRig } from './RetargetRig';
import { MannyCharacter, mannyPreviewConfig } from './MannyCharacter';
import type { RetargetCharacter } from '../core/retarget';
import { autoMapBones, defaultHiddenMeshes } from '../core/retarget';
import { exportRetargetGLB } from './retargetExport';
import { prepareMannyMaterial } from './mannyMaterials';
import { ViewportTransformControls } from './ViewportTransformControls';
import { StudioReflections } from './reflections';
import { pivotPoint, transformedControl, orientationQuaternion } from './transformOptions';
import type { TransformOrientation, TransformPivot } from './transformOptions';
import { createStudioBackdrop } from './studioBackdrop';
import { boxControls, mouseAxis, transformAxis } from './selection';
import * as T from 'three';
import { bakeSharedSkeleton } from './sharedSkeletonExport';
import type { SharedExportPlan, SharedExportItem } from '../core/sharedExport';
import { fullSkinLoader, skinSets } from './skinInfluences';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createStudioFloor } from './grid';
import { MannyRig } from './rig';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { maskedGeometry } from './meshMask';
import { createMagazine, createMainProp, setMainProp, geometryData } from './props';
import {
  evaluate,
  fromMatrix,
  IDS,
  matrix,
  pose,
  forLayer,
  layerFrame,
  CAMERA_REFERENCE,
  limbMode,
  controlEnabled,
  controlLabel,
  clone,
  activeSpace,
  controlParent,
} from '../core/model';
import type { ControlId, Pose, Project, Q4, V3 } from '../core/model';
import { CONTROLS, isBoneControl, isRotationControl } from '../core/controls';
import type { LimbId, LimbMode } from '../core/controls';
import { matchLimb } from '../core/rigMatching';
import { ControlVisual, pickControl } from './controlVisual';
import shapes from '../../public/assets/controller-shapes.json';
import { rootMotionFrame } from '../core/rootMotion';
import type { RootMotionMode } from '../core/rootMotion';
import { playbackFrame } from '../core/loops';
import { recordingFrame } from '../core/recording';
import type { RecordingPlan } from '../core/recording';
import { boneFollowing } from '../core/boneFollowing';
import { keyingFrame } from '../core/layers';
import { putKey } from '../core/model';
import type { StudioState, StudioStore } from '../core/store';

export class StudioScene {
  canonicalRig?: MannyRig;
  retargetRig?: RetargetRig;
  previewCharacter?: MannyCharacter;
  private previewSignature = '';
  private targetAsset = '';
  private targetLoad = 0;
  private sourceControlWorlds = new Map<ControlId, T.Matrix4>();
  private previewControlWorlds = new Map<ControlId, T.Matrix4>();
  private targetRifle = createMainProp();
  private targetMagazine = createMagazine();
  private targetFirstRifle = createMainProp();
  private targetFirstMagazine = createMagazine();
  private attachmentFirst = new AttachmentSolver();
  private attachmentBody = new AttachmentSolver();
  private pickingAttachment = false;
  private recording = false;
  private projectObjects: ProjectProps;
  private previewObjects: ProjectProps;
  private previewProject?: Project;
  private previewBodyRoot = new T.Matrix4();
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  private overlays = new T.Scene();
  private reflections?: StudioReflections;
  private playerEffects?: StudioReflections;
  camera = new T.PerspectiveCamera(36, 1, 0.01, 100);
  playerCamera = new T.PerspectiveCamera(70, 16 / 9, 0.035, 100);
  orbit: OrbitControls;
  gizmo: TransformControls;
  gizmoHelper: T.Object3D;
  proxy = new T.Object3D();
  rifle = createMainProp();
  magazine = createMagazine();
  rig?: MannyRig;
  bodyRig?: MannyRig;
  fpGroup = new T.Group();
  bodyRoot?: T.Group;
  worldRifle = createMainProp();
  worldMagazine = createMagazine();
  private bodyLegs: T.SkinnedMesh[] = [];
  private worldMaterials = new Set<T.Material>();
  private cameraDelta = new T.Matrix4();
  markers = new Map<ControlId, ControlVisual>();
  restControls: Partial<Record<ControlId, Pose>> = {};
  private pasteMirroredKeys = () => {
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
  private linkAnimationMirror = (event: Event) => {
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
  private groundSelection = (event: Event) =>
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
  private activateControl = (e: Event) => {
    const id = (e as CustomEvent<ControlId>).detail,
      d = CONTROLS[id];
    if (d?.limb && d.only) this.switchLimb(d.limb, d.only);
  };
  private hovered: ControlId | null = null;
  private tooltip = document.createElement('div');
  private pointer = { x: 0, y: 0 };
  private suppressPointerUp = false;
  private selectionModifier = false;
  private selectionKeys = (e: KeyboardEvent) => {
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
  private clearSelectionModifier = () => {
    if (this.selectionModifier) {
      this.selectionModifier = false;
      this.drawDirty = true;
    }
  };
  private middleAxis = false;
  private boxPointer?: number;
  private boxArmed = false;
  private boxStart: null | { x: number; y: number; mode: 'replace' | 'add' | 'subtract' } = null;
  private marquee = document.createElement('div');
  private modal: null | {
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
  private gizmoDrag: null | {
    project: Project;
    drafts: Partial<Record<ControlId, Pose>>;
    worlds: Map<ControlId, T.Matrix4>;
    proxy: T.Matrix4;
    mode: 'translate' | 'rotate';
    pivot: TransformPivot;
    localOrientation?: T.Quaternion;
  } = null;
  private cursorMarker = new T.Group();
  private observer: ResizeObserver;
  private raf = 0;
  private disposed = false;
  private dragging = false;
  private started = 0;
  private startFrame = 0;
  private wasPlaying = false;
  private lastPlaybackSeek = -1;
  private lastPlaybackClip = '';
  private lastSelected = '';
  private lastMode = '';
  private lastLayer = '';
  private trailKey = '';
  private trailJob?: {
    key: string;
    id: ControlId;
    project: Project;
    samples: TrailSamples<T.Vector3>;
  };
  private trailIdle = 0;
  private clickStart = [0, 0];
  private unsubscribe: () => void;
  private env: T.WebGLRenderTarget;
  private backdrop = createStudioBackdrop();
  private floor = createStudioFloor(this.backdrop);
  private width = 1;
  private height = 1;
  private resizePending = true;
  private preview = { x: 20, y: 38, w: 330, h: 186 };
  private materialCache = new Set<T.Material>();
  private trail?: T.Line;
  private trailControl?: ControlId;
  showTrails = false;
  private fitOnApply = false;
  private drawDirty = true;
  private forcePose = true;
  private lastPoseState?: StudioState;
  private lastPoseFrame = -1;
  private renderBudget = new RenderBudget();
  private lastActiveDraw = 0;
  private cadence = new DisplayCadence();
  private invalidate = () => {
    this.drawDirty = true;
  };
  private pendingTouch?: TouchPoint;
  private touchCandidate?: {
    kind: 'gizmo' | 'direct';
    id: ControlId;
    toggle?: boolean;
    axis?: NonNullable<TransformControls['axis']>;
  };
  private touchPose?: {
    kind: 'gizmo' | 'direct';
    start: TouchPoint;
    project: Project;
    drafts: Partial<Record<ControlId, Pose>>;
    right: T.Vector3;
    up: T.Vector3;
    units: number;
  };
  private touch = new TouchGestures({
    beginPose: (p) => this.beginTouchPose(p),
    startPose: (p) => this.startTouchPose(p),
    movePose: (p) => this.moveTouchPose(p),
    finishPose: (cancel) => this.finishTouchPose(cancel),
    tap: (p) => this.tapTouch(p),
    orbit: (x, y) => this.orbitTouch(x, y),
    panZoom: (x, y, scale) => this.panTouch(x, y, scale),
  });
  constructor(
    private host: HTMLElement,
    public store: StudioStore,
    private onReady: () => void,
  ) {
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(
      isAndroid
        ? tabletPixelRatio(host.clientWidth, host.clientHeight, devicePixelRatio)
        : Math.min(devicePixelRatio, 2),
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.className = 'scene-canvas';
    host.appendChild(this.renderer.domElement);
    this.scene.background = this.backdrop;
    this.scene.environmentIntensity = 0.45;
    const pmrem = new T.PMREMGenerator(this.renderer),
      room = new RoomEnvironment();
    this.env = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.env.texture;
    room.dispose();
    pmrem.dispose();
    const hemi = new T.HemisphereLight(0xe5e7e9, 0x303234, 1.25);
    hemi.layers.enable(1);
    this.scene.add(hemi);
    const key = new T.DirectionalLight(0xfff9f2, 2.5);
    key.position.set(-3, 5, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(isAndroid ? 1024 : 2048, isAndroid ? 1024 : 2048);
    key.shadow.camera.left = -3;
    key.shadow.camera.right = 3;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -2;
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 16;
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.00003;
    key.shadow.normalBias = 0.001;
    key.layers.enable(1);
    this.scene.add(key);
    const rim = new T.DirectionalLight(0xd9e0e5, 1.15);
    rim.position.set(-2, 3, -2);
    rim.layers.enable(1);
    this.scene.add(rim);
    this.scene.add(this.floor, this.targetRifle, this.targetMagazine);
    this.targetRifle.visible = false;
    this.targetMagazine.visible = false;
    this.fpGroup.matrixAutoUpdate = false;
    this.fpGroup.add(this.rifle, this.magazine);
    this.scene.add(this.fpGroup, this.worldRifle, this.worldMagazine, this.proxy);
    for (const g of [this.rifle, this.magazine])
      g.traverse((o) => {
        if (o instanceof T.Mesh) o.castShadow = false;
      });
    for (const g of [this.targetFirstRifle, this.targetFirstMagazine])
      g.traverse((o) => {
        o.layers.enable(1);
        if (o instanceof T.Mesh) o.castShadow = false;
      });
    for (const g of [this.worldRifle, this.worldMagazine, this.targetRifle, this.targetMagazine])
      g.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.material = (o.material as T.Material).clone();
          this.worldMaterials.add(o.material as T.Material);
        }
      });
    this.projectObjects = new ProjectProps(
      this.scene,
      this.fpGroup,
      this.worldMaterials,
      (message) => this.store.patch({ message }),
      () => {
        this.forcePose = true;
        this.drawDirty = true;
      },
    );
    this.previewObjects = new ProjectProps(
      this.scene,
      this.fpGroup,
      this.worldMaterials,
      (message) => this.store.patch({ message }),
      () => {
        this.forcePose = true;
        this.drawDirty = true;
      },
    );
    this.camera.position.set(1.0, 1.65, 1.8);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 1.25, 0.16);
    this.orbit.enableDamping = !isAndroid;
    this.orbit.minDistance = 0.3;
    this.orbit.maxDistance = 8;
    this.orbit.maxPolarAngle = Math.PI * 0.93;
    this.orbit.mouseButtons = { LEFT: undefined, MIDDLE: T.MOUSE.ROTATE, RIGHT: T.MOUSE.PAN };
    this.gizmo = new ViewportTransformControls(this.camera, this.renderer.domElement, () =>
      this.viewRect(),
    );
    this.gizmo.setSize(isAndroid ? 1.15 : 0.85);
    this.gizmoHelper = this.gizmo.getHelper();
    this.overlays.add(this.gizmoHelper);
    const cursorMaterial = new T.LineBasicMaterial({
      color: 0xd1d9df,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });
    const cursorPoints = [
      new T.Vector3(-0.035, 0, 0),
      new T.Vector3(0.035, 0, 0),
      new T.Vector3(0, -0.035, 0),
      new T.Vector3(0, 0.035, 0),
    ];
    this.cursorMarker.add(
      new T.LineSegments(new T.BufferGeometry().setFromPoints(cursorPoints), cursorMaterial),
      new T.LineLoop(
        new T.BufferGeometry().setFromPoints(
          Array.from(
            { length: 32 },
            (_, i) =>
              new T.Vector3(
                Math.cos((i * Math.PI) / 16) * 0.022,
                Math.sin((i * Math.PI) / 16) * 0.022,
                0,
              ),
          ),
        ),
        cursorMaterial,
      ),
    );
    this.cursorMarker.renderOrder = 950;
    this.overlays.add(this.cursorMarker);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.dragging = Boolean(e.value);
      this.orbit.enabled = !this.dragging;
      if (this.dragging) {
        const s = this.store.state;
        this.gizmoDrag = s.project
          ? {
              project: s.project,
              drafts: clone(s.drafts),
              worlds: this.selectedWorlds(this.gizmo.getMode() as 'translate' | 'rotate'),
              proxy: new T.Matrix4().compose(
                this.proxy.position,
                this.proxy.quaternion,
                new T.Vector3(1, 1, 1),
              ),
              mode: this.gizmo.getMode() as 'translate' | 'rotate',
              pivot: this.transformPivotMode(),
              localOrientation:
                s.transformSpace === 'local'
                  ? this.markers.get(s.selected)!.quaternion.clone()
                  : undefined,
            }
          : null;
        this.store.beginGesture();
      } else {
        this.gizmoDrag = null;
        this.store.endGesture();
      }
    });
    this.gizmo.addEventListener('objectChange', () => this.updateGizmoDrag());
    this.gizmo.addEventListener('change', this.invalidate);
    this.orbit.addEventListener('change', this.invalidate);
    for (const id of IDS) {
      const marker = new ControlVisual(
        id,
        (shapes as Record<string, import('./controlVisual').SourceShape>)[id],
      );
      this.overlays.add(marker);
      this.markers.set(id, marker);
    }
    this.marquee.className = 'selection-marquee scene-marquee';
    this.marquee.hidden = true;
    host.appendChild(this.marquee);
    this.tooltip.className = 'controller-tooltip';
    this.tooltip.hidden = true;
    host.appendChild(this.tooltip);
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Pose viewport');
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown, true);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp, true);
    this.renderer.domElement.addEventListener('pointermove', this.pointerMove, true);
    this.renderer.domElement.addEventListener('contextmenu', this.contextMenu);
    this.renderer.domElement.addEventListener('pointercancel', this.pointerCancel, true);
    // ResizeObserver runs after animation callbacks. Resizing the drawing buffer
    // there clears the rendered frame just before paint; defer it to our next draw.
    window.addEventListener('pose-activate-control', this.activateControl);
    window.addEventListener('pose-paste-mirrored-keys', this.pasteMirroredKeys);
    window.addEventListener('pose-link-animation-mirror', this.linkAnimationMirror);
    window.addEventListener('pose-ground-selection', this.groundSelection);
    window.addEventListener('keydown', this.selectionKeys);
    window.addEventListener('keyup', this.selectionKeys);
    window.addEventListener('blur', this.clearSelectionModifier);
    this.observer = new ResizeObserver(() => {
      this.resizePending = true;
    });
    this.observer.observe(host);
    this.unsubscribe = store.subscribe(() => {
      if (!this.dragging && store.state.selected !== this.lastSelected) this.lastSelected = '';
    });
    this.load();
    this.loop();
  }
  private async load() {
    try {
      const gltf = await fullSkinLoader().loadAsync(
        new URL('assets/manny.glb', document.baseURI).href,
      );
      if (this.disposed) return;
      gltf.scene.traverse((o) => {
        if (o instanceof T.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) {
            prepareMannyMaterial(m);
            const mm = m as T.MeshStandardMaterial;
            mm.side = T.FrontSide;
            for (const texture of [
              mm.map,
              mm.normalMap,
              mm.roughnessMap,
              mm.metalnessMap,
              mm.emissiveMap,
              mm.aoMap,
            ])
              if (texture)
                texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
            this.materialCache.add(m);
          }
        }
      });
      this.bodyRoot = gltf.scene;
      this.bodyRig = new MannyRig(gltf.scene);
      this.canonicalRig = new MannyRig(cloneSkeleton(gltf.scene) as T.Group);
      this.scene.add(gltf.scene);
      const basisRig = new MannyRig(cloneSkeleton(gltf.scene) as T.Group);
      this.store.restPose = new RestPoseSampler(this.canonicalRig).sample;
      setBodySourceResolver(
        new BodySourceSampler(new MannyRig(cloneSkeleton(gltf.scene) as T.Group)).sample,
      );
      setLayerBasisProvider((values, p, frame) => {
        const world = { ...values };
        for (const id of IDS)
          if (
            id !== 'root' &&
            id !== 'camera' &&
            !isBoneControl(id) &&
            CONTROLS[id].kind !== 'pivot'
          )
            world[id] = fromMatrix(matrix(values.root).multiply(matrix(values[id])), values[id]);
        basisRig.setMotionRig(p.motionRig);
        basisRig.apply(
          world,
          Object.fromEntries(
            (['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const).map((id) => [
              id,
              limbMode(p, id, frame),
            ]),
          ),
          {},
          p.ikReference === 'fk',
          controllerConstraints(p),
        );
        return Object.fromEntries(
          IDS.filter((id) => isBoneControl(id) || CONTROLS[id].kind === 'pivot').map((id) => {
            const b = basisRig.bodyBone(id);
            return [
              id,
              {
                parent: b.parent!.getWorldQuaternion(new T.Quaternion()),
                rest: basisRig.rest.get(b.name)!.q.clone(),
                local: b.quaternion.clone(),
                parentPosition: b.parent!.getWorldPosition(new T.Vector3()),
                restPosition: basisRig.rest.get(b.name)!.p.clone(),
              },
            ];
          }),
        );
      });
      const floating = cloneSkeleton(gltf.scene) as T.Group;
      this.rig = new MannyRig(floating, true);
      this.restControls = this.rig.restControls;
      floating.traverse((o) => {
        if (o instanceof T.SkinnedMesh) {
          o.geometry = maskedGeometry(o, /^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)/);
          o.material = Array.isArray(o.material)
            ? o.material.map((m) => prepareMannyMaterial(m.clone()))
            : prepareMannyMaterial(o.material.clone());
          o.castShadow = false;
          o.receiveShadow = false;
          o.layers.enable(1);
        }
      });
      this.fpGroup.add(floating);
      const legParents = new Map<T.SkinnedMesh, T.Object3D>();
      gltf.scene.traverse((o) => {
        if (!(o instanceof T.SkinnedMesh)) return;
        o.layers.enable(1);
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          this.worldMaterials.add(m);
        const legs = new T.SkinnedMesh(
          maskedGeometry(o, /^(pelvis|thigh|calf|foot|ball)/),
          Array.isArray(o.material)
            ? o.material.map((m) => prepareMannyMaterial(m.clone()))
            : prepareMannyMaterial(o.material.clone()),
        );
        legs.bind(o.skeleton, o.bindMatrix);
        legs.position.copy(o.position);
        legs.quaternion.copy(o.quaternion);
        legs.scale.copy(o.scale);
        legs.layers.set(1);
        legs.frustumCulled = false;
        legs.castShadow = false;
        legs.receiveShadow = true;
        this.bodyLegs.push(legs);
        legParents.set(legs, o.parent!);
      });
      for (const legs of this.bodyLegs) legParents.get(legs)!.add(legs);
      this.playerCamera.layers.set(1);
      this.store.init(this.restControls);
      this.apply(this.store.state.frame);
      this.onReady();
    } catch (e) {
      this.store.patch({ message: 'Could not load Manny: ' + (e as Error).message });
    }
  }
  private resize() {
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
  private async parseCharacter(data: Uint8Array) {
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
  private currentCharacter(): RetargetCharacter | undefined {
    const s = this.store.state,
      c = s.workspace?.characters?.find(
        (c) =>
          c.id ===
          (s.retargetMode ? s.workspace?.activeCharacterId : s.workspace?.previewCharacterId),
      );
    if (c) return c;
    if (s.project?.motionRig && this.canonicalRig) return mannyPreviewConfig(this.canonicalRig);
  }
  private clearPreview() {
    this.targetFirstRifle.removeFromParent();
    this.targetFirstMagazine.removeFromParent();
    this.previewCharacter?.dispose();
    this.previewCharacter = undefined;
    this.previewSignature = '';
    this.previewControlWorlds.clear();
  }
  private preparePreview() {
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
  private syncRetarget() {
    const s = this.store.state,
      c = this.currentCharacter(),
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
            ? new RetargetRig(
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
  apply(frame: number, project = this.store.state.project, usePreview = true) {
    this.syncRetarget();
    if (!project || !this.rig || !this.bodyRig) return;
    this.projectObjects.sync(project);
    for (const id of IDS)
      if (!this.markers.has(id)) {
        const marker = new ControlVisual(id);
        this.overlays.add(marker);
        this.markers.set(id, marker);
      }
    if (this.lastLayer !== project.editing) {
      this.lastLayer = project.editing;
      this.resetView();
      this.fitOnApply = isAndroid;
    }
    setMainProp(this.rifle, project.propPreset);
    setMainProp(this.worldRifle, project.propPreset);
    const views =
      usePreview &&
      (this.store.state.cameraPreview ||
        this.store.state.playerView ||
        project.editing === 'firstPerson')
        ? previewViews(
            project,
            frame,
            this.store.state.workspace,
            !this.recording ? this.store.state.drafts : undefined,
          )
        : {
            firstPerson: {
              project: forLayer(project, 'firstPerson'),
              frame: layerFrame(project, 'firstPerson', frame),
            },
            body: { project: forLayer(project, 'body'), frame: layerFrame(project, 'body', frame) },
          };
    const fpProject = views.firstPerson.project,
      bodyProject = views.body.project,
      fpFrame = views.firstPerson.frame,
      bodyFrame = views.body.frame;
    this.previewProject = project.editing === 'body' ? fpProject : bodyProject;
    this.previewObjects.sync(this.previewProject);
    const fp = evaluate(
        fpProject,
        fpFrame,
        !this.recording && project.editing === 'firstPerson' ? this.store.state.drafts : {},
      ),
      body = evaluate(
        bodyProject,
        bodyFrame,
        !this.recording &&
          this.store.state.project?.editing === 'body' &&
          project.editing === 'body'
          ? this.store.state.drafts
          : {},
      );
    this.fpGroup.matrix.identity();
    this.fpGroup.updateMatrixWorld(true);
    const modes = (p: Project) =>
      Object.fromEntries(
        (['arm_l', 'arm_r', 'leg_l', 'leg_r'] as const).map((id) => [
          id,
          limbMode(p, id, p.editing === 'firstPerson' ? fpFrame : bodyFrame),
        ]),
      );
    this.rig.floating = fpProject.bodyBase?.source.editing !== 'body';
    this.rig.setMotionRig(fpProject.motionRig);
    this.bodyRig.setMotionRig(bodyProject.motionRig);
    this.rig.apply(
      fp,
      modes(fpProject),
      boneFollowing(fpProject, fpFrame),
      fpProject.ikReference === 'fk',
      controllerConstraints(fpProject),
    );
    this.bodyRig.apply(
      body,
      modes(bodyProject),
      boneFollowing(bodyProject, bodyFrame),
      bodyProject.ikReference === 'fk',
      controllerConstraints(bodyProject),
    );
    this.cameraDelta
      .copy(matrix(body.root).multiply(matrix(fp.camera)))
      .multiply(matrix(CAMERA_REFERENCE).invert());
    this.attachmentFirst.apply(this.rig, fp, fpProject, fpFrame, this.cameraDelta);
    this.attachmentBody.apply(this.bodyRig, body, bodyProject, bodyFrame);
    for (const [values, objects] of [
      [fp, [this.rifle, this.magazine]],
      [body, [this.worldRifle, this.worldMagazine]],
    ] as [Record<ControlId, Pose>, T.Group[]][]) {
      for (const [i, id] of (['rifle', 'magazine'] as const).entries()) {
        objects[i].position.fromArray(values[id].p);
        objects[i].quaternion.fromArray(values[id].q);
      }
    }
    const sourceCamera = matrix(body.root).multiply(
      animationCamera(fpProject, this.rig, fp.camera),
    );
    this.preparePreview();
    const character = this.previewCharacter,
      config = character?.config,
      reference = this.store.state.retargetMode && this.store.state.retargetRest;
    this.previewControlWorlds.clear();
    let targetCamera: T.Matrix4 | undefined;
    if (character && config) {
      character.fpGroup.matrix.identity();
      character.fpGroup.updateMatrixWorld(true);
      character.body.sample(this.bodyRig, body, bodyProject, bodyFrame, config, reference);
      targetCamera = character.body.cameraMatrix(sourceCamera);
      const rigCamera = character.body.cameraMatrix(matrix(body.root).multiply(matrix(fp.camera))),
        referenceCamera = character.body.cameraMatrix(matrix(CAMERA_REFERENCE), true),
        delta = rigCamera.multiply(referenceCamera.invert());
      character.first.sample(this.rig, fp, fpProject, fpFrame, config, reference, delta);
      const first = project.editing === 'firstPerson',
        active = first ? character.first : character.body;
      if (!reference)
        for (const id of IDS) this.previewControlWorlds.set(id, active.controlMatrix(id));
      for (const [model, rifle, magazine] of [
        [character.body, this.targetRifle, this.targetMagazine],
        [character.first, this.targetFirstRifle, this.targetFirstMagazine],
      ] as const) {
        setMainProp(rifle, project.propPreset);
        model.props.rifle!.decompose(rifle.position, rifle.quaternion, rifle.scale);
        model.props.magazine!.decompose(magazine.position, magazine.quaternion, magazine.scale);
      }
      character.fpGroup.matrix.copy(delta);
      character.fpGroup.updateMatrixWorld(true);
      if (first)
        for (const [id, m] of this.previewControlWorlds) {
          if (id === 'camera') m.copy(targetCamera);
          else m.premultiply(delta);
        }
    }
    this.previewBodyRoot.copy(matrix(body.root));
    for (const objects of [this.projectObjects, this.previewObjects])
      objects.apply(
        fp,
        body,
        character
          ? {
              fpRoot: character.fpGroup,
              first: (id) => character.first.controlMatrix(id),
              body: (id) => character.body.controlMatrix(id),
            }
          : undefined,
      );
    (targetCamera ?? sourceCamera).decompose(
      this.playerCamera.position,
      this.playerCamera.quaternion,
      this.playerCamera.scale,
    );
    this.playerCamera.fov = fp.camera.fov;
    this.playerCamera.aspect = this.store.state.playerView ? this.width / this.height : 16 / 9;
    this.playerCamera.updateProjectionMatrix();
    this.cameraDelta
      .copy(matrix(body.root).multiply(matrix(fp.camera)))
      .multiply(matrix(CAMERA_REFERENCE).invert());
    this.fpGroup.matrix.copy(this.cameraDelta);
    this.scene.updateMatrixWorld(true);
    if (this.store.state.retargetMode) {
      this.gizmo.detach();
      return;
    }
    const first = project.editing === 'firstPerson',
      values = first ? fp : body,
      activeRig = first ? this.rig : this.bodyRig;
    for (const id of this.markers.keys())
      this.sourceControlWorlds.set(id, this.controlWorld(id, values, activeRig, first, body.root));
    if (first) this.sourceControlWorlds.set('camera', sourceCamera);
    this.updateControls(frame);
    if (this.fitOnApply) {
      this.fitOnApply = false;
      this.frameScene();
    }
  }

  private updateControls(frame: number) {
    const project = this.store.state.project;
    if (!project || !this.rig || !this.bodyRig || this.store.state.retargetMode) return;
    const view = this.viewCamera(),
      rect = this.viewRect();
    this.gizmo.camera = view;
    const selection = this.store.state.selection,
      choosing =
        this.pickingAttachment ||
        this.boxArmed ||
        !!this.boxStart ||
        (!this.dragging && !this.modal && (this.store.state.multiSelect || this.selectionModifier));
    for (const [id, m] of this.markers) {
      if (/^(foot|toe|heel|ball)_[lr]$/.test(id)) {
        const first = project.editing === 'firstPerson',
          rig =
            (first ? this.previewCharacter?.first : this.previewCharacter?.body) ??
            (first ? this.rig : this.bodyRig);
        m.setPropShape(rig.footShape(id));
      }
      if (isProp(id)) {
        const outline = this.projectObjects.controlOutline(id, project);
        if (outline) m.setPropShape(outline);
      }
      const original = this.sourceControlWorlds.get(id);
      if (!original) continue;
      (this.previewControlWorlds.get(id) ?? original).decompose(m.position, m.quaternion, m.scale);
      const enabled = controlEnabled(project, id, frame),
        selected = this.store.state.selection.includes(id);
      const distance = m.position.distanceTo(view.position),
        pixelsPerMeter = rect.h / (2 * Math.tan(T.MathUtils.degToRad(view.fov) / 2) * distance);
      // Do not inflate every finger into overlapping boxes when framing the body.
      // Selected joints get a modest floor; picking remains padded in screen space.
      const pixelRadius = m.radius * pixelsPerMeter,
        minRadius = selected ? 6 : m.family === 'pole' ? 7 : 0;
      if (pixelRadius > 0 && pixelRadius < minRadius)
        m.scale.multiplyScalar(Math.min(2, minRadius / pixelRadius));
      m.style(rect.w, rect.h, selected, this.hovered === id, enabled, pixelRadius);
      m.visible = this.store.controlVisible(id) && (!selection.length || selected || choosing);
      if (id === 'magazine' && project.propPreset === 'axe') m.visible = false;
    }
    if (this.hovered && !this.markers.get(this.hovered)?.visible) {
      this.hovered = null;
      this.tooltip.hidden = true;
    }
    this.cursorMarker.visible = this.store.state.transformPivot === 'cursor';
    this.cursorMarker.position.fromArray(this.store.state.cursorPosition);
    this.cursorMarker.quaternion.copy(view.quaternion);
    if (this.trail)
      this.trail.visible =
        this.trailControl === this.store.state.selected &&
        this.store.controlVisible(this.store.state.selected);
    if (!this.dragging) {
      const id = this.store.state.selected;
      const selectedMarker = this.markers.get(id)!;
      this.proxy.position.copy(selectedMarker.position);
      this.proxy.quaternion.copy(selectedMarker.quaternion);
      this.proxy.scale.setScalar(1);
      const worlds = this.selectedWorlds(
        this.store.state.mode === 'select' ? 'translate' : this.store.state.mode,
      );
      this.proxy.position.copy(this.rotationPivot(worlds));
      if (this.store.state.transformSpace === 'view') this.proxy.quaternion.copy(view.quaternion);
      if (
        this.store.state.gameView ||
        this.pickingAttachment ||
        this.modal ||
        this.store.state.mode === 'select' ||
        !this.store.state.selection.includes(id) ||
        !this.store.controlVisible(id) ||
        !controlEnabled(project, id, frame)
      )
        this.gizmo.detach();
      else {
        this.gizmo.attach(this.proxy);
        this.gizmo.setMode(isRotationControl(id) ? 'rotate' : this.store.state.mode);
        this.gizmo.setSpace(
          this.store.state.transformSpace === 'view' ? 'local' : this.store.state.transformSpace,
        );
      }
    }
    this.publishCoordinates();
  }

  private controlWorld(
    id: ControlId,
    values: Record<ControlId, Pose>,
    rig: MannyRig,
    first: boolean,
    bodyRoot: Pose,
  ) {
    const d = CONTROLS[id];
    if (d.kind === 'pivot') return rig.pivotWorld(id);
    if (d.kind === 'bone' || id === 'root') return rig.bodyBone(id).matrixWorld.clone();
    const m = matrix(values[id]);
    if (d.kind === 'pole') m.makeTranslation(...values[id].p);
    if (first) m.premultiply(id === 'camera' ? matrix(bodyRoot) : this.cameraDelta);
    return m;
  }
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
  setBoneFollowing(position: boolean, rotation: boolean) {
    const state = this.store.state,
      id = state.selected;
    if (
      !state.project ||
      state.project.editing !== 'body' ||
      !isBoneControl(id) ||
      !this.store.canEditLayer(id) ||
      !controlEnabled(state.project, id, state.frame)
    )
      return;
    const next = clone(state.project);
    for (const [control, value] of Object.entries(state.drafts))
      putKey(next.tracks[control as ControlId], keyingFrame(next, state.frame), value!);
    this.apply(state.frame, next);
    const event = this.bodyRig!.captureFollowing(id, state.frame, position, rotation),
      track = next.tracks[id];
    track.following = (track.following ?? [])
      .filter((k) => k.frame !== state.frame)
      .concat(event)
      .sort((a, b) => a.frame - b.frame);
    this.store.commit(next, 'Bone following keyed at frame ' + state.frame);
    this.store.patch({ drafts: {} });
    this.apply(state.frame);
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
      values = evaluate(p, s.frame, s.drafts),
      poses: Partial<Record<ControlId, Pose>> = {};
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
    for (const id of this.store.selectedControls()) {
      const target = mirrorDestination(id);
      if (!target || !controlEnabled(p, target, s.frame)) continue;
      const a = rest(id),
        b = rest(target);
      poses[target] = mirrorControlPose(
        values[id],
        a.world,
        b.world,
        isBoneControl(id) || CONTROLS[id].kind === 'pivot',
        a.parent,
        b.parent,
        matrix(values.root),
      );
    }
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
  private viewCamera() {
    return this.store.state.playerView ? this.playerCamera : this.camera;
  }
  private viewRect() {
    return { x: 0, y: 0, w: this.width, h: this.height };
  }
  private renderControls(camera: T.PerspectiveCamera) {
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
  private contactRotationActive(mode = this.store.state.mode) {
    const s = this.store.state;
    return (
      mode === 'rotate' &&
      s.footPivot !== 'ankle' &&
      s.selection.length === 1 &&
      /^foot_[lr]$/.test(s.selected)
    );
  }
  private transformPivotMode(mode = this.store.state.mode) {
    return this.contactRotationActive(mode) ? ('median' as const) : this.store.state.transformPivot;
  }
  private rotationPivot(worlds: Map<ControlId, T.Matrix4>, mode = this.store.state.mode) {
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
  private selectedWorlds(mode: 'translate' | 'rotate') {
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
  private coordinateSnapshot: CoordinateSnapshot | null = null;
  private coordinateListeners = new Set<() => void>();
  subscribeCoordinates = (listener: () => void) => {
    this.coordinateListeners.add(listener);
    this.forcePose = true;
    this.drawDirty = true;
    return () => {
      this.coordinateListeners.delete(listener);
    };
  };
  getCoordinates = () => this.coordinateSnapshot;
  private coordinateState(): CoordinateSnapshot | null {
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
  private publishCoordinates() {
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
  private transformInputCache?: {
    project: Project;
    drafts: Partial<Record<ControlId, Pose>>;
    id: ControlId;
    frame: number;
    ownsPosition: boolean;
    bonePosition: boolean;
    commit: () => void;
  };
  private applyTransformTargets(
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
  private updateGizmoDrag() {
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
  private captureControlProxy(bonePosition = false) {
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
  private clearBox() {
    this.drawDirty = true;
    this.boxArmed = false;
    this.boxPointer = undefined;
    this.boxStart = null;
    this.marquee.hidden = true;
    this.orbit.enabled = true;
    this.renderer.domElement.style.cursor = '';
    if (this.store.state.boxSelection) this.store.patch({ boxSelection: null });
  }
  private drawBox(p: { x: number; y: number }) {
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
  private finishBox(x: number, y: number) {
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
  private touchPoint(e: PointerEvent): TouchPoint {
    const r = this.renderer.domElement.getBoundingClientRect();
    return {
      id: e.pointerId,
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      kind: e.pointerType === 'pen' ? 'pen' : 'touch',
    };
  }
  private touchPointer(p: TouchPoint, button = 0) {
    return {
      x: (p.x / this.width) * 2 - 1,
      y: 1 - (p.y / this.height) * 2,
      button,
    } as PointerEvent;
  }
  private beginTouchPose(p: TouchPoint) {
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
  private startTouchPose(p: TouchPoint) {
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
  private moveTouchPose(p: TouchPoint) {
    if (!this.touchPose) return;
    this.pendingTouch = p;
    this.drawDirty = true;
  }
  private applyTouchPose(p: TouchPoint) {
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
  private finishTouchPose(cancel: boolean) {
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
  private tapTouch(p: TouchPoint) {
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
  private orbitTouch(dx: number, dy: number) {
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
  private panTouch(dx: number, dy: number, scale: number) {
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
  private pointerCancel = (e: PointerEvent) => {
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
  private pointerDown = (e: PointerEvent) => {
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
  private contextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (this.modal) this.finishTransform(true);
    if (this.boxArmed || this.boxStart) this.clearBox();
    if (this.pickingAttachment) {
      this.pickingAttachment = false;
      this.drawDirty = true;
      this.renderer.domElement.style.cursor = '';
    }
  };
  private pointerMove = (e: PointerEvent) => {
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
  private lockMouseAxis() {
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
  private hitControls(x: number, y: number) {
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
      (id) => !!this.store.state.project,
    );
  }
  private pointerUp = (e: PointerEvent) => {
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
                id = boneControl(
                  this.bodyRig!,
                  mesh.skeleton.bones[index.getComponent(vertex, k)].name,
                );
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
  private updateTransform() {
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
  private finishTransform(cancel = false) {
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
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.recording || document.hidden) {
      this.lastActiveDraw = 0;
      this.cadence.reset();
      return;
    }
    const started = performance.now();
    if (isAndroid) this.cadence.observe(started);
    if (this.pendingTouch) {
      const point = this.pendingTouch;
      this.pendingTouch = undefined;
      this.applyTouchPose(point);
    }
    if (this.resizePending) this.resize();
    if (
      !this.wasPlaying &&
      this.store.state.retargetMode &&
      this.store.state.retargetRest &&
      this.store.state.playing
    )
      this.store.patch({ retargetRest: false });
    const state = this.store.state,
      now = performance.now();
    let frame = state.frame;
    if (state.playing && state.project) {
      if (
        !this.wasPlaying ||
        this.lastPlaybackSeek !== state.playbackSeek ||
        this.lastPlaybackClip !== state.workspace?.activeId
      ) {
        this.started = now;
        this.startFrame = state.frame;
      }
      this.lastPlaybackSeek = state.playbackSeek;
      this.lastPlaybackClip = state.workspace?.activeId ?? '';
      const result = playbackFrame(
        state.project,
        this.startFrame,
        ((now - this.started) / 1000) * state.project.fps,
      );
      frame = result.frame;
      if (Math.floor(frame) !== state.frame || result.finished)
        this.store.patch({ frame: Math.floor(frame), playing: !result.finished });
    }
    this.store.displayClock.publish(frame);
    this.wasPlaying = this.store.state.playing;
    const moved = this.orbit.update(),
      needsPose =
        this.forcePose || this.lastPoseState !== this.store.state || frame !== this.lastPoseFrame;
    if (this.showTrails) this.updateTrail();
    if (!needsPose && !moved && !this.drawDirty) return;
    this.renderer.shadowMap.autoUpdate = !isAndroid || this.store.state.cameraPreview;
    if (needsPose) {
      this.apply(frame);
      this.lastPoseState = this.store.state;
      this.lastPoseFrame = frame;
      this.forcePose = false;
      this.renderer.shadowMap.needsUpdate = true;
    } else this.updateControls(frame);
    this.updateAxes();
    this.render();
    this.drawDirty = false;
    if (isAndroid && (state.playing || this.touch.active)) {
      const elapsed = performance.now() - started,
        interval = this.lastActiveDraw ? now - this.lastActiveDraw : elapsed;
      if (
        this.renderBudget.sample(
          state.playing ? Math.max(elapsed, Math.min(interval, 80)) : elapsed,
          this.cadence.milliseconds,
        )
      )
        this.resizePending = true;
      this.lastActiveDraw = now;
    } else this.lastActiveDraw = 0;
  };
  private updateAxes() {
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
  toggleGameView() {
    if (this.modal) this.finishTransform(true);
    this.clearBox();
    this.tooltip.hidden = true;
    this.hovered = null;
    this.store.patch({ gameView: !this.store.state.gameView });
  }
  private render() {
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
  toggleTrail() {
    this.drawDirty = true;
    this.showTrails = !this.showTrails;
    this.trailKey = '';
    this.updateTrail();
  }
  private clearTrail() {
    if (this.trail) {
      this.trail.removeFromParent();
      this.trail.geometry.dispose();
      (this.trail.material as T.Material).dispose();
      this.trail = undefined;
    }
  }
  private cancelTrailSample() {
    if (this.trailIdle) {
      cancelIdleCallback(this.trailIdle);
      this.trailIdle = 0;
    }
  }
  private currentTrailKey() {
    const s = this.store.state;
    return [
      s.revision,
      s.selected,
      s.project?.editing,
      this.previewSignature,
      this.targetLoad,
    ].join(':');
  }
  private trailBusy() {
    const s = this.store.state;
    return (
      s.playing ||
      s.interacting ||
      s.gameView ||
      s.retargetMode ||
      this.touch.active ||
      this.dragging ||
      !!this.modal ||
      this.recording ||
      document.hidden
    );
  }
  private updateTrail() {
    if (!this.showTrails || !this.store.state.project) {
      this.cancelTrailSample();
      this.trailJob = undefined;
      this.trailKey = '';
      this.clearTrail();
      return;
    }
    const key = this.currentTrailKey();
    if (this.trailJob && this.trailJob.key !== key) {
      this.cancelTrailSample();
      this.trailJob = undefined;
    }
    if (this.trailKey === key || this.trailBusy()) {
      this.cancelTrailSample();
      return;
    }
    if (!this.trailJob) {
      const s = this.store.state;
      this.trailJob = {
        key,
        id: s.selected,
        project: s.project!,
        samples: new TrailSamples(s.project!.end),
      };
    }
    if (this.trailIdle) return;
    this.trailIdle = requestIdleCallback(
      (deadline) => {
        this.trailIdle = 0;
        if (this.disposed || !this.showTrails) return;
        const job = this.trailJob;
        if (!job || job.key !== this.currentTrailKey() || this.trailBusy()) return;
        if (deadline.timeRemaining() < 1 && !deadline.didTimeout) {
          this.updateTrail();
          return;
        }
        // One pose per idle slice, always restore the live scene before yielding.
        // Never feed a sampled pose into a pointer gesture or a playback frame.
        try {
          job.samples.step((frame) => {
            this.apply(frame, job.project);
            return this.markers.get(job.id)!.position.clone();
          });
        } finally {
          this.apply(this.store.state.frame);
        }
        if (job.samples.done) {
          this.clearTrail();
          this.trail = new T.Line(
            new T.BufferGeometry().setFromPoints(job.samples.points),
            new T.LineBasicMaterial({ color: 0x55bfd3, transparent: true, opacity: 0.6 }),
          );
          this.trailControl = job.id;
          this.trail.visible = this.store.controlVisible(job.id);
          this.overlays.add(this.trail);
          this.trailKey = job.key;
          this.trailJob = undefined;
          this.drawDirty = true;
        } else this.updateTrail();
      },
      { timeout: 500 },
    );
  }

  async renderRecording(
    plan: RecordingPlan,
    onFrame: (index: number) => Promise<void>,
    signal: AbortSignal,
  ) {
    if (this.recording || !this.rig || !this.store.state.project)
      throw Error('The scene is not ready to record.');
    const old = this.store.state,
      project = clone(old.project!),
      pixelRatio = this.renderer.getPixelRatio(),
      orbitEnabled = this.orbit.enabled;
    this.recording = true;
    try {
      this.orbit.enabled = false;
      this.store.patch({
        playing: false,
        gameView: true,
        playerView: plan.view === 'player',
        retargetRest: false,
      });
      this.width = plan.width;
      this.height = plan.height;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(plan.width, plan.height, false);
      this.camera.aspect = plan.width / plan.height;
      this.camera.setViewOffset(
        plan.width,
        plan.height,
        -plan.width * 0.08,
        0,
        plan.width,
        plan.height,
      );
      this.camera.updateProjectionMatrix();
      for (let index = 0; index < plan.totalFrames; index++) {
        signal.throwIfAborted();
        if (this.disposed) throw Error('The scene was closed during recording.');
        this.apply(recordingFrame(plan, index), project);
        this.render();
        await onFrame(index);
        if (index % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      this.renderer.setPixelRatio(pixelRatio);
      this.orbit.enabled = orbitEnabled;
      this.store.patch({
        playing: old.playing,
        gameView: old.gameView,
        playerView: old.playerView,
        drafts: old.drafts,
        retargetRest: old.retargetRest,
      });
      this.wasPlaying = false;
      this.recording = false;
      this.resize();
      this.apply(old.frame);
      this.render();
    }
  }
  async bake(
    project: Project,
    onProgress: (v: number) => void,
    range = { start: 0, end: project.end },
    rootMotion: RootMotionMode = 'keep',
  ) {
    if (!this.rig) throw Error('Manny is still loading.');
    project = { ...project, props: projectProps(project) };
    await this.projectObjects.ready(project);
    const frames: unknown[] = [];
    const old = this.store.state;
    this.store.patch({ playing: false, drafts: {} });
    const duration = range.end - range.start,
      origin = matrix(
        evaluate(forLayer(project, 'body'), layerFrame(project, 'body', range.start)).root,
      ).toArray();
    for (let f = range.start; f <= range.end; f++) {
      this.apply(f, project, false);
      const v = evaluate(forLayer(project, 'firstPerson'), layerFrame(project, 'firstPerson', f)),
        body = evaluate(forLayer(project, 'body'), layerFrame(project, 'body', f));
      const exportBody =
          project.motionRig && this.previewCharacter ? this.previewCharacter.body : this.bodyRig!,
        exportFirst =
          project.motionRig && this.previewCharacter ? this.previewCharacter.first : this.rig;
      const world = rootMotionFrame(
        exportBody.deformation(),
        Object.fromEntries(
          [...this.projectObjects.entries].map(([id, e]) => [
            id,
            new T.Matrix4()
              .compose(
                (project.motionRig && this.previewCharacter ? e.targetWorld : e.world).position,
                (project.motionRig && this.previewCharacter ? e.targetWorld : e.world).quaternion,
                (project.motionRig && this.previewCharacter ? e.targetWorld : e.world).scale,
              )
              .toArray(),
          ]),
        ),
        origin,
        rootMotion,
      );
      frames.push({
        frame: f - range.start,
        bones: exportFirst.deformation(this.cameraDelta.clone().invert()),
        bodyBones: world.bones,
        bodyProps: world.props,
        props: Object.fromEntries(
          [...this.projectObjects.entries].map(([id, e]) => [
            id,
            new T.Matrix4()
              .compose(
                (project.motionRig && this.previewCharacter ? e.targetFirst : e.first).position,
                (project.motionRig && this.previewCharacter ? e.targetFirst : e.first).quaternion,
                (project.motionRig && this.previewCharacter ? e.targetFirst : e.first).scale,
              )
              .toArray(),
          ]),
        ),
        camera: {
          matrix: animationCamera(forLayer(project, 'firstPerson'), this.rig, v.camera).toArray(),
          fov: v.camera.fov,
        },
      });
      if (f % 30 === 0) {
        onProgress(((f - range.start) / duration) * 0.4);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    this.apply(0, project, false);
    const geometry = Object.fromEntries(
      [...this.projectObjects.entries].map(([id, e]) => [id, geometryData(e.first)]),
    );
    this.store.patch({ drafts: old.drafts });
    this.apply(old.frame);
    return {
      version: 2,
      rootMotion,
      cameraReference: matrix(CAMERA_REFERENCE).toArray(),
      rig: 'ue5-manny-simple',
      name: project.name,
      fps: project.fps,
      end: duration,
      sourceRange: { start: range.start, end: range.end },
      frames,
      geometry,
      project,
    };
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
  dispose() {
    this.store.restPose = undefined;
    window.removeEventListener('keydown', this.selectionKeys);
    window.removeEventListener('keyup', this.selectionKeys);
    window.removeEventListener('blur', this.clearSelectionModifier);
    this.cancelTrailSample();
    this.clearTrail();
    this.trailJob = undefined;
    this.touch.cancel();
    window.removeEventListener('pose-activate-control', this.activateControl);
    window.removeEventListener('pose-paste-mirrored-keys', this.pasteMirroredKeys);
    window.removeEventListener('pose-link-animation-mirror', this.linkAnimationMirror);
    window.removeEventListener('pose-ground-selection', this.groundSelection);
    setLayerBasisProvider(undefined);
    setBodySourceResolver(undefined);
    this.projectObjects.dispose();
    this.previewObjects.dispose();
    this.disposed = true;
    this.targetLoad++;
    this.clearPreview();
    this.retargetRig?.dispose();
    cancelAnimationFrame(this.raf);
    this.unsubscribe();
    this.observer.disconnect();
    this.orbit.dispose();
    this.gizmo.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown, true);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp, true);
    this.renderer.domElement.removeEventListener('pointermove', this.pointerMove, true);
    this.renderer.domElement.removeEventListener('contextmenu', this.contextMenu);
    this.renderer.domElement.removeEventListener('pointercancel', this.pointerCancel, true);
    this.tooltip.remove();
    this.marquee.remove();
    for (const m of this.markers.values()) m.dispose();
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          this.materialCache.add(m);
      }
    });
    const textures = new Set<T.Texture>();
    for (const m of this.materialCache) {
      for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
      m.dispose();
    }
    for (const texture of textures) texture.dispose();
    this.cursorMarker.traverse((o) => {
      if (o instanceof T.Line) {
        o.geometry.dispose();
        (o.material as T.Material).dispose();
      }
    });
    this.reflections?.dispose();
    this.playerEffects?.dispose();
    this.env.dispose();
    this.backdrop.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

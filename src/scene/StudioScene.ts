import { RestPoseSampler } from './restPose';
import { previewViews } from '../core/previewLinks';
import { controllerConstraints } from '../core/controllerConstraints';
import { animationCamera } from './animationCamera';
import { MotionTrail } from './MotionTrail';
import { tabletPixelRatio } from './renderBudget';
import { isTouch as isAndroid } from '../platform/storage';
import { BodySourceSampler } from './BodySourceSampler';
import { setBodySourceResolver } from '../core/model';
import { setLayerBasisProvider } from '../core/layerSpaces';
import { ProjectProps } from './ProjectProps';
import { isProp } from '../core/assets';
import { prepareMannyMaterial } from './mannyMaterials';
import { ViewportTransformControls } from './ViewportTransformControls';
import * as T from 'three';
import { fullSkinLoader } from './skinInfluences';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MannyRig } from './rig';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { maskedGeometry } from './meshMask';
import { setMainProp } from './props';
import {
  evaluate,
  fromMatrix,
  IDS,
  matrix,
  forLayer,
  layerFrame,
  CAMERA_REFERENCE,
  limbMode,
  controlEnabled,
  clone,
} from '../core/model';
import type { ControlId, Pose, Project } from '../core/model';
import { CONTROLS, isBoneControl, isRotationControl } from '../core/controls';
import { ControlVisual } from './controlVisual';
import shapes from '../../public/assets/controller-shapes.json';
import { playbackFrame } from '../core/loops';
import { boneFollowing } from '../core/boneFollowing';
import type { StudioStore } from '../core/store';
import { ExportScene } from './studio/export';

export class StudioScene extends ExportScene {
  private graphicsLost = false;
  private onFailure: (message: string | null) => void = () => {};
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.graphicsLost = true;
    this.store.endGesture();
    this.store.patch({ playing: false, interacting: false });
    this.onFailure(
      'The graphics context was lost. The view will resume if the browser restores it. You can also retry or download your project.',
    );
  };
  private contextRestored = () => {
    if (this.disposed) return;
    this.graphicsLost = false;
    this.forcePose = true;
    this.drawDirty = true;
    this.onFailure(null);
  };
  protected trails = new MotionTrail({
    add: (line) => this.overlays.add(line),
    key: () => {
      const s = this.store.state;
      return [
        s.revision,
        s.selected,
        s.project?.editing,
        this.previewSignature,
        this.targetLoad,
      ].join(':');
    },
    busy: () => {
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
    },
    current: () => ({ id: this.store.state.selected, project: this.store.state.project }),
    positionAt: (frame, project, id) => {
      this.apply(frame, project);
      return this.markers.get(id)!.position.clone();
    },
    restore: () => this.apply(this.store.state.frame),
    controlVisible: (id) => this.store.controlVisible(id),
    redraw: () => {
      this.drawDirty = true;
    },
  });
  constructor(
    host: HTMLElement,
    store: StudioStore,
    onReady: () => void,
    onFailure?: (message: string | null) => void,
  ) {
    super();
    this.host = host;
    this.store = store;
    this.onReady = onReady;
    if (onFailure) this.onFailure = onFailure;
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
    window.addEventListener('pose-request-selection-anchor', this.requestSelectionAnchor);
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
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.contextRestored);
    this.load();
    this.loop();
  }
  protected async load() {
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
      // Retrying a failed graphics view must not replace the live document,
      // drafts or undo history with an older recovery snapshot.
      if (!this.store.state.ready) await this.store.init(this.restControls);
      this.apply(this.store.state.frame);
      this.onReady();
    } catch (e) {
      if (this.disposed) return;
      this.store.patch({ message: 'Could not load Manny: ' + (e as Error).message });
      this.onFailure('Could not load the character: ' + (e as Error).message);
    }
  }
  override apply(frame: number, project = this.store.state.project, usePreview = true) {
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
    for (const id of this.markers.keys()) {
      const limb = CONTROLS[id].limb,
        fk = !!limb && limbMode(project, limb, frame) === 'fk';
      this.sourceControlWorlds.set(
        id,
        this.controlWorld(id, values, activeRig, first, body.root, fk),
      );
    }
    if (first) this.sourceControlWorlds.set('camera', sourceCamera);
    this.updateControls(frame);
    if (this.fitOnApply) {
      this.fitOnApply = false;
      this.frameScene();
    }
  }
  protected override updateControls(frame: number) {
    const project = this.store.state.project;
    if (!project || !this.rig || !this.bodyRig || this.store.state.retargetMode) {
      this.publishSelectionAnchor();
      return;
    }
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
    this.trails.sync(this.store.state.selected);
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
    this.publishSelectionAnchor();
  }
  /** Publishes a cheap screen-space anchor for the contextual controller ribbon.
   * The event keeps React out of the render loop while still following orbit,
   * playback, multi-selection and committed controller drags. */
  private requestSelectionAnchor = () => {
    this.selectionAnchor = undefined;
    this.publishSelectionAnchor();
  };
  private selectionAnchor?: {
    x: number;
    y: number;
    visible: boolean;
    dragging: boolean;
    playing: boolean;
    scrubbing: boolean;
    gizmoBounds?: { left: number; top: number; right: number; bottom: number };
  };
  /** Protect selected controller outlines as well as the visible gizmo.
   * Picking planes and extended drag guides are not UI obstacles. */
  private selectionGizmoBounds() {
    this.gizmoHelper.updateMatrixWorld(true);
    const camera = this.viewCamera();
    const point = new T.Vector3();
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    const include = () => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.z) > 1) return;
      const x = ((point.x + 1) / 2) * this.width;
      const y = ((1 - point.y) / 2) * this.height;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    };
    for (const id of this.store.state.selection) {
      const marker = this.markers.get(id);
      if (!marker?.visible) continue;
      marker.updateMatrixWorld(true);
      for (const vertex of marker.points) {
        point.copy(vertex).applyMatrix4(marker.matrixWorld).project(camera);
        include();
      }
    }
    if (this.gizmo.object && this.gizmoHelper.visible)
      this.gizmoHelper.traverseVisible((node) => {
        if ('tag' in node && node.tag === 'helper') return;
        const mesh = node as T.Mesh;
        if (!mesh.geometry || !mesh.material) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (!materials.some((material) => material.visible && material.opacity > 0.05)) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        if (!box || box.isEmpty()) return;
        for (let corner = 0; corner < 8; corner++) {
          point
            .set(
              corner & 1 ? box.max.x : box.min.x,
              corner & 2 ? box.max.y : box.min.y,
              corner & 4 ? box.max.z : box.min.z,
            )
            .applyMatrix4(mesh.matrixWorld)
            .project(camera);
          include();
        }
      });
    return Number.isFinite(left) ? { left, top, right, bottom } : undefined;
  }
  private publishSelectionAnchor() {
    const state = this.store.state;
    let visible = false;
    let x = 0;
    let y = 0;
    if (
      !state.gameView &&
      !state.retargetMode &&
      !this.dragging &&
      !state.playing &&
      !state.interacting &&
      state.selection.length
    ) {
      const points = state.selection
        .map((id) => this.markers.get(id))
        .filter((marker): marker is ControlVisual => !!marker && marker.visible)
        .map((marker) => marker.position);
      if (points.length) {
        const center = points
          .reduce((sum, point) => sum.add(point), new T.Vector3())
          .multiplyScalar(1 / points.length);
        const projected = center.project(this.viewCamera());
        visible =
          projected.z >= -1 &&
          projected.z <= 1 &&
          projected.x >= -1 &&
          projected.x <= 1 &&
          projected.y >= -1 &&
          projected.y <= 1 &&
          Number.isFinite(projected.x) &&
          Number.isFinite(projected.y);
        if (visible) {
          x = (projected.x + 1) * 0.5 * this.width;
          y = (1 - projected.y) * 0.5 * this.height;
        }
      }
    }
    const detail = {
      x,
      y,
      visible,
      dragging: this.dragging,
      playing: state.playing,
      scrubbing: state.interacting,
      gizmoBounds: visible ? this.selectionGizmoBounds() : undefined,
    };
    const previous = this.selectionAnchor;
    // Idle scenes and playback need no repeated DOM anchor work. Panel layout
    // changes are handled by the ribbon's own surface observers.
    if (
      previous &&
      previous.visible === visible &&
      previous.dragging === detail.dragging &&
      previous.playing === detail.playing &&
      previous.scrubbing === detail.scrubbing &&
      ((!previous.gizmoBounds && !detail.gizmoBounds) ||
        (previous.gizmoBounds &&
          detail.gizmoBounds &&
          Math.abs(previous.gizmoBounds.left - detail.gizmoBounds.left) < 0.25 &&
          Math.abs(previous.gizmoBounds.top - detail.gizmoBounds.top) < 0.25 &&
          Math.abs(previous.gizmoBounds.right - detail.gizmoBounds.right) < 0.25 &&
          Math.abs(previous.gizmoBounds.bottom - detail.gizmoBounds.bottom) < 0.25)) &&
      Math.abs(previous.x - x) < 0.25 &&
      Math.abs(previous.y - y) < 0.25
    )
      return;
    this.selectionAnchor = detail;
    window.dispatchEvent(
      new CustomEvent('pose-selection-anchor', {
        detail,
      }),
    );
  }
  protected loop = () => {
    if (this.disposed) return;
    try {
      if (!this.graphicsLost) this.drawFrame();
    } catch (error) {
      this.store.patch({ playing: false, interacting: false });
      this.onFailure('The 3D view stopped: ' + (error as Error).message);
      return;
    }
    this.raf = requestAnimationFrame(this.loop);
  };
  private drawFrame() {
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
    if (this.trails.enabled) this.trails.update();
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
  }
  /** Resolves once the open project's props and characters are loaded, its shaders
   * compiled and a frame drawn: when opening a project has visibly finished. */
  async settled(timeout = 30000) {
    const frame = () => new Promise((done) => requestAnimationFrame(done)),
      work = (async () => {
        await frame();
        const project = this.store.state.project;
        if (project) {
          this.store.patch({
            opening: this.store.state.opening && {
              ...this.store.state.opening,
              stage: 'Loading props and characters',
            },
          });
          await this.projectObjects.ready(project).catch(() => {});
        }
        while (this.store.state.retargetLoading && !this.disposed)
          await new Promise((done) => setTimeout(done, 50));
        this.store.patch({
          opening: this.store.state.opening && {
            ...this.store.state.opening,
            stage: 'Preparing the viewport',
          },
        });
        await this.renderer.compileAsync(this.scene, this.camera).catch(() => {});
        await frame();
        await frame();
      })();
    await Promise.race([work, new Promise((done) => setTimeout(done, timeout))]);
  }
  toggleTrail() {
    this.trails.toggle();
  }
  dispose() {
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.contextRestored);
    this.store.restPose = undefined;
    window.removeEventListener('keydown', this.selectionKeys);
    window.removeEventListener('keyup', this.selectionKeys);
    window.removeEventListener('blur', this.clearSelectionModifier);
    this.trails.dispose();
    this.touch.cancel();
    window.removeEventListener('pose-activate-control', this.activateControl);
    window.removeEventListener('pose-paste-mirrored-keys', this.pasteMirroredKeys);
    window.removeEventListener('pose-link-animation-mirror', this.linkAnimationMirror);
    window.removeEventListener('pose-ground-selection', this.groundSelection);
    window.removeEventListener('pose-request-selection-anchor', this.requestSelectionAnchor);
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

import { animationCamera } from '../animationCamera';
import { projectProps } from '../../core/assets';
import * as T from 'three';
import { geometryData } from '../props';
import { evaluate, matrix, forLayer, layerFrame, CAMERA_REFERENCE, clone } from '../../core/model';
import type { Project } from '../../core/model';
import { rootMotionFrame } from '../../core/rootMotion';
import type { RootMotionMode } from '../../core/rootMotion';
import { recordingFrame } from '../../core/recording';
import type { RecordingPlan } from '../../core/recording';
import { InputScene } from './input';

/** Recording and baking animation for export. */
export abstract class ExportScene extends InputScene {
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
      const v = evaluate(forLayer(project, 'firstPerson'), layerFrame(project, 'firstPerson', f));
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
}

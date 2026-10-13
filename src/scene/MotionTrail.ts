import * as T from 'three';
import type { ControlId, Project } from '../core/model';
import { TrailSamples } from './trailSampling';

export interface MotionTrailHost {
  /** Add the finished line to the overlay layer. */
  add(line: T.Line): void;
  /** Changes whenever the trail must be sampled again. */
  key(): string;
  /** True while sampling would disturb playback, a gesture or a recording. */
  busy(): boolean;
  current(): { id: ControlId; project: Project | null };
  /** Pose the scene at `frame` and return the control's world position. */
  positionAt(frame: number, project: Project, id: ControlId): T.Vector3;
  /** Put the live pose back after sampling. */
  restore(): void;
  controlVisible(id: ControlId): boolean;
  redraw(): void;
}

/** Draws the selected control's path, sampling one pose per idle slice. */
export class MotionTrail {
  enabled = false;
  private key = '';
  private job?: { key: string; id: ControlId; project: Project; samples: TrailSamples<T.Vector3> };
  private idle = 0;
  private line?: T.Line;
  private control?: ControlId;
  private disposed = false;

  constructor(private host: MotionTrailHost) {}

  toggle() {
    this.enabled = !this.enabled;
    this.key = '';
    this.host.redraw();
    this.update();
  }

  /** Show the line only for the control it was sampled for. */
  sync(selected: ControlId) {
    if (this.line)
      this.line.visible = this.control === selected && this.host.controlVisible(selected);
  }

  update() {
    if (!this.enabled || !this.host.current().project) {
      this.cancel();
      this.job = undefined;
      this.key = '';
      this.clear();
      return;
    }
    const key = this.host.key();
    if (this.job && this.job.key !== key) {
      this.cancel();
      this.job = undefined;
    }
    if (this.key === key || this.host.busy()) {
      this.cancel();
      return;
    }
    if (!this.job) {
      const { id, project } = this.host.current();
      this.job = { key, id, project: project!, samples: new TrailSamples(project!.end) };
    }
    if (this.idle) return;
    this.idle = requestIdleCallback(
      (deadline) => {
        this.idle = 0;
        if (this.disposed || !this.enabled) return;
        const job = this.job;
        if (!job || job.key !== this.host.key() || this.host.busy()) return;
        if (deadline.timeRemaining() < 1 && !deadline.didTimeout) {
          this.update();
          return;
        }
        // One pose per idle slice, always restore the live scene before yielding.
        // Never feed a sampled pose into a pointer gesture or a playback frame.
        try {
          job.samples.step((frame) => this.host.positionAt(frame, job.project, job.id));
        } finally {
          this.host.restore();
        }
        if (job.samples.done) {
          this.clear();
          this.line = new T.Line(
            new T.BufferGeometry().setFromPoints(job.samples.points),
            new T.LineBasicMaterial({ color: 0x55bfd3, transparent: true, opacity: 0.6 }),
          );
          this.control = job.id;
          this.line.visible = this.host.controlVisible(job.id);
          this.host.add(this.line);
          this.key = job.key;
          this.job = undefined;
          this.host.redraw();
        } else this.update();
      },
      { timeout: 500 },
    );
  }

  dispose() {
    this.disposed = true;
    this.cancel();
    this.clear();
    this.job = undefined;
  }

  private clear() {
    if (!this.line) return;
    this.line.removeFromParent();
    this.line.geometry.dispose();
    (this.line.material as T.Material).dispose();
    this.line = undefined;
  }

  private cancel() {
    if (!this.idle) return;
    cancelIdleCallback(this.idle);
    this.idle = 0;
  }
}

// Keep the original two-frame resolution and include the last frame for odd
// clip lengths. Sampling is incremental; long clips never become one big task.
export class TrailSamples<T> {
  private next = 0;
  readonly points: T[] = [];
  constructor(readonly end: number) {}
  get done() {
    return this.next > this.end;
  }
  step(sample: (frame: number) => T) {
    if (this.done) return;
    const frame = this.next;
    this.points.push(sample(frame));
    this.next = frame === this.end ? this.end + 1 : Math.min(this.end, frame + 2);
  }
}

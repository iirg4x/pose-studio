// Keep editing fill bounded independently of export resolution.
export function tabletPixelRatio(width: number, height: number, dpr: number, quality = 1.25) {
  return Math.max(0.65, Math.min(dpr, quality, Math.sqrt(2100000 / Math.max(1, width * height))));
}
// Observe rAF even while the scene is idle. A low percentile finds the display
// cadence without mistaking occasional missed frames for a slower screen.
export class DisplayCadence {
  milliseconds = 1000 / 60;
  private previous = 0;
  private samples: number[] = [];
  observe(now: number) {
    const interval = now - this.previous;
    this.previous = now;
    if (interval < 3 || interval > 50) return;
    this.samples.push(interval);
    if (this.samples.length >= 60) {
      const sorted = [...this.samples].sort((a, b) => a - b);
      this.milliseconds = Math.max(
        1000 / 240,
        Math.min(1000 / 30, sorted[Math.floor(sorted.length * 0.2)]),
      );
      this.samples = [];
    }
  }
  reset() {
    this.previous = 0;
    this.samples = [];
  }
}
export class RenderBudget {
  quality = 1.25;
  private slow = 0;
  private fast = 0;
  sample(milliseconds: number, frameBudget = 1000 / 60) {
    if (milliseconds > frameBudget * 1.35) {
      this.slow++;
      this.fast = 0;
    } else if (milliseconds < frameBudget * 0.85) {
      this.fast++;
      this.slow = 0;
    } else this.slow = this.fast = 0;
    if (this.slow >= 40 && this.quality > 0.75) {
      this.quality = Math.max(0.75, this.quality - 0.125);
      this.slow = 0;
      return true;
    }
    if (this.fast >= 180 && this.quality < 1.25) {
      this.quality = Math.min(1.25, this.quality + 0.125);
      this.fast = 0;
      return true;
    }
    return false;
  }
}

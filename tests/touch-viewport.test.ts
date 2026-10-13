import { describe, expect, it } from 'vitest';
import { measureTouchViewport } from '../src/platform/touchViewport';

describe('touch viewport sizing', () => {
  it('uses the visual viewport at normal page scale, including browser offsets', () => {
    expect(
      measureTouchViewport({
        innerWidth: 390,
        innerHeight: 844,
        visualViewport: {
          width: 390,
          height: 780,
          offsetLeft: 2,
          offsetTop: 24,
          scale: 1,
        },
      }),
    ).toEqual({ width: 390, height: 780, offsetLeft: 2, offsetTop: 24 });
  });

  it('falls back to the layout viewport when zoom changes visual coordinates', () => {
    expect(
      measureTouchViewport({
        innerWidth: 390,
        innerHeight: 844,
        visualViewport: {
          width: 260,
          height: 563,
          offsetLeft: 60,
          offsetTop: 40,
          scale: 1.5,
        },
      }),
    ).toEqual({ width: 390, height: 844, offsetLeft: 0, offsetTop: 0 });
  });

  it('falls back when the visual viewport is unavailable or invalid', () => {
    expect(
      measureTouchViewport({ innerWidth: 412, innerHeight: 915, visualViewport: null }),
    ).toEqual({ width: 412, height: 915, offsetLeft: 0, offsetTop: 0 });
    expect(
      measureTouchViewport({
        innerWidth: 412,
        innerHeight: 915,
        visualViewport: { width: 0, height: 0, scale: 1 },
      }),
    ).toEqual({ width: 412, height: 915, offsetLeft: 0, offsetTop: 0 });
  });
});

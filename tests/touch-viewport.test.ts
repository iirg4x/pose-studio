import { describe, expect, it } from 'vitest';
import { measureTouchViewport } from '../src/platform/touchViewport';

describe('touch viewport sizing', () => {
  it('uses a shorter visible portrait viewport when browser chrome is present', () => {
    expect(
      measureTouchViewport({
        innerWidth: 390,
        innerHeight: 844,
        visualViewport: { width: 390, height: 780, scale: 1 },
      }),
    ).toEqual({ width: 390, height: 780, offsetLeft: 0, offsetTop: 0 });
  });

  it('uses a shorter visible landscape viewport when the bottom inset is present', () => {
    expect(
      measureTouchViewport({
        innerWidth: 852,
        innerHeight: 393,
        visualViewport: { width: 852, height: 353, scale: 1 },
      }),
    ).toEqual({ width: 852, height: 353, offsetLeft: 0, offsetTop: 0 });
  });

  it('tracks visual viewport offsets for an inset or panned viewport', () => {
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

  it('shrinks for the keyboard and returns to the full visible viewport after it closes', () => {
    const keyboard = measureTouchViewport({
      innerWidth: 393,
      innerHeight: 759,
      visualViewport: { width: 393, height: 430, scale: 1 },
    });
    const recovered = measureTouchViewport({
      innerWidth: 393,
      innerHeight: 759,
      visualViewport: { width: 393, height: 759, scale: 1 },
    });

    expect(keyboard).toEqual({ width: 393, height: 430, offsetLeft: 0, offsetTop: 0 });
    expect(recovered).toEqual({ width: 393, height: 759, offsetLeft: 0, offsetTop: 0 });
  });

  it('uses the layout viewport during pinch zoom', () => {
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
    expect(
      measureTouchViewport({
        innerWidth: 412,
        innerHeight: 915,
        visualViewport: { width: 412, height: Number.NaN, scale: 1 },
      }),
    ).toEqual({ width: 412, height: 915, offsetLeft: 0, offsetTop: 0 });
  });

  it('rejects an invalid scale instead of using transformed visual coordinates', () => {
    expect(
      measureTouchViewport({
        innerWidth: 412,
        innerHeight: 915,
        visualViewport: { width: 412, height: 915, scale: Number.POSITIVE_INFINITY },
      }),
    ).toEqual({ width: 412, height: 915, offsetLeft: 0, offsetTop: 0 });
  });
});

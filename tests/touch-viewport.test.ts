import { describe, expect, it } from 'vitest';
import { detectTouchKeyboard, measureTouchViewport } from '../src/platform/touchViewport';

describe('touch viewport sizing', () => {
  it('detects a keyboard when both layout and visual heights shrink', () => {
    expect(
      detectTouchKeyboard({
        focused: true,
        wasOpen: false,
        closedHeight: 759,
        previousInnerHeight: 759,
        previousVisualHeight: 759,
        innerHeight: 520,
        visualHeight: 430,
      }),
    ).toBe(true);
    expect(
      detectTouchKeyboard({
        focused: true,
        wasOpen: true,
        closedHeight: 759,
        previousInnerHeight: 520,
        previousVisualHeight: 430,
        innerHeight: 759,
        visualHeight: 759,
      }),
    ).toBe(false);
  });

  it('keeps a keyboard state through a rotation without a new closed baseline', () => {
    expect(
      detectTouchKeyboard({
        focused: true,
        wasOpen: true,
        previousInnerHeight: 759,
        previousVisualHeight: 430,
        innerHeight: 353,
        visualHeight: 250,
      }),
    ).toBe(true);
  });

  it('closes a rotated keyboard state against a provisional screen baseline', () => {
    expect(
      detectTouchKeyboard({
        focused: true,
        wasOpen: true,
        closedHeight: 393,
        previousInnerHeight: 300,
        previousVisualHeight: 300,
        innerHeight: 350,
        visualHeight: 350,
      }),
    ).toBe(false);
  });

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

  it('fills an installed iPhone PWA to the oriented screen while the keyboard is closed', () => {
    expect(
      measureTouchViewport({
        innerWidth: 393,
        innerHeight: 759,
        visualViewport: {
          width: 393,
          height: 759,
          offsetTop: 0,
          scale: 1,
        },
        standaloneIPhone: true,
        fullscreenScreen: { width: 393, height: 852 },
      }),
    ).toEqual({ width: 393, height: 852, offsetLeft: 0, offsetTop: 0 });
    expect(
      measureTouchViewport({
        innerWidth: 852,
        innerHeight: 353,
        visualViewport: { width: 852, height: 353, scale: 1 },
        standaloneIPhone: true,
        fullscreenScreen: { width: 393, height: 852 },
      }),
    ).toEqual({ width: 852, height: 393, offsetLeft: 0, offsetTop: 0 });
    expect(
      measureTouchViewport({
        innerWidth: 393,
        innerHeight: 852,
        visualViewport: null,
        standaloneIPhone: true,
        fullscreenScreen: { width: 393, height: 852 },
      }),
    ).toEqual({ width: 393, height: 852, offsetLeft: 0, offsetTop: 0 });
  });

  it('returns to the visible viewport while an iPhone keyboard is open', () => {
    expect(
      measureTouchViewport({
        innerWidth: 393,
        innerHeight: 759,
        visualViewport: { width: 393, height: 430, offsetTop: 0, scale: 1 },
        standaloneIPhone: true,
        fullscreenScreen: { width: 393, height: 852 },
        keyboardOpen: true,
      }),
    ).toEqual({ width: 393, height: 430, offsetLeft: 0, offsetTop: 0 });
  });

  it('does not apply physical screen sizing to iPad or ordinary browser viewports', () => {
    expect(
      measureTouchViewport({
        innerWidth: 744,
        innerHeight: 1050,
        visualViewport: { width: 744, height: 980, scale: 1 },
        fullscreenScreen: { width: 834, height: 1194 },
      }),
    ).toEqual({ width: 744, height: 980, offsetLeft: 0, offsetTop: 0 });
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

import { describe, expect, it } from 'vitest';
import {
  combinedOpacity,
  paintsAbove,
  rectanglesToClipPath,
  rectanglesToMaskImage,
  subtractRectangles,
} from '../src/hooks/surfaceOcclusion';

describe('surface occlusion', () => {
  it('retains four non-overlapping regions around an interior overlap', () => {
    expect(
      subtractRectangles({ left: 0, top: 0, right: 100, bottom: 80 }, [
        { left: 20, top: 10, right: 70, bottom: 50 },
      ]),
    ).toEqual([
      { left: 0, top: 0, right: 100, bottom: 10 },
      { left: 0, top: 50, right: 100, bottom: 80 },
      { left: 0, top: 10, right: 20, bottom: 50 },
      { left: 70, top: 10, right: 100, bottom: 50 },
    ]);
  });

  it('does not restore pixels where overlapping occluders intersect', () => {
    const pieces = subtractRectangles({ left: 0, top: 0, right: 100, bottom: 100 }, [
      { left: 10, top: 10, right: 60, bottom: 60 },
      { left: 40, top: 40, right: 90, bottom: 90 },
    ]);
    const pointVisible = (x: number, y: number) =>
      pieces.some(
        (piece) => x >= piece.left && x < piece.right && y >= piece.top && y < piece.bottom,
      );

    expect(pointVisible(20, 20)).toBe(false);
    expect(pointVisible(50, 50)).toBe(false);
    expect(pointVisible(80, 80)).toBe(false);
    expect(pointVisible(5, 5)).toBe(true);
  });

  it('clips edge overlaps and serializes retained rectangles as one path', () => {
    const pieces = subtractRectangles({ left: 0, top: 0, right: 100, bottom: 80 }, [
      { left: -20, top: 20, right: 30, bottom: 100 },
    ]);
    expect(pieces).toEqual([
      { left: 0, top: 0, right: 100, bottom: 20 },
      { left: 30, top: 20, right: 100, bottom: 80 },
    ]);
    expect(rectanglesToClipPath(pieces)).toBe('path("M0 0H100V20H0ZM30 20H100V80H30Z")');
  });

  it('only treats a surface earlier in rendered paint order as an occluder', () => {
    const order = ['menu-label', 'menu', 'inspector-field', 'inspector'];
    expect(
      paintsAbove(
        order,
        (item) => item === 'menu' || item === 'menu-label',
        (item) => item === 'inspector' || item === 'inspector-field',
      ),
    ).toBe(true);
    expect(
      paintsAbove(
        order,
        (item) => item === 'inspector' || item === 'inspector-field',
        (item) => item === 'menu' || item === 'menu-label',
      ),
    ).toBe(false);
  });

  it('encodes transition opacity into a local alpha mask hole', () => {
    const mask = rectanglesToMaskImage(100, 80, [
      { rect: { left: 20, top: 10, right: 70, bottom: 50 }, opacity: 0.35 },
    ]);
    const svg = decodeURIComponent(mask.slice('url("data:image/svg+xml,'.length, -2));
    expect(svg).toContain('viewBox="0 0 100 80"');
    expect(svg).toContain('x="20" y="10" width="50" height="40"');
    expect(svg).toContain('fill-opacity="0.35"');
  });

  it('combines a dialog opacity with its fading overlay ancestors', () => {
    expect(combinedOpacity([1, 0.6, 0.5])).toBeCloseTo(0.3);
    expect(combinedOpacity([1, 1])).toBe(1);
  });
});

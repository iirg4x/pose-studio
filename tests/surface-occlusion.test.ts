import { describe, expect, it } from 'vitest';
import {
  clipSurfaceRect,
  combinedOpacity,
  inflateSurfaceRect,
  parseBorderRadii,
  parseBoxShadowInsets,
  parseCssColorAlpha,
  paintsAbove,
  rectanglesToClipPath,
  rectanglesToMaskImage,
  roundedRectanglePath,
  subtractRectangles,
} from '../src/hooks/surfaceOcclusion';

describe('surface occlusion', () => {
  it('clips an overlay to every scroll ancestor before it reaches lower docks', () => {
    expect(
      clipSurfaceRect({ left: 305, top: 52, right: 360, bottom: 472 }, [
        { left: 304, top: 52, right: 360, bottom: 230 },
        { left: 0, top: 52, right: 640, bottom: 230 },
      ]),
    ).toEqual({ left: 305, top: 52, right: 360, bottom: 230 });
    expect(
      clipSurfaceRect({ left: 305, top: 240, right: 360, bottom: 472 }, [
        { left: 304, top: 52, right: 360, bottom: 230 },
      ]),
    ).toBeNull();
  });

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

  it('keeps rounded overlay corners while inflating for a directional shadow', () => {
    const shadow = parseBoxShadowInsets('rgba(0, 0, 0, 0.2) 0px 8px 24px');
    expect(shadow).toEqual({ left: 24, top: 16, right: 24, bottom: 32 });

    const rect = inflateSurfaceRect({ left: 20, top: 10, right: 120, bottom: 70 }, shadow);
    expect(rect).toEqual({ left: -4, top: -6, right: 144, bottom: 102 });
    const path = roundedRectanglePath({ left: 0, top: 0, right: 100, bottom: 60 }, 12);
    expect(path.startsWith('M12 0')).toBe(true);
    expect(path).toContain('C');
    expect(path).not.toContain('H');
  });

  it('resolves percentage and asymmetric border radii to the surface size', () => {
    const radii = parseBorderRadii(
      {
        borderRadius: '0',
        borderTopLeftRadius: '10% 20%',
        borderTopRightRadius: '4px 8px',
        borderBottomRightRadius: '0',
        borderBottomLeftRadius: '0',
      },
      100,
      50,
    );
    expect(radii.topLeft).toEqual({ x: 10, y: 10 });
    expect(radii.topRight).toEqual({ x: 4, y: 8 });
  });

  it('serializes shaped cuts as paths so the mask does not become a giant rectangle', () => {
    const path = roundedRectanglePath({ left: 4, top: 6, right: 64, bottom: 46 }, 10);
    const mask = rectanglesToMaskImage(100, 80, [
      { rect: { left: 4, top: 6, right: 64, bottom: 46 }, path, opacity: 1 },
    ]);
    const svg = decodeURIComponent(mask.slice('url("data:image/svg+xml,'.length, -2));
    expect(svg).toContain(`<path d="${path}"`);
    expect(svg).not.toContain('<rect x="4" y="6" width="60" height="40"');
  });

  it('distinguishes solid desktop dock colors from translucent touch surfaces', () => {
    expect(parseCssColorAlpha('rgb(25 39 53)')).toBe(1);
    expect(parseCssColorAlpha('rgba(18, 29, 40, 0.7)')).toBeCloseTo(0.7);
    expect(parseCssColorAlpha('rgb(18 29 40 / 70%)')).toBeCloseTo(0.7);
    expect(parseCssColorAlpha('transparent')).toBe(0);
  });
});

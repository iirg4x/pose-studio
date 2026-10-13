import { describe, expect, it } from 'vitest';
import { beginCurveKeyDrag, curveKeyDragDelta } from '../src/core/curveDrag';
import { translateCurveKeys } from '../src/core/timelineChannels';
import type { CurveKey } from '../src/core/curves';
const keys: CurveKey[] = [
  { frame: 10, value: 5, interpolation: 'bezier', handle: 'aligned', left: [-3, 0], right: [3, 0] },
];
describe('curve key drag intent', () => {
  it('does not edit on tap jitter and consumes the deadzone without a jump', () => {
    expect(beginCurveKeyDrag(2, -3, 10)).toBeNull();
    expect(beginCurveKeyDrag(0, -10, 10)).toBeNull();
    const d = beginCurveKeyDrag(1, -10.01, 10)!;
    expect(d.axis).toBe('y');
    expect(Math.abs(curveKeyDragDelta(d, 1, -10.01).y)).toBeLessThan(0.02);
  });
  it('keeps frame exactly unchanged throughout a vertical drag with lateral drift', () => {
    const d = beginCurveKeyDrag(2, -11, 10)!;
    expect(d.axis).toBe('y');
    for (const [dx, dy] of [
      [2, -11],
      [8, -40],
      [-12, -90],
      [4, -30],
    ]) {
      const delta = curveKeyDragDelta(d, dx, dy),
        moved = translateCurveKeys(keys, [10], delta.x * 3, -delta.y / 10, 100)!;
      expect(moved.keys[0].frame).toBe(10);
      expect(moved.keys[0].value).not.toBe(5);
    }
  });
  it('keeps value exactly unchanged throughout horizontal retiming with vertical drift', () => {
    const d = beginCurveKeyDrag(-11, 1, 10)!;
    expect(d.axis).toBe('x');
    for (const [dx, dy] of [
      [-15, 5],
      [-25, -9],
      [-35, 12],
    ]) {
      const delta = curveKeyDragDelta(d, dx, dy),
        moved = translateCurveKeys(keys, [10], delta.x / 4, -delta.y * 10, 100)!;
      expect(moved.keys[0].value).toBe(5);
      expect(moved.keys[0].frame).toBeLessThan(10);
    }
  });
  it('allows an intentional diagonal move and retains aligned tangent offsets', () => {
    const d = beginCurveKeyDrag(10, -10, 6)!;
    expect(d.axis).toBe('free');
    const delta = curveKeyDragDelta(d, 30, -20),
      moved = translateCurveKeys(keys, [10], delta.x, -delta.y, 100)!;
    expect(moved.keys[0].frame).toBeGreaterThan(10);
    expect(moved.keys[0].value).toBeGreaterThan(5);
    expect(moved.keys[0].left).toEqual(keys[0].left);
    expect(moved.keys[0].right).toEqual(keys[0].right);
  });
  it('honors explicit time/value locks and ignores motion solely across the locked axis', () => {
    expect(beginCurveKeyDrag(3, 50, 6, 'x')).toBeNull();
    expect(beginCurveKeyDrag(50, 3, 6, 'y')).toBeNull();
    const d = beginCurveKeyDrag(30, 20, 6, 'y')!;
    expect(d.axis).toBe('y');
    expect(curveKeyDragDelta(d, 70, 30)).toEqual({ x: 0, y: 24 });
  });
});

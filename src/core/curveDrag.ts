export type CurveDragAxis = 'x' | 'y' | 'free';
export interface CurveKeyDrag {
  axis: CurveDragAxis;
  offsetX: number;
  offsetY: number;
}
/** Resolve intent in screen pixels before converting to frames/value units.
 * Keep that decision for the entire gesture, so hand jitter cannot change the
 * other coordinate. A diagonal start deliberately leaves both axes available.
 * Consume the deadzone to avoid jumping on the first editing event. */
export function beginCurveKeyDrag(
  dx: number,
  dy: number,
  threshold: number,
  constraint: 'x' | 'y' | null = null,
): CurveKeyDrag | null {
  const distance =
    constraint === 'x' ? Math.abs(dx) : constraint === 'y' ? Math.abs(dy) : Math.hypot(dx, dy);
  if (distance <= threshold) return null;
  const axis =
    constraint ??
    (Math.abs(dx) >= Math.abs(dy) * 2 ? 'x' : Math.abs(dy) >= Math.abs(dx) * 2 ? 'y' : 'free');
  const radius = Math.hypot(dx, dy),
    amount = axis === 'free' ? threshold / radius : threshold / Math.abs(axis === 'x' ? dx : dy);
  return { axis, offsetX: dx * amount, offsetY: dy * amount };
}
export function curveKeyDragDelta(drag: CurveKeyDrag, dx: number, dy: number) {
  return {
    x: drag.axis === 'y' ? 0 : dx - drag.offsetX,
    y: drag.axis === 'x' ? 0 : dy - drag.offsetY,
  };
}

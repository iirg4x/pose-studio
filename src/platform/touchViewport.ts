export interface TouchViewportSource {
  innerWidth: number;
  innerHeight: number;
  visualViewport?: {
    width: number;
    height: number;
    offsetLeft?: number;
    offsetTop?: number;
    scale?: number;
  } | null;
}

export interface TouchViewportSize {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
}

function positiveFinite(value: number | undefined | null): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

/**
 * Read the visible CSS viewport without relying on the device's physical screen.
 * A visual viewport is useful while the browser is in a standalone PWA and while
 * the software keyboard is open, but page zoom changes its coordinate space. In
 * that case the layout viewport is the stable fallback.
 */
export function measureTouchViewport(source: TouchViewportSource): TouchViewportSize {
  const visual = source.visualViewport;
  const scale = visual?.scale;
  const useVisual =
    !!visual &&
    positiveFinite(visual.width) &&
    positiveFinite(visual.height) &&
    (scale == null || !Number.isFinite(scale) || Math.abs(scale - 1) <= 0.01);
  const width = useVisual && visual ? visual.width : source.innerWidth;
  const height = useVisual && visual ? visual.height : source.innerHeight;
  const offsetLeft =
    useVisual && visual && Number.isFinite(visual.offsetLeft)
      ? Math.max(0, visual.offsetLeft ?? 0)
      : 0;
  const offsetTop =
    useVisual && visual && Number.isFinite(visual.offsetTop)
      ? Math.max(0, visual.offsetTop ?? 0)
      : 0;

  return {
    width: positiveFinite(width) ? width : 0,
    height: positiveFinite(height) ? height : 0,
    offsetLeft,
    offsetTop,
  };
}

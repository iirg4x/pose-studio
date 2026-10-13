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
  /** Only set for an installed iPhone/iPod PWA. iPad and regular browsers stay visual. */
  standaloneIPhone?: boolean;
  fullscreenScreen?: {
    width: number;
    height: number;
  } | null;
  keyboardOpen?: boolean;
}

export interface TouchViewportSize {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
}

export interface TouchKeyboardMeasurement {
  focused: boolean;
  wasOpen: boolean;
  closedHeight?: number;
  previousInnerHeight: number;
  previousVisualHeight: number;
  innerHeight: number;
  visualHeight: number;
}

const touchKeyboardShortfall = 120;

function positiveFinite(value: number | undefined | null): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function orientedScreen(source: TouchViewportSource): { width: number; height: number } | null {
  const screen = source.fullscreenScreen;
  if (
    !source.standaloneIPhone ||
    !screen ||
    !positiveFinite(screen.width) ||
    !positiveFinite(screen.height)
  )
    return null;

  const landscape = source.innerWidth > source.innerHeight;
  const long = Math.max(screen.width, screen.height);
  const short = Math.min(screen.width, screen.height);
  return landscape ? { width: long, height: short } : { width: short, height: long };
}

/** Detect a keyboard resize without replacing the closed baseline during its animation. */
export function detectTouchKeyboard(measurement: TouchKeyboardMeasurement): boolean {
  const closedHeight = measurement.closedHeight;
  const baselineShortfall =
    closedHeight == null
      ? 0
      : Math.max(
          0,
          closedHeight - measurement.innerHeight,
          closedHeight - measurement.visualHeight,
        );
  const transitionShortfall = Math.max(
    0,
    measurement.previousInnerHeight - measurement.innerHeight,
    measurement.previousVisualHeight - measurement.visualHeight,
  );
  const recovered =
    measurement.innerHeight >= measurement.previousInnerHeight + touchKeyboardShortfall / 2 ||
    measurement.visualHeight >= measurement.previousVisualHeight + touchKeyboardShortfall / 2;
  const baselineOpen = baselineShortfall >= touchKeyboardShortfall;
  const openingWithoutBaseline =
    closedHeight == null && measurement.wasOpen && transitionShortfall >= touchKeyboardShortfall;
  const continuingWithoutBaseline = closedHeight == null && measurement.wasOpen && !recovered;
  return (
    (measurement.focused || measurement.wasOpen) &&
    (baselineOpen || openingWithoutBaseline || continuingWithoutBaseline)
  );
}

/**
 * Read the visible CSS viewport. Installed iPhone PWAs need the oriented screen CSS
 * size while their keyboard is closed because iOS reports the safe-area-shortened
 * visual viewport; every other browser stays on the visual/layout viewport.
 */
export function measureTouchViewport(source: TouchViewportSource): TouchViewportSize {
  const visual = source.visualViewport;
  const scale = visual?.scale;
  const useVisual =
    !!visual &&
    positiveFinite(visual.width) &&
    positiveFinite(visual.height) &&
    (scale == null || !Number.isFinite(scale) || Math.abs(scale - 1) <= 0.01);
  const fullscreen = orientedScreen(source);
  const useFullscreen = !!fullscreen && !source.keyboardOpen && (!visual || useVisual);
  const width =
    useFullscreen && fullscreen
      ? fullscreen.width
      : useVisual && visual
        ? visual.width
        : source.innerWidth;
  const height =
    useFullscreen && fullscreen
      ? fullscreen.height
      : useVisual && visual
        ? visual.height
        : source.innerHeight;
  const offsetLeft =
    !useFullscreen && useVisual && visual && Number.isFinite(visual.offsetLeft)
      ? Math.max(0, visual.offsetLeft ?? 0)
      : 0;
  const offsetTop =
    !useFullscreen && useVisual && visual && Number.isFinite(visual.offsetTop)
      ? Math.max(0, visual.offsetTop ?? 0)
      : 0;

  return {
    width: positiveFinite(width) ? width : 0,
    height: positiveFinite(height) ? height : 0,
    offsetLeft,
    offsetTop,
  };
}

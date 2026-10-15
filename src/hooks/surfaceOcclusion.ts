import { useLayoutEffect } from 'react';

export type SurfaceRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type SurfaceInsets = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type SurfaceCorner = {
  x: number;
  y: number;
};

export type SurfaceRadii = {
  topLeft: SurfaceCorner;
  topRight: SurfaceCorner;
  bottomRight: SurfaceCorner;
  bottomLeft: SurfaceCorner;
};

const zeroInsets = (): SurfaceInsets => ({ left: 0, top: 0, right: 0, bottom: 0 });

const finite = (value: number) => (Number.isFinite(value) ? value : 0);

const positive = (value: number) => Math.max(0, finite(value));

const clamp01 = (value: number) => Math.max(0, Math.min(1, finite(value)));

const parseAlphaToken = (value: string) => {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed)) return 1;
  return clamp01(value.trim().endsWith('%') ? parsed / 100 : parsed);
};

/** Return the alpha component of a serialized CSS color. */
export function parseCssColorAlpha(value: string | undefined) {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized || normalized === 'transparent') return 0;
  const functionBody = normalized.match(
    /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/,
  )?.[1];
  if (!functionBody) return 1;
  const slash = functionBody.lastIndexOf('/');
  if (slash >= 0) return parseAlphaToken(functionBody.slice(slash + 1));
  const commaParts = functionBody.split(',');
  return commaParts.length >= 4 ? parseAlphaToken(commaParts[commaParts.length - 1]) : 1;
}

const baseSelector = [
  '.area-side',
  '.tablet-sheet',
  '.controller-ribbon',
  '.timeline',
  '.library-panel',
  '.library-popover',
  '.transport',
  '.touch-transport',
  '.time-slider',
  '.statusbar',
].join(',');

const floatingSelector = [
  '.studio-failure-notice',
  '.tablet-sheet',
  '.active-layer-menu',
  '[data-motion="popover"]',
  '[data-motion="context"]',
  '[role="menu"]',
  '.desktop-command-menu',
  '.touch-command-menu',
  '.file-menu',
  '.library-popover',
  '.controller-ribbon',
  '[role="dialog"]',
  'dialog[open]',
].join(',');

const valid = (rect: SurfaceRect) => rect.right > rect.left && rect.bottom > rect.top;

const intersection = (a: SurfaceRect, b: SurfaceRect): SurfaceRect | null => {
  const rect = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return valid(rect) ? rect : null;
};

/** Intersect a surface with every ancestor clip rectangle in paint order. */
export function clipSurfaceRect(
  rect: SurfaceRect,
  clips: readonly SurfaceRect[],
): SurfaceRect | null {
  return clips.reduce<SurfaceRect | null>(
    (visibleRect, clip) => (visibleRect ? intersection(visibleRect, clip) : null),
    rect,
  );
}

const containsRect = (outer: SurfaceRect, inner: SurfaceRect) =>
  outer.left <= inner.left &&
  outer.top <= inner.top &&
  outer.right >= inner.right &&
  outer.bottom >= inner.bottom;

const number = (value: number) => Number(value.toFixed(2));

const tokenNumbers = (value: string) => value.match(/-?(?:\d+\.?\d*|\.\d+)(?:px|%)?/gi) ?? [];

const length = (token: string | undefined, reference: number) => {
  if (!token) return 0;
  const value = Number.parseFloat(token);
  if (!Number.isFinite(value)) return 0;
  return token.trim().endsWith('%') ? (value / 100) * reference : value;
};

const corner = (value: string | undefined, width: number, height: number): SurfaceCorner => {
  const tokens = tokenNumbers(value ?? '');
  return {
    x: positive(length(tokens[0], width)),
    y: positive(length(tokens[1] ?? tokens[0], height)),
  };
};

const scaleRadii = (radii: SurfaceRadii, width: number, height: number) => {
  const horizontal = Math.max(
    radii.topLeft.x + radii.topRight.x,
    radii.bottomLeft.x + radii.bottomRight.x,
  );
  const vertical = Math.max(
    radii.topLeft.y + radii.bottomLeft.y,
    radii.topRight.y + radii.bottomRight.y,
  );
  const scale = Math.min(
    1,
    horizontal > width && width > 0 ? width / horizontal : 1,
    vertical > height && height > 0 ? height / vertical : 1,
  );
  if (scale === 1) return radii;
  return {
    topLeft: { x: radii.topLeft.x * scale, y: radii.topLeft.y * scale },
    topRight: { x: radii.topRight.x * scale, y: radii.topRight.y * scale },
    bottomRight: { x: radii.bottomRight.x * scale, y: radii.bottomRight.y * scale },
    bottomLeft: { x: radii.bottomLeft.x * scale, y: radii.bottomLeft.y * scale },
  };
};

/** Resolve an element's computed border radius into its four outer corners. */
export function parseBorderRadii(
  style: Pick<
    CSSStyleDeclaration,
    | 'borderRadius'
    | 'borderTopLeftRadius'
    | 'borderTopRightRadius'
    | 'borderBottomRightRadius'
    | 'borderBottomLeftRadius'
  >,
  width: number,
  height: number,
) {
  const fallback = style.borderRadius || '0';
  const radii = {
    topLeft: corner(style.borderTopLeftRadius || fallback, width, height),
    topRight: corner(style.borderTopRightRadius || fallback, width, height),
    bottomRight: corner(style.borderBottomRightRadius || fallback, width, height),
    bottomLeft: corner(style.borderBottomLeftRadius || fallback, width, height),
  };
  return scaleRadii(radii, Math.max(0, width), Math.max(0, height));
}

const splitShadowList = (value: string) => {
  const shadows: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '(') depth++;
    else if (character === ')') depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) {
      shadows.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = value.slice(start).trim();
  if (last) shadows.push(last);
  return shadows;
};

/**
 * Computes a conservative visual margin for outer box shadows. The result is
 * directional, so a one-sided shadow does not turn into a large rectangle
 * around the whole popover. Inset shadows do not occlude a lower surface.
 */
export function parseBoxShadowInsets(value: string | undefined) {
  const result = zeroInsets();
  if (!value || value === 'none') return result;
  for (const shadow of splitShadowList(value)) {
    if (/\binset\b/i.test(shadow)) continue;
    // Remove color functions before reading lengths; rgba() contains numbers
    // that are not shadow geometry.
    const geometry = shadow.replace(/(?:rgba?|hsla?)\([^)]*\)/gi, '').replace(/#[0-9a-f]+/gi, '');
    const values = tokenNumbers(geometry).map((token) => Number.parseFloat(token));
    if (values.length < 2 || values.some((item) => !Number.isFinite(item))) continue;
    const [x, y, blur = 0, spread = 0] = values;
    const extent = Math.max(0, blur + spread);
    result.left = Math.max(result.left, extent - x);
    result.right = Math.max(result.right, extent + x);
    result.top = Math.max(result.top, extent - y);
    result.bottom = Math.max(result.bottom, extent + y);
  }
  return {
    left: number(result.left),
    top: number(result.top),
    right: number(result.right),
    bottom: number(result.bottom),
  };
}

export function inflateSurfaceRect(rect: SurfaceRect, insets: SurfaceInsets): SurfaceRect {
  return {
    left: rect.left - positive(insets.left),
    top: rect.top - positive(insets.top),
    right: rect.right + positive(insets.right),
    bottom: rect.bottom + positive(insets.bottom),
  };
}

const inflateRadii = (radii: SurfaceRadii, insets: SurfaceInsets): SurfaceRadii => ({
  topLeft: {
    x: radii.topLeft.x + positive(insets.left),
    y: radii.topLeft.y + positive(insets.top),
  },
  topRight: {
    x: radii.topRight.x + positive(insets.right),
    y: radii.topRight.y + positive(insets.top),
  },
  bottomRight: {
    x: radii.bottomRight.x + positive(insets.right),
    y: radii.bottomRight.y + positive(insets.bottom),
  },
  bottomLeft: {
    x: radii.bottomLeft.x + positive(insets.left),
    y: radii.bottomLeft.y + positive(insets.bottom),
  },
});

type Point = { x: number; y: number };
type PointTransform = (point: Point) => Point;

const pathPoint = (point: Point, transform: PointTransform) => {
  const result = transform(point);
  return `${number(result.x)} ${number(result.y)}`;
};

/**
 * Returns a rounded outer-surface path. The path uses cubic corner arcs so it
 * remains useful for CSS masks and for transformed client quads. A scalar
 * radius is accepted for the common test and fallback case.
 */
export function roundedRectanglePath(
  rect: SurfaceRect,
  radii: SurfaceRadii | number = 0,
  transform: PointTransform = (point) => point,
) {
  const size = {
    width: Math.max(0, rect.right - rect.left),
    height: Math.max(0, rect.bottom - rect.top),
  };
  const corners: SurfaceRadii =
    typeof radii === 'number'
      ? {
          topLeft: { x: Math.max(0, radii), y: Math.max(0, radii) },
          topRight: { x: Math.max(0, radii), y: Math.max(0, radii) },
          bottomRight: { x: Math.max(0, radii), y: Math.max(0, radii) },
          bottomLeft: { x: Math.max(0, radii), y: Math.max(0, radii) },
        }
      : radii;
  const r = scaleRadii(corners, size.width, size.height);
  const k = 0.5522847498;
  const p = (x: number, y: number) => pathPoint({ x, y }, transform);
  const tl = r.topLeft,
    tr = r.topRight,
    br = r.bottomRight,
    bl = r.bottomLeft;
  return [
    `M${p(rect.left + tl.x, rect.top)}`,
    `L${p(rect.right - tr.x, rect.top)}`,
    `C${p(rect.right - tr.x + tr.x * k, rect.top)} ${p(rect.right, rect.top + tr.y - tr.y * k)} ${p(rect.right, rect.top + tr.y)}`,
    `L${p(rect.right, rect.bottom - br.y)}`,
    `C${p(rect.right, rect.bottom - br.y + br.y * k)} ${p(rect.right - br.x + br.x * k, rect.bottom)} ${p(rect.right - br.x, rect.bottom)}`,
    `L${p(rect.left + bl.x, rect.bottom)}`,
    `C${p(rect.left + bl.x - bl.x * k, rect.bottom)} ${p(rect.left, rect.bottom - bl.y + bl.y * k)} ${p(rect.left, rect.bottom - bl.y)}`,
    `L${p(rect.left, rect.top + tl.y)}`,
    `C${p(rect.left, rect.top + tl.y - tl.y * k)} ${p(rect.left + tl.x - tl.x * k, rect.top)} ${p(rect.left + tl.x, rect.top)}Z`,
  ].join('');
}

/** Returns non-overlapping pieces of `base` after every occluder is removed. */
export function subtractRectangles(base: SurfaceRect, occluders: readonly SurfaceRect[]) {
  return occluders.reduce<SurfaceRect[]>(
    (pieces, occluder) => {
      return pieces.flatMap((piece) => {
        const cut = intersection(piece, occluder);
        if (!cut) return [piece];
        return [
          { left: piece.left, top: piece.top, right: piece.right, bottom: cut.top },
          { left: piece.left, top: cut.bottom, right: piece.right, bottom: piece.bottom },
          { left: piece.left, top: cut.top, right: cut.left, bottom: cut.bottom },
          { left: cut.right, top: cut.top, right: piece.right, bottom: cut.bottom },
        ].filter(valid);
      });
    },
    [base],
  );
}

export function rectanglesToClipPath(rectangles: readonly SurfaceRect[]) {
  const path = rectangles
    .map(
      ({ left, top, right, bottom }) =>
        `M${number(left)} ${number(top)}H${number(right)}V${number(bottom)}H${number(left)}Z`,
    )
    .join('');
  return `path("${path || 'M0 0Z'}")`;
}

export function rectanglesToMaskImage(
  width: number,
  height: number,
  cuts: readonly { rect: SurfaceRect; opacity: number; path?: string }[],
) {
  const w = number(width);
  const h = number(height);
  const holes = cuts
    .map(({ rect, opacity, path }) => {
      const alpha = number(clamp01(opacity));
      if (path) return `<path d="${path}" fill="black" fill-opacity="${alpha}"/>`;
      const x = number(rect.left);
      const y = number(rect.top);
      return `<rect x="${x}" y="${y}" width="${number(rect.right - rect.left)}" height="${number(rect.bottom - rect.top)}" fill="black" fill-opacity="${alpha}"/>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><mask id="m" maskUnits="userSpaceOnUse" style="mask-type:luminance"><rect width="${w}" height="${h}" fill="white"/>${holes}</mask><rect width="${w}" height="${h}" fill="white" mask="url(#m)"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** `elementsFromPoint` is ordered from the topmost painted element down. */
export function paintsAbove<T>(
  paintOrder: readonly T[],
  isFloating: (item: T) => boolean,
  isBase: (item: T) => boolean,
) {
  const floatingIndex = paintOrder.findIndex(isFloating);
  const baseIndex = paintOrder.findIndex(isBase);
  return floatingIndex >= 0 && baseIndex >= 0 && floatingIndex < baseIndex;
}

export function combinedOpacity(values: readonly number[]) {
  return Math.max(
    0,
    Math.min(
      1,
      values.reduce((opacity, value) => opacity * value, 1),
    ),
  );
}

const visible = (element: HTMLElement) => {
  if (
    element.hidden ||
    element.matches('.controller-ribbon[data-anchor-hidden="true"]') ||
    element.getClientRects().length === 0
  )
    return false;
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
};

const bounds = (element: HTMLElement): SurfaceRect => {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
};

const cssLength = (value: string | undefined) => {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

const paddingBox = (rect: SurfaceRect, style: CSSStyleDeclaration) => ({
  left: rect.left + cssLength(style.borderLeftWidth),
  top: rect.top + cssLength(style.borderTopWidth),
  right: rect.right - cssLength(style.borderRightWidth),
  bottom: rect.bottom - cssLength(style.borderBottomWidth),
});

const clipsDescendants = (style: CSSStyleDeclaration) => {
  const overflowX = style.overflowX || style.overflow;
  const overflowY = style.overflowY || style.overflow;
  const hasOverflowClip = [overflowX, overflowY].some((value) => value && value !== 'visible');
  const hasClipPath = !!style.clipPath && style.clipPath !== 'none';
  const hasLegacyClip = !!style.clip && style.clip !== 'auto';
  const hasPaintContainment = style.contain.split(/\s+/).includes('paint');
  const hasMask =
    (!!style.maskImage && style.maskImage !== 'none') ||
    (!!style.webkitMaskImage && style.webkitMaskImage !== 'none') ||
    (!!style.mask && style.mask !== 'none');
  return hasOverflowClip || hasClipPath || hasLegacyClip || hasPaintContainment || hasMask;
};

const establishesFixedContainingBlock = (style: CSSStyleDeclaration) =>
  style.transform !== 'none' ||
  style.perspective !== 'none' ||
  style.filter !== 'none' ||
  style.backdropFilter !== 'none' ||
  style.contain.split(/\s+/).some((value) => value === 'paint' || value === 'layout') ||
  style.willChange
    .split(/\s*,\s*/)
    .some((value) => value === 'transform' || value === 'perspective');

type SurfaceVisibility = {
  bounds: SurfaceRect;
  clips: SurfaceRect[];
};

/**
 * `getBoundingClientRect()` describes an element's layout box, even when an
 * overflow/scroll ancestor clips most of that box. Return the paint-visible
 * bounds and the clip chain so occlusion cannot leak outside a scroll rail.
 */
const visibleSurface = (element: HTMLElement): SurfaceVisibility | null => {
  const rawBounds = bounds(element);
  const clips: SurfaceRect[] = [];
  const fixed = getComputedStyle(element).position === 'fixed';
  let fixedContaining = !fixed;
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    const establishesContainingBlock = establishesFixedContainingBlock(style);
    if (fixed && !fixedContaining) {
      if (establishesContainingBlock) fixedContaining = true;
      else continue;
    }
    if (clipsDescendants(style)) clips.push(paddingBox(bounds(ancestor), style));
  }
  const visibleBounds = clipSurfaceRect(rawBounds, clips);
  return visibleBounds ? { bounds: visibleBounds, clips } : null;
};

/**
 * Desktop docks have a solid panel face. Keep that face visible when a
 * translucent popover crosses it; only the dock's contents need covering.
 * Compact/touch surfaces keep their alpha background and use the mask path.
 */
const opaqueDesktopDockBackground = (element: HTMLElement) => {
  if (element.matches('.statusbar') || !element.closest('.app.desktop-workspace')) return;
  const background = getComputedStyle(element).backgroundColor;
  return parseCssColorAlpha(background) >= 0.999 ? background : undefined;
};

type OcclusionCut = { rect: SurfaceRect; opacity: number; path?: string };
type QuadPoint = { x: number; y: number };
type ClientQuad = { p1: QuadPoint; p2: QuadPoint; p3: QuadPoint; p4: QuadPoint };
type QuadElement = HTMLElement & { getBoxQuads?: () => ClientQuad[] };

const firstClientQuad = (element: HTMLElement) => {
  try {
    const quad = (element as QuadElement).getBoxQuads?.()[0];
    if (!quad) return undefined;
    const points = [quad.p1, quad.p2, quad.p3, quad.p4];
    return points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      ? quad
      : undefined;
  } catch {
    return undefined;
  }
};

const quadTransform = (quad: ClientQuad, width: number, height: number): PointTransform => {
  const safeWidth = width || 1;
  const safeHeight = height || 1;
  return ({ x, y }) => ({
    x:
      quad.p1.x +
      (x / safeWidth) * (quad.p2.x - quad.p1.x) +
      (y / safeHeight) * (quad.p4.x - quad.p1.x),
    y:
      quad.p1.y +
      (x / safeWidth) * (quad.p2.y - quad.p1.y) +
      (y / safeHeight) * (quad.p4.y - quad.p1.y),
  });
};

const surfaceShape = (
  element: HTMLElement,
  rect: SurfaceRect,
  style: CSSStyleDeclaration,
  origin: Pick<SurfaceRect, 'left' | 'top'>,
  includeShadow = true,
) => {
  const width = Math.max(0, element.offsetWidth || rect.right - rect.left);
  const height = Math.max(0, element.offsetHeight || rect.bottom - rect.top);
  const radii = parseBorderRadii(style, width, height);
  const insets = includeShadow ? parseBoxShadowInsets(style.boxShadow) : zeroInsets();
  const quad = firstClientQuad(element);
  const hasRadius = Object.values(radii).some((corner) => corner.x > 0 || corner.y > 0);
  const hasShadow = Object.values(insets).some((value) => value > 0);
  const transformed =
    !!quad &&
    (Math.abs(quad.p1.x - rect.left) > 0.01 ||
      Math.abs(quad.p1.y - rect.top) > 0.01 ||
      Math.abs(quad.p2.x - rect.right) > 0.01 ||
      Math.abs(quad.p2.y - rect.top) > 0.01 ||
      Math.abs(quad.p4.x - rect.left) > 0.01 ||
      Math.abs(quad.p4.y - rect.bottom) > 0.01);
  const needsShape = hasRadius || hasShadow || transformed;
  if (quad && width > 0 && height > 0) {
    const localRect = {
      left: -insets.left,
      top: -insets.top,
      right: width + insets.right,
      bottom: height + insets.bottom,
    };
    const path = needsShape
      ? roundedRectanglePath(localRect, inflateRadii(radii, insets), (point) => {
          const viewport = quadTransform(quad, width, height)(point);
          return { x: viewport.x - origin.left, y: viewport.y - origin.top };
        })
      : undefined;
    return { rect: inflateSurfaceRect(rect, insets), path };
  }
  const inflated = inflateSurfaceRect(rect, insets);
  const path = needsShape
    ? roundedRectanglePath(inflated, inflateRadii(radii, insets), (point) => ({
        x: point.x - origin.left,
        y: point.y - origin.top,
      }))
    : undefined;
  return { rect: inflated, path };
};

type InlineStyle = Pick<
  CSSStyleDeclaration,
  | 'clipPath'
  | 'position'
  | 'opacity'
  | 'pointerEvents'
  | 'maskImage'
  | 'maskSize'
  | 'maskRepeat'
  | 'webkitMaskImage'
  | 'webkitMaskSize'
  | 'webkitMaskRepeat'
>;

/**
 * Erases lower panel pixels and hit targets only where a higher floating surface overlaps.
 * A base containing its popup is deliberately left whole so the popup cannot clip itself.
 */
export function useSurfaceOcclusion() {
  useLayoutEffect(() => {
    const clipped = new Map<HTMLElement, InlineStyle>();
    const shields = new Map<HTMLElement, HTMLElement[]>();
    const dockCovers = new Map<HTMLElement, HTMLElement[]>();
    const observed = new Set<HTMLElement>();
    const resizeObserver = new ResizeObserver(schedule);
    const pathSupported =
      typeof CSS !== 'undefined' && CSS.supports('clip-path', 'path("M0 0H1V1H0Z")');
    const maskSupported =
      typeof CSS !== 'undefined' &&
      (CSS.supports('mask-image', 'linear-gradient(black, black)') ||
        CSS.supports('-webkit-mask-image', 'linear-gradient(black, black)'));
    let frame = 0;
    let transitionUntil = 0;

    const restoreMask = (element: HTMLElement, original: InlineStyle) => {
      element.style.maskImage = original.maskImage;
      element.style.maskSize = original.maskSize;
      element.style.maskRepeat = original.maskRepeat;
      element.style.webkitMaskImage = original.webkitMaskImage;
      element.style.webkitMaskSize = original.webkitMaskSize;
      element.style.webkitMaskRepeat = original.webkitMaskRepeat;
    };

    const removeShields = (element: HTMLElement) => {
      const existing = shields.get(element);
      if (!existing) return;
      for (const shield of existing) shield.remove();
      shields.delete(element);
    };

    const removeDockCovers = (element: HTMLElement) => {
      const existing = dockCovers.get(element);
      if (!existing) return;
      for (const cover of existing) cover.remove();
      dockCovers.delete(element);
    };

    const addShields = (element: HTMLElement, cuts: readonly OcclusionCut[]) => {
      removeShields(element);
      const next: HTMLElement[] = [];
      for (const cut of cuts) {
        if (!valid(cut.rect) && !cut.path) continue;
        const shield = element.ownerDocument.createElement('div');
        shield.className = 'surface-occlusion-shield';
        shield.setAttribute('aria-hidden', 'true');
        shield.tabIndex = -1;
        shield.style.position = 'absolute';
        shield.style.inset = '0';
        shield.style.width = '100%';
        shield.style.height = '100%';
        shield.style.padding = '0';
        shield.style.margin = '0';
        shield.style.border = '0';
        shield.style.background = 'transparent';
        shield.style.pointerEvents = 'auto';
        shield.style.touchAction = 'none';
        shield.style.zIndex = '2147483647';
        shield.style.clipPath = cut.path ? `path("${cut.path}")` : rectanglesToClipPath([cut.rect]);
        const stop = (event: Event) => event.stopPropagation();
        for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu'])
          shield.addEventListener(type, stop);
        element.appendChild(shield);
        next.push(shield);
      }
      if (next.length) shields.set(element, next);
    };

    const addDockCovers = (
      element: HTMLElement,
      cuts: readonly OcclusionCut[],
      background: string,
    ) => {
      removeDockCovers(element);
      const next: HTMLElement[] = [];
      for (const cut of cuts) {
        if (!valid(cut.rect) && !cut.path) continue;
        const cover = element.ownerDocument.createElement('div');
        cover.className = 'surface-occlusion-cover';
        cover.setAttribute('aria-hidden', 'true');
        cover.style.position = 'absolute';
        cover.style.inset = '0';
        cover.style.width = '100%';
        cover.style.height = '100%';
        cover.style.padding = '0';
        cover.style.margin = '0';
        cover.style.border = '0';
        cover.style.background = background;
        cover.style.opacity = String(clamp01(cut.opacity));
        cover.style.pointerEvents = 'none';
        cover.style.zIndex = '2147483646';
        cover.style.clipPath =
          pathSupported && cut.path ? `path("${cut.path}")` : rectanglesToClipPath([cut.rect]);
        element.appendChild(cover);
        next.push(cover);
      }
      if (next.length) dockCovers.set(element, next);
    };

    const ensureContainingBlock = (element: HTMLElement) => {
      if (getComputedStyle(element).position === 'static') element.style.position = 'relative';
    };

    function restore(element: HTMLElement) {
      const original = clipped.get(element);
      removeShields(element);
      removeDockCovers(element);
      if (!original) return;
      element.style.clipPath = original.clipPath;
      element.style.position = original.position;
      element.style.opacity = original.opacity;
      element.style.pointerEvents = original.pointerEvents;
      restoreMask(element, original);
      clipped.delete(element);
    }

    function expose(element: HTMLElement) {
      const original = clipped.get(element);
      removeShields(element);
      removeDockCovers(element);
      if (!original) return;
      element.style.clipPath = original.clipPath;
      element.style.position = original.position;
      element.style.opacity = original.opacity;
      element.style.pointerEvents = original.pointerEvents;
      restoreMask(element, original);
    }

    const paintedAbove = (floating: HTMLElement, base: HTMLElement, overlap: SurfaceRect) => {
      const testArea = intersection(overlap, {
        left: 0,
        top: 0,
        right: document.documentElement.clientWidth,
        bottom: document.documentElement.clientHeight,
      });
      if (!testArea) return false;
      const x = [
        testArea.left + Math.min(0.5, (testArea.right - testArea.left) / 2),
        (testArea.left + testArea.right) / 2,
        testArea.right - Math.min(0.5, (testArea.right - testArea.left) / 2),
      ];
      const y = [
        testArea.top + Math.min(0.5, (testArea.bottom - testArea.top) / 2),
        (testArea.top + testArea.bottom) / 2,
        testArea.bottom - Math.min(0.5, (testArea.bottom - testArea.top) / 2),
      ];
      const points: [number, number][] = [];
      for (const px of x) for (const py of y) points.push([px, py]);
      return points.some(([x, y]) =>
        paintsAbove(
          document.elementsFromPoint(x, y),
          (element) => element === floating || floating.contains(element),
          (element) => element === base || base.contains(element),
        ),
      );
    };

    const effectiveOpacity = (surface: HTMLElement) => {
      const values: number[] = [];
      for (let element: HTMLElement | null = surface; element; element = element.parentElement) {
        const opacity = Number(getComputedStyle(element).opacity);
        values.push(Number.isFinite(opacity) ? opacity : 1);
      }
      return combinedOpacity(values);
    };

    const surfaceAnimating = (surface: HTMLElement) => {
      const motionRoot = surface.closest<HTMLElement>('[data-motion]') ?? surface;
      return motionRoot
        .getAnimations({ subtree: true })
        .some((animation) => animation.playState === 'running');
    };

    function measure() {
      frame = 0;
      // Hit testing must see the uncut surfaces to determine their actual
      // rendered order. Restoring and reapplying within one frame does not paint.
      for (const element of clipped.keys()) expose(element);
      const bases = [...document.querySelectorAll<HTMLElement>(baseSelector)];
      const floating = [...document.querySelectorAll<HTMLElement>(floatingSelector)].filter(
        visible,
      );
      const current = new Set([...bases, ...floating]);

      for (const element of observed)
        if (!current.has(element)) {
          resizeObserver.unobserve(element);
          observed.delete(element);
        }
      for (const element of current)
        if (!observed.has(element)) {
          resizeObserver.observe(element);
          observed.add(element);
        }

      for (const base of bases) {
        if (!visible(base)) {
          restore(base);
          continue;
        }
        const baseBounds = bounds(base);
        const dockBackground = opaqueDesktopDockBackground(base);
        const occluders = floating
          .filter(
            (surface) => surface !== base && !base.contains(surface) && !surface.contains(base),
          )
          .flatMap((surface) => {
            const surfaceBounds = bounds(surface);
            const visibility = visibleSurface(surface);
            if (!visibility) return [];
            // A solid desktop dock needs an exact panel-shaped cover, so its
            // background remains visible and a large shadow cannot become a
            // black hole. Translucent touch surfaces retain shadow coverage.
            const shape = surfaceShape(
              surface,
              surfaceBounds,
              getComputedStyle(surface),
              { left: baseBounds.left, top: baseBounds.top },
              !dockBackground,
            );
            const visibleShape = clipSurfaceRect(shape.rect, visibility.clips);
            if (!visibleShape) return [];
            // A rounded/transformed path is safe only while every clip
            // ancestor contains its complete geometry. Once a scroll rail
            // trims it, use the clipped rectangle so no path pixels escape
            // below the ancestor's paint edge.
            const shapeWithinClips = visibility.clips.every((clip) =>
              containsRect(clip, shape.rect),
            );
            // Use the uninflated element for paint-order probing. Shadow
            // expansion is included only for translucent lower surfaces.
            const overlap = intersection(baseBounds, visibility.bounds);
            const coverage = intersection(baseBounds, visibleShape);
            // The status bar is a passive scene underlay (`pointer-events: none`),
            // so elementsFromPoint cannot rank it. Floating editors always paint
            // semantically above it and erase only their intersecting rectangle.
            const semanticTop = surface.matches(
              '[data-motion], [role="menu"], [role="dialog"], dialog[open], .active-layer-menu, .studio-failure-notice, .desktop-command-menu, .touch-command-menu, .file-menu, .library-popover, .controller-ribbon',
            );
            return coverage &&
              (base.matches('.statusbar') ||
                semanticTop ||
                (overlap != null && paintedAbove(surface, base, overlap)))
              ? [
                  {
                    rect: visibleShape,
                    opacity: effectiveOpacity(surface),
                    path: shapeWithinClips ? shape.path : undefined,
                  },
                ]
              : [];
          });
        if (!occluders.length) {
          restore(base);
          continue;
        }
        if (!clipped.has(base))
          clipped.set(base, {
            clipPath: base.style.clipPath,
            position: base.style.position,
            opacity: base.style.opacity,
            pointerEvents: base.style.pointerEvents,
            maskImage: base.style.maskImage,
            maskSize: base.style.maskSize,
            maskRepeat: base.style.maskRepeat,
            webkitMaskImage: base.style.webkitMaskImage,
            webkitMaskSize: base.style.webkitMaskSize,
            webkitMaskRepeat: base.style.webkitMaskRepeat,
          });
        const original = clipped.get(base)!;
        const localBase = {
          left: 0,
          top: 0,
          right: baseBounds.right - baseBounds.left,
          bottom: baseBounds.bottom - baseBounds.top,
        };
        let localCuts: OcclusionCut[] = occluders.map(({ rect, opacity, path }) => ({
          rect: {
            left: rect.left - baseBounds.left,
            top: rect.top - baseBounds.top,
            right: rect.right - baseBounds.left,
            bottom: rect.bottom - baseBounds.top,
          },
          opacity,
          path,
        }));
        // A partially visible recovery notice is no longer meaningful. Fade the
        // whole status badge for any overlap; all other bases retain local cuts.
        if (base.matches('.statusbar'))
          localCuts = localCuts.map(({ opacity }) => ({ rect: localBase, opacity }));
        const settled = localCuts.every(({ opacity }) => opacity >= 0.999);
        const shaped = localCuts.some(({ path }) => !!path);
        if (dockBackground) {
          // Desktop docks intentionally keep their solid face. Painting that
          // same face through the exact overlay shape hides text and controls
          // without erasing the panel itself; the transparent shield keeps
          // the covered lower controls out of the hit target list.
          base.style.clipPath = original.clipPath;
          restoreMask(base, original);
          base.style.position = original.position;
          base.style.opacity = original.opacity;
          base.style.pointerEvents = original.pointerEvents;
          ensureContainingBlock(base);
          addDockCovers(base, localCuts, dockBackground);
          if (pathSupported && original.pointerEvents !== 'none') addShields(base, localCuts);
          else if (!pathSupported) base.style.pointerEvents = 'none';
          continue;
        }
        base.style.opacity = original.opacity;
        base.style.pointerEvents = original.pointerEvents;
        if (settled && pathSupported && !shaped) {
          removeShields(base);
          restoreMask(base, original);
          base.style.clipPath = rectanglesToClipPath(
            subtractRectangles(
              localBase,
              localCuts.map(({ rect }) => rect),
            ),
          );
        } else if (maskSupported) {
          base.style.clipPath = original.clipPath;
          const mask = rectanglesToMaskImage(localBase.right, localBase.bottom, localCuts);
          base.style.maskImage = mask;
          base.style.maskSize = '100% 100%';
          base.style.maskRepeat = 'no-repeat';
          base.style.webkitMaskImage = mask;
          base.style.webkitMaskSize = '100% 100%';
          base.style.webkitMaskRepeat = 'no-repeat';
          // CSS masks affect pixels but are not consistently part of HTML hit
          // testing. A transparent, clipped shield blocks only the covered
          // geometry while leaving the rest of a partially overlapped
          // inspector interactive. Rectangular transition cuts can use the
          // same shield path, so a fading small overlay does not disable the
          // entire lower properties surface.
          if (pathSupported && original.pointerEvents !== 'none') {
            ensureContainingBlock(base);
            addShields(base, localCuts);
          } else if (!settled || !pathSupported) base.style.pointerEvents = 'none';
        } else {
          removeShields(base);
          base.style.clipPath = original.clipPath;
          base.style.opacity = String(1 - Math.max(...localCuts.map(({ opacity }) => opacity)));
          base.style.pointerEvents = 'none';
        }
      }
      for (const element of [...clipped.keys()]) if (!bases.includes(element)) restore(element);
      const animating = floating.some(surfaceAnimating);
      if (animating) {
        // A transform/clip animation changes the client quad without
        // necessarily changing the element's size, so ResizeObserver cannot
        // keep the lower surface in sync. Continue until the animation really
        // settles instead of assuming a 300ms transition.
        transitionUntil = Math.max(transitionUntil, performance.now() + 300);
        frame = requestAnimationFrame(measure);
      } else if (performance.now() < transitionUntil) frame = requestAnimationFrame(measure);
      else transitionUntil = 0;
    }

    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }

    const surfaceSelector = baseSelector + ',' + floatingSelector;
    const containsSurfaceRoot = (node: Node) =>
      node instanceof Element &&
      (node.matches(surfaceSelector) || !!node.querySelector(surfaceSelector));
    const mutations = new MutationObserver((records) => {
      if (
        records.some((record) => {
          if (record.type === 'attributes')
            return record.target instanceof Element && record.target.matches(surfaceSelector);
          return [...record.addedNodes, ...record.removedNodes].some(containsSurfaceRoot);
        })
      )
        schedule();
    });
    mutations.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'open', 'aria-hidden', 'data-state'],
    });

    const motion = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const relevant =
        target?.closest(surfaceSelector) ||
        (target?.matches('[data-motion]') && target.querySelector(floatingSelector));
      if (!relevant) return;
      schedule();
      if (event.type === 'transitionrun' || event.type === 'animationstart') {
        transitionUntil = Math.max(transitionUntil, performance.now() + 300);
      }
    };
    for (const event of [
      'transitionrun',
      'transitionend',
      'transitioncancel',
      'animationstart',
      'animationend',
      'animationcancel',
    ])
      document.addEventListener(event, motion, true);
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    let ribbonSuppressed = false;
    const anchor = (event: Event) => {
      const detail = (
        event as CustomEvent<{ dragging?: boolean; playing?: boolean; scrubbing?: boolean }>
      ).detail;
      const suppressed = !!(detail?.dragging || detail?.playing || detail?.scrubbing);
      if (suppressed === ribbonSuppressed && suppressed) return;
      ribbonSuppressed = suppressed;
      // PoseActions queues its ribbon placement during the same event. Queueing
      // after dispatch guarantees our single measurement frame runs after it.
      queueMicrotask(schedule);
    };
    window.addEventListener('pose-selection-anchor', anchor);
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('pose-selection-anchor', anchor);
      for (const event of [
        'transitionrun',
        'transitionend',
        'transitioncancel',
        'animationstart',
        'animationend',
        'animationcancel',
      ])
        document.removeEventListener(event, motion, true);
      for (const element of [...clipped.keys()]) restore(element);
    };
  }, []);
}

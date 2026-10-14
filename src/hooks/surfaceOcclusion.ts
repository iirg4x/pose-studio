import { useLayoutEffect } from 'react';

export type SurfaceRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

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

const number = (value: number) => Number(value.toFixed(2));

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
  cuts: readonly { rect: SurfaceRect; opacity: number }[],
) {
  const w = number(width);
  const h = number(height);
  const holes = cuts
    .map(({ rect, opacity }) => {
      const x = number(rect.left);
      const y = number(rect.top);
      return `<rect x="${x}" y="${y}" width="${number(rect.right - rect.left)}" height="${number(rect.bottom - rect.top)}" fill="black" fill-opacity="${number(opacity)}"/>`;
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

type InlineStyle = Pick<
  CSSStyleDeclaration,
  | 'clipPath'
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

    function restore(element: HTMLElement) {
      const original = clipped.get(element);
      if (!original) return;
      element.style.clipPath = original.clipPath;
      element.style.opacity = original.opacity;
      element.style.pointerEvents = original.pointerEvents;
      restoreMask(element, original);
      clipped.delete(element);
    }

    function expose(element: HTMLElement) {
      const original = clipped.get(element);
      if (!original) return;
      element.style.clipPath = original.clipPath;
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
      const points = [
        [(testArea.left + testArea.right) / 2, (testArea.top + testArea.bottom) / 2],
        [testArea.left + 0.5, testArea.top + 0.5],
        [testArea.right - 0.5, testArea.bottom - 0.5],
      ];
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
        const occluders = floating
          .filter(
            (surface) => surface !== base && !base.contains(surface) && !surface.contains(base),
          )
          .flatMap((surface) => {
            const overlap = intersection(baseBounds, bounds(surface));
            // The status bar is a passive scene underlay (`pointer-events: none`),
            // so elementsFromPoint cannot rank it. Floating editors always paint
            // semantically above it and erase only their intersecting rectangle.
            const semanticTop = surface.matches('[role="dialog"], dialog[open]');
            return overlap &&
              (base.matches('.statusbar') || semanticTop || paintedAbove(surface, base, overlap))
              ? [
                  {
                    rect: overlap,
                    opacity: effectiveOpacity(surface),
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
        let localCuts = occluders.map(({ rect, opacity }) => ({
          rect: {
            left: rect.left - baseBounds.left,
            top: rect.top - baseBounds.top,
            right: rect.right - baseBounds.left,
            bottom: rect.bottom - baseBounds.top,
          },
          opacity,
        }));
        // A partially visible recovery notice is no longer meaningful. Fade the
        // whole status badge for any overlap; all other bases retain local cuts.
        if (base.matches('.statusbar'))
          localCuts = localCuts.map(({ opacity }) => ({ rect: localBase, opacity }));
        const settled = localCuts.every(({ opacity }) => opacity >= 0.999);
        base.style.opacity = original.opacity;
        base.style.pointerEvents = original.pointerEvents;
        if (settled && pathSupported) {
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
          if (!settled || !pathSupported) base.style.pointerEvents = 'none';
        } else {
          base.style.clipPath = original.clipPath;
          base.style.opacity = String(1 - Math.max(...localCuts.map(({ opacity }) => opacity)));
          base.style.pointerEvents = 'none';
        }
      }
      for (const element of [...clipped.keys()]) if (!bases.includes(element)) restore(element);
      if (performance.now() < transitionUntil) {
        const animating = floating.some(surfaceAnimating);
        if (animating) frame = requestAnimationFrame(measure);
        else transitionUntil = 0;
      }
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

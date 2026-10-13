import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { measureTouchViewport } from '../platform/touchViewport';

type PopupAnchor = RefObject<Element | null>;

type PopupPlacement = 'point' | 'above-end';

export interface PopupPosition {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
}

interface PopupPlacementOptions {
  open: boolean;
  panel: RefObject<HTMLElement | null>;
  anchor?: PopupAnchor;
  point?: { x: number; y: number };
  placement?: PopupPlacement;
  fallbackWidth?: number;
  fallbackHeight?: number;
  margin?: number;
  gap?: number;
}

const initialPosition: PopupPosition = {
  left: 8,
  top: 8,
  maxWidth: 320,
  maxHeight: 480,
};

/**
 * Place a fixed popup inside the currently visible CSS viewport.
 *
 * `innerWidth`/`innerHeight` describe the layout viewport and can remain larger
 * than the visible area when Safari shows browser chrome or the keyboard. The
 * visual viewport, including its offsets, is therefore the source of truth.
 * The panel is measured after it renders and again whenever its content changes.
 */
export function usePopupPlacement({
  open,
  panel,
  anchor,
  point,
  placement = 'point',
  fallbackWidth = 320,
  fallbackHeight = 420,
  margin = 8,
  gap = 8,
}: PopupPlacementOptions): PopupPosition {
  const [position, setPosition] = useState<PopupPosition>(initialPosition);

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const place = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const viewport = measureTouchViewport({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          visualViewport: window.visualViewport,
        });
        if (!viewport.width || !viewport.height) return;

        const inset = Math.max(4, margin);
        const leftEdge = viewport.offsetLeft + inset;
        const topEdge = viewport.offsetTop + inset;
        const rightEdge = viewport.offsetLeft + viewport.width - inset;
        const bottomEdge = viewport.offsetTop + viewport.height - inset;
        const maxWidth = Math.max(1, rightEdge - leftEdge);
        const maxHeight = Math.max(1, bottomEdge - topEdge);
        const measured = panel.current?.getBoundingClientRect();
        const width = Math.min(
          measured?.width && measured.width > 0 ? measured.width : fallbackWidth,
          maxWidth,
        );
        const height = Math.min(
          measured?.height && measured.height > 0 ? measured.height : fallbackHeight,
          maxHeight,
        );

        let left = leftEdge;
        let top = topEdge;
        if (placement === 'above-end') {
          const rect = anchor?.current?.getBoundingClientRect();
          if (rect) {
            left = rect.right - width;
            const above = rect.top - height - gap;
            const below = rect.bottom + gap;
            top =
              above >= topEdge || below + height > bottomEdge
                ? Math.min(Math.max(above, topEdge), bottomEdge - height)
                : below;
          }
        } else if (point) {
          left = point.x;
          top = point.y;
        }

        setPosition({
          left: Math.min(Math.max(left, leftEdge), rightEdge - width),
          top: Math.min(Math.max(top, topEdge), bottomEdge - height),
          maxWidth,
          maxHeight,
        });
      });
    };
    const onResize = () => place();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    const anchorElement = anchor?.current ?? null;
    const layoutAncestors: Element[] = [];
    for (let element: Element | null = anchorElement; element; element = element.parentElement)
      layoutAncestors.push(element);
    if (panel.current) observer?.observe(panel.current);
    for (const element of layoutAncestors) observer?.observe(element);
    const scrollTargets: (Window | Element)[] = [window, ...layoutAncestors];
    for (const target of scrollTargets)
      target.addEventListener('scroll', onResize, { passive: true });
    place();
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
    window.visualViewport?.addEventListener('resize', onResize, { passive: true });
    window.visualViewport?.addEventListener('scroll', onResize, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      for (const target of scrollTargets) target.removeEventListener('scroll', onResize);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
    };
  }, [
    anchor,
    fallbackHeight,
    fallbackWidth,
    gap,
    margin,
    open,
    panel,
    placement,
    point?.x,
    point?.y,
  ]);

  return position;
}

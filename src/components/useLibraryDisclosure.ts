import { useLayoutEffect } from 'react';
import type { RefObject } from 'react';

/** Compact libraries scroll as a whole. Follow an opening disclosure's
 * occupied height so its fields are revealed above the fixed transport. */
export function useLibraryDisclosure(open: boolean, content: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const target = content.current,
      panel = target?.closest<HTMLElement>('.library-panel');
    if (!open || !target || !panel) return;
    if (!['auto', 'scroll'].includes(getComputedStyle(panel).overflowY)) return;
    const disclosure = target.closest<HTMLElement>('.motion-collapse') ?? target;
    const reveal = () => {
      const viewport = panel.getBoundingClientRect(),
        bounds = disclosure.getBoundingClientRect(),
        available = panel.clientHeight;
      // A taller disclosure remains scrollable from its beginning. Otherwise
      // keep its growing bottom visible without scrolling any scene ancestor.
      const delta =
        bounds.height > available
          ? bounds.top - viewport.top
          : Math.max(0, bounds.bottom - viewport.top - available);
      if (Math.abs(delta) > 1) panel.scrollTop += delta;
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(disclosure);
    observer.observe(panel);
    reveal();
    return () => observer.disconnect();
  }, [open, content]);
}

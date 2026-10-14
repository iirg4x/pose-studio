import { cloneElement, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { usePresence } from '../hooks';

/** Retain the last visible content while closing. CSS transitions can reverse
 * in place when a tool is reopened; hidden controls cannot receive input. */
export function MotionPresence({
  show,
  children,
  kind = 'popover',
}: {
  show: boolean;
  children: ReactElement;
  kind?: 'popover' | 'context' | 'collapse' | 'inline' | 'overlay';
}) {
  const presence = usePresence(show ? true : null, 220),
    last = useRef(children);
  if (show) last.current = children;
  if (!presence.value) return null;
  return cloneElement(last.current as ReactElement<Record<string, unknown>>, {
    'data-motion': kind,
    'data-state': presence.exiting ? 'closing' : 'open',
    inert: presence.exiting || undefined,
    'aria-hidden': presence.exiting || undefined,
  });
}

export function MotionOverlay({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <MotionPresence show={show} kind="overlay">
      <div className="motion-overlay">{children}</div>
    </MotionPresence>
  );
}

export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <MotionPresence show={open} kind="collapse">
      <div className="motion-collapse">
        <div className="motion-collapse-inner">{children}</div>
      </div>
    </MotionPresence>
  );
}

/** Collapse the occupied inline space along with opacity. The inner content
 * keeps its natural width so adjacent tools slide instead of jumping. */
export function InlineCollapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <MotionPresence show={open} kind="inline">
      <div className="motion-inline">
        <div className="motion-inline-inner">{children}</div>
      </div>
    </MotionPresence>
  );
}

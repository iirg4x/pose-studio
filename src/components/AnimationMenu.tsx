import { createPortal } from 'react-dom';
import { useLayoutEffect, useRef, useState } from 'react';
import { Pencil, Copy, X, PanelTopClose, Trash2 } from 'lucide-react';
import { usePopupPlacement } from '../hooks/usePopupPlacement';
import { useTransientPopover } from '../hooks/transientPopover';

export function AnimationMenu({
  tabs = true,
  x,
  y,
  rename,
  duplicate,
  remove,
  closeTab,
  closeOthers,
  dismiss,
  exiting = false,
}: {
  tabs?: boolean;
  x: number;
  y: number;
  rename: () => void;
  duplicate: () => void;
  remove: () => void;
  closeTab: () => void;
  closeOthers: () => void;
  dismiss: () => void;
  exiting?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const position = usePopupPlacement({
    open: !exiting,
    panel: ref,
    point: { x, y },
    fallbackWidth: 216,
    fallbackHeight: tabs ? 156 : 92,
  });
  const popover = useTransientPopover({
    owner: 'animation-menu',
    open: !exiting,
    onClose: dismiss,
    rootRef: ref,
  });
  useLayoutEffect(() => {
    setReady(false);
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [x, y]);
  useLayoutEffect(() => {
    if (!ready || exiting) return;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [ready, exiting]);
  return createPortal(
    <div
      ref={ref}
      className="animation-context-menu"
      role="menu"
      aria-label="Animation tab menu"
      aria-hidden={exiting || undefined}
      data-editor-overlay
      data-motion="context"
      data-state={exiting ? 'closing' : 'open'}
      inert={exiting || undefined}
      style={{
        ...position,
        maxWidth: position.maxWidth,
        maxHeight: position.maxHeight,
        visibility: ready ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        e.stopPropagation();
        const items = [...ref.current!.querySelectorAll<HTMLButtonElement>('button')],
          at = items.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'Escape') {
          e.preventDefault();
          popover.close(true);
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          items[
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? items.length - 1
                : (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          ]?.focus();
        }
      }}
    >
      <button role="menuitem" onClick={rename}>
        <Pencil size={14} />
        <span>Rename</span>
        <kbd>F2</kbd>
      </button>
      <button role="menuitem" onClick={duplicate}>
        <Copy size={14} />
        <span>Duplicate</span>
      </button>
      {tabs && (
        <>
          <hr />
          <button role="menuitem" onClick={closeTab}>
            <X size={14} />
            <span>Close tab</span>
          </button>
          <button role="menuitem" onClick={closeOthers}>
            <PanelTopClose size={14} />
            <span>Close other tabs</span>
          </button>
        </>
      )}
      <hr />
      <button role="menuitem" className="danger" onClick={remove}>
        <Trash2 size={14} />
        <span>Delete animation…</span>
      </button>
    </div>,
    document.body,
  );
}

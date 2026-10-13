import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';

const claimEvent = 'pose-transient-popover-claim';
let activeOwner: string | undefined;

/**
 * Claims the single top-level transient-menu slot.
 *
 * This is deliberately separate from nested editor popovers (for example the
 * timeline More menu and its Loop settings), which manage their own stack.
 */
export function claimTransientPopover(owner: string) {
  activeOwner = owner;
  window.dispatchEvent(new CustomEvent(claimEvent, { detail: { owner } }));
}

export function useTransientPopover({
  owner,
  open,
  onClose,
  rootRef,
  triggerRef,
}: {
  owner: string;
  open: boolean;
  onClose: () => void;
  rootRef: RefObject<HTMLElement | null>;
  triggerRef?: RefObject<HTMLElement | null>;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const announce = useCallback(() => claimTransientPopover(owner), [owner]);
  const close = useCallback(
    (restoreFocus = false) => {
      closeRef.current();
      if (restoreFocus) requestAnimationFrame(() => triggerRef?.current?.focus());
    },
    [triggerRef],
  );

  useEffect(() => {
    if (!open) return;

    // Covers programmatic openings whose caller did not announce before its
    // state update. Pointer-triggered openings should call announce first.
    announce();
    const claimed = (event: Event) => {
      const next = (event as CustomEvent<{ owner?: string }>).detail?.owner;
      if (next && next !== owner) close();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target) && !triggerRef?.current?.contains(target))
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || activeOwner !== owner) return;
      // A modal or nested editor surface owns its own Escape handling. This
      // capture listener must not swallow the event before it reaches that UI.
      const target = event.target instanceof Element ? event.target : null;
      const nested = target?.closest('dialog[open], [role="dialog"], [data-editor-overlay]');
      if (nested && !rootRef.current?.contains(nested)) return;
      const dialogs = [...document.querySelectorAll('dialog[open], [role="dialog"]')];
      if (
        dialogs.some((dialog) => !dialog.closest('[inert]') && !rootRef.current?.contains(dialog))
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    const dismiss = (event: Event) => {
      if (event.defaultPrevented || activeOwner !== owner) return;
      event.preventDefault();
      close();
    };

    window.addEventListener(claimEvent, claimed);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('pose-dismiss-overlay', dismiss, true);
    return () => {
      if (activeOwner === owner) activeOwner = undefined;
      window.removeEventListener(claimEvent, claimed);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('pose-dismiss-overlay', dismiss, true);
    };
  }, [announce, close, open, owner, rootRef, triggerRef]);

  return useMemo(() => ({ announce, close }), [announce, close]);
}

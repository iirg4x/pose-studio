import { useEffect, useRef, type RefObject } from 'react';

const focusableSelector = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusable(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) =>
      !element.hidden &&
      !element.closest('[hidden], [aria-hidden="true"], [inert]') &&
      element.getAttribute('aria-disabled') !== 'true',
  );
}

/**
 * Gives an in-document dialog the same containment guarantees as a native
 * modal: background siblings become inert, Tab stays inside the surface,
 * Escape is delivered to the owner, and focus returns to the opener.
 *
 * The callback is kept in a ref so a dialog can render validation or busy
 * state without replacing the captured opener or re-running the inert pass.
 */
export function useModalFocus({
  rootRef,
  initialFocusRef,
  restoreFocusRef,
  enabled = true,
  onEscape,
}: {
  rootRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  enabled?: boolean;
  onEscape?: () => void;
}) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;

    const previous =
      restoreFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const inerted: Array<{ element: HTMLElement; value: boolean }> = [];
    let node: HTMLElement | null = root;

    // Mark siblings on the path to the dialog inert. This works for both
    // inline dialogs and dialogs rendered inside a body-level portal without
    // accidentally inerting the dialog's own overlay wrapper.
    while (node && node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) break;
      for (const sibling of [...parent.children]) {
        if (sibling === node || !(sibling instanceof HTMLElement)) continue;
        inerted.push({ element: sibling, value: sibling.inert });
        sibling.inert = true;
      }
      node = parent;
    }

    const focusTarget = (last = false) => {
      const items = focusable(root);
      const target = last
        ? items.at(-1)
        : initialFocusRef?.current && !initialFocusRef.current.matches(':disabled')
          ? initialFocusRef.current
          : items[0];
      (target ?? root).focus({ preventScroll: true });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      const nested =
        target instanceof Element
          ? target.closest('dialog[open], [role="dialog"], [data-editor-overlay]')
          : null;
      if (nested && !root.contains(nested)) return;
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusable(root);
      if (!items.length) {
        event.preventDefault();
        root.focus({ preventScroll: true });
        return;
      }
      if (!target || !root.contains(target)) {
        event.preventDefault();
        focusTarget(event.shiftKey);
        return;
      }
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && (at <= 0 || document.activeElement === root)) {
        event.preventDefault();
        items.at(-1)?.focus({ preventScroll: true });
      } else if (!event.shiftKey && (at === items.length - 1 || at < 0)) {
        event.preventDefault();
        items[0]?.focus({ preventScroll: true });
      }
    };
    const onDismiss = (event: Event) => {
      if (event.defaultPrevented) return;
      const nested = [...document.querySelectorAll('dialog[open], [role="dialog"]')].some(
        (dialog) => dialog !== root && !root.contains(dialog) && !dialog.closest('[inert]'),
      );
      if (nested) return;
      event.preventDefault();
      escapeRef.current?.();
    };

    focusTarget();
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pose-dismiss-overlay', onDismiss, true);
    const observer =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => {
            // MotionPresence retains a closing overlay for its exit animation and
            // marks it inert. Release the trap at that point instead of waiting
            // for the retained subtree to unmount.
            if (root.closest('[inert]')) restore();
          });
    observer?.observe(document.body, {
      attributes: true,
      attributeFilter: ['inert'],
      subtree: true,
    });
    let active = true;
    const restore = () => {
      if (!active) return;
      active = false;
      observer?.disconnect();
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pose-dismiss-overlay', onDismiss, true);
      for (const { element, value } of inerted) element.inert = value;
      if (previous?.isConnected && !previous.closest('[inert]'))
        previous.focus({ preventScroll: true });
    };
    return () => {
      restore();
    };
  }, [enabled, initialFocusRef, restoreFocusRef, rootRef]);
}

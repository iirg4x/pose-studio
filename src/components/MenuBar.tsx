import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { consumeSceneDismiss } from '../hooks/transientPopover';
import { MotionPresence } from './Motion';

type MenuItem =
  | {
      label: string;
      run: () => void;
      shortcut?: string;
      disabled?: boolean;
      /** Shows a check mark; the item becomes a menuitemcheckbox. */
      checked?: boolean;
    }
  | 'separator';
export interface Menu {
  label: string;
  items: MenuItem[];
  /** Extra content rendered after the items (e.g. recent projects). */
  footer?: ReactNode;
}

/** Desktop menu bar following the WAI-ARIA menubar pattern. */
export function MenuBar({ menus, disabled = false }: { menus: Menu[]; disabled?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState({
    left: 0,
    top: 0,
    side: 'right' as 'left' | 'right',
  });
  const root = useRef<HTMLDivElement>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const dropdowns = useRef<(HTMLDivElement | null)[]>([]);
  const pointerMenu = useRef<number | null>(null);
  const openRef = useRef<number | null>(null);
  openRef.current = open;
  const close = (focusTrigger = false) => {
    if (focusTrigger && open !== null) triggers.current[open]?.focus();
    pointerMenu.current = null;
    setOpen(null);
  };
  useEffect(() => {
    if (open === null) return;
    const outside = (e: PointerEvent) => {
      const target = e.target as Node,
        activeDropdown = open === null ? null : dropdowns.current[open];
      if (!root.current?.contains(target) && !activeDropdown?.contains(target)) {
        consumeSceneDismiss(e);
        pointerMenu.current = null;
        setOpen(null);
      }
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  useLayoutEffect(() => {
    const commandMenu = root.current?.closest('.desktop-command-menu');
    setPortalHost(commandMenu?.parentElement ?? root.current?.parentElement ?? document.body);
  }, []);
  useLayoutEffect(() => {
    // The application popover owns a document-level Escape listener. Capture
    // the first Escape while focus is in a portaled submenu so the category
    // list remains available; the next Escape reaches the application menu.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const active = openRef.current;
      if (active === null) return;
      const target = event.target as Node | null;
      if (!target || !dropdowns.current[active]?.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      pointerMenu.current = null;
      triggers.current[active]?.focus();
      setOpen(null);
    };
    document.addEventListener('keydown', onEscape, true);
    return () => document.removeEventListener('keydown', onEscape, true);
  }, []);
  useLayoutEffect(() => {
    // The menu is mounted when the application menu opens. Put focus on its
    // first category so keyboard users can immediately move through rows.
    triggers.current.find((trigger) => !trigger?.disabled)?.focus();
  }, []);
  useLayoutEffect(() => {
    if (open === null) return;
    dropdowns.current[open]?.querySelector<HTMLElement>('[role^=menuitem]:not(:disabled)')?.focus();

    const positionSubmenu = () => {
      const trigger = triggers.current[open],
        dropdown = dropdowns.current[open];
      if (!trigger || !dropdown) return;
      const triggerRect = trigger.getBoundingClientRect(),
        dropdownRect = dropdown.getBoundingClientRect(),
        width = dropdownRect.width || 240,
        height = dropdownRect.height || 0,
        viewportPadding = 8;
      let left = triggerRect.right + 4,
        side: 'left' | 'right' = 'right';
      if (left + width > innerWidth - viewportPadding) {
        left = triggerRect.left - width - 4;
        side = 'left';
      }
      left = Math.max(viewportPadding, Math.min(left, innerWidth - width - viewportPadding));
      const top = Math.max(
        viewportPadding,
        Math.min(triggerRect.top, innerHeight - height - viewportPadding),
      );
      setSubmenuPosition((current) =>
        current.left === left && current.top === top && current.side === side
          ? current
          : { left, top, side },
      );
    };
    positionSubmenu();
    window.addEventListener('resize', positionSubmenu);
    window.addEventListener('scroll', positionSubmenu, true);
    return () => {
      window.removeEventListener('resize', positionSubmenu);
      window.removeEventListener('scroll', positionSubmenu, true);
    };
  }, [open, portalHost]);
  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      // Let normal tab order reach footer fields before leaving this menu.
      const menu = e.currentTarget;
      requestAnimationFrame(() => {
        if (!menu.contains(document.activeElement)) close();
      });
      return;
    }
    if (
      e.target instanceof Element &&
      e.target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return;
    const list = [
        ...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role^=menuitem]:not(:disabled)'),
      ],
      i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      list[(i + step + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    }
  };
  return (
    <div
      className="menubar"
      role="menubar"
      aria-label="Main menu"
      aria-orientation="vertical"
      ref={root}
    >
      {menus.map((menu, m) => (
        <div
          className="menubar-menu"
          key={menu.label}
          data-submenu-side={open === m ? submenuPosition.side : undefined}
          onPointerEnter={() => {
            pointerMenu.current = m;
            setOpen((current) => (current === m ? current : m));
          }}
        >
          <button
            ref={(el) => {
              triggers.current[m] = el;
            }}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === m}
            aria-controls={`menubar-submenu-${m}`}
            disabled={disabled}
            className="menubar-trigger"
            onClick={() => {
              const enteredByPointer = pointerMenu.current === m;
              pointerMenu.current = null;
              setOpen((current) =>
                enteredByPointer && current === m ? current : current === m ? null : m,
              );
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                triggers.current[(m + step + menus.length) % menus.length]?.focus();
              } else if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                triggers.current[e.key === 'Home' ? 0 : menus.length - 1]?.focus();
              } else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(m);
              } else if (e.key === 'ArrowLeft' || e.key === 'Escape') {
                e.preventDefault();
                setOpen(null);
              }
            }}
          >
            <span>{menu.label}</span>
            <span className="menubar-submenu-indicator" aria-hidden="true">
              ›
            </span>
          </button>
          {portalHost
            ? createPortal(
                <MotionPresence show={open === m}>
                  <div
                    ref={(el) => {
                      dropdowns.current[m] = el;
                    }}
                    className="menubar-dropdown"
                    role="menu"
                    id={`menubar-submenu-${m}`}
                    aria-label={menu.label}
                    data-editor-overlay
                    data-submenu="true"
                    data-side={open === m ? submenuPosition.side : undefined}
                    style={
                      open === m
                        ? { left: submenuPosition.left, top: submenuPosition.top }
                        : undefined
                    }
                    onKeyDown={onMenuKey}
                  >
                    {renderItems(menu.items, () => close(true))}
                    {menu.footer}
                  </div>
                </MotionPresence>,
                portalHost,
              )
            : null}
        </div>
      ))}
    </div>
  );
}

function renderItems(items: MenuItem[], done: () => void) {
  return items.map((item, i) =>
    item === 'separator' ? (
      <hr key={'sep' + i} />
    ) : (
      <button
        key={item.label}
        role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
        aria-checked={item.checked}
        disabled={item.disabled}
        tabIndex={-1}
        onClick={() => {
          done();
          item.run();
        }}
      >
        <span className="menu-check" aria-hidden="true">
          {item.checked && <Check size={13} />}
        </span>
        <span className="menu-label">{item.label}</span>
        {item.shortcut && <kbd>{item.shortcut}</kbd>}
      </button>
    ),
  );
}

/** Menu opened at the pointer, sharing the menu bar's items and keyboard behaviour. */
export function ContextMenu({
  x,
  y,
  label,
  items,
  close,
  exiting = false,
}: {
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
  close: () => void;
  exiting?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x, y });
  useLayoutEffect(() => {
    if (exiting) return;
    const r = root.current!.getBoundingClientRect();
    setAt({
      x: Math.max(4, Math.min(x, innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(y, innerHeight - r.height - 4)),
    });
    root.current?.querySelector<HTMLElement>('[role^=menuitem]:not(:disabled)')?.focus();
  }, [x, y, exiting]);
  useEffect(() => {
    if (exiting) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        consumeSceneDismiss(e);
        close();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', close);
    };
  }, [close, exiting]);
  return (
    <div
      ref={root}
      className="menubar-dropdown context-menu"
      role="menu"
      aria-label={label}
      aria-hidden={exiting || undefined}
      data-motion="context"
      data-state={exiting ? 'closing' : 'open'}
      inert={exiting || undefined}
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        const list = [
          ...root.current!.querySelectorAll<HTMLButtonElement>('[role^=menuitem]:not(:disabled)'),
        ];
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
        } else if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault();
          close();
        }
      }}
    >
      {renderItems(items, close)}
    </div>
  );
}

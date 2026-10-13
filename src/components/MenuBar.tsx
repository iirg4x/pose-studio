import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Check } from 'lucide-react';

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
  const root = useRef<HTMLDivElement>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const close = (focusTrigger = false) => {
    if (focusTrigger && open !== null) triggers.current[open]?.focus();
    setOpen(null);
  };
  useEffect(() => {
    if (open === null) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  useEffect(() => {
    if (open === null) return;
    root.current
      ?.querySelector<HTMLElement>('[role=menu] [role^=menuitem]:not(:disabled)')
      ?.focus();
  }, [open]);
  const items = () => [
    ...(root.current?.querySelectorAll<HTMLButtonElement>(
      '[role=menu] [role^=menuitem]:not(:disabled)',
    ) ?? []),
  ];
  const onMenuKey = (e: ReactKeyboardEvent) => {
    const list = items(),
      i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      list[(i + step + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      setOpen((o) => (o === null ? o : (o + step + menus.length) % menus.length));
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault();
      close(e.key === 'Escape');
    }
  };
  return (
    <div className="menubar" role="menubar" aria-label="Main menu" ref={root}>
      {menus.map((menu, m) => (
        <div className="menubar-menu" key={menu.label}>
          <button
            ref={(el) => {
              triggers.current[m] = el;
            }}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === m}
            disabled={disabled}
            className="menubar-trigger"
            onClick={() => setOpen(open === m ? null : m)}
            onPointerEnter={() => open !== null && open !== m && setOpen(m)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(m);
              } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                triggers.current[
                  (m + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length
                ]?.focus();
              }
            }}
          >
            {menu.label}
          </button>
          {open === m && (
            <div
              className="menubar-dropdown"
              role="menu"
              aria-label={menu.label}
              onKeyDown={onMenuKey}
            >
              {menu.items.map((item, i) =>
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
                      close(true);
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
              )}
              {menu.footer}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

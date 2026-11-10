import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ContextMenu } from './MenuBar';
import type { MenuItem } from './MenuBar';
import { usePresence } from '../hooks';

/** The viewport's own View menu: framing, cameras and scene presentation. */
export function ViewportMenu({ items }: { items: MenuItem[] }) {
  const trigger = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState<{ x: number; y: number } | null>(null),
    presence = usePresence(open);
  return (
    <nav className="viewport-menu" aria-label="Viewport" data-editor-overlay>
      <button
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={!!open}
        onClick={() => {
          const r = trigger.current!.getBoundingClientRect();
          setOpen(open ? null : { x: r.left, y: r.bottom + 4 });
        }}
      >
        <span>View</span>
        <ChevronDown size={12} />
      </button>
      {presence.value && (
        <ContextMenu
          x={presence.value.x}
          y={presence.value.y}
          label="View"
          items={items}
          exiting={presence.exiting}
          close={() => {
            setOpen(null);
            trigger.current?.focus();
          }}
        />
      )}
    </nav>
  );
}

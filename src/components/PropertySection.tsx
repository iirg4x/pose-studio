import { Collapse } from './Motion';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
export function PropertySection({
  id,
  title,
  children,
  defaultOpen = true,
  collapsible = true,
  headerAction,
}: {
  id: string;
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  collapsible?: boolean;
  headerAction?: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try {
      const value = localStorage.getItem('pose-property-' + id);
      return value === null ? defaultOpen : value === 'true';
    } catch {
      return defaultOpen;
    }
  });
  return (
    <section className="property-section" data-property-section={id}>
      {collapsible &&
        (headerAction == null ? (
          <button
            type="button"
            className="property-header"
            aria-expanded={open}
            aria-controls={'property-' + id}
            onClick={() => {
              setOpen(!open);
              try {
                localStorage.setItem('pose-property-' + id, String(!open));
              } catch {}
            }}
          >
            <ChevronDown className="property-chevron" data-open={open} size={14} />
            <span>{title}</span>
          </button>
        ) : (
          <div className="property-header property-header-with-action">
            <button
              type="button"
              className="property-header-toggle"
              aria-expanded={open}
              aria-controls={'property-' + id}
              onClick={() => {
                setOpen(!open);
                try {
                  localStorage.setItem('pose-property-' + id, String(!open));
                } catch {}
              }}
            >
              <ChevronDown className="property-chevron" data-open={open} size={14} />
              <span>{title}</span>
            </button>
            <div className="property-header-action">{headerAction}</div>
          </div>
        ))}
      <Collapse open={!collapsible || open}>
        <div className="property-content" id={'property-' + id}>
          {children}
        </div>
      </Collapse>
    </section>
  );
}

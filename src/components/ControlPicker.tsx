import { useEffect, useId, useRef, useState } from 'react';
import { useStudio } from '../hooks';
import { Check, ChevronDown } from 'lucide-react';
import { controlLabels, visibleControls } from '../core/model';
import type { ControlId, RigLayer } from '../core/model';

export function ControlPicker({
  value,
  layer,
  onChange,
}: {
  value: ControlId;
  layer: RigLayer;
  onChange: (value: ControlId) => void;
}) {
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(value),
    host = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    id = useId();
  const project = useStudio().project,
    labels = controlLabels(project),
    options = visibleControls(layer, project);
  useEffect(() => {
    setActive(value);
    setOpen(false);
  }, [value, layer]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const choose = (control: ControlId) => {
    onChange(control);
    setOpen(false);
    button.current?.focus();
  };
  const move = (next: ControlId) => {
    setActive(next);
    requestAnimationFrame(() =>
      document.getElementById(id + '-' + next)?.scrollIntoView({ block: 'nearest' }),
    );
  };
  return (
    <div className="control-picker" ref={host}>
      <button
        ref={button}
        className="control-picker-trigger"
        role="combobox"
        aria-label="Selected control"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-activedescendant={open ? id + '-' + active : undefined}
        onClick={() => {
          setActive(value);
          setOpen(!open);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (e.key === 'Tab') {
            setOpen(false);
            return;
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            open ? choose(active) : setOpen(true);
            return;
          }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
            const index = options.indexOf(active),
              next =
                e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? options.length - 1
                    : (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            move(options[next]);
            return;
          }
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            e.stopPropagation();
            e.preventDefault();
            setOpen(true);
            const next = options.find((x) =>
              labels[x].toLowerCase().startsWith(e.key.toLowerCase()),
            );
            if (next) move(next);
          }
        }}
      >
        {labels[value]}
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="control-picker-options" id={id} role="listbox" aria-label="Rig controls">
          {options.map((option) => (
            <button
              id={id + '-' + option}
              key={option}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected={value === option}
              className={active === option ? 'highlighted' : ''}
              onPointerMove={() => setActive(option)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
            >
              <span>{labels[option]}</span>
              {value === option && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

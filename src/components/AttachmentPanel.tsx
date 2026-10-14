import { MotionPresence } from './Motion';
import { isTouch as isAndroid } from '../platform/storage';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bone,
  Check,
  ChevronDown,
  CornerUpLeft,
  Diamond,
  Globe,
  Move,
  Pipette,
  RotateCw,
  Search,
  Waypoints,
} from 'lucide-react';
import { useStudioChrome } from '../hooks';
import { useTransientPopover } from '../hooks/transientPopover';
import { studio } from '../core/store';
import { boneFollowing } from '../core/boneFollowing';
import { controlLabel, visibleControls } from '../core/model';
import { isBoneControl, CONTROLS } from '../core/controls';
import type { AttachmentTarget } from '../scene/attachments';
import { PropertySection } from './PropertySection';
export function AttachmentPanel({
  attach,
  pick,
}: {
  attach: (target: AttachmentTarget, position: boolean, rotation: boolean) => void;
  pick: () => void;
}) {
  const s = useStudioChrome({ edits: 'live' }),
    [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [active, setActive] = useState(0),
    [bounds, setBounds] = useState({ left: 0, top: 0, width: 240, height: 280 });
  const host = useRef<HTMLDivElement>(null),
    popup = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    listId = useId();
  const popover = useTransientPopover({
    owner: 'attachment-parent',
    open,
    onClose: () => setOpen(false),
    rootRef: popup,
    triggerRef: trigger,
  });
  useEffect(() => {
    setOpen(false);
    setSearch('');
  }, [s.selected]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const scroll = (e: Event) => {
      if (!popup.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  if (!s.project) return null;
  const id = s.selected,
    key = boneFollowing(s.project, s.frame)[id],
    legacy = studio.parent(),
    target = key?.target ?? (isBoneControl(id) ? 'native' : legacy === 'world' ? 'root' : legacy),
    position = key?.position ?? true,
    rotation = key?.rotation ?? true;
  const options: { value: AttachmentTarget; label: string; group: string }[] = [
    { value: 'native', label: 'Original parent', group: 'Spaces' },
    { value: 'world', label: 'World space', group: 'Spaces' },
    ...(id !== 'root' ? [{ value: 'root' as const, label: 'Root space', group: 'Spaces' }] : []),
    ...visibleControls(s.project.editing, s.project)
      .filter((k) => k !== id && k !== 'root')
      .map((k) => ({ value: k, label: controlLabel(k, s.project), group: CONTROLS[k].group })),
  ];
  const filtered = options.filter((o) =>
      (o.label + ' ' + o.group).toLowerCase().includes(search.toLowerCase()),
    ),
    label =
      options.find((o) => o.value === target)?.label ?? controlLabel(target as never, s.project),
    Icon =
      target === 'world'
        ? Globe
        : target === 'root'
          ? Waypoints
          : target === 'native'
            ? CornerUpLeft
            : Bone;
  const choose = (value: AttachmentTarget) => {
    attach(value, position, rotation);
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const show = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = host.current!.getBoundingClientRect(),
      height = Math.min(320, Math.max(innerHeight - r.bottom - 16, r.top - 16));
    setBounds({
      left: Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 256) - 8)),
      top: innerHeight - r.bottom >= height ? r.bottom + 4 : r.top - height - 4,
      width: Math.max(r.width, 256),
      height,
    });
    setSearch('');
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === target),
      ),
    );
    popover.announce();
    setOpen(true);
  };
  return (
    <PropertySection id="attachment" title="Attachment" defaultOpen={false}>
      <div className="attachment-editor">
        <div className="attachment-target" ref={host}>
          <button
            ref={trigger}
            className="attachment-target-button"
            role="combobox"
            aria-label="Attachment parent"
            aria-haspopup="listbox"
            aria-controls={open ? listId : undefined}
            aria-expanded={open}
            title={'Parent · ' + label}
            onClick={show}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                show();
              }
            }}
          >
            <Icon size={14} />
            <span>{label}</span>
            <ChevronDown size={13} />
          </button>
          <button
            className="attachment-pick"
            aria-label="Pick attachment parent"
            title="Pick a bone or prop in the viewport · Esc cancels"
            onClick={() => {
              setOpen(false);
              pick();
            }}
          >
            <Pipette size={15} />
          </button>
        </div>
        <div className="attachment-inherit">
          <span>Inherit</span>
          <div role="group" aria-label="Inherited channels">
            <button
              aria-label="Follow position"
              aria-pressed={position}
              title="Inherit parent movement; changing this keeps the current pose"
              onClick={() => attach(target, !position, rotation)}
            >
              <Move size={13} />
              Position
            </button>
            <button
              aria-label="Follow rotation"
              aria-pressed={rotation}
              title="Inherit parent rotation; changing this keeps the current pose"
              onClick={() => attach(target, position, !rotation)}
            >
              <RotateCw size={13} />
              Rotation
            </button>
          </div>
        </div>
        <div
          className="attachment-key-status"
          title="Parent and inheritance changes are keyed at this frame without changing the current pose."
        >
          <Diamond size={10} />
          <span>
            Keys at frame <b>{s.frame}</b>
          </span>
        </div>
      </div>
      {createPortal(
        <MotionPresence show={open}>
          <div
            ref={popup}
            className="attachment-popover"
            role="dialog"
            aria-label="Attachment parent"
            data-editor-overlay
            style={{
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              maxHeight: bounds.height,
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                trigger.current?.focus();
              } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                const next =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? filtered.length - 1
                      : Math.max(
                          0,
                          Math.min(filtered.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)),
                        );
                setActive(next);
                document.getElementById(listId + '-' + next)?.scrollIntoView({ block: 'nearest' });
              } else if (e.key === 'Enter' && filtered[active]) {
                e.preventDefault();
                choose(filtered[active].value);
              } else if (e.key === 'Tab') setOpen(false);
            }}
          >
            <div className="attachment-search">
              <Search size={14} />
              <input
                autoFocus={!isAndroid}
                aria-label="Find attachment parent"
                placeholder="Search bones and props…"
                value={search}
                aria-controls={listId}
                aria-activedescendant={filtered[active] ? listId + '-' + active : undefined}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setActive(0);
                }}
              />
            </div>
            <div
              className="attachment-options"
              id={listId}
              role="listbox"
              aria-label="Attachment targets"
            >
              {filtered.map((o, i) => (
                <div key={o.value}>
                  {(i === 0 || filtered[i - 1].group !== o.group) && (
                    <div className="attachment-option-group">{o.group}</div>
                  )}
                  <button
                    role="option"
                    id={listId + '-' + i}
                    aria-selected={target === o.value}
                    tabIndex={-1}
                    className={i === active ? 'highlighted' : ''}
                    onPointerMove={() => setActive(i)}
                    onClick={() => choose(o.value)}
                  >
                    <span>{o.label}</span>
                    {target === o.value && <Check size={13} />}
                  </button>
                </div>
              ))}
              {!filtered.length && <p>No matching controls</p>}
            </div>
          </div>
        </MotionPresence>,
        document.body,
      )}
    </PropertySection>
  );
}

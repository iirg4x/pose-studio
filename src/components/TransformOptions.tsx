import { MotionPresence } from './Motion';
import { useEffect, useRef, useState } from 'react';
import {
  Move3D,
  Box,
  View,
  ChevronDown,
  Check,
  CircleDot,
  Focus,
  Crosshair,
  Scan,
  Orbit,
  RotateCcw,
} from 'lucide-react';
import { studio } from '../core/store';
import { useStudioSelector } from '../hooks';
import type { TransformOrientation, TransformPivot } from '../scene/transformOptions';
import { useTransientPopover } from '../hooks/transientPopover';
const orientations = [
  ['world', 'Global', Move3D, 'Fixed scene axes'],
  ['local', 'Local', Box, 'Active control axes'],
  ['view', 'View', View, 'Screen-aligned axes'],
] as const;
const pivots = [
  ['median', 'Median Point', Orbit, 'Average of selected control positions'],
  ['active', 'Active Element', CircleDot, 'Last selected control'],
  ['individual', 'Individual Origins', Focus, 'Rotate each control around itself'],
  ['bounds', 'Bounding Box Center', Scan, 'Center of the selection bounds'],
  ['cursor', '3D Cursor', Crosshair, 'Shift + right-click to place the cursor'],
] as const;
export function TransformOptions({ compact = false }: { compact?: boolean }) {
  const s = useStudioSelector(
      (s) => ({ transformSpace: s.transformSpace, transformPivot: s.transformPivot }),
      (a, b) => a.transformSpace === b.transformSpace && a.transformPivot === b.transformPivot,
    ),
    [open, setOpen] = useState<'orientation' | 'pivot' | null>(null),
    ref = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    popover = useTransientPopover({
      owner: 'transform-options',
      open: !!open,
      onClose: () => setOpen(null),
      rootRef: ref,
      triggerRef: trigger,
    });
  const orientation = orientations.find((o) => o[0] === s.transformSpace)!,
    pivot = pivots.find((p) => p[0] === s.transformPivot)!,
    O = orientation[2],
    P = pivot[2];
  useEffect(() => {
    const menu = (e: Event) => {
      popover.announce();
      setOpen((e as CustomEvent<'orientation' | 'pivot'>).detail);
    };
    window.addEventListener('transform-options', menu);
    return () => window.removeEventListener('transform-options', menu);
  }, [popover]);
  useEffect(() => {
    if (open)
      ref.current?.querySelector<HTMLButtonElement>('[role=menu] [aria-checked=true]')?.focus();
  }, [open]);
  return (
    <div
      className="transform-options"
      ref={ref}
      data-editor-overlay={open ? '' : undefined}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          popover.close(true);
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const items = [...ref.current!.querySelectorAll<HTMLButtonElement>('[role=menu] button')],
            i = items.indexOf(document.activeElement as HTMLButtonElement),
            next =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? items.length - 1
                  : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        ref={open === 'pivot' ? undefined : trigger}
        className="orientation-trigger"
        aria-label="Transform orientation"
        title="Transform orientation (,) · manipulation axes only"
        aria-haspopup="menu"
        aria-expanded={open === 'orientation'}
        onClick={() => {
          if (open === 'orientation') setOpen(null);
          else {
            popover.announce();
            setOpen('orientation');
          }
        }}
      >
        <O size={18} />
        <span>{orientation[1]}</span>
        <ChevronDown size={12} />
      </button>
      <button
        ref={open === 'pivot' ? trigger : undefined}
        className="pivot-trigger"
        aria-label="Transform pivot point"
        title={pivot[1] + ' (.)'}
        aria-haspopup="menu"
        aria-expanded={open === 'pivot'}
        onClick={() => {
          if (open === 'pivot') setOpen(null);
          else {
            popover.announce();
            setOpen('pivot');
          }
        }}
      >
        <P size={19} />
        {compact && (
          <span>
            {
              {
                median: 'Median',
                active: 'Active',
                individual: 'Individual',
                bounds: 'Bounds',
                cursor: 'Cursor',
              }[s.transformPivot]
            }
          </span>
        )}
        <ChevronDown size={12} />
      </button>
      <MotionPresence show={!!open}>
        <div
          className={'transform-popover ' + open}
          role="menu"
          aria-label={open === 'orientation' ? 'Transform orientations' : 'Pivot points'}
        >
          <h4 className="context-flair">
            {open === 'orientation' ? 'Transform Orientation' : 'Transform Pivot Point'}
          </h4>
          {(open === 'orientation' ? orientations : pivots).map(([id, name, Icon, description]) => (
            <button
              key={id}
              title={description}
              role="menuitemradio"
              aria-checked={(open === 'orientation' ? s.transformSpace : s.transformPivot) === id}
              onClick={() => {
                studio.setTransformOptions(
                  open === 'orientation'
                    ? { transformSpace: id as TransformOrientation }
                    : { transformPivot: id as TransformPivot },
                );
                setOpen(null);
                document.querySelector<HTMLCanvasElement>('.scene-canvas')?.focus();
              }}
            >
              <Icon size={16} />
              <span>
                {name}
                <small>{description}</small>
              </span>
              {(open === 'orientation' ? s.transformSpace : s.transformPivot) === id && (
                <Check size={14} />
              )}
            </button>
          ))}
          {open === 'pivot' && (
            <button
              className="cursor-reset"
              onClick={() => studio.setTransformOptions({ cursorPosition: [0, 0, 0] })}
            >
              <RotateCcw size={14} />
              Reset cursor to origin
            </button>
          )}
        </div>
      </MotionPresence>
    </div>
  );
}

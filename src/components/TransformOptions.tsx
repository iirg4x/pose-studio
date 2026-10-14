import { MotionPresence } from './Motion';
import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState } from 'react';
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
import { usePopupPlacement } from '../hooks/usePopupPlacement';
import { useTransientPopover } from '../hooks/transientPopover';
const orientations = [
  ['world', 'World', Move3D, 'Fixed scene axes'],
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
    menuId = useId(),
    ref = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null),
    orientationTrigger = useRef<HTMLButtonElement>(null),
    pivotTrigger = useRef<HTMLButtonElement>(null),
    lastTrigger = useRef<HTMLButtonElement | null>(null),
    restoreFocus = useRef(false),
    anchor = open === 'pivot' ? pivotTrigger : orientationTrigger;
  useEffect(() => {
    // useTransientPopover owns the document-level Escape listener. Register
    // this capture observer first so a portal Escape can restore focus to the
    // actual trigger even though the transient hook closes before bubbling.
    // A portaled menu is outside the trigger's [data-editor-overlay] root, so
    // the transient hook intentionally ignores Escape while the trigger has
    // focus. Handle that case here before the hook sees the event.
    const onEscape = (event: KeyboardEvent) => {
      if (!open || event.key !== 'Escape') return;
      const target = event.target as Node | null;
      if (target && panel.current?.contains(target)) {
        restoreFocus.current = true;
        return;
      }
      if (target && ref.current?.contains(target)) {
        event.preventDefault();
        event.stopPropagation();
        restoreFocus.current = true;
        setOpen(null);
      }
    };
    document.addEventListener('keydown', onEscape, true);
    return () => document.removeEventListener('keydown', onEscape, true);
  }, [open]);
  const popover = useTransientPopover({
      owner: 'transform-options',
      open: !!open,
      onClose: () => setOpen(null),
      // The menu is portaled; use the panel for menu containment and the
      // wrapper for both triggers so switching Orientation ↔ Pivot remains a
      // single interaction rather than an outside-click dismissal.
      rootRef: panel,
      triggerRef: ref,
    }),
    position = usePopupPlacement({
      open: !!open,
      panel,
      anchor,
      placement: 'above-end',
      fallbackWidth: 320,
      fallbackHeight: 430,
      margin: 8,
      gap: 8,
    });
  const orientation = orientations.find((o) => o[0] === s.transformSpace)!,
    pivot = pivots.find((p) => p[0] === s.transformPivot)!,
    O = orientation[2],
    P = pivot[2];
  useEffect(() => {
    const menu = (e: Event) => {
      popover.announce();
      const next = (e as CustomEvent<'orientation' | 'pivot'>).detail;
      restoreFocus.current = false;
      lastTrigger.current = (next === 'pivot' ? pivotTrigger : orientationTrigger).current;
      setOpen(next);
    };
    window.addEventListener('transform-options', menu);
    return () => window.removeEventListener('transform-options', menu);
  }, [orientationTrigger, pivotTrigger, popover]);
  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() =>
        panel.current
          ?.querySelector<HTMLButtonElement>('[role=menuitemradio][aria-checked=true]')
          ?.focus({ preventScroll: true }),
      );
      return () => cancelAnimationFrame(frame);
    }
    if (restoreFocus.current) {
      restoreFocus.current = false;
      requestAnimationFrame(() => lastTrigger.current?.focus({ preventScroll: true }));
    }
  }, [open]);
  const toggle = (next: 'orientation' | 'pivot', button: HTMLButtonElement | null) => {
    if (open === next) {
      setOpen(null);
      return;
    }
    restoreFocus.current = false;
    lastTrigger.current = button;
    popover.announce();
    setOpen(next);
  };
  return (
    <div className="transform-options" ref={ref} data-editor-overlay={open ? '' : undefined}>
      <button
        ref={orientationTrigger}
        className="orientation-trigger"
        aria-label={`Transform orientation: ${orientation[1]}`}
        title="Transform orientation (,) · manipulation axes only"
        aria-haspopup="menu"
        aria-expanded={open === 'orientation'}
        aria-controls={menuId}
        onClick={(event) => toggle('orientation', event.currentTarget)}
      >
        <O size={18} />
        <span>{orientation[1]}</span>
        <ChevronDown size={12} />
      </button>
      <button
        ref={pivotTrigger}
        className="pivot-trigger"
        aria-label={`Transform pivot point: ${pivot[1]}`}
        title={`Pivot: ${pivot[1]} (.)`}
        aria-haspopup="menu"
        aria-expanded={open === 'pivot'}
        aria-controls={menuId}
        onClick={(event) => toggle('pivot', event.currentTarget)}
      >
        <P size={19} />
        {compact && <span>Pivot</span>}
        <ChevronDown size={12} />
      </button>
      {createPortal(
        <MotionPresence show={!!open}>
          <div
            ref={panel}
            id={menuId}
            className={'transform-popover ' + open}
            role="menu"
            aria-label={open === 'orientation' ? 'Transform orientations' : 'Pivot points'}
            data-editor-overlay
            style={{
              position: 'fixed',
              ...position,
              bottom: 'auto',
              right: 'auto',
              width: 'min(320px, calc(100vw - 16px))',
              maxWidth: position.maxWidth,
              maxHeight: position.maxHeight,
              overflowY: 'auto',
              zIndex: 1000,
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (!open) return;
              if (e.key === 'Escape') {
                e.preventDefault();
                restoreFocus.current = true;
                popover.close(true);
                return;
              }
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                const items = [
                    ...panel.current!.querySelectorAll<HTMLButtonElement>('[role=menu] button'),
                  ],
                  i = items.indexOf(document.activeElement as HTMLButtonElement),
                  next =
                    e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? items.length - 1
                        : e.key === 'ArrowDown'
                          ? i < 0
                            ? 0
                            : (i + 1) % items.length
                          : i <= 0
                            ? items.length - 1
                            : i - 1;
                items[next]?.focus();
              }
            }}
          >
            <h4 className="context-flair">
              {open === 'orientation' ? 'Transform Orientation' : 'Transform Pivot Point'}
            </h4>
            {(open === 'orientation' ? orientations : pivots).map(
              ([id, name, Icon, description]) => (
                <button
                  key={id}
                  title={description}
                  role="menuitemradio"
                  aria-checked={
                    (open === 'orientation' ? s.transformSpace : s.transformPivot) === id
                  }
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
              ),
            )}
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
        </MotionPresence>,
        document.body,
      )}
    </div>
  );
}

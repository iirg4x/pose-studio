import { useEffect, useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { studio } from '../core/store';
import { clone } from '../core/model';

// A click enters text editing; a drag adjusts the value as one undo gesture.
export function ScrubNumber(props: InputHTMLAttributes<HTMLInputElement>) {
  const input = useRef<HTMLInputElement>(null),
    [typing, setTyping] = useState(false),
    cleanup = useRef<(() => void) | null>(null);
  const drag = useRef<null | {
    start: number;
    last: number;
    initial: number;
    value: number;
    moved: boolean;
    frame: number;
    drafts: typeof studio.state.drafts;
  }>(null);
  const finish = (cancel = false) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    cleanup.current?.();
    cleanup.current = null;
    if (d.moved) {
      if (cancel) {
        studio.cancelGesture();
        studio.patch({ drafts: d.drafts, frame: d.frame });
      } else studio.endGesture();
      setTyping(false);
      input.current?.blur();
    } else {
      setTyping(true);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
    }
  };
  useEffect(
    () => () => {
      cleanup.current?.();
      if (drag.current?.moved) studio.endGesture();
    },
    [],
  );
  return (
    <input
      {...props}
      ref={input}
      type="number"
      className={['scrub-number', typing ? 'typing' : '', props.className ?? ''].join(' ')}
      readOnly={props.readOnly || !typing}
      title={props.title ?? 'Drag to adjust · Shift: fine · Ctrl: snap · click to type'}
      onFocus={(e) => {
        if (!drag.current) setTyping(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setTyping(false);
        props.onBlur?.(e);
      }}
      onPointerDown={(e) => {
        props.onPointerDown?.(e);
        if (
          e.button !== 0 ||
          props.disabled ||
          props.readOnly ||
          (typing && document.activeElement === e.currentTarget)
        )
          return;
        e.preventDefault();
        const value = Number(e.currentTarget.value) || 0;
        drag.current = {
          start: e.clientX,
          last: e.clientX,
          initial: value,
          value,
          moved: false,
          frame: studio.state.frame,
          drafts: clone(studio.state.drafts),
        };
        e.currentTarget.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        const escape = (event: KeyboardEvent) => {
          if (event.key === 'Escape' && drag.current) {
            event.preventDefault();
            event.stopImmediatePropagation();
            finish(true);
          }
        };
        window.addEventListener('keydown', escape, true);
        cleanup.current = () => window.removeEventListener('keydown', escape, true);
      }}
      onPointerMove={(e) => {
        props.onPointerMove?.(e);
        const d = drag.current;
        if (!d) return;
        if (!d.moved && Math.abs(e.clientX - d.start) < 3) return;
        if (!d.moved) {
          d.moved = true;
          studio.beginGesture();
          setTyping(false);
        }
        e.preventDefault();
        const step = Number(props.step) > 0 ? Number(props.step) : 1;
        d.value += (e.clientX - d.last) * step * 0.1 * (e.shiftKey ? 0.1 : 1);
        d.last = e.clientX;
        let value = e.ctrlKey ? Math.round(d.value / step) * step : d.value;
        if (props.min !== undefined) value = Math.max(Number(props.min), value);
        if (props.max !== undefined) value = Math.min(Number(props.max), value);
        value = Number(value.toFixed(6));
        // Bypass React's value tracker so this is handled by the field's ordinary
        // onChange, including its unit conversion, validation and animation keying.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          e.currentTarget,
          String(value),
        );
        e.currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
      }}
      onPointerUp={(e) => {
        props.onPointerUp?.(e);
        finish();
      }}
      onPointerCancel={(e) => {
        props.onPointerCancel?.(e);
        finish(true);
      }}
      onLostPointerCapture={(e) => {
        props.onLostPointerCapture?.(e);
        if (drag.current?.moved) finish(true);
      }}
      onKeyDown={(e) => {
        props.onKeyDown?.(e);
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

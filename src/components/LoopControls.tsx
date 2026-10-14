import { MotionPresence } from './Motion';
import { ScrubNumber } from './ScrubNumber';
import { createPortal } from 'react-dom';
import { useMemo, useRef, useState } from 'react';
import { Repeat2, ChevronDown, X } from 'lucide-react';
import { studio } from '../core/store';
import { useStudioChrome } from '../hooks';
import { loopRange, seamReport } from '../core/loops';
import { usePopupPlacement } from '../hooks/usePopupPlacement';
import { useTransientPopover } from '../hooks/transientPopover';
export function LoopControls() {
  const s = useStudioChrome({ frame: 'none' }),
    [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    popover = useTransientPopover({
      owner: 'loop-controls',
      open,
      onClose: () => setOpen(false),
      rootRef: panel,
      triggerRef: trigger,
    }),
    position = usePopupPlacement({
      open,
      panel,
      anchor: trigger,
      placement: 'above-end',
      fallbackWidth: 400,
      fallbackHeight: 420,
    });
  const seams = useMemo(() => (open && s.project ? seamReport(s.project) : []), [open, s.project]);
  if (!s.project) return null;
  const p = s.project,
    range = loopRange(p);
  return (
    <div className="loop-controls" ref={root}>
      <button
        className={range.enabled ? 'enabled' : ''}
        title="Loop playback in the chosen range"
        aria-label="Loop playback"
        aria-pressed={range.enabled}
        onClick={() => studio.setLoop({ enabled: !range.enabled })}
      >
        <Repeat2 size={16} />
        <span>Loop</span>
      </button>
      <button
        ref={trigger}
        className="loop-settings-toggle"
        aria-label="Loop settings"
        aria-expanded={open}
        onClick={() => {
          if (open) setOpen(false);
          else {
            popover.announce();
            setOpen(true);
          }
        }}
      >
        <ChevronDown size={13} />
      </button>
      {createPortal(
        <MotionPresence show={open}>
          <section
            ref={panel}
            style={{
              position: 'fixed',
              ...position,
              bottom: 'auto',
              right: 'auto',
              width: 'min(400px, calc(100vw - 32px))',
              maxWidth: position.maxWidth,
              maxHeight: position.maxHeight,
              overflowY: 'auto',
              zIndex: 1000,
            }}
            className="loop-panel"
            role="dialog"
            aria-label="Loop settings panel"
          >
            <header>
              <h3>Animation loop</h3>
              <button aria-label="Close loop settings" onClick={() => setOpen(false)}>
                <X size={15} />
              </button>
            </header>
            <div className="loop-range-fields">
              <label>
                Start
                <ScrubNumber
                  aria-label="Loop start"
                  type="number"
                  min={0}
                  max={range.end - 1}
                  value={range.start}
                  onChange={(e) => studio.setLoop({ start: Number(e.target.value) })}
                />
              </label>
              <label>
                End
                <ScrubNumber
                  aria-label="Loop end"
                  type="number"
                  min={range.start + 1}
                  max={p.end}
                  value={range.end}
                  onChange={(e) => studio.setLoop({ end: Number(e.target.value) })}
                />
              </label>
              <button onClick={() => studio.setLoop({ start: 0, end: p.end })}>
                Entire animation
              </button>
            </div>
            <p>
              {range.end - range.start} frame intervals ·{' '}
              {((range.end - range.start) / p.fps).toFixed(2)} seconds. Playback wraps before
              holding the closing frame twice.
            </p>
            <div className="seam-table">
              <span>End → start gap</span>
              <span>Position</span>
              <span>Rotation</span>
              <span>Grip</span>
              {seams.map((result) => (
                <div key={result.layer}>
                  <strong>{result.layer === 'firstPerson' ? 'First person' : 'Full body'}</strong>
                  <span>{result.position.toFixed(2)} cm</span>
                  <span>{result.rotation.toFixed(2)}°</span>
                  <span>{result.grip.toFixed(1)}%</span>
                </div>
              ))}
            </div>
            <button className="wide-button" onClick={() => studio.matchLoop()}>
              Match end pose to start · both rigs
            </button>
            <p>
              This matches poses, not velocities. Adjust tangents for a smooth join. Modifiers and
              contacts stay active.
            </p>
            <p className="loop-speed">
              Position velocity gap: FP {seams[0]?.speed.toFixed(2)} · Body{' '}
              {seams[1]?.speed.toFixed(2)} cm/frame. Camera FOV gap: {seams[0]?.fov.toFixed(2)}°.
            </p>
          </section>
        </MotionPresence>,
        document.body,
      )}
    </div>
  );
}

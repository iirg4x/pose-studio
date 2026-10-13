import { MotionPresence, Collapse } from './Motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Diamond, X, Copy, ClipboardPaste, FlipHorizontal2, Trash2 } from 'lucide-react';
import { studio } from '../core/store';
import { useStudioChrome } from '../hooks';
import { selectedCurveKeys } from '../core/timelineSettings';
import { loopRange } from '../core/loops';
import { MotionSettings } from './MotionSettings';
import { InterpolationSettings, HandleSettings } from './InterpolationSettings';

export function KeyframeSettings({
  x,
  y,
  close,
  open = true,
}: {
  x: number;
  y: number;
  close: () => void;
  open?: boolean;
}) {
  const s = useStudioChrome({ frame: 'none' }),
    root = useRef<HTMLDivElement>(null),
    keys = open && s.project ? selectedCurveKeys(s.project, s.timelineSelection) : [],
    modes = new Set(keys.map((k) => k.interpolation)),
    handles = new Set(keys.map((k) => k.handle));
  const mode = modes.size === 1 ? keys[0].interpolation : 'mixed',
    handle = handles.size === 1 ? keys[0].handle : 'mixed';
  const loop =
    !!s.project &&
    s.timelineSelection.some((k) =>
      Object.values(s.project!.tracks[k.id].curves ?? {}).some((c) => c?.loop),
    );
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: innerHeight - 16 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = root.current;
      if (!el) return;
      const viewport = window.visualViewport,
        width = viewport?.width ?? innerWidth,
        height = viewport?.height ?? innerHeight,
        left = viewport?.offsetLeft ?? 0,
        top = viewport?.offsetTop ?? 0;
      setPosition({
        left: Math.max(left + 8, Math.min(x, left + width - el.offsetWidth - 8)),
        top: Math.max(
          top + 8,
          Math.min(y, top + height - Math.min(el.offsetHeight, height - 16) - 8),
        ),
        maxHeight: height - 16,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (root.current) observer.observe(root.current);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open, x, y]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', outside, true);
    root.current?.focus();
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [close, open]);
  return createPortal(
    <MotionPresence show={open}>
      <div
        className="keyframe-settings"
        ref={root}
        tabIndex={-1}
        role="dialog"
        aria-label="Keyframe settings"
        data-editor-overlay
        style={position}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      >
        <header>
          <Diamond size={14} />
          <strong>Keyframes</strong>
          <span className="key-settings-count">{s.timelineSelection.length} selected</span>
          <button aria-label="Close keyframe settings" title="Close" onClick={close}>
            <X size={15} />
          </button>
        </header>
        <div className="key-settings-scroll" tabIndex={0} aria-label="Scroll keyframe settings">
          <InterpolationSettings
            mode={mode}
            change={(interpolation) => studio.setTimelineKeySettings({ interpolation })}
            loop={loop}
            loopChange={(loop) => studio.setTimelineKeySettings({ loop })}
            range={s.project ? loopRange(s.project) : { start: 0, end: 0 }}
            disabled={!keys.length}
          />
          <Collapse open={mode === 'bezier' || mode === 'loop'}>
            <HandleSettings
              value={handle}
              change={(handle) => studio.setTimelineKeySettings({ handle })}
            />
          </Collapse>
          {(mode === 'spring' || mode === 'bounce') && (
            <MotionSettings
              mode={mode}
              options={keys[0]}
              change={(settings) => studio.setTimelineKeySettings(settings)}
            />
          )}
          <p className="key-setting-note">
            {keys.length
              ? 'Interpolation changes the selected segments. Loop links only the playback endpoints.'
              : 'Attachment events switch spaces and have no interpolation.'}
          </p>
        </div>
        <div className="keyframe-context-actions">
          <button
            title="Copy selected keyframes (Ctrl C)"
            aria-label="Copy selected keyframes"
            onClick={() => {
              studio.copyTimeline();
              close();
            }}
          >
            <Copy size={15} />
          </button>
          <button
            title="Paste keyframes at playhead (Ctrl V)"
            aria-label="Paste copied keyframes"
            disabled={!s.keyClipboard}
            onClick={() => {
              studio.pasteTimeline();
              close();
            }}
          >
            <ClipboardPaste size={15} />
          </button>
          <button
            title="Paste mirrored keyframes at playhead (Ctrl Shift V)"
            aria-label="Paste mirrored keyframes"
            disabled={!s.keyClipboard}
            onClick={() => {
              window.dispatchEvent(new Event('pose-paste-mirrored-keys'));
              close();
            }}
          >
            <FlipHorizontal2 size={15} />
          </button>
          <button
            title="Delete selected keyframes"
            aria-label="Delete these keyframes"
            onClick={() => {
              studio.deleteTimeline();
              close();
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </MotionPresence>,
    document.body,
  );
}

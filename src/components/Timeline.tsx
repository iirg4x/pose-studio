import { createPortal } from 'react-dom';
import { AnimationMirror } from './AnimationMirror';
import { mirrorDriver } from '../core/liveMirror';
import { MirrorCurve } from './MirrorCurve';
import { LockKeyhole, UnlockKeyhole } from 'lucide-react';
import { memo, useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { loadTimelineCollapsed, revealTimelineControl } from '../core/timelineHierarchy';
import type { Channel } from '../core/curves';
import { channelsFor } from '../core/curves';
import type { ControlId } from '../core/model';
import { CurveTrackTree } from './TimelineTracks';
import type { TimelineTracksState } from './TimelineTracks';
import { ScrubNumber } from './ScrubNumber';
import { TimelineGrid } from './TimelineGrid';
import { CurveEditor } from './CurveEditor';
import { CurveReducer } from './CurveReducer';
import { LoopControls } from './LoopControls';
import { MotionPresence } from './Motion';
import {
  SkipBack,
  SkipForward,
  ListVideo,
  Spline,
  ChevronsUpDown,
  Scissors,
  X,
  MoreHorizontal,
} from 'lucide-react';
import { useStudioChrome } from '../hooks';
import { studio } from '../core/store';
import { timelineVisibleControls } from '../core/timelineChannels';
import { measureTouchViewport } from '../platform/touchViewport';

type TimelineMorePosition = {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
};

const initialTimelineMorePosition: TimelineMorePosition = {
  left: 8,
  top: 8,
  maxWidth: 320,
  maxHeight: 480,
};

const STANDARD_FRAME_RATES = [24, 25, 30, 48, 60] as const;

/** Keep the common transport rates while retaining an imported project's rate. */
export function frameRateOptions(current: number) {
  const rates = new Set<number>(STANDARD_FRAME_RATES);
  if (Number.isFinite(current) && current >= 1 && current <= 120) rates.add(current);
  return [...rates].sort((a, b) => a - b);
}

export const Timeline = memo(function Timeline({
  expanded = false,
  expand,
  close,
  exiting = false,
  split = false,
}: {
  expanded?: boolean;
  expand?: () => void;
  close?: () => void;
  exiting?: boolean;
  /** Desktop dock: shares the editor header; transport lives in the shell. */
  split?: boolean;
}) {
  const s = useStudioChrome({ frame: 'none' }),
    p = s.project;
  const [expandedChannels, setExpandedChannels] = useState<Set<ControlId>>(
    () => new Set(s.tab === 'curves' && s.selection.includes(s.selected) ? [s.selected] : []),
  );
  const [collapsed, setCollapsed] = useState(() =>
      p
        ? revealTimelineControl(
            timelineVisibleControls(p, s.selection, s.timelineFilter),
            loadTimelineCollapsed(),
            s.selected,
          )
        : loadTimelineCollapsed(),
    ),
    [query, setQuery] = useState(''),
    [channel, setChannel] = useState<Channel>('px');
  const [curveFocus, setCurveFocus] = useState<{ frame: number; serial: number } | undefined>();
  const [reducer, setReducer] = useState<{ channel?: Channel; frames: number[] } | null>(null);
  const [more, setMore] = useState(false);
  const moreTrigger = useRef<HTMLButtonElement>(null),
    morePanel = useRef<HTMLDivElement>(null);
  const [morePosition, setMorePosition] = useState<TimelineMorePosition>(
    initialTimelineMorePosition,
  );
  const touchBar = useRef<HTMLDivElement>(null);
  const [headerTools, setHeaderTools] = useState<HTMLDivElement | null>(null);
  const [inlineSettings, setInlineSettings] = useState(false);
  const placeMore = useCallback(() => {
    const viewport = measureTouchViewport({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        visualViewport: window.visualViewport,
      }),
      trigger = moreTrigger.current?.getBoundingClientRect();
    if (!viewport.width || !viewport.height) return;
    const inset = Math.max(4, split ? 12 : 8),
      gap = split ? 8 : 6,
      leftEdge = viewport.offsetLeft + inset,
      topEdge = viewport.offsetTop + inset,
      rightEdge = viewport.offsetLeft + viewport.width - inset,
      bottomEdge = viewport.offsetTop + viewport.height - inset,
      maxWidth = Math.max(1, rightEdge - leftEdge),
      maxHeight = Math.max(1, bottomEdge - topEdge),
      panel = morePanel.current,
      panelRect = panel?.getBoundingClientRect(),
      fallbackWidth = split ? 240 : 340,
      fallbackHeight = split ? 280 : 320,
      width = Math.min(
        panelRect?.width && panelRect.width > 0 ? panelRect.width : fallbackWidth,
        maxWidth,
      ),
      measuredHeight = Math.max(
        panelRect?.height && panelRect.height > 0 ? panelRect.height : 0,
        panel?.scrollHeight ?? 0,
      ),
      naturalHeight = Math.min(measuredHeight || fallbackHeight, maxHeight);
    let left = rightEdge - width,
      top = topEdge,
      availableHeight = maxHeight;
    if (trigger) {
      left = trigger.right - width;
      const belowTop = trigger.bottom + gap,
        belowRoom = Math.max(0, bottomEdge - belowTop),
        aboveRoom = Math.max(0, trigger.top - gap - topEdge),
        below = belowRoom >= naturalHeight || belowRoom >= aboveRoom;
      availableHeight = Math.max(1, below ? belowRoom : aboveRoom);
      const height = Math.min(naturalHeight, availableHeight);
      top = below ? belowTop : trigger.top - gap - height;
    }
    const next: TimelineMorePosition = {
      left: Math.min(Math.max(left, leftEdge), rightEdge - width),
      top: Math.min(Math.max(top, topEdge), bottomEdge - Math.min(naturalHeight, availableHeight)),
      maxWidth,
      maxHeight: availableHeight,
    };
    setMorePosition((current) =>
      current.left === next.left &&
      current.top === next.top &&
      current.maxWidth === next.maxWidth &&
      current.maxHeight === next.maxHeight
        ? current
        : next,
    );
  }, [split]);
  useLayoutEffect(() => {
    if (!more) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        placeMore();
      });
    };
    placeMore();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    if (morePanel.current) observer?.observe(morePanel.current);
    if (moreTrigger.current) observer?.observe(moreTrigger.current);
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('orientationchange', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [more, placeMore]);
  useLayoutEffect(() => {
    const bar = touchBar.current;
    if (!bar) return;
    const measure = (observedWidth?: number) => {
      const styles = getComputedStyle(bar);
      const horizontalPadding =
        (Number.parseFloat(styles.paddingLeft) || 0) +
        (Number.parseFloat(styles.paddingRight) || 0);
      const available = Math.max(
        0,
        observedWidth ?? Math.max(0, bar.clientWidth - horizontalPadding),
      );
      // The touch transport is owned by the workspace shell. Keep the
      // timeline header focused on Keys/Curves and the compact options menu;
      // the full settings row belongs in More on touch at every practical
      // tablet width.
      const next = available >= 1440;
      setInlineSettings((current) => (current === next ? current : next));
      if (next) setMore(false);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width));
      observer.observe(bar);
      return () => observer.disconnect();
    }
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [!!p, split]);
  useEffect(() => {
    if (!more) return;
    const outside = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (
        !t ||
        !t.closest(
          '.timeline-more-anchor, .timeline-more-portal, .active-layer-menu, .keyframe-menu, .loop-panel, .animation-mirror-panel',
        )
      )
        setMore(false);
    };
    const nested = () =>
      !!document.querySelector(
        '.loop-panel:not([inert]), .animation-mirror-panel:not([inert]), .keyframe-menu:not([inert])',
      );
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || nested()) return;
      e.preventDefault();
      setMore(false);
      touchBar.current
        ?.querySelector<HTMLButtonElement>('[aria-label="More timeline options"]')
        ?.focus();
    };
    const dismiss = (e: Event) => {
      if (e.defaultPrevented || nested()) return;
      e.preventDefault();
      setMore(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape);
    window.addEventListener('pose-dismiss-overlay', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('pose-dismiss-overlay', dismiss, true);
    };
  }, [more]);
  useEffect(() => setReducer(null), [s.workspace?.activeId, p?.activeLayerId, p?.editing]);
  const visible = p ? timelineVisibleControls(p, s.selection, s.timelineFilter) : [],
    visibilityKey = visible.join('|'),
    ids = useMemo(() => visible, [visibilityKey]);
  useEffect(() => {
    if (s.timelineSelection.some((k) => !ids.includes(k.id)))
      studio.selectTimeline(s.timelineSelection.filter((k) => ids.includes(k.id)));
  }, [visibilityKey]);
  const fold = (next: Set<ControlId>) => {
    setCollapsed(next);
    try {
      localStorage.setItem('pose-timeline-collapsed', JSON.stringify([...next]));
    } catch {}
  };
  useLayoutEffect(() => {
    if (!p) return;
    setCollapsed((old) => revealTimelineControl(ids, old, s.selected));
    if (s.tab === 'curves')
      setExpandedChannels((old) => (old.has(s.selected) ? old : new Set([...old, s.selected])));
  }, [s.selected, s.tab, visibilityKey]);
  useEffect(() => {
    if (p && !channelsFor(s.selected, p.tracks[s.selected]).includes(channel)) setChannel('px');
  }, [s.selected, p?.tracks[s.selected].rotationMode, channel]);
  const tracks: TimelineTracksState = {
    expanded: expandedChannels,
    collapsed,
    query,
    channel,
    fold,
    setQuery,
    toggleChannels: (id) =>
      setExpandedChannels((old) => {
        const next = new Set(old);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      }),
    openCurve: (id, axis, frame) => {
      studio.selectControl(id);
      setChannel(p && channelsFor(id, p.tracks[id]).includes(axis) ? axis : 'px');
      setExpandedChannels((old) => new Set([...old, id]));
      if (frame !== undefined) {
        studio.setFrame(frame);
        setCurveFocus({ frame, serial: Date.now() });
      } else setCurveFocus(undefined);
      studio.patch({ tab: 'curves' });
    },
  };
  if (!p) return <div className="timeline" />;
  const grid = (
    <TimelineGrid
      key={(s.workspace?.activeId ?? '') + p.editing}
      tracks={tracks}
      headerTools={headerTools}
    />
  );
  const curves = mirrorDriver(p, s.selected) ? (
    <MirrorCurve
      project={p}
      id={s.selected}
      channel={channel}
      sidebar={<CurveTrackTree state={tracks} ids={ids} />}
    />
  ) : (
    <CurveEditor
      key={(s.workspace?.activeId ?? '') + s.selected + p.editing + (p.activeLayerId ?? '')}
      channel={channel}
      focusKey={curveFocus}
      onReduce={(frames) => setReducer({ channel, frames })}
      sidebar={<CurveTrackTree state={tracks} ids={ids} />}
    />
  );
  const renderTimelineSettings = (mode: 'inline' | 'popup', portal = false) => (
    <div
      ref={portal ? morePanel : undefined}
      className={
        'touch-timeline-settings ' +
        (mode === 'inline' ? 'inline' : 'timeline-more') +
        (portal
          ? ' timeline-more-portal ' +
            (split ? 'timeline-more-portal-desktop' : 'timeline-more-portal-touch')
          : '')
      }
      data-inline={mode === 'inline' ? 'true' : 'false'}
      role="group"
      aria-label="Timeline options"
      style={
        portal
          ? {
              left: morePosition.left,
              top: morePosition.top,
              maxWidth: morePosition.maxWidth,
              maxHeight: morePosition.maxHeight,
            }
          : undefined
      }
    >
      {!split && (
        <div className="timeline-more-row timeline-frame-settings">
          <label className="timeline-more-length">
            <span>End</span>
            <ScrubNumber
              aria-label="Animation end frame"
              type="number"
              min={1}
              max={2400}
              value={p.end}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 1 && v <= 2400) studio.updateProject({ end: Math.round(v) });
              }}
            />
          </label>
          <button aria-label="First frame" onClick={() => studio.setFrame(0)}>
            <SkipBack size={17} />
          </button>
          <button aria-label="Last frame" onClick={() => studio.setFrame(p.end)}>
            <SkipForward size={17} />
          </button>
          <select
            aria-label="Frame rate"
            value={p.fps}
            onChange={(e) => studio.updateProject({ fps: Number(e.target.value) })}
          >
            {frameRateOptions(p.fps).map((v) => (
              <option key={v} value={v}>
                {v} fps
              </option>
            ))}
          </select>
          <LoopControls />
        </div>
      )}
      <div className="timeline-more-row timeline-edit-settings">
        <AnimationMirror />
        <KeyLockButton />
        <button
          aria-label="Reduce keyframes"
          onClick={() => {
            setMore(false);
            setReducer({
              channel: s.tab === 'curves' ? channel : undefined,
              frames: s.timelineSelection.map((k) => k.frame),
            });
          }}
        >
          <Scissors size={16} />
        </button>
        {expand && (
          <button
            aria-label={expanded ? 'Collapse timeline' : 'Expand timeline'}
            aria-pressed={expanded}
            onClick={expand}
          >
            <ChevronsUpDown size={18} />
          </button>
        )}
      </div>
    </div>
  );
  return (
    <>
      <section
        id={split ? undefined : 'touch-timeline'}
        className={split ? 'timeline split' : 'timeline'}
        aria-label="Animation timeline"
        aria-hidden={exiting || undefined}
        inert={exiting || undefined}
        data-state={exiting ? 'closing' : 'open'}
      >
        {/* Touch: keep the editor header quiet; playback and keying stay in the shell transport. */}
        <div
          ref={touchBar}
          className="timeline-tabs touch-timeline-bar"
          data-inline={inlineSettings ? 'true' : 'false'}
        >
          <div className="timeline-tab-group" role="group" aria-label="Editor">
            <button
              className={s.tab === 'timeline' ? 'active' : ''}
              aria-label="Keys"
              aria-pressed={s.tab === 'timeline'}
              onClick={() => studio.patch({ tab: 'timeline' })}
            >
              <ListVideo size={17} />
              <span>Keys</span>
            </button>
            <button
              className={s.tab === 'curves' ? 'active' : ''}
              aria-label="Curves"
              aria-pressed={s.tab === 'curves'}
              onClick={() => studio.patch({ tab: 'curves' })}
            >
              <Spline size={17} />
              <span>Curves</span>
            </button>
          </div>
          <div className="touch-timeline-end">
            <div className="timeline-header-tools" ref={setHeaderTools} />
            {inlineSettings ? (
              renderTimelineSettings('inline')
            ) : (
              <div className="timeline-more-anchor">
                <button
                  ref={moreTrigger}
                  aria-label="More timeline options"
                  aria-expanded={more && !exiting}
                  onClick={() => {
                    if (more) setMore(false);
                    else {
                      placeMore();
                      setMore(true);
                    }
                  }}
                >
                  <MoreHorizontal size={18} />
                </button>
              </div>
            )}
            {close && (
              <button aria-label="Close timeline" onClick={close}>
                <X size={20} />
              </button>
            )}
          </div>
        </div>
        {s.tab === 'curves' ? curves : grid}
        {reducer && (
          <CurveReducer
            channel={reducer.channel}
            selectedFrames={reducer.frames}
            close={() => setReducer(null)}
          />
        )}
      </section>
      {typeof document !== 'undefined' &&
        createPortal(
          <MotionPresence show={more && !exiting}>
            {renderTimelineSettings('popup', true)}
          </MotionPresence>,
          document.body,
        )}
    </>
  );
});

/** Locks new keys on the selected controls; existing keys stay editable. */
export function KeyLockButton() {
  const s = useStudioChrome({ frame: 'none' }),
    p = s.project;
  if (!p) return null;
  const locked = !!s.selection.length && s.selection.every((id) => p.tracks[id].keyLock);
  return (
    <button
      className="control-key-lock"
      aria-label="Lock new keys on selected controls"
      title="Prevent new keys on selected controls; existing keys stay editable"
      aria-pressed={locked}
      disabled={!s.selection.length}
      onClick={() => studio.setControlKeyLock(s.selection, !locked)}
    >
      {locked ? <LockKeyhole size={15} /> : <UnlockKeyhole size={15} />}
    </button>
  );
}

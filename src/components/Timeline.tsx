import { AnimationMirror } from './AnimationMirror';
import { mirrorDriver } from '../core/liveMirror';
import { MirrorCurve } from './MirrorCurve';
import { LockKeyhole, UnlockKeyhole } from 'lucide-react';
import { memo, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { CurveAlign } from './CurveEditor';
import { loadTimelineCollapsed, revealTimelineControl } from '../core/timelineHierarchy';
import type { Channel } from '../core/curves';
import { channelsFor } from '../core/curves';
import type { ControlId } from '../core/model';
import { CurveTrackTree } from './TimelineTracks';
import type { TimelineTracksState } from './TimelineTracks';
import { ActiveLayer } from './PoseActions';
import { TimelineFrame } from './TimelinePlayhead';
import { isTouch as isAndroid } from '../platform/storage';
import { ScrubNumber } from './ScrubNumber';
import { TimelineGrid } from './TimelineGrid';
import { CurveEditor } from './CurveEditor';
import { CurveReducer } from './CurveReducer';
import { LoopControls } from './LoopControls';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Diamond,
  ChevronDown,
  ListVideo,
  Spline,
  ChevronsUpDown,
  Scissors,
  X,
} from 'lucide-react';
import { useStudioChrome } from '../hooks';
import { studio } from '../core/store';
import { timelineVisibleControls } from '../core/timelineChannels';
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
  /** Desktop: dope sheet and graph editor side by side; transport lives elsewhere. */
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
  const [dopeShare, setDopeShare] = useState(() => {
    const v = Number(localStorage.getItem('pose-dope-share'));
    return v >= 0.2 && v <= 0.8 ? v : 0.45;
  });
  const splitRoot = useRef<HTMLElement>(null);
  const [align, setAlign] = useState<CurveAlign | null>(null);
  useEffect(() => {
    const root = splitRoot.current;
    if (!split || !root || !p) return;
    let raf = 0;
    // The graph's plot spans exactly the dope sheet's visible frames, at the same x.
    const measure = () => {
      raf = 0;
      const content = root.querySelector<HTMLElement>('.split-dope .track-content'),
        ruler = root.querySelector<HTMLElement>('.split-dope .time-ruler'),
        graph = root.querySelector<SVGElement>('.split-graph .curve-canvas');
      if (!content || !ruler || !graph) return;
      const c = content.getBoundingClientRect(),
        r = ruler.getBoundingClientRect(),
        g = graph.getBoundingClientRect(),
        visibleRight = c.left + content.clientWidth;
      if (!r.width || !g.width) return;
      const next = {
        left: c.left - g.left,
        right: g.right - visibleRight,
        from: ((c.left - r.left) / r.width) * p.end,
        to: ((visibleRight - r.left) / r.width) * p.end,
      };
      setAlign((old) =>
        old &&
        Math.abs(old.left - next.left) < 0.5 &&
        Math.abs(old.right - next.right) < 0.5 &&
        Math.abs(old.from - next.from) < 0.01 &&
        Math.abs(old.to - next.to) < 0.01
          ? old
          : next,
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    const watch = () => {
      root
        .querySelectorAll('.split-dope .time-ruler, .split-graph .curve-canvas')
        .forEach((el) => observer.observe(el));
    };
    watch();
    const mutations = new MutationObserver(() => {
      watch();
      schedule();
    });
    mutations.observe(root, { childList: true, subtree: true });
    root.addEventListener('scroll', schedule, true);
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      mutations.disconnect();
      root.removeEventListener('scroll', schedule, true);
    };
  }, [split, p?.end]);
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
      if (isAndroid && !expanded) expand?.();
    },
    selectChannel: split
      ? (id, axis) => {
          studio.selectControl(id);
          setChannel(p && channelsFor(id, p.tracks[id]).includes(axis) ? axis : 'px');
        }
      : undefined,
  };
  if (!p) return <div className="timeline" />;
  const grid = <TimelineGrid key={(s.workspace?.activeId ?? '') + p.editing} tracks={tracks} />;
  const curves = mirrorDriver(p, s.selected) ? (
    <MirrorCurve
      project={p}
      id={s.selected}
      channel={channel}
      sidebar={<CurveTrackTree state={tracks} ids={ids} />}
    />
  ) : (
    <CurveEditor
      hideTracks={split}
      align={split ? align : null}
      key={(s.workspace?.activeId ?? '') + s.selected + p.editing + (p.activeLayerId ?? '')}
      channel={channel}
      focusKey={curveFocus}
      onReduce={(frames) => setReducer({ channel, frames })}
      sidebar={<CurveTrackTree state={tracks} ids={ids} />}
    />
  );
  if (split)
    return (
      <section
        ref={splitRoot}
        className="timeline split"
        aria-label="Animation editors"
        style={{ '--dope-share': dopeShare } as CSSProperties}
      >
        <div className="split-dope">{grid}</div>
        <div
          className="split-editors-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize dope sheet and graph editor"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const box = e.currentTarget.parentElement!.getBoundingClientRect(),
              share = Math.max(0.2, Math.min(0.8, (e.clientY - box.top) / box.height));
            setDopeShare(share);
            try {
              localStorage.setItem('pose-dope-share', String(share));
            } catch {}
          }}
        />
        <div className="split-graph">{curves}</div>
        {reducer && (
          <CurveReducer
            channel={reducer.channel}
            selectedFrames={reducer.frames}
            close={() => setReducer(null)}
          />
        )}
      </section>
    );
  return (
    <section
      id="touch-timeline"
      className="timeline"
      aria-label="Animation timeline"
      aria-hidden={exiting || undefined}
      inert={exiting || undefined}
      data-state={exiting ? 'closing' : 'open'}
    >
      <div className="timeline-tabs">
        <div className="timeline-tab-group">
          <button
            className={s.tab === 'timeline' ? 'active' : ''}
            aria-label="Timeline"
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
            onClick={() => {
              studio.patch({ tab: 'curves' });
              if (isAndroid && !expanded) expand?.();
            }}
          >
            <Spline size={17} />
            <span>Curves</span>
          </button>
        </div>
        <span className="timeline-context">{p.name}</span>
        <ActiveLayer />
        <div className="timeline-window-tools">
          <AnimationMirror />
          <KeyLockButton />
          <button
            aria-label="Reduce keyframes"
            title="Reduce keyframes with fitted curves"
            onClick={() =>
              setReducer({
                channel: s.tab === 'curves' ? channel : undefined,
                frames: s.timelineSelection.map((k) => k.frame),
              })
            }
          >
            <Scissors size={16} />
          </button>
          {isAndroid && (
            <button
              aria-label={expanded ? 'Collapse timeline' : 'Expand timeline'}
              aria-pressed={expanded}
              onClick={expand}
            >
              <ChevronsUpDown size={18} />
            </button>
          )}
          {close && (
            <button aria-label="Close timeline" onClick={close}>
              <X size={20} />
            </button>
          )}
        </div>
      </div>
      <div className="transport">
        <div className="playback-controls">
          <button
            aria-label="First frame"
            title="First frame (Home)"
            onClick={() => studio.setFrame(0)}
          >
            <SkipBack size={17} />
          </button>
          <button
            className={s.playing ? 'playing' : ''}
            aria-label={s.playing ? 'Pause' : 'Play'}
            title="Play / pause (Space)"
            onClick={() => studio.patch({ playing: !s.playing, drafts: {} })}
          >
            {s.playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
          </button>
          <button
            aria-label="Last frame"
            title="Last frame (End)"
            onClick={() => studio.setFrame(p.end)}
          >
            <SkipForward size={17} />
          </button>
        </div>
        <label className="frame-label">
          <span>Frame</span>
          <TimelineFrame end={p.end} />
          <span>/</span>
          <ScrubNumber
            aria-label="End frame"
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
        <div className="playback-options">
          <button
            className={'auto-key ' + (s.autoKey ? 'enabled' : '')}
            aria-label="Auto key"
            title="Record pose changes"
            aria-pressed={s.autoKey}
            onClick={() => studio.patch({ autoKey: !s.autoKey })}
          >
            <i />
            <span>Auto key</span>
          </button>
          <select
            aria-label="Frame rate"
            value={p.fps}
            onChange={(e) => studio.updateProject({ fps: Number(e.target.value) })}
          >
            {[24, 25, 30, 48, 60].map((v) => (
              <option key={v} value={v}>
                {v} fps
              </option>
            ))}
          </select>
          <LoopControls />
        </div>
        <div className="insert-key-group">
          <button
            className="insert-key"
            aria-label="Add keyframe"
            disabled={!s.selection.length}
            onClick={() => studio.keySelected()}
          >
            <Diamond size={18} />
            <span>Add key</span>
          </button>
          <button
            aria-label="Keyframe options"
            title="Choose channels to key"
            onClick={(e) => studio.showKeyframeMenu(e.clientX, e.clientY)}
          >
            <ChevronDown size={16} />
          </button>
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

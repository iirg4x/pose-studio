import { AnimationMirror } from './AnimationMirror';
import { mirrorDriver } from '../core/liveMirror';
import { MirrorCurve } from './MirrorCurve';
import { LockKeyhole, UnlockKeyhole } from 'lucide-react';
import { memo, useState, useEffect, useLayoutEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { loadTimelineCollapsed, revealTimelineControl } from '../core/timelineHierarchy';
import type { Channel } from '../core/curves';
import { CHANNEL_LABELS, channelColor, channelsFor } from '../core/curves';
import type { ControlId } from '../core/model';
import { CurveTrackTree } from './TimelineTracks';
import type { TimelineTracksState } from './TimelineTracks';
import { ActiveLayer } from './PoseActions';
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
  ChevronLeft,
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
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!more) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.timeline-more-anchor, .active-layer-menu, .keyframe-menu')) setMore(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
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
      if (isAndroid && !expanded) expand?.();
    },
  };
  if (!p) return <div className="timeline" />;
  // Desktop: the panel is either the timeline or the curves of one bone, never both.
  const toCurves = split ? (
    <button
      className="editor-go"
      title="Curves of the selected bone (double-click a bone name)"
      disabled={!p.tracks[s.selected]}
      onClick={() => studio.patch({ tab: 'curves' })}
    >
      <Spline size={15} />
      <span>Curves</span>
    </button>
  ) : undefined;
  const toTimeline = split ? (
    <>
      <button
        className="editor-go"
        title="Back to the timeline"
        onClick={() => studio.patch({ tab: 'timeline' })}
      >
        <ChevronLeft size={15} />
        <span>Timeline</span>
      </button>
      <div className="curve-channel-chips" role="group" aria-label="Curve channel">
        {channelsFor(s.selected, p.tracks[s.selected]).map((c) => (
          <button
            key={c}
            aria-pressed={c === channel}
            title={CHANNEL_LABELS[c]}
            style={{ '--chip': channelColor(c) } as CSSProperties}
            onClick={() => setChannel(c)}
          >
            {CHANNEL_LABELS[c].replace('Position ', 'Loc ').replace('Rotation ', 'Rot ')}
          </button>
        ))}
      </div>
    </>
  ) : undefined;
  const grid = (
    <TimelineGrid
      key={(s.workspace?.activeId ?? '') + p.editing}
      tracks={tracks}
      viewSwitch={toCurves}
    />
  );
  const curves = mirrorDriver(p, s.selected) ? (
    <MirrorCurve
      project={p}
      id={s.selected}
      channel={channel}
      sidebar={split ? undefined : <CurveTrackTree state={tracks} ids={ids} />}
    />
  ) : (
    <CurveEditor
      viewSwitch={toTimeline}
      key={(s.workspace?.activeId ?? '') + s.selected + p.editing + (p.activeLayerId ?? '')}
      channel={channel}
      focusKey={curveFocus}
      onReduce={(frames) => setReducer({ channel, frames })}
      sidebar={split ? undefined : <CurveTrackTree state={tracks} ids={ids} />}
    />
  );
  if (split)
    return (
      <section className="timeline split" aria-label="Animation editor">
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
  return (
    <section
      id="touch-timeline"
      className="timeline"
      aria-label="Animation timeline"
      aria-hidden={exiting || undefined}
      inert={exiting || undefined}
      data-state={exiting ? 'closing' : 'open'}
    >
      {/* Touch: one bar for what every edit needs; the rest sits in the overflow menu,
          so the panel stays short and the 3D result stays in view while editing. */}
      <div className="timeline-tabs touch-timeline-bar">
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
        <div className="touch-timeline-transport">
          <button
            className={'touch-timeline-play' + (s.playing ? ' playing' : '')}
            aria-label={s.playing ? 'Pause' : 'Play'}
            onClick={() => studio.patch({ playing: !s.playing, drafts: {} })}
          >
            {s.playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
          </button>
          <div className="insert-key-group">
            <button
              className="insert-key"
              aria-label="Add keyframe"
              disabled={!s.selection.length}
              onClick={() => studio.keySelected()}
            >
              <Diamond size={17} />
              <span>Key</span>
            </button>
            <button
              aria-label="Keyframe options"
              onClick={(e) => studio.showKeyframeMenu(e.clientX, e.clientY)}
            >
              <ChevronDown size={15} />
            </button>
          </div>
          <button
            className={'auto-key ' + (s.autoKey ? 'enabled' : '')}
            aria-label="Auto key"
            aria-pressed={s.autoKey}
            onClick={() => studio.patch({ autoKey: !s.autoKey })}
          >
            <i />
            <span>Auto</span>
          </button>
        </div>
        <div className="touch-timeline-end">
          <div className="timeline-more-anchor">
            <button
              aria-label="More timeline options"
              aria-expanded={more}
              onClick={() => setMore(!more)}
            >
              <MoreHorizontal size={18} />
            </button>
            {more && (
              <div className="timeline-more" role="group" aria-label="Timeline options">
                {/* The playhead shows the current frame; the clip length lives here. */}
                <label className="timeline-more-length">
                  <span>Length</span>
                  <ScrubNumber
                    aria-label="Animation length in frames"
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
                <div className="timeline-more-row">
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
                    {[24, 25, 30, 48, 60].map((v) => (
                      <option key={v} value={v}>
                        {v} fps
                      </option>
                    ))}
                  </select>
                  <LoopControls />
                </div>
                <ActiveLayer />
                <div className="timeline-more-row">
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
            )}
          </div>
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

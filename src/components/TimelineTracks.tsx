import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { curveKeyLocked } from '../core/curveLocks';
import { mirrorDriver } from '../core/liveMirror';
import { ChevronDown, Search, ListTree, LockKeyhole, Link2 } from 'lucide-react';
import { CHANNEL_LABELS, channelColor, channelUnit } from '../core/curves';
import type { Channel } from '../core/curves';
import type { ControlId, Track } from '../core/model';
import { channelPreview, timelineChannelRows } from '../core/timelineChannels';
import type { TimelineRow } from '../core/timelineChannels';
import { revealTimelineControl } from '../core/timelineHierarchy';
import { controlTint } from '../core/controlStyle';
import { studio } from '../core/store';
import { useStudioChrome } from '../hooks';
import { isTouch } from '../platform/storage';

export interface TimelineTracksState {
  expanded: ReadonlySet<ControlId>;
  collapsed: ReadonlySet<ControlId>;
  query: string;
  channel: Channel;
  toggleChannels: (id: ControlId) => void;
  fold: (next: Set<ControlId>) => void;
  setQuery: (text: string) => void;
  openCurve: (id: ControlId, channel: Channel, frame?: number) => void;
}
export const timelineRowHeight = isTouch ? 44 : 32;

export function TrackSearch({
  query,
  setQuery,
}: {
  query: string;
  setQuery: (query: string) => void;
}) {
  return (
    <label className="timeline-search">
      <Search size={14} />
      <input
        aria-label="Find timeline bone"
        placeholder="Find bone…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query && (
        <button aria-label="Clear bone filter" onClick={() => setQuery('')}>
          ×
        </button>
      )}
    </label>
  );
}

export function TimelineTrackLabel({
  row,
  state,
  selected,
  onSelect,
}: {
  row: TimelineRow;
  state: TimelineTracksState;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const id = row.control,
    channel = row.channel,
    p = studio.state.project,
    linked = id && p && mirrorDriver(p, id),
    locked =
      id && p && (p.tracks[id].keyLock || (channel && curveKeyLocked(p.tracks[id], channel)));
  return (
    <div
      data-depth={row.depth}
      data-group={row.children.length > 0}
      className={
        'timeline-track-label' +
        (channel ? ' axis-label-row' : ' bone-label-row') +
        (selected ? ' selected' : '')
      }
      style={
        {
          '--track-depth': Math.min(row.depth, 3),
          '--track-color': channel ? channelColor(channel) : id ? controlTint(id) : 'var(--accent)',
        } as CSSProperties
      }
    >
      {channel ? (
        <>
          <span className="axis-letter">
            {channel.length === 2 ? channel.at(-1)!.toUpperCase() : '•'}
          </span>
          <button
            className="track-name"
            aria-label={row.label + ' ' + CHANNEL_LABELS[channel] + ' curve'}
            aria-pressed={selected}
            onClick={() => state.openCurve(id!, channel)}
          >
            <span>{CHANNEL_LABELS[channel]}</span>
            <small>{channelUnit(channel)}</small>
          </button>
        </>
      ) : (
        <>
          {id ? (
            <button
              className="track-disclosure"
              aria-label={
                (state.expanded.has(id) ? 'Collapse ' : 'Expand ') + row.label + ' channels'
              }
              aria-expanded={state.expanded.has(id)}
              title="Position, rotation and other animation channels"
              onClick={() => state.toggleChannels(id)}
            >
              <ChevronDown size={15} />
            </button>
          ) : (
            <ListTree size={15} className="track-summary-icon" />
          )}
          <button
            className="track-name"
            aria-pressed={selected}
            title={id ? row.label + ' · double-click for curves' : row.label}
            onClick={onSelect}
            onDoubleClick={() => id && state.openCurve(id, state.channel)}
          >
            <span>{row.label}</span>
          </button>
          {row.children.length > 0 && (
            <button
              className={'track-children' + (row.collapsed ? ' folded' : '')}
              aria-label={(row.collapsed ? 'Expand ' : 'Collapse ') + row.label + ' child bones'}
              aria-expanded={!row.collapsed}
              title={row.children.length + ' child bones'}
              onClick={() => {
                const next = new Set(state.collapsed);
                next.has(id!) ? next.delete(id!) : next.add(id!);
                state.fold(next);
              }}
            >
              <ListTree size={12} />
              <small>{row.children.length}</small>
            </button>
          )}
        </>
      )}
      {linked ? (
        <Link2 size={12} className="track-link-state" aria-label="Mirror linked" />
      ) : locked ? (
        <LockKeyhole size={12} className="track-lock-state" aria-label="New keys locked" />
      ) : null}
    </div>
  );
}

/** The same bone/axis ladder stays available in both Keys and Curves. */
export const CurveTrackTree = memo(function CurveTrackTree({
  state,
  ids,
}: {
  state: TimelineTracksState;
  ids: ControlId[];
}) {
  const s = useStudioChrome({ frame: 'none' }),
    p = s.project!,
    ref = useRef<HTMLDivElement>(null),
    [viewport, setViewport] = useState({ top: 0, height: 320 });
  const rows = useMemo(
    () =>
      ids.length ? timelineChannelRows(p, ids, state.collapsed, state.expanded, state.query) : [],
    [p, ids, state.collapsed, state.expanded, state.query],
  );
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      setViewport({ top: el.scrollTop, height: el.clientHeight });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    el.addEventListener('scroll', schedule, { passive: true });
    measure();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      el.removeEventListener('scroll', schedule);
    };
  }, []);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [state.query]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const index = rows.findIndex(
      (row) => row.control === s.selected && row.channel === state.channel,
    );
    if (index < 0) return;
    const top = index * timelineRowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + timelineRowHeight > el.scrollTop + el.clientHeight)
      el.scrollTop = top + timelineRowHeight - el.clientHeight;
  }, [s.selected, state.channel, state.expanded, state.collapsed, state.query, rows]);
  const first = Math.max(0, Math.floor(viewport.top / timelineRowHeight) - 2),
    last = Math.min(
      rows.length,
      Math.ceil((viewport.top + viewport.height) / timelineRowHeight) + 2,
    );
  return (
    <aside className="curve-track-tree" aria-label="Bone curves">
      <TrackSearch query={state.query} setQuery={state.setQuery} />
      <div className="curve-track-scroll" ref={ref}>
        <div style={{ height: rows.length * timelineRowHeight, position: 'relative' }}>
          {rows.slice(first, last).map((row, i) => (
            <div
              key={row.key}
              style={{
                position: 'absolute',
                top: (first + i) * timelineRowHeight,
                left: 0,
                right: 0,
              }}
            >
              <TimelineTrackLabel
                row={row}
                state={state}
                selected={
                  row.channel
                    ? row.control === s.selected && row.channel === state.channel
                    : !!row.control && s.selection.includes(row.control)
                }
                onSelect={() => {
                  if (!row.control) return;
                  state.openCurve(row.control, state.channel);
                  const next = revealTimelineControl(ids, state.collapsed, row.control);
                  state.fold(next);
                }}
              />
            </div>
          ))}
        </div>
        {!rows.length && <p className="timeline-empty">No matching bones</p>}
      </div>
    </aside>
  );
});

export const AxisCurveStrip = memo(function AxisCurveStrip({
  track,
  channel,
  end,
  label,
  open,
}: {
  track: Track;
  channel: Channel;
  end: number;
  label: string;
  open: (frame?: number) => void;
}) {
  const preview = useMemo(() => channelPreview(track, channel, end), [track, channel, end]);
  const y = (value: number) => 5 + (1 - (value - preview.min) / (preview.max - preview.min)) * 22;
  const path = preview.points
    .map(
      (p, i) => (i ? 'L' : 'M') + ((p.frame / end) * 1000).toFixed(2) + ',' + y(p.value).toFixed(2),
    )
    .join(' ');
  const markers = preview.keys
    .map((k) => {
      const x = (k.frame / end) * 1000,
        cy = y(k.value);
      return 'M' + x + ',' + (cy - 2.5) + 'l2.5 2.5l-2.5 2.5l-2.5 -2.5Z';
    })
    .join(' ');
  return (
    <div
      className="axis-curve-strip"
      style={{ '--axis-color': channelColor(channel) } as CSSProperties}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        className="axis-curve-open"
        data-key-count={preview.keys.length}
        aria-label={'Edit ' + label + ' ' + CHANNEL_LABELS[channel] + ' curve'}
        title="Open curve · tap a diamond to select that key"
        onClick={(e) => {
          if (!e.detail) {
            open();
            return;
          }
          const box = e.currentTarget.getBoundingClientRect(),
            px = e.clientX - box.left,
            py = e.clientY - box.top;
          let nearest: number | undefined,
            distance = 12;
          for (const k of preview.keys) {
            const d = Math.hypot(
              (k.frame / end) * box.width - px,
              (y(k.value) / 32) * box.height - py,
            );
            if (d < distance) {
              distance = d;
              nearest = k.frame;
            }
          }
          open(nearest);
        }}
      >
        <svg viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden="true">
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={markers}
            fill="currentColor"
            stroke="var(--track-ink)"
            strokeWidth=".6"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </button>
    </div>
  );
});

import type { ReactNode } from 'react';
import { timelineMarqueeKeys, marqueeScrollSpeed } from '../core/timelineMarquee';
import { MotionPresence, InlineCollapse } from './Motion';
import { isTouch as isAndroid } from '../platform/storage';
import { firstPersonKeyReferences } from '../core/timelineReferences';
import { revealTimelineControl } from '../core/timelineHierarchy';
import {
  timelineChannelRows,
  timelineVisibleControls,
  selectedControlSummary,
} from '../core/timelineChannels';
import { mirrorDriver, mirrorDisplayFrame } from '../core/liveMirror';
import { Link2 } from 'lucide-react';
import { controlLabel } from '../core/model';
import {
  TimelineTrackLabel,
  TrackSearch,
  AxisCurveStrip,
  timelineRowHeight,
} from './TimelineTracks';
import type { TimelineTracksState } from './TimelineTracks';
import { segmentInterpolation } from '../core/timelineSettings';
import { InterpolationConnector } from './InterpolationConnector';
import { KeyframeSettings } from './KeyframeSettings';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { controlTint } from '../core/controlStyle';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import {
  ListChecks,
  FlipHorizontal2,
  Copy,
  ClipboardPaste,
  BoxSelect,
  Diamond,
  Trash2,
  ListTree,
  FoldVertical,
  Ghost,
  ZoomIn,
  Filter,
  ZoomOut,
  Settings2,
  MoreHorizontal,
} from 'lucide-react';
import { studio } from '../core/store';
import { useStudioChrome, useStudioSelector } from '../hooks';
import { TimelinePlayhead } from './TimelinePlayhead';
import { controlLabels } from '../core/model';
import type { ControlId } from '../core/model';
import { trackFrames, keyToken, keyDelta, uniqueKeys, validKeys } from '../core/timelineKeys';
import type { TimelineKey } from '../core/timelineKeys';
type PendingKey = {
  pointer: number;
  x: number;
  y: number;
  threshold: number;
  keys: TimelineKey[];
  tap: TimelineKey[];
};
type Drag =
  | {
      kind: 'move';
      start: number;
      keys: TimelineKey[];
      delta: number;
      keyboard?: boolean;
      numeric: string;
    }
  | {
      kind: 'box';
      x: number;
      y: number;
      toX: number;
      toY: number;
      mode: 'replace' | 'add' | 'subtract';
    };
export const TimelineGrid = memo(function TimelineGrid({
  tracks,
  viewSwitch,
}: {
  tracks: TimelineTracksState;
  /** Desktop: Timeline/Curves switch shown first in the tool row. */
  viewSwitch?: ReactNode;
}) {
  const [toolsOpen, setToolsOpen] = useState(false),
    toolsRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!toolsOpen) return;
    const close = (e: globalThis.PointerEvent) => {
      if (!toolsRoot.current?.contains(e.target as Node)) setToolsOpen(false);
    };
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') setToolsOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', escape);
    };
  }, [toolsOpen]);
  const [zoom, setZoom] = useState(1),
    rowHeight = timelineRowHeight,
    rulerHeight = isAndroid ? 40 : 30;
  const s = useStudioChrome({ frame: 'none' }),
    scroll = useRef<HTMLDivElement>(null),
    root = useRef<HTMLDivElement>(null),
    grid = useRef<HTMLDivElement>(null),
    drag = useRef<Drag | null>(null),
    lastX = useRef(0);
  const [keyMenu, setKeyMenu] = useState<{ x: number; y: number } | null>(null),
    closeKeyMenu = useCallback(() => setKeyMenu(null), []);
  const [showReferences, setShowReferences] = useState(() => {
    try {
      return localStorage.getItem('pose-timeline-references') !== 'false';
    } catch {
      return true;
    }
  });
  const collapsed = tracks.collapsed,
    reveal = useRef<ControlId | null>(null);
  const fold = (next: Set<ControlId>) => {
    if (!drag.current) tracks.fold(next);
  };
  const pointer = useRef<{ x: number; y: number } | null>(null),
    previewRaf = useRef(0);
  const [preview, setPreview] = useState<Drag | null>(null),
    [armed, setArmed] = useState(false),
    [multiSelect, setMultiSelect] = useState(false),
    pendingKey = useRef<PendingKey | null>(null);
  const p = s.project!;
  const labels = controlLabels(p),
    visibleIds = timelineVisibleControls(p, s.selection, s.timelineFilter),
    visibilityKey = visibleIds.join('|'),
    ids = useMemo(() => visibleIds, [visibilityKey]);
  const keys = useMemo(
      () =>
        ids
          .filter((id) => !mirrorDriver(p, id))
          .flatMap((id) =>
            trackFrames(p.tracks[id])
              .filter((frame) => frame <= p.end)
              .map((frame) => ({ id, frame })),
          ),
      [p, ids],
    ),
    selection = validKeys(p, s.timelineSelection),
    selected = new Set(selection.map(keyToken));
  const rows = useMemo(
    () =>
      ids.length
        ? selectedControlSummary(
            timelineChannelRows(p, ids, collapsed, tracks.expanded, tracks.query),
            s.selection,
          )
        : [],
    [p, ids, collapsed, tracks.expanded, tracks.query, s.selection],
  );
  useEffect(() => {
    if (!s.selection.includes(s.selected)) return;
    reveal.current = s.selected;
    const next = revealTimelineControl(ids, collapsed, s.selected);
    if ([...collapsed].some((id) => !next.has(id))) tracks.fold(next);
  }, [s.selected, s.selection, ids]);
  useEffect(() => {
    const el = scroll.current,
      id = reveal.current;
    if (!el || !id) return;
    const index = rows.findIndex((row) => row.control === id && !row.channel);
    if (index < 0) return;
    const top = rulerHeight + index * rowHeight,
      bottom = top + rowHeight;
    if (top < el.scrollTop + rulerHeight) el.scrollTop = top - rulerHeight;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    reveal.current = null;
  }, [collapsed, tracks.expanded, tracks.query, s.selected, s.selection, ids]);
  const [viewport, setViewport] = useState({ top: 0, height: 360 });
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const top = el.scrollTop,
        height = el.clientHeight;
      setViewport((old) => (old.top === top && old.height === height ? old : { top, height }));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    el.addEventListener('scroll', schedule, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', schedule);
      cancelAnimationFrame(raf);
    };
  }, []);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [tracks.query]);
  const first = Math.max(
    0,
    Math.min(rows.length - 1, Math.floor((viewport.top - rulerHeight) / rowHeight) - 2),
  );
  const last = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / rowHeight) + 2),
    shown =
      first > 0 && rows[0]?.key === 'all'
        ? [rows[0], ...rows.slice(first, last)]
        : rows.slice(first, last);
  const segments = useMemo(
    () =>
      Object.fromEntries(
        shown
          .filter((row) => !row.channel && row.ids.length === 1)
          .map((row) => {
            const id = row.ids[0],
              frames = trackFrames(p.tracks[id]).filter((f) => f <= p.end);
            return [
              id,
              frames.slice(0, -1).map((from, i) => ({
                from,
                to: frames[i + 1],
                ...segmentInterpolation(id, p.tracks[id], from, frames[i + 1]),
              })),
            ];
          }),
      ),
    [p, rows, first, last],
  );
  const references = useMemo(() => firstPersonKeyReferences(p), [p]);
  const hand = s.selected === 'hand_r' ? 'hand_r' : 'hand_l',
    spaces = p.tracks[hand].spaces.length
      ? p.tracks[hand].spaces
      : p.bodyBase?.enabled
        ? p.bodyBase.source.tracks[hand].spaces.map((v) => ({
            ...v,
            frame: (v.frame * p.fps) / p.bodyBase!.source.fps,
          }))
        : [];
  const frameAt = (x: number) => {
    const r = grid.current!.getBoundingClientRect();
    return Math.round(((x - r.left) / r.width) * p.end);
  };
  const show = (d: Drag | null) => {
    drag.current = d;
    if (!d) {
      cancelAnimationFrame(previewRaf.current);
      previewRaf.current = 0;
      setPreview(null);
      return;
    }
    if (!previewRaf.current)
      previewRaf.current = requestAnimationFrame(() => {
        previewRaf.current = 0;
        setPreview(drag.current ? { ...drag.current } : null);
      });
  };
  const boxKeys = (d: Extract<Drag, { kind: 'box' }>) =>
    timelineMarqueeKeys(p, rows, d, {
      width: grid.current?.getBoundingClientRect().width ?? 0,
      rowHeight,
      rulerHeight,
      scrollTop: scroll.current?.scrollTop ?? 0,
    });
  const boxHits = preview?.kind === 'box' ? boxKeys(preview) : [];
  if (preview?.kind === 'box') {
    if (preview.mode === 'replace') selected.clear();
    for (const key of boxHits)
      preview.mode === 'subtract' ? selected.delete(keyToken(key)) : selected.add(keyToken(key));
  }
  useEffect(() => {
    if (preview?.kind !== 'box') return;
    let raf = 0,
      last = performance.now();
    const tick = (now: number) => {
      const el = scroll.current,
        g = grid.current,
        pt = pointer.current,
        d = drag.current;
      if (!el || !g || !pt || d?.kind !== 'box') return;
      const r = el.getBoundingClientRect(),
        gr = g.getBoundingClientRect(),
        dt = Math.min(2, (now - last) / 16.667);
      last = now;
      const x = marqueeScrollSpeed(pt.x, Math.max(r.left + 170, gr.left), r.right),
        y = marqueeScrollSpeed(pt.y, r.top + rulerHeight, r.bottom);
      const beforeX = el.scrollLeft,
        beforeY = el.scrollTop;
      el.scrollBy(x * dt, y * dt);
      if (el.scrollLeft !== beforeX || el.scrollTop !== beforeY) {
        const next = g.getBoundingClientRect();
        d.toX = pt.x - next.left;
        d.toY = pt.y - next.top;
        show(d);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [preview?.kind, rulerHeight]);
  useEffect(() => () => cancelAnimationFrame(previewRaf.current), []);
  const finish = (cancel = false) => {
    const pending = pendingKey.current;
    pendingKey.current = null;
    if (pending && !cancel) studio.selectTimeline(pending.tap);
    const d = drag.current;
    if (!d) return;
    if (!cancel) {
      if (d.kind === 'move') studio.moveTimeline(d.delta, d.keys);
      else {
        studio.selectTimeline(boxKeys(d), d.mode);
      }
    }
    pointer.current = null;
    show(null);
  };
  const keyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).matches('input,select,textarea')) return;
    const k = e.key.toLowerCase(),
      cmd = e.ctrlKey || e.metaKey;
    let handled = true;
    const d = drag.current;
    if (d) {
      if (k === 'escape') finish(true);
      else if (k === 'enter') finish();
      else if (d.kind === 'move' && (/^[0-9-]$/.test(k) || k === 'backspace')) {
        d.numeric =
          k === 'backspace'
            ? d.numeric.slice(0, -1)
            : k === '-'
              ? d.numeric.startsWith('-')
                ? d.numeric.slice(1)
                : '-' + d.numeric
              : d.numeric + k;
        d.delta = keyDelta(p, d.keys, Number(d.numeric) || 0);
        show(d);
      }
    } else if (cmd && k === 'c') studio.copyTimeline();
    else if (cmd && k === 'v') {
      if (e.shiftKey) window.dispatchEvent(new Event('pose-paste-mirrored-keys'));
      else studio.pasteTimeline();
    } else if (k === 'a' && !cmd) studio.selectTimeline(e.altKey ? [] : keys);
    else if (k === 'b' && !cmd) setArmed(true);
    else if (k === 'escape') {
      if (armed) setArmed(false);
      else studio.selectTimeline([]);
    } else if (k === 'g' && !cmd) {
      if (selection.length)
        show({
          kind: 'move',
          start: lastX.current,
          keys: selection,
          delta: 0,
          keyboard: true,
          numeric: '',
        });
    } else if (k === 'delete' || k === 'backspace') studio.deleteTimeline();
    else if (k === 'arrowleft' || k === 'arrowright') {
      if (selection.length)
        studio.moveTimeline((k === 'arrowright' ? 1 : -1) * (e.shiftKey ? 10 : 1));
      else studio.setFrame(studio.state.frame + (k === 'arrowright' ? 1 : -1));
    } else if (k === 'home') studio.setFrame(0);
    else if (k === 'end') studio.setFrame(p.end);
    else if (['r', 'h', 'f', 'q', 'w', 'e'].includes(k) && !cmd) {
    } // Scene shortcuts stay in the scene.
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const startBox = (e: PointerEvent) => {
    if (e.button !== 0 || (e.pointerType === 'touch' && !armed)) return;
    if (drag.current?.kind === 'move' && drag.current.keyboard) {
      finish();
      return;
    }
    e.preventDefault();
    root.current!.focus();
    pointer.current = { x: e.clientX, y: e.clientY };
    const r = grid.current!.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    show({
      kind: 'box',
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      toX: e.clientX - r.left,
      toY: e.clientY - r.top,
      mode: e.ctrlKey || e.altKey ? 'subtract' : e.shiftKey || multiSelect ? 'add' : 'replace',
    });
  };
  const interval = Math.max(
    1,
    Math.round((p.end <= 120 ? 8 : p.end <= 300 ? 24 : Math.ceil(p.end / 12 / 12) * 12) / zoom),
  );
  return (
    <div
      className={'dope-sheet' + (armed ? ' box-armed' : '')}
      ref={root}
      tabIndex={0}
      onKeyDown={keyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        finish(true);
      }}
      aria-label="Timeline key editor"
      onPointerMove={(e) => {
        lastX.current = e.clientX;
        if (pointer.current) pointer.current = { x: e.clientX, y: e.clientY };
        const pending = pendingKey.current;
        if (pending && pending.pointer === e.pointerId) {
          const dx = e.clientX - pending.x;
          if (Math.abs(dx) <= pending.threshold) return;
          pendingKey.current = null;
          studio.selectTimeline(pending.keys);
          show({
            kind: 'move',
            start: pending.x + Math.sign(dx) * pending.threshold,
            keys: pending.keys,
            delta: 0,
            numeric: '',
          });
        }
        const d = drag.current;
        if (!d) return;
        if (d.kind === 'move') {
          if (!d.numeric) d.delta = keyDelta(p, d.keys, frameAt(e.clientX) - frameAt(d.start));
        } else {
          const r = grid.current!.getBoundingClientRect();
          d.toX = e.clientX - r.left;
          d.toY = e.clientY - r.top;
        }
        show(d);
      }}
      onPointerUp={() => {
        if (
          pendingKey.current ||
          (drag.current && !('keyboard' in drag.current && drag.current.keyboard))
        )
          finish();
      }}
      onPointerCancel={() => finish(true)}
    >
      <KeyframeSettings
        open={!!keyMenu}
        x={keyMenu?.x ?? 0}
        y={keyMenu?.y ?? 0}
        close={closeKeyMenu}
      />
      <div className="key-edit-tools">
        {viewSwitch}
        <button
          aria-label="Box select timeline keys"
          title="Drag to select keys"
          aria-pressed={armed}
          className={armed ? 'active' : ''}
          onClick={() => {
            root.current!.focus();
            setArmed(!armed);
          }}
        >
          <BoxSelect size={18} />
          <span>Box</span>
        </button>
        <button
          aria-label="Multi select keyframes"
          title="Tap keys to add or remove from selection"
          aria-pressed={multiSelect}
          className={multiSelect ? 'active' : ''}
          onClick={() => {
            finish(true);
            setMultiSelect(!multiSelect);
          }}
        >
          <ListChecks size={18} />
          <span>{multiSelect ? 'Multi on' : 'Multi'}</span>
        </button>
        {!isAndroid && (
          <button
            aria-label="Show only selected controls"
            title="Show only selected controls"
            aria-pressed={s.timelineFilter === 'selected'}
            className={s.timelineFilter === 'selected' ? 'active' : ''}
            onClick={() =>
              studio.patch({
                timelineFilter: s.timelineFilter === 'selected' ? 'animated' : 'selected',
              })
            }
          >
            <Filter size={17} />
            <span>Selected only</span>
          </button>
        )}
        <span className="key-selection-count">
          {preview?.kind === 'move'
            ? preview.delta + ' frames'
            : preview?.kind === 'box'
              ? boxHits.length + ' keys in box'
              : armed
                ? 'Drag anywhere · Esc to exit'
                : selection.length
                  ? selection.length + (selection.length === 1 ? ' key' : ' keys')
                  : 'Bone tracks'}
        </span>
        <InlineCollapse open={selection.length > 0}>
          <div className="selected-key-actions" aria-label="Selected key actions">
            <button
              aria-label="Copy keyframes"
              title="Copy selected keys (Ctrl C)"
              onClick={() => studio.copyTimeline()}
            >
              <Copy size={17} />
              <span>Copy</span>
            </button>
            <button
              aria-label="Keyframe interpolation"
              onClick={(e) => setKeyMenu({ x: e.clientX, y: e.clientY })}
            >
              <Settings2 size={17} />
            </button>
            <button aria-label="Delete selected keyframes" onClick={() => studio.deleteTimeline()}>
              <Trash2 size={17} />
            </button>
          </div>
        </InlineCollapse>
        {s.keyClipboard && (
          <button
            aria-label="Paste mirrored keyframes"
            title="Paste mirrored at playhead (Ctrl Shift V)"
            onClick={() => window.dispatchEvent(new Event('pose-paste-mirrored-keys'))}
          >
            <FlipHorizontal2 size={17} />
            <span>Paste mirrored</span>
          </button>
        )}
        {s.keyClipboard && (
          <button
            aria-label="Paste keyframes"
            title="Paste at playhead"
            onClick={() => studio.pasteTimeline()}
          >
            <ClipboardPaste size={17} />
            <span>Paste</span>
          </button>
        )}
        <div className="track-view-tools">
          {
            <>
              <button
                aria-label="Zoom out timeline"
                disabled={zoom === 1}
                onClick={() => setZoom((v) => Math.max(1, v - 1))}
              >
                <ZoomOut size={18} />
              </button>
              <output aria-label="Timeline zoom">{zoom}×</output>
              <button
                aria-label="Zoom in timeline"
                disabled={zoom === 8}
                onClick={() => setZoom((v) => Math.min(8, v + 1))}
              >
                <ZoomIn size={18} />
              </button>
            </>
          }
          <div className="track-options" ref={toolsRoot}>
            <button
              aria-label="Track options"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen(!toolsOpen)}
            >
              <MoreHorizontal size={20} />
            </button>
            <MotionPresence show={toolsOpen}>
              <div className="track-options-menu" aria-label="Track display options">
                <button
                  onClick={() => {
                    fold(new Set());
                    setToolsOpen(false);
                  }}
                >
                  <ListTree size={17} />
                  Expand all tracks
                </button>
                <button
                  onClick={() => {
                    fold(new Set(ids.filter((id) => id !== 'root')));
                    setToolsOpen(false);
                  }}
                >
                  <FoldVertical size={17} />
                  Collapse track groups
                </button>
                {p.bodyBase && (
                  <button
                    aria-label="Source reference keys"
                    aria-pressed={showReferences}
                    onClick={() => {
                      setShowReferences(!showReferences);
                      try {
                        localStorage.setItem('pose-timeline-references', String(!showReferences));
                      } catch {}
                    }}
                  >
                    <Ghost size={17} />
                    Source reference keys
                  </button>
                )}
              </div>
            </MotionPresence>
          </div>
        </div>
      </div>
      <div
        className="timeline-grid"
        ref={scroll}
        style={{ '--timeline-zoom': zoom } as CSSProperties}
      >
        <div className="track-labels">
          <div className="track-ruler-label">
            <TrackSearch query={tracks.query} setQuery={tracks.setQuery} />
          </div>
          <div style={{ height: rows.length * rowHeight, position: 'relative' }}>
            {shown.map((row) => (
              <div
                key={row.key}
                style={{
                  position: row.key === 'all' ? 'sticky' : 'absolute',
                  top: row.key === 'all' ? rulerHeight : rows.indexOf(row) * rowHeight,
                  left: 0,
                  right: 0,
                  height: rowHeight,
                  zIndex: row.key === 'all' ? 5 : undefined,
                }}
              >
                <TimelineTrackLabel
                  row={row}
                  state={tracks}
                  selected={!!row.control && s.selection.includes(row.control) && !row.channel}
                  onSelect={(e) => {
                    root.current!.focus();
                    if (row.control && !multiSelect)
                      studio.selectControl(row.control, e.shiftKey || s.multiSelect);
                    const rowKeys = keys.filter((k) => row.ids.includes(k.id));
                    studio.selectTimeline(
                      rowKeys,
                      e.shiftKey || multiSelect
                        ? rowKeys.every((k) => selected.has(keyToken(k)))
                          ? 'subtract'
                          : 'add'
                        : 'replace',
                    );
                  }}
                />
              </div>
            ))}
            <>{!rows.length && <p className="timeline-empty">No matching bones</p>}</>
          </div>
          {spaces.length > 0 && (
            <button className="contact-label" onClick={() => studio.selectControl(hand)}>
              {hand === 'hand_l' ? 'Left' : 'Right'} hand contact
            </button>
          )}
        </div>
        <div
          className="track-content"
          ref={grid}
          onPointerDown={startBox}
          onPointerDownCapture={(e) => {
            if (armed && !(e.target as HTMLElement).closest('.time-ruler')) {
              e.stopPropagation();
              startBox(e);
            }
          }}
          onClickCapture={(e) => {
            if (armed) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onDoubleClickCapture={(e) => {
            if (armed) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <div
            className="time-ruler"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (drag.current) {
                finish();
                return;
              }
              root.current!.focus();
              e.currentTarget.setPointerCapture(e.pointerId);
              studio.setFrame(frameAt(e.clientX));
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId))
                studio.setFrame(frameAt(e.clientX));
            }}
          >
            {Array.from({ length: Math.floor(p.end / interval) + 1 }, (_, i) => i * interval).map(
              (f) => (
                <span className="ruler-tick" key={f} style={{ left: (f / p.end) * 100 + '%' }}>
                  {f}
                </span>
              ),
            )}
            <div className="ruler-minors" />
            <TimelinePlayhead end={p.end} cap />
          </div>
          <div style={{ height: rows.length * rowHeight, position: 'relative' }}>
            {shown.map((row) => {
              const link = row.control && mirrorDriver(p, row.control);
              if (link)
                return (
                  <div
                    className="key-track linked-track"
                    key={row.key}
                    style={{
                      position: 'absolute',
                      top: rows.indexOf(row) * rowHeight,
                      left: 0,
                      right: 0,
                    }}
                  >
                    <button
                      className="timeline-linked-strip"
                      onClick={() => tracks.openCurve(link.source, row.channel ?? tracks.channel)}
                      title="Edit the source animation"
                    >
                      <Link2 size={14} />
                      <span>{controlLabel(link.source, p)}</span>
                      <small>{link.phase ? '½ cycle' : 'Same frame'} · linked</small>
                      {!row.channel &&
                        trackFrames(p.tracks[link.source]).map((frame) => (
                          <i
                            key={frame}
                            style={{
                              left: (mirrorDisplayFrame(p, frame, link.phase) / p.end) * 100 + '%',
                            }}
                          />
                        ))}
                    </button>
                  </div>
                );
              if (row.channel)
                return (
                  <div
                    className="key-track axis-track"
                    data-alternate={rows.indexOf(row) % 2 === 1}
                    key={row.key}
                    style={{
                      position: 'absolute',
                      top: rows.indexOf(row) * rowHeight,
                      left: 0,
                      right: 0,
                    }}
                  >
                    <AxisCurveStrip
                      track={p.tracks[row.control!]}
                      channel={row.channel}
                      end={p.end}
                      label={row.label}
                      open={(frame) => tracks.openCurve(row.control!, row.channel!, frame)}
                    />
                  </div>
                );
              const rowKeys = keys.filter((k) => row.ids.includes(k.id)),
                frames = [...new Set(rowKeys.map((k) => k.frame))];
              return (
                <div
                  className={
                    'key-track' +
                    (row.key === 'all' ? ' summary-track' : '') +
                    (row.control && row.ids.some((id) => s.selection.includes(id))
                      ? ' selected-channel'
                      : '')
                  }
                  data-alternate={rows.indexOf(row) % 2 === 1}
                  data-group={row.children.length > 0}
                  key={row.key}
                  style={
                    {
                      position: row.key === 'all' ? 'sticky' : 'absolute',
                      top: row.key === 'all' ? rulerHeight : rows.indexOf(row) * rowHeight,
                      left: 0,
                      right: 0,
                      zIndex: row.key === 'all' ? 5 : undefined,
                      '--track-color': row.control ? controlTint(row.control) : 'var(--accent)',
                      '--beat-width': (interval / p.end) * 100 + '%',
                    } as CSSProperties
                  }
                  onDoubleClick={(e) => {
                    if (row.ids.length === 1 && !(e.target as HTMLElement).closest('.keyframe')) {
                      studio.setFrame(frameAt(e.clientX));
                      studio.addKey(row.ids[0]);
                    }
                  }}
                >
                  {showReferences &&
                    [...new Set(row.ids.flatMap((id) => references[id]))].map((frame) => (
                      <span
                        key={'reference-' + frame}
                        className="reference-key"
                        role="img"
                        aria-label={row.label + ' source reference key ' + Number(frame.toFixed(2))}
                        title={
                          'Source animation · frame ' + Number(frame.toFixed(2)) + ' · read only'
                        }
                        style={{ left: (frame / p.end) * 100 + '%' }}
                      >
                        <Diamond size={12} />
                      </span>
                    ))}
                  {row.ids.length === 1 &&
                    preview?.kind !== 'move' &&
                    segments[row.ids[0]]?.map((segment) => (
                      <span
                        className="timeline-interpolation"
                        data-interpolation={segment.kind}
                        key={segment.from}
                        title={segment.title}
                        aria-label={row.label + ' · ' + segment.title.split('\n')[0]}
                        style={{
                          left: (segment.from / p.end) * 100 + '%',
                          width: ((segment.to - segment.from) / p.end) * 100 + '%',
                        }}
                      >
                        <InterpolationConnector kind={segment.kind} modified={segment.modified} />
                      </span>
                    ))}
                  {frames.map((frame) => {
                    const at = rowKeys.filter((k) => k.frame === frame),
                      active = at.every((k) => selected.has(keyToken(k))),
                      partial = !active && at.some((k) => selected.has(keyToken(k)));
                    const left =
                      ((preview?.kind === 'move' &&
                      at.some((k) => preview.keys.some((v) => keyToken(k) === keyToken(v)))
                        ? frame + preview.delta
                        : frame) /
                        p.end) *
                      100;
                    return (
                      <button
                        key={frame}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (drag.current) finish(true);
                          if (!active) studio.selectTimeline(at);
                          setKeyMenu({ x: e.clientX, y: e.clientY });
                        }}
                        aria-label={row.label + ' key ' + frame}
                        aria-pressed={active}
                        className={
                          'keyframe' + (active ? ' selected' : '') + (partial ? ' partial' : '')
                        }
                        style={{ left: left + '%' }}
                        title={
                          row.label +
                          ' · frame ' +
                          frame +
                          ' · Shift click or Multi to add or remove'
                        }
                        onClick={(e) => {
                          if (e.detail !== 0) return;
                          const extend = e.shiftKey || multiSelect;
                          studio.selectTimeline(
                            at,
                            extend ? (active ? 'subtract' : 'add') : 'replace',
                          );
                          root.current!.focus();
                        }}
                        onPointerDown={(e) => {
                          if (armed) return;
                          e.stopPropagation();
                          e.preventDefault();
                          root.current!.focus();
                          if (drag.current?.kind === 'move' && drag.current.keyboard) {
                            finish();
                            return;
                          }
                          if (e.button !== 0) return;
                          const extend = e.shiftKey || multiSelect,
                            next = active
                              ? selection
                              : extend
                                ? uniqueKeys([...selection, ...at])
                                : at,
                            tap =
                              extend && active
                                ? selection.filter(
                                    (k) => !at.some((a) => keyToken(k) === keyToken(a)),
                                  )
                                : next;
                          e.currentTarget.setPointerCapture(e.pointerId);
                          pendingKey.current = {
                            pointer: e.pointerId,
                            x: e.clientX,
                            y: e.clientY,
                            threshold:
                              e.pointerType === 'touch' ? 14 : e.pointerType === 'pen' ? 10 : 3,
                            keys: next,
                            tap,
                          };
                        }}
                      >
                        <Diamond size={10} fill="currentColor" />
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {spaces.length > 0 && (
            <div className="contact-track" onPointerDown={(e) => e.stopPropagation()}>
              {spaces.map((space, i) => {
                const end = spaces[i + 1]?.frame ?? p.end;
                return (
                  end > space.frame && (
                    <ContactSegment
                      key={space.frame}
                      from={space.frame}
                      to={end}
                      attached={space.parent !== 'world'}
                      style={{
                        left: (space.frame / p.end) * 100 + '%',
                        width: ((end - space.frame) / p.end) * 100 + '%',
                      }}
                      title={
                        space.parent === 'world'
                          ? 'Free movement'
                          : 'Following ' + labels[space.parent]
                      }
                      onClick={() => {
                        studio.selectControl(hand);
                        studio.setFrame(space.frame);
                      }}
                    >
                      {space.parent === 'world' ? 'Free' : 'Hold ' + labels[space.parent]}
                    </ContactSegment>
                  )
                );
              })}
            </div>
          )}
          <TimelinePlayhead end={p.end} />
          {preview?.kind === 'box' && (
            <div
              className="selection-marquee"
              style={{
                left: Math.min(preview.x, preview.toX),
                top: Math.min(preview.y, preview.toY),
                width: Math.abs(preview.toX - preview.x),
                height: Math.abs(preview.toY - preview.y),
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
});

const ContactSegment = memo(function ContactSegment({
  from,
  to,
  attached,
  ...props
}: {
  from: number;
  to: number;
  attached: boolean;
} & import('react').ButtonHTMLAttributes<HTMLButtonElement>) {
  const active = useStudioSelector((s) => s.frame >= from && s.frame < to);
  return (
    <button
      {...props}
      className={'contact-segment' + (attached ? ' attached' : '') + (active ? ' now' : '')}
    />
  );
});

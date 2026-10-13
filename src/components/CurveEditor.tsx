import { LockKeyhole, UnlockKeyhole } from 'lucide-react';
import { curveKeyLocked } from '../core/curveLocks';
import { MotionPresence } from './Motion';
import { CurvePlayhead } from './TimelinePlayhead';
import { ScrubNumber } from './ScrubNumber';
import { ModifierPanel } from './ModifierPanel';
import { MotionSettings } from './MotionSettings';
import { InterpolationSettings, HandleSettings } from './InterpolationSettings';
import { loopRange } from '../core/loops';
import { INTERPOLATION_NAMES } from '../core/timelineSettings';
import { memo, useEffect, useMemo, useRef, useState, useId } from 'react';
import type { ReactNode } from 'react';
import { beginCurveKeyDrag, curveKeyDragDelta } from '../core/curveDrag';
import type { CurveKeyDrag, CurveDragAxis } from '../core/curveDrag';
import { translateCurveKeys, editCurveHandle } from '../core/timelineChannels';
import { isTouch } from '../platform/storage';
import {
  Plus,
  Trash2,
  Maximize2,
  Copy,
  ClipboardPaste,
  BoxSelect,
  ListChecks,
  Hand,
  SlidersHorizontal,
  Waves,
  ArrowLeftRight,
  ArrowUpDown,
  Layers2,
  PanelLeft,
  ZoomIn,
  ZoomOut,
  Focus,
  Scissors,
  Grid3X3,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { studio } from '../core/store';
import { controlLabel } from '../core/model';
import { useStudioChrome } from '../hooks';
import {
  CHANNEL_LABELS,
  channelColor,
  channelsFor,
  channelUnit,
  channelSample,
  readCurve,
  handles,
  baseCurve,
} from '../core/curves';
import type { Channel, CurveKey } from '../core/curves';
type View = { from: number; to: number; min: number; max: number };
type Drag = {
  kind: 'keys' | 'left' | 'right' | 'pan' | 'scrub' | 'box';
  x: number;
  y: number;
  view: View;
  keys: CurveKey[];
  frames: number[];
  anchor: number;
  threshold?: number;
  scrubFrame?: number;
  keyDrag?: CurveKeyDrag;
  started?: boolean;
  add?: boolean;
};
const bounds = { left: 54, right: 16, top: 12, bottom: 26 };
const copy = <T,>(v: T) => structuredClone(v);
export const CurveEditor = memo(function CurveEditor({
  channel,
  focusKey,
  sidebar,
  hideTracks = false,
  onReduce,
}: {
  channel: Channel;
  focusKey?: { frame: number; serial: number };
  sidebar: ReactNode;
  /** Start with the channel list hidden (another list drives the channel). */
  hideTracks?: boolean;
  onReduce: (frames: number[]) => void;
}) {
  const s = useStudioChrome({ frame: 'none', edits: 'live' }),
    p = s.project!,
    track = p.tracks[s.selected];
  const [selected, setSelected] = useState<number[]>([]),
    [panel, setPanel] = useState<'key' | 'modifiers'>('key'),
    [view, setView] = useState<View | null>(null);
  const [showTracks, setShowTracks] = useState(() => !hideTracks && (!isTouch || innerWidth > 700)),
    [guides, setGuides] = useState(false);
  const [tool, setTool] = useState<'box' | 'pan'>('box'),
    [multi, setMulti] = useState(false),
    [constraint, setConstraint] = useState<'x' | 'y' | null>(null),
    [compare, setCompare] = useState(false),
    [inspecting, setInspecting] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; toX: number; toY: number } | null>(
      null,
    ),
    clipId = useId();
  useEffect(() => {
    setSelected(focusKey ? [focusKey.frame] : []);
    setView(null);
  }, [channel, focusKey?.serial]);
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<Drag | null>(null);
  const [dragAxis, setDragAxis] = useState<CurveDragAxis | null>(null);
  const keyboardDrag = useRef<{ axis: 'x' | 'y' | null; numeric: string } | null>(null),
    pointer = useRef({ x: 300, y: 100 });
  useEffect(
    () => () => {
      if (keyboardDrag.current || drag.current?.started) studio.cancelGesture();
    },
    [],
  );
  const [size, setSize] = useState({ w: 1000, h: 260 }),
    W = Math.max(80, size.w),
    H = Math.max(60, size.h);
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const preventScroll = (event: WheelEvent) => event.preventDefault();
    node.addEventListener('wheel', preventScroll, { passive: false });
    const observer = new ResizeObserver(() => {
      const r = node.getBoundingClientRect();
      if (r.width && r.height) setSize({ w: r.width, h: r.height });
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      node.removeEventListener('wheel', preventScroll);
    };
  }, []);
  const curve = useMemo(() => readCurve(track, channel), [track, channel]);
  const data = useMemo(
    () =>
      Array.from({ length: 361 }, (_, i) => {
        const frame = (i / 360) * p.end;
        return { frame, value: channelSample(track, channel, frame) };
      }),
    [track, channel, p.end],
  );
  const siblings = useMemo(
    () =>
      compare
        ? channelsFor(s.selected, track).filter(
            (c) => c !== channel && c[0] === channel[0] && c.length === 2,
          )
        : [],
    [compare, s.selected, track.rotationMode, channel],
  );
  const contextData = useMemo(
    () =>
      siblings.map((c) => ({
        channel: c,
        points: Array.from({ length: 241 }, (_, i) => ({
          frame: (i / 240) * p.end,
          value: channelSample(track, c, (i / 240) * p.end),
        })),
      })),
    [siblings, track, p.end],
  );
  const fit = useMemo(() => {
    const vs = [
        ...data.map((v) => v.value),
        ...curve.keys.map((k) => k.value),
        ...contextData.flatMap((c) => c.points.map((p) => p.value)),
      ],
      lo = Math.min(...vs),
      hi = Math.max(...vs),
      pad = Math.max((hi - lo) * 0.16, channel.startsWith('q') ? 0.002 : hi === lo ? 1 : 0.01);
    return { from: 0, to: p.end, min: lo - pad, max: hi + pad };
  }, [data, curve, channel, p.end, contextData]);
  const v = view ?? fit,
    cw = Math.max(20, W - bounds.left - bounds.right),
    ch = Math.max(20, H - bounds.top - bounds.bottom);
  const x = (f: number) => bounds.left + ((f - v.from) / (v.to - v.from)) * cw,
    y = (value: number) => bounds.top + ((v.max - value) / (v.max - v.min)) * ch;
  const point = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const frameAt = (px: number) =>
    Math.max(0, Math.min(p.end, Math.round(v.from + ((px - bounds.left) / cw) * (v.to - v.from))));
  const valueAt = (py: number) => v.max - ((py - bounds.top) / ch) * (v.max - v.min);
  const active = curve.keys.find((k) => k.frame === selected.at(-1)),
    selectedKeys = curve.keys.filter((k) => selected.includes(k.frame));
  const remove = () => {
    const keys = curve.keys.filter((k) => !selected.includes(k.frame));
    if (!keys.length) {
      studio.patch({ message: 'Keep at least one key on the channel.' });
      return;
    }
    studio.setCurveKeys(channel, keys);
    setSelected([]);
  };
  const insertKey = (frame = studio.state.frame, value?: number) => {
    studio.addCurveKey(channel, frame, value);
    if (
      readCurve(studio.state.project!.tracks[s.selected], channel).keys.some(
        (k) => k.frame === frame,
      )
    )
      setSelected([frame]);
  };
  const paste = () => {
    const frames = studio.pasteCurveKeys(channel);
    if (frames?.length) {
      setSelected(frames);
      setPanel('key');
      if (frames.some((f) => f < v.from || f > v.to)) setView(null);
    }
  };
  const editKeys = (fn: (key: CurveKey) => CurveKey) =>
    studio.setCurveKeys(
      channel,
      curve.keys.map((k) => (selected.includes(k.frame) ? fn(copy(k)) : k)),
    );
  const zoom = (factor: number) => {
    const anchor = selected.at(-1) ?? studio.state.frame,
      span = Math.max(1, Math.min(p.end * 16, (v.to - v.from) * factor)),
      ratio = (anchor - v.from) / (v.to - v.from);
    setView({ ...v, from: anchor - ratio * span, to: anchor + (1 - ratio) * span });
  };
  const fitSelection = () => {
    const picked = selectedKeys.length ? selectedKeys : curve.keys;
    const lo = Math.min(...picked.map((k) => k.value)),
      hi = Math.max(...picked.map((k) => k.value)),
      from = Math.min(...picked.map((k) => k.frame)),
      to = Math.max(...picked.map((k) => k.frame)),
      px = Math.max(2, (to - from) * 0.12),
      py = Math.max(hi === lo ? 1 : 0.01, (hi - lo) * 0.2);
    setView({ from: from - px, to: to + px, min: lo - py, max: hi + py });
  };
  const editHandle = (side: 'left' | 'right', axis: 0 | 1, value: number) => {
    if (!active) return;
    const index = curve.keys.indexOf(active),
      h = handles(curve, index)[side];
    h[axis] = value;
    studio.setCurveKeys(
      channel,
      curve.keys.map((k, i) => (i === index ? editCurveHandle(curve, index, side, h) : k)),
    );
  };
  const start = (e: React.PointerEvent<SVGElement>, kind: Drag['kind'], frame?: number) => {
    if (keyboardDrag.current) {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 2) {
        studio.cancelGesture();
        setSelected(drag.current?.frames ?? []);
      } else studio.endGesture();
      keyboardDrag.current = null;
      drag.current = null;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 2) {
      end(true);
      return;
    }
    if (drag.current) {
      end(true);
      return;
    }
    svg.current!.focus();
    const at = point(e);
    let frames = selected;
    if (kind === 'keys' && frame !== undefined) {
      // Dense touch targets overlap: select the visually nearest key, not the last DOM node.
      let nearest = Infinity;
      for (const key of curve.keys) {
        const distance = Math.hypot(x(key.frame) - at.x, y(key.value) - at.y);
        if (distance < nearest) {
          nearest = distance;
          frame = key.frame;
        }
      }
      if (e.shiftKey || multi) {
        frames = selected.includes(frame)
          ? selected.filter((f) => f !== frame)
          : [...selected, frame];
        setSelected(frames);
        if (!frames.includes(frame)) return;
      } else if (!selected.includes(frame)) {
        frames = [frame];
        setSelected(frames);
      }
      setPanel('key');
      studio.setFrame(frame);
    }
    if (kind === 'scrub' && frame === undefined) studio.setFrame(frameAt(at.x));
    if (kind === 'box') {
      setMarquee({ x: at.x, y: at.y, toX: at.x, toY: at.y });
      if (!e.shiftKey && !multi) frames = [];
    }
    setView(v);
    drag.current = {
      kind,
      scrubFrame: kind === 'scrub' ? frame : undefined,
      x: at.x,
      y: at.y,
      view: { ...v },
      keys: copy(curve.keys),
      frames: [...frames],
      anchor: frame ?? selected.at(-1) ?? 0,
      threshold: e.pointerType === 'mouse' ? 6 : 10,
      add: e.shiftKey || multi,
    };
    svg.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const at = point(e);
    pointer.current = at;
    const d = drag.current;
    if (!d) return;
    const df = ((at.x - d.x) / cw) * (d.view.to - d.view.from),
      dv = (-(at.y - d.y) / ch) * (d.view.max - d.view.min);
    if (d.kind === 'pan') {
      setView({
        ...d.view,
        from: d.view.from - df,
        to: d.view.to - df,
        min: d.view.min - dv,
        max: d.view.max - dv,
      });
      return;
    }
    if (d.kind === 'scrub') {
      studio.setFrame(d.scrubFrame === undefined ? frameAt(at.x) : Math.round(d.scrubFrame + df));
      return;
    }
    if (d.kind === 'box') {
      setMarquee({ x: d.x, y: d.y, toX: at.x, toY: at.y });
      return;
    }
    if (d.kind === 'keys' && !keyboardDrag.current) {
      const dx = at.x - d.x,
        dy = at.y - d.y;
      if (!d.keyDrag) {
        const intent = beginCurveKeyDrag(dx, dy, d.threshold ?? 0, constraint);
        if (!intent) return;
        d.keyDrag = intent;
        setDragAxis(intent.axis);
        studio.beginGesture();
        d.started = true;
      }
      const delta = curveKeyDragDelta(d.keyDrag, dx, dy);
      moveKeys(
        d,
        (delta.x / cw) * (d.view.to - d.view.from),
        (-delta.y / ch) * (d.view.max - d.view.min),
      );
      return;
    }
    if (!d.started) {
      if (Math.hypot(at.x - d.x, at.y - d.y) < (d.threshold ?? 0)) return;
      studio.beginGesture();
      d.started = true;
    }
    if (d.kind === 'keys') {
      moveKeys(d, df, dv);
      return;
    }
    const idx = d.keys.findIndex((k) => k.frame === d.anchor);
    if (idx < 0) return;
    const side = d.kind,
      hs = handles({ ...curve, keys: d.keys }, idx),
      h = hs[side];
    const next = editCurveHandle({ ...curve, keys: d.keys }, idx, side, [h[0] + df, h[1] + dv]);
    studio.setCurveKeys(
      channel,
      d.keys.map((k, i) => (i === idx ? next : k)),
    );
  };
  const moveKeys = (d: Drag, df: number, dv: number) => {
    const k = keyboardDrag.current;
    if (k) {
      if (k.axis === 'x') dv = 0;
      if (k.axis === 'y') df = 0;
      if (k.numeric !== '' && Number.isFinite(Number(k.numeric))) {
        if (k.axis === 'y') dv = Number(k.numeric);
        else {
          df = Number(k.numeric);
          dv = 0;
        }
      }
    }
    if (!k) {
      if (constraint === 'x') dv = 0;
      if (constraint === 'y') df = 0;
    }
    const moved = translateCurveKeys(d.keys, d.frames, df, dv, p.end);
    if (!moved) return;
    studio.setCurveKeys(channel, moved.keys);
    setSelected(moved.frames);
  };
  const end = (cancel = false) => {
    if (keyboardDrag.current && !cancel) return;
    const d = drag.current;
    if (!d) return;
    if (d.started) {
      if (cancel) {
        studio.cancelGesture();
        setSelected(d.frames);
      } else studio.endGesture();
    }
    if (d.kind === 'box' && !cancel && marquee) {
      const { x: a, y: b, toX: c, toY: e } = marquee;
      const hits = curve.keys
        .filter(
          (k) =>
            x(k.frame) >= Math.min(a, c) - 5 &&
            x(k.frame) <= Math.max(a, c) + 5 &&
            y(k.value) >= Math.min(b, e) - 5 &&
            y(k.value) <= Math.max(b, e) + 5,
        )
        .map((k) => k.frame);
      setSelected([...new Set([...(d.add ? d.frames : []), ...hits])]);
      if (hits.length) setPanel('key');
    }
    drag.current = null;
    keyboardDrag.current = null;
    setDragAxis(null);
    setMarquee(null);
  };
  const path = (fn: (f: number) => number) =>
    Array.from({ length: 481 }, (_, i) => {
      const f = v.from + (i / 480) * (v.to - v.from);
      return (i ? 'L' : 'M') + x(f).toFixed(2) + ',' + y(fn(f)).toFixed(2);
    }).join(' ');
  const evaluatedPath = useMemo(
    () => path((f) => channelSample(track, channel, f)),
    [track, channel, v, W, H],
  );
  const underlyingPath = useMemo(() => path((f) => baseCurve(curve, f)), [curve, v, W, H]);
  const changeFrame = (frame: number) => {
    if (
      !active ||
      !Number.isFinite(frame) ||
      frame < 0 ||
      frame > p.end ||
      curve.keys.some((k) => k.frame === frame && k.frame !== active.frame)
    )
      return;
    const old = active.frame;
    studio.setCurveKeys(
      channel,
      curve.keys.map((k) => (k.frame === old ? { ...k, frame } : k)),
    );
    setSelected([frame]);
  };
  return (
    <div
      className={
        'curve-editor' + (inspecting ? ' inspecting' : '') + (showTracks ? '' : ' tracks-hidden')
      }
      tabIndex={0}
      aria-label="Curve editor"
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).closest('input,select,textarea')) return;
        const key = e.key.toLowerCase();
        if (keyboardDrag.current) {
          e.preventDefault();
          e.stopPropagation();
          const k = keyboardDrag.current,
            d = drag.current!;
          if (key === 'escape' || key === 'enter') {
            if (key === 'escape') {
              studio.cancelGesture();
              setSelected(d.frames);
            } else studio.endGesture();
            keyboardDrag.current = null;
            drag.current = null;
            return;
          }
          if (key === 'x' || key === 'y') k.axis = k.axis === key ? null : key;
          else if (/^[0-9.\-]$/.test(key)) {
            if (key === '-')
              k.numeric = k.numeric.startsWith('-') ? k.numeric.slice(1) : '-' + k.numeric;
            else if (key !== '.' || !k.numeric.includes('.')) k.numeric += key;
          } else if (key === 'backspace') k.numeric = k.numeric.slice(0, -1);
          moveKeys(
            d,
            ((pointer.current.x - d.x) / cw) * (d.view.to - d.view.from),
            (-(pointer.current.y - d.y) / ch) * (d.view.max - d.view.min),
          );
          return;
        }
        if (key === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          if (!selected.length) return;
          studio.beginGesture();
          setView(v);
          drag.current = {
            kind: 'keys',
            ...pointer.current,
            view: { ...v },
            keys: copy(curve.keys),
            frames: [...selected],
            anchor: selected.at(-1)!,
            started: true,
          };
          keyboardDrag.current = { axis: null, numeric: '' };
          return;
        }
        if (key === 'a' && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          setSelected(e.altKey ? [] : curve.keys.map((k) => k.frame));
          return;
        }
        if ((e.ctrlKey || e.metaKey) && key === 'i') {
          e.preventDefault();
          e.stopPropagation();
          setSelected(curve.keys.filter((k) => !selected.includes(k.frame)).map((k) => k.frame));
          return;
        }
        if (key === 'home' || key === 'f' || e.code === 'NumpadDecimal') {
          e.preventDefault();
          e.stopPropagation();
          if (key === 'home') setView(null);
          else fitSelection();
          return;
        }
        if (key === 'i' || key === 'k') {
          e.preventDefault();
          e.stopPropagation();
          insertKey();
          return;
        }
        if (key === 'b') {
          e.preventDefault();
          e.stopPropagation();
          setTool('box');
          return;
        }
        if (key === 'escape') {
          e.preventDefault();
          e.stopPropagation();
          end(true);
          setSelected([]);
          return;
        }
        // Viewport pose shortcuts must never change the rig while the graph has focus.
        if (['g', 'r', 'h', 'q', 'w', 'e'].includes(key) && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.key === 'Delete') {
          e.preventDefault();
          e.stopPropagation();
          remove();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
          e.preventDefault();
          e.stopPropagation();
          studio.copyCurveKeys(channel, selected);
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
          e.preventDefault();
          e.stopPropagation();
          paste();
        }
      }}
    >
      {showTracks && sidebar}
      <div className="curve-center">
        <div className="curve-tools">
          <button
            className="curve-tracks-toggle"
            aria-label={showTracks ? 'Hide bone channels' : 'Show bone channels'}
            title="Bone channels"
            aria-pressed={showTracks}
            onClick={() => setShowTracks(!showTracks)}
          >
            <PanelLeft size={16} />
          </button>
          <strong style={{ color: channelColor(channel) }}>
            <span className="curve-bone-flair">{controlLabel(s.selected, p)}</span>
            {CHANNEL_LABELS[channel]} <small>{channelUnit(channel)}</small>
          </strong>
          <button
            className="curve-key-lock"
            aria-label="Lock new keys on this curve"
            title="Prevent new keys; existing keys and tangents stay editable"
            aria-pressed={curveKeyLocked(track, channel)}
            onClick={() => studio.setCurveKeyLock(channel, !curveKeyLocked(track, channel))}
          >
            {curveKeyLocked(track, channel) ? (
              <LockKeyhole size={15} />
            ) : (
              <UnlockKeyhole size={15} />
            )}
            <span>{curveKeyLocked(track, channel) ? 'Keys locked' : 'Lock keys'}</span>
          </button>
          <div className="curve-gesture-tools">
            <button
              aria-label="Box select curve keys"
              title="Box select (B)"
              aria-pressed={tool === 'box'}
              onClick={() => setTool('box')}
            >
              <BoxSelect size={16} />
            </button>
            <button
              aria-label="Pan curve graph"
              title="Pan"
              aria-pressed={tool === 'pan'}
              onClick={() => setTool('pan')}
            >
              <Hand size={16} />
            </button>
            <button
              aria-label="Multi select curve keys"
              title="Multi select"
              aria-pressed={multi}
              onClick={() => setMulti(!multi)}
            >
              <ListChecks size={16} />
            </button>
          </div>
          <span className="title-spacer" />
          <button
            aria-label="Compare sibling axes"
            title="Show the other axes"
            aria-pressed={compare}
            onClick={() => {
              setCompare(!compare);
              setView(null);
            }}
          >
            <Layers2 size={16} />
          </button>
          <button
            className="curve-secondary-view"
            aria-label="Show curve guides"
            title="Guide lines and value scale"
            aria-pressed={guides}
            onClick={() => setGuides(!guides)}
          >
            <Grid3X3 size={16} />
          </button>
          <button title="Fit all (Home)" aria-label="Fit curve" onClick={() => setView(null)}>
            <Maximize2 size={15} />
            <span>Fit</span>
          </button>
          <button
            className="curve-secondary-view"
            aria-label="Zoom in curve"
            title="Zoom in"
            onClick={() => zoom(0.5)}
          >
            <ZoomIn size={16} />
          </button>
          <button
            className="curve-secondary-view"
            aria-label="Zoom out curve"
            title="Zoom out"
            onClick={() => zoom(2)}
          >
            <ZoomOut size={16} />
          </button>
          <button
            className="curve-cleanup"
            aria-label="Clean up curve"
            title="Reduce this curve, or the selected key range"
            onClick={() => onReduce(selected)}
          >
            <Scissors size={16} />
            <span>Clean up</span>
          </button>
          <button
            title="Add channel key at playhead"
            aria-label="Add channel key"
            onClick={() => insertKey()}
          >
            <Plus size={16} />
          </button>
          <div className="curve-clipboard-tools" aria-label="Curve clipboard">
            <button
              aria-label="Copy curve keys"
              title="Copy selected keys (Ctrl C)"
              disabled={!selected.length}
              onClick={() => studio.copyCurveKeys(channel, selected)}
            >
              <Copy size={16} />
              <span>Copy</span>
            </button>
            <button
              title="Paste curve keys at playhead (Ctrl V)"
              aria-label="Paste curve keys"
              disabled={!s.curveClipboard?.length}
              onClick={paste}
            >
              <ClipboardPaste size={16} />
              <span>Paste</span>
            </button>
          </div>
          <details className="curve-view-options">
            <summary aria-label="Curve view options" title="Zoom, guides and movement">
              <MoreHorizontal size={17} />
            </summary>
            <div className="curve-view-menu">
              <button aria-label="Zoom in curve" onClick={() => zoom(0.5)}>
                <ZoomIn size={16} />
                Zoom in
              </button>
              <button aria-label="Zoom out curve" onClick={() => zoom(2)}>
                <ZoomOut size={16} />
                Zoom out
              </button>
              <button
                aria-label="Show curve guides"
                aria-pressed={guides}
                onClick={() => setGuides(!guides)}
              >
                <Grid3X3 size={16} />
                Guide lines
              </button>
              {selected.length > 0 && (
                <>
                  <button
                    aria-label="Move curve keys in time only"
                    aria-pressed={constraint === 'x'}
                    onClick={() => setConstraint(constraint === 'x' ? null : 'x')}
                  >
                    <ArrowLeftRight size={16} />
                    Move time only
                  </button>
                  <button
                    aria-label="Move curve key values only"
                    aria-pressed={constraint === 'y'}
                    onClick={() => setConstraint(constraint === 'y' ? null : 'y')}
                  >
                    <ArrowUpDown size={16} />
                    Move values only
                  </button>
                  <button aria-label="Fit selected curve keys" onClick={fitSelection}>
                    <Focus size={16} />
                    Fit selected keys
                  </button>
                </>
              )}
            </div>
          </details>
          <button
            aria-label="Curve key and tangent properties"
            title="Key values and tangent handles"
            aria-pressed={inspecting && panel === 'key'}
            onClick={() => {
              setInspecting(!(inspecting && panel === 'key'));
              setPanel('key');
            }}
          >
            <SlidersHorizontal size={16} />
          </button>
          <button
            aria-label="Curve modifiers"
            title="Channel modifiers"
            aria-pressed={inspecting && panel === 'modifiers'}
            onClick={() => {
              setInspecting(!(inspecting && panel === 'modifiers'));
              setPanel('modifiers');
            }}
          >
            <Waves size={16} />
          </button>
        </div>
        <div className="curve-selection-tools" aria-label="Curve key tools">
          {active ? (
            <>
              <span className="curve-selection-count">
                {selected.length > 1 ? selected.length + ' keys' : 'Key'}
              </span>
              <label title="Frame">
                Frame
                <ScrubNumber
                  aria-label="Selected key frame"
                  type="number"
                  step={1}
                  value={active.frame}
                  onFocus={() => studio.beginGesture()}
                  onBlur={() => studio.endGesture()}
                  onChange={(e) => {
                    if (e.target.value !== '') changeFrame(Number(e.target.value));
                  }}
                />
              </label>
              <label title={'Value in ' + channelUnit(channel)}>
                Value
                <ScrubNumber
                  aria-label="Selected key value"
                  type="number"
                  step={0.1}
                  value={Number(active.value.toFixed(4))}
                  onFocus={() => studio.beginGesture()}
                  onBlur={() => studio.endGesture()}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (e.target.value !== '' && Number.isFinite(value))
                      editKeys((k) => ({ ...k, value: k.value + value - active.value }));
                  }}
                />
              </label>
              <button
                className="curve-interpolation-trigger"
                aria-label="Selected key interpolation"
                title="Edit interpolation and tangents"
                onClick={() => {
                  setPanel('key');
                  setInspecting(true);
                }}
              >
                <SlidersHorizontal size={14} />
                <span>
                  {active.interpolation === 'loop'
                    ? 'Loop endpoint'
                    : INTERPOLATION_NAMES[active.interpolation]}
                </span>
              </button>
              <span className="title-spacer" />
              <button
                className="curve-secondary-action"
                aria-label="Move curve keys in time only"
                title="Move in time only"
                aria-pressed={constraint === 'x'}
                onClick={() => setConstraint(constraint === 'x' ? null : 'x')}
              >
                <ArrowLeftRight size={16} />
              </button>
              <button
                className="curve-secondary-action"
                aria-label="Move curve key values only"
                title="Move values only"
                aria-pressed={constraint === 'y'}
                onClick={() => setConstraint(constraint === 'y' ? null : 'y')}
              >
                <ArrowUpDown size={16} />
              </button>
              <button
                className="curve-secondary-action"
                aria-label="Fit selected curve keys"
                title="Fit selection (F)"
                onClick={fitSelection}
              >
                <Focus size={16} />
              </button>
              <button
                aria-label="Delete channel keys"
                title="Delete selected keys"
                onClick={remove}
              >
                <Trash2 size={16} />
              </button>
            </>
          ) : (
            <span className="curve-selection-placeholder">
              Select a key to edit its timing and motion
            </span>
          )}
        </div>
        <svg
          ref={svg}
          tabIndex={0}
          className="curve-canvas"
          viewBox={'0 0 ' + W + ' ' + H}
          preserveAspectRatio="none"
          role="group"
          aria-label={CHANNEL_LABELS[channel] + ' graph'}
          onPointerDown={(e) =>
            start(
              e,
              e.button === 1 || e.altKey || tool === 'pan'
                ? 'pan'
                : point(e).y > H - bounds.bottom
                  ? 'scrub'
                  : 'box',
            )
          }
          onPointerMove={move}
          onPointerUp={() => end()}
          onPointerCancel={() => end(true)}
          onContextMenu={(e) => e.preventDefault()}
          onDoubleClick={(e) => {
            const at = point(e);
            if (at.x < bounds.left || at.y > H - bounds.bottom) return;
            const f = frameAt(at.x);
            insertKey(f, valueAt(at.y));
          }}
          onWheel={(e) => {
            const at = point(e),
              factor = e.deltaY > 0 ? 1.15 : 0.87,
              anchor = v.from + ((at.x - bounds.left) / cw) * (v.to - v.from),
              value = valueAt(at.y);
            setView(
              e.shiftKey
                ? {
                    ...v,
                    min: value + (v.min - value) * factor,
                    max: value + (v.max - value) * factor,
                  }
                : {
                    ...v,
                    from: anchor + (v.from - anchor) * factor,
                    to: anchor + (v.to - anchor) * factor,
                  },
            );
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={bounds.left - 12} y={bounds.top} width={cw + 24} height={ch} />
            </clipPath>
          </defs>
          {guides &&
            Array.from({ length: 4 }, (_, i) => {
              const value = v.min + ((v.max - v.min) * i) / 3;
              return (
                <g key={'y' + i} className="curve-guide">
                  <line
                    x1={bounds.left}
                    x2={W - bounds.right}
                    y1={y(value)}
                    y2={y(value)}
                    className="curve-grid-line"
                  />
                  <text x={bounds.left - 8} y={y(value) + 4} textAnchor="end">
                    {Number(value.toFixed(2))}
                  </text>
                </g>
              );
            })}
          {frameTicks(v.from, v.to, cw).map((frame) => (
            <g key={frame}>
              <line
                x1={x(frame)}
                x2={x(frame)}
                y1={bounds.top}
                y2={H - bounds.bottom}
                className={'curve-grid-line' + (guides ? '' : ' quiet')}
              />
              <text x={x(frame)} y={H - 8} textAnchor="middle">
                {frame}
              </text>
            </g>
          ))}
          <CurvePlayhead
            from={v.from}
            to={v.to}
            left={bounds.left}
            width={cw}
            top={bounds.top}
            bottom={H - bounds.bottom}
            onScrubStart={(e) => start(e, 'scrub', studio.state.frame)}
          />
          <g clipPath={'url(#' + clipId + ')'}>
            {contextData.map((c) => (
              <path
                key={c.channel}
                d={c.points
                  .map(
                    (p, i) => (i ? 'L' : 'M') + x(p.frame).toFixed(2) + ',' + y(p.value).toFixed(2),
                  )
                  .join(' ')}
                fill="none"
                stroke={channelColor(c.channel)}
                strokeWidth="1.5"
                opacity=".35"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ))}
            {v.min < 0 && v.max > 0 && (
              <line
                className="curve-zero-line"
                x1={bounds.left}
                x2={W - bounds.right}
                y1={y(0)}
                y2={y(0)}
              />
            )}
            {curve.modifiers.some((m) => m.enabled) && (
              <path d={underlyingPath} className="curve-base-line" />
            )}
            <path
              d={evaluatedPath}
              fill="none"
              stroke={channelColor(channel)}
              strokeWidth="2.25"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
            {curve.keys.map((k, i) => {
              if (k.frame < v.from - 1 || k.frame > v.to + 1) return null;
              const hs = handles(curve, i),
                chosen = selected.includes(k.frame);
              return (
                <g key={i}>
                  {chosen &&
                    (['left', 'right'] as const)
                      .filter((side) =>
                        side === 'right'
                          ? ['bezier', 'loop'].includes(k.interpolation)
                          : ['bezier', 'loop'].includes(curve.keys[i - 1]?.interpolation),
                      )
                      .map((side) => (
                        <g key={side} className="curve-tangent">
                          <line
                            className="tangent-line"
                            x1={x(k.frame)}
                            y1={y(k.value)}
                            x2={x(k.frame + hs[side][0])}
                            y2={y(k.value + hs[side][1])}
                          />
                          <circle
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (!e.key.startsWith('Arrow')) return;
                              e.preventDefault();
                              e.stopPropagation();
                              const h = handles(curve, i)[side],
                                time = e.key === 'ArrowLeft' || e.key === 'ArrowRight',
                                delta =
                                  (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1) *
                                  (e.shiftKey ? 10 : 1) *
                                  (time ? 1 : (v.max - v.min) / 100);
                              h[time ? 0 : 1] += delta;
                              studio.setCurveKeys(
                                channel,
                                curve.keys.map((key, j) =>
                                  j === i ? editCurveHandle(curve, i, side, h) : key,
                                ),
                              );
                            }}
                            aria-label={side + ' tangent at frame ' + k.frame}
                            className="tangent-handle"
                            cx={x(k.frame + hs[side][0])}
                            cy={y(k.value + hs[side][1])}
                            r={isTouch ? 9 : 6}
                            onPointerDown={(e) => start(e, side, k.frame)}
                            onDoubleClick={(e) => e.stopPropagation()}
                          />
                        </g>
                      ))}
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={'Curve key at frame ' + k.frame}
                    className={'curve-key-target' + (chosen ? ' selected' : '')}
                    onPointerDown={(e) => start(e, 'keys', k.frame)}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setSelected([k.frame]);
                        studio.setFrame(k.frame);
                        setPanel('key');
                      }
                    }}
                  >
                    <rect
                      className="curve-key-hit"
                      x={x(k.frame) - (isTouch ? 12 : 8)}
                      y={y(k.value) - (isTouch ? 12 : 8)}
                      width={isTouch ? 24 : 16}
                      height={isTouch ? 24 : 16}
                    />
                    <rect
                      className={'curve-key ' + (chosen ? 'selected' : '')}
                      x={x(k.frame) - (isTouch ? 4.5 : 3.5)}
                      y={y(k.value) - (isTouch ? 4.5 : 3.5)}
                      width={isTouch ? 9 : 7}
                      height={isTouch ? 9 : 7}
                      transform={'rotate(45 ' + x(k.frame) + ' ' + y(k.value) + ')'}
                    />
                    <title>
                      {'Frame ' + k.frame + ' · ' + k.value.toFixed(3) + ' ' + channelUnit(channel)}
                    </title>
                  </g>
                </g>
              );
            })}
          </g>
          {marquee && (
            <rect
              className="curve-marquee"
              x={Math.min(marquee.x, marquee.toX)}
              y={Math.min(marquee.y, marquee.toY)}
              width={Math.abs(marquee.toX - marquee.x)}
              height={Math.abs(marquee.toY - marquee.y)}
            />
          )}
        </svg>
        <div className="curve-help">
          <span>
            {curve.keys.length} {curve.keys.length === 1 ? 'key' : 'keys'}
            {curve.modifiers.some((m) => m.enabled)
              ? ' · ' + curve.modifiers.filter((m) => m.enabled).length + ' modifiers'
              : ''}
          </span>
          <span>
            {dragAxis === 'x'
              ? 'Time only · value locked'
              : dragAxis === 'y'
                ? 'Value only · frame locked'
                : dragAxis === 'free'
                  ? 'Moving time and value'
                  : selected.length
                    ? 'Drag vertically for value · horizontally for time'
                    : ''}
          </span>
        </div>
      </div>
      <MotionPresence show={inspecting}>
        <aside className="curve-properties">
          <div className="curve-property-tabs">
            <button className={panel === 'key' ? 'active' : ''} onClick={() => setPanel('key')}>
              Key & tangent
            </button>
            <button
              className={panel === 'modifiers' ? 'active' : ''}
              onClick={() => setPanel('modifiers')}
            >
              Modifiers <b>{curve.modifiers.length || ''}</b>
            </button>
            <button
              className="curve-inspector-close"
              aria-label="Close curve properties"
              onClick={() => setInspecting(false)}
            >
              <X size={15} />
            </button>
          </div>
          <div className="curve-property-scroll">
            {panel === 'key' ? (
              active ? (
                <>
                  <div className="curve-field-pair">
                    <Numeric label="Key frame" value={active.frame} step={1} change={changeFrame} />
                    <Numeric
                      label={'Key value (' + channelUnit(channel) + ')'}
                      value={active.value}
                      change={(value) =>
                        editKeys((k) => ({ ...k, value: k.value + (value - active.value) }))
                      }
                    />
                  </div>
                  <InterpolationSettings
                    mode={
                      selectedKeys.every((k) => k.interpolation === active.interpolation)
                        ? active.interpolation
                        : 'mixed'
                    }
                    change={(mode) => studio.setCurveInterpolation(channel, selected, mode)}
                    loop={!!curve.loop}
                    loopChange={(enabled) => studio.setCurveLoop(channel, enabled)}
                    range={loopRange(p)}
                  />
                  {['bezier', 'loop'].includes(active.interpolation) && (
                    <HandleSettings
                      value={
                        selectedKeys.every((k) => k.handle === active.handle)
                          ? active.handle
                          : 'mixed'
                      }
                      change={(handle) => editKeys((k) => ({ ...k, handle }))}
                    />
                  )}
                  {['bezier', 'loop'].includes(active.interpolation) && (
                    <details className="tangent-numbers">
                      <summary>Precise tangents</summary>
                      <p className="curve-note">
                        Offsets from the key. Time is in frames; values use the channel’s units.
                      </p>
                      {(['left', 'right'] as const).map((side) => {
                        const h = handles(curve, curve.keys.indexOf(active))[side];
                        return (
                          <div key={side}>
                            <span>{side === 'left' ? 'Incoming' : 'Outgoing'}</span>
                            <div className="curve-field-pair">
                              <Numeric
                                label={(side === 'left' ? 'Incoming' : 'Outgoing') + ' handle time'}
                                value={h[0]}
                                change={(value) => editHandle(side, 0, value)}
                              />
                              <Numeric
                                label={
                                  (side === 'left' ? 'Incoming' : 'Outgoing') + ' handle value'
                                }
                                value={h[1]}
                                change={(value) => editHandle(side, 1, value)}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </details>
                  )}
                  {(active.interpolation === 'spring' || active.interpolation === 'bounce') && (
                    <MotionSettings
                      mode={active.interpolation}
                      options={active}
                      change={(value) => editKeys((k) => ({ ...k, ...value }))}
                    />
                  )}
                  <p className="curve-note">
                    {curve.loop &&
                    (active.frame === curve.loop.start || active.frame === curve.loop.end)
                      ? 'This endpoint shares its value and tangent with the other end of the loop.'
                      : active.frame === curve.keys.at(-1)!.frame
                        ? 'The last key has no outgoing segment. Select an earlier key to change the motion before it.'
                        : 'Interpolation applies from the selected key to the next key.'}
                  </p>
                  <p className="curve-note">
                    {curve.loop
                      ? 'Loop links the first and last keys. Interior keys keep their settings. '
                      : ''}
                    {selectedKeys.length} selected · {CHANNEL_LABELS[channel]} only.
                  </p>
                </>
              ) : (
                <p className="curve-note">
                  Select a key to edit its time, value, interpolation, and handles. Double-click the
                  graph to add one.
                </p>
              )
            ) : (
              <ModifierPanel channel={channel} curve={curve} />
            )}
          </div>
        </aside>
      </MotionPresence>
    </div>
  );
});
function Numeric({
  label,
  value,
  change,
  step = 0.1,
}: {
  label: string;
  value: number;
  change: (n: number) => void;
  step?: number;
}) {
  return (
    <label className="curve-field">
      {label}
      <ScrubNumber
        aria-label={label}
        type="number"
        step={step}
        value={Number(value.toFixed(5))}
        onFocus={() => studio.beginGesture()}
        onBlur={() => studio.endGesture()}
        onChange={(e) => {
          if (e.target.value !== '' && Number.isFinite(Number(e.target.value)))
            change(Number(e.target.value));
        }}
      />
    </label>
  );
}

function frameTicks(from: number, to: number, width: number) {
  const target = Math.max(1, (to - from) / Math.max(2, Math.floor(width / 120))),
    power = 10 ** Math.floor(Math.log10(target));
  const step = Math.max(1, ([1, 2, 5, 10].find((n) => n * power >= target) ?? 10) * power),
    first = Math.ceil(from / step) * step;
  return Array.from(
    { length: Math.min(100, Math.max(0, Math.floor((to - first) / step) + 1)) },
    (_, i) => Math.round(first + i * step),
  );
}

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import {
  MousePointer2,
  Move,
  RotateCw,
  Undo2,
  Redo2,
  Waypoints,
  SlidersHorizontal,
  Library,
  Settings2,
  PanelRight,
  PanelBottom,
  Play,
  Pause,
  Diamond,
  ChevronDown,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { studio } from '../core/store';
import { useStudioChrome, useStudioSelector } from '../hooks';
import { TransformOptions } from './TransformOptions';
import { Timeline, KeyLockButton } from './Timeline';
import { ActiveLayer } from './PoseActions';
import { AnimationMirror } from './AnimationMirror';
import { LoopControls } from './LoopControls';
import { ScrubNumber } from './ScrubNumber';
import './desktop-workspace.css';

type Side = 'properties' | 'animations' | 'rig' | 'tools';
type Layout = { side: Side; sideOpen: boolean; editors: boolean };
const LAYOUT_KEY = 'pose-desktop-layout-v2';
const defaults: Layout = { side: 'properties', sideOpen: true, editors: true };
const SIDES: { id: Side; label: string; Icon: typeof Library }[] = [
  { id: 'properties', label: 'Pose properties', Icon: SlidersHorizontal },
  { id: 'animations', label: 'Animation library', Icon: Library },
  { id: 'rig', label: 'Rig controls', Icon: Waypoints },
  { id: 'tools', label: 'Workspace tools', Icon: Settings2 },
];
function loadLayout(): Layout {
  try {
    const p = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}');
    return {
      side: SIDES.some((s) => s.id === p.side) ? p.side : defaults.side,
      sideOpen: p.sideOpen !== false,
      editors: p.editors !== false,
    };
  } catch {
    return defaults;
  }
}

/** Animator layout: viewport, dope sheet and graph editor side by side, a properties
 * column and a time slider. Areas are fixed; splitters size them. */
export function DesktopWorkspace({
  scene,
  controls,
  inspector,
  animations,
  tools,
  sizes,
  resize,
  retarget,
  toolbarSlot,
}: {
  scene: ReactNode;
  controls: ReactNode;
  inspector: ReactNode;
  animations: ReactNode;
  tools: ReactNode;
  sizes: { controls: number; inspector: number; timeline: number };
  resize: (panel: 'controls' | 'inspector' | 'timeline', size: number) => void;
  retarget: boolean;
  /** Title bar element that hosts the tool and panel toolbars. */
  toolbarSlot?: HTMLElement | null;
}) {
  const [layout, setLayout] = useState(loadLayout),
    s = useStudioChrome({ frame: 'none' });
  const change = (patch: Partial<Layout>) =>
    setLayout((old) => {
      const next = { ...old, ...patch };
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  const showSide = (side: Side) => change({ side, sideOpen: true });
  useEffect(() => {
    if (retarget) showSide('properties');
  }, [retarget]);
  const toolbars = (
    <>
      <nav className="desktop-tools" aria-label="Animation tools">
        {(
          [
            ['select', MousePointer2, 'Select (Q)'],
            ['translate', Move, 'Move (W)'],
            ['rotate', RotateCw, 'Rotate (E)'],
          ] as const
        ).map(([mode, Icon, label]) => (
          <button
            key={mode}
            title={label}
            aria-label={label}
            aria-pressed={s.mode === mode}
            onClick={() => studio.patch({ mode })}
          >
            <Icon size={16} />
          </button>
        ))}
        <i />
        <TransformOptions />
        <i />
        <button aria-label="Undo" title="Undo (Ctrl Z)" onClick={() => studio.undo()}>
          <Undo2 size={15} />
        </button>
        <button aria-label="Redo" title="Redo (Ctrl Y)" onClick={() => studio.redo()}>
          <Redo2 size={15} />
        </button>
      </nav>
      <nav className="desktop-panel-nav" aria-label="Workspace panels">
        <button
          className="desktop-clip-trigger"
          title="Animation library"
          aria-label="Animations panel"
          onClick={() => showSide('animations')}
        >
          <Library size={14} />
          <strong>{s.project?.name ?? 'Animations'}</strong>
          <ChevronDown size={12} />
        </button>
        {s.project && (
          <>
            <ActiveLayer />
            <AnimationMirror />
          </>
        )}
        <i />
        <button
          aria-label={layout.editors ? 'Hide editors' : 'Show editors'}
          title="Dope sheet and graph editor"
          aria-pressed={layout.editors}
          onClick={() => change({ editors: !layout.editors })}
        >
          <PanelBottom size={16} />
        </button>
        <button
          aria-label={layout.sideOpen ? 'Hide side panel' : 'Show side panel'}
          title="Properties, library, rig and tools"
          aria-pressed={layout.sideOpen}
          onClick={() => change({ sideOpen: !layout.sideOpen })}
        >
          <PanelRight size={16} />
        </button>
      </nav>
    </>
  );
  const side = SIDES.find((x) => x.id === layout.side)!;
  const style = {
    '--side-width': sizes.inspector + 'px',
    '--editors-height': sizes.timeline + 'px',
  } as CSSProperties;
  return (
    <div
      className="animate-layout"
      data-side={layout.sideOpen}
      data-editors={layout.editors}
      style={style}
    >
      {toolbarSlot ? createPortal(toolbars, toolbarSlot) : toolbars}
      <div className="area area-viewport">{scene}</div>
      {layout.editors && (
        <>
          <Splitter
            className="split-editors"
            label="Resize editors"
            axis="y"
            size={sizes.timeline}
            resize={(size) => resize('timeline', size)}
          />
          <div className="area area-editors">
            <Timeline split />
          </div>
        </>
      )}
      {layout.sideOpen && (
        <>
          <Splitter
            className="split-side"
            label="Resize side panel"
            axis="x"
            size={sizes.inspector}
            resize={(size) => resize('inspector', size)}
          />
          <aside className="area area-side" aria-label={side.label}>
            <nav className="side-tabs" aria-label="Side panel">
              {SIDES.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  aria-label={label}
                  title={label}
                  aria-pressed={layout.side === id}
                  onClick={() => showSide(id)}
                >
                  <Icon size={15} />
                </button>
              ))}
            </nav>
            <div className="side-content">
              {layout.side === 'properties'
                ? inspector
                : layout.side === 'animations'
                  ? animations
                  : layout.side === 'rig'
                    ? controls
                    : tools}
            </div>
          </aside>
        </>
      )}
      <TimeSlider />
    </div>
  );
}

/** Drag or arrow keys resize the area after (below / right of) the splitter. */
function Splitter({
  className,
  label,
  axis,
  size,
  resize,
}: {
  className: string;
  label: string;
  axis: 'x' | 'y';
  size: number;
  resize: (size: number) => void;
}) {
  const drag = useRef<{ at: number; size: number } | null>(null);
  return (
    <div
      className={'area-splitter ' + className}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(size)}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { at: axis === 'x' ? e.clientX : e.clientY, size };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        resize(d.size + d.at - (axis === 'x' ? e.clientX : e.clientY));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(e) => {
        const grow = axis === 'x' ? 'ArrowLeft' : 'ArrowUp',
          shrink = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (e.key !== grow && e.key !== shrink) return;
        e.preventDefault();
        resize(size + (e.key === grow ? 20 : -20));
      }}
    />
  );
}

function TimeSlider() {
  const s = useStudioSelector(
    (s) => ({
      frame: s.frame,
      end: s.project?.end ?? 1,
      fps: s.project?.fps ?? 30,
      ready: s.ready,
      playing: s.playing,
      count: s.selection.length,
      autoKey: s.autoKey,
    }),
    (a, b) =>
      a.frame === b.frame &&
      a.end === b.end &&
      a.fps === b.fps &&
      a.ready === b.ready &&
      a.playing === b.playing &&
      a.count === b.count &&
      a.autoKey === b.autoKey,
  );
  return (
    <div className="time-slider" aria-label="Playback">
      <button
        aria-label="First frame"
        title="First frame (Home)"
        onClick={() => studio.setFrame(0)}
      >
        <SkipBack size={15} />
      </button>
      <button
        className="play"
        aria-label={s.playing ? 'Pause' : 'Play'}
        title="Play / pause (Space)"
        disabled={!s.ready}
        onClick={() => studio.patch({ playing: !s.playing, drafts: {} })}
      >
        {s.playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
      </button>
      <button
        aria-label="Last frame"
        title="Last frame (End)"
        onClick={() => studio.setFrame(s.end)}
      >
        <SkipForward size={15} />
      </button>
      <output aria-label="Current frame">{s.frame}</output>
      <span className="time-slash">/</span>
      <ScrubNumber
        aria-label="End frame"
        type="number"
        min={1}
        max={2400}
        value={s.end}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (v >= 1 && v <= 2400) studio.updateProject({ end: Math.round(v) });
        }}
      />
      <button
        className="auto-key"
        aria-label="Auto key"
        title="Record pose changes"
        aria-pressed={s.autoKey}
        onClick={() => studio.patch({ autoKey: !s.autoKey })}
      >
        <span className="record-dot" />
      </button>
      <button
        aria-label="Add keyframe"
        title="Key selected controls (K)"
        disabled={!s.count}
        onClick={() => studio.keySelected()}
      >
        <Diamond size={14} />
      </button>
      <button
        aria-label="Keyframe options"
        title="Choose channels to key"
        onClick={(e) => studio.showKeyframeMenu(e.clientX, e.clientY)}
      >
        <ChevronDown size={13} />
      </button>
      <input
        type="range"
        aria-label="Scrub animation"
        min={0}
        max={s.end}
        value={s.frame}
        onChange={(e) => studio.setFrame(Number(e.target.value))}
      />
      <select
        aria-label="Frame rate"
        value={s.fps}
        onChange={(e) => studio.updateProject({ fps: Number(e.target.value) })}
      >
        {[24, 25, 30, 48, 60].map((v) => (
          <option key={v} value={v}>
            {v} fps
          </option>
        ))}
      </select>
      <LoopControls />
      <KeyLockButton />
    </div>
  );
}

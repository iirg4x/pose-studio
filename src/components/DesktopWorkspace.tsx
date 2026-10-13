import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import {
  MousePointer2,
  Move,
  RotateCw,
  Undo2,
  Redo2,
  Library,
  Play,
  Pause,
  Diamond,
  ChevronDown,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { studio } from '../core/store';
import type { RigLayer } from '../core/model';
import { useStudioChrome, useStudioSelector } from '../hooks';
import { TransformOptions } from './TransformOptions';
import { Timeline, KeyLockButton } from './Timeline';
import { ActiveLayer } from './PoseActions';
import { AnimationMirror } from './AnimationMirror';
import { LoopControls } from './LoopControls';
import { ScrubNumber } from './ScrubNumber';
import './desktop-workspace.css';

export type DesktopLayout = { editors: boolean; properties: boolean };
const LAYOUT_KEY = 'pose-desktop-layout-v3';
function loadLayout(): DesktopLayout {
  try {
    const p = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}');
    return { editors: p.editors !== false, properties: p.properties !== false };
  } catch {
    return { editors: true, properties: true };
  }
}
/** Which desktop areas are shown; persisted per browser. */
export function useDesktopLayout() {
  const [layout, setLayout] = useState(loadLayout);
  const change = (patch: Partial<DesktopLayout>) =>
    setLayout((old) => {
      const next = { ...old, ...patch };
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return [layout, change] as const;
}

/**
 * Two workspaces, each laid out for one job:
 * Animate: viewport, dope sheet and graph editor, properties of the selection, time slider.
 * Setup: characters on the left, bone mapping on the right, viewport, playback only.
 */
export function DesktopWorkspace({
  scene,
  controls,
  inspector,
  animations,
  sizes,
  resize,
  retarget,
  toolbarSlot,
  layout,
  chooseAction,
}: {
  scene: ReactNode;
  /** Setup: character list. */
  controls: ReactNode;
  /** Animate: selection properties. Setup: bone mapping. */
  inspector: ReactNode;
  animations: ReactNode;
  sizes: { controls: number; inspector: number; timeline: number };
  resize: (panel: 'controls' | 'inspector' | 'timeline', size: number) => void;
  retarget: boolean;
  /** Title bar element that hosts the tool toolbars. */
  toolbarSlot?: HTMLElement | null;
  layout: DesktopLayout;
  chooseAction: (layer: RigLayer) => void;
}) {
  const s = useStudioChrome({ frame: 'none' });
  const [library, setLibrary] = useState(false);
  const libraryRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!library) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (
        !libraryRoot.current?.contains(t) &&
        !t.closest('.desktop-clip-trigger, [role=dialog], dialog')
      )
        setLibrary(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) setLibrary(false);
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape);
    };
  }, [library]);
  useEffect(() => setLibrary(false), [s.workspace?.activeId]);
  const editing = s.project?.editing;
  const toolbars = (
    <>
      {!retarget && (
        <nav className="desktop-tools" aria-label="Transform tools">
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
      )}
      <nav className="desktop-panel-nav" aria-label="Animation">
        {s.project && !retarget && (
          <div className="action-switch" role="group" aria-label="Rig being animated">
            <button
              aria-pressed={editing === 'firstPerson'}
              onClick={() => chooseAction('firstPerson')}
            >
              First person
            </button>
            <button aria-pressed={editing === 'body'} onClick={() => chooseAction('body')}>
              Full body
            </button>
          </div>
        )}
        <button
          className="desktop-clip-trigger"
          title="Animation library"
          aria-label="Animation library"
          aria-expanded={library}
          onClick={() => setLibrary(!library)}
        >
          <Library size={14} />
          <strong>{s.project?.name ?? 'Animations'}</strong>
          <ChevronDown size={12} />
        </button>
        {s.project && !retarget && (
          <>
            <ActiveLayer />
            <AnimationMirror />
          </>
        )}
      </nav>
    </>
  );
  const style = {
    '--side-width': sizes.inspector + 'px',
    '--setup-width': sizes.controls + 60 + 'px',
    '--editors-height': sizes.timeline + 'px',
  } as CSSProperties;
  const showEditors = !retarget && layout.editors,
    showProperties = retarget || layout.properties;
  return (
    <div
      className={'animate-layout' + (retarget ? ' setup-layout' : '')}
      data-side={showProperties}
      data-editors={showEditors}
      style={style}
    >
      {toolbarSlot ? createPortal(toolbars, toolbarSlot) : toolbars}
      {library && (
        <div
          className="library-popover"
          ref={libraryRoot}
          role="dialog"
          aria-label="Animation library"
        >
          {animations}
        </div>
      )}
      {retarget && (
        <>
          <aside className="area area-setup" aria-label="Characters">
            {controls}
          </aside>
          <Splitter
            className="split-setup"
            label="Resize character list"
            axis="x"
            invert
            size={sizes.controls + 60}
            resize={(size) => resize('controls', size - 60)}
          />
        </>
      )}
      <div className="area area-viewport">{scene}</div>
      {showEditors && (
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
      {showProperties && (
        <>
          <Splitter
            className="split-side"
            label="Resize properties"
            axis="x"
            size={sizes.inspector}
            resize={(size) => resize('inspector', size)}
          />
          <aside className="area area-side" aria-label={retarget ? 'Bone mapping' : 'Properties'}>
            <div className="side-content">{inspector}</div>
          </aside>
        </>
      )}
      <TimeSlider />
    </div>
  );
}

/** Drag or arrow keys resize the adjacent area (below/right of the splitter, or left with invert). */
function Splitter({
  className,
  label,
  axis,
  size,
  resize,
  invert = false,
}: {
  className: string;
  label: string;
  axis: 'x' | 'y';
  size: number;
  resize: (size: number) => void;
  invert?: boolean;
}) {
  const drag = useRef<{ at: number; size: number } | null>(null);
  const sign = invert ? -1 : 1;
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
        resize(d.size + sign * (d.at - (axis === 'x' ? e.clientX : e.clientY)));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(e) => {
        const grow = axis === 'x' ? (invert ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp',
          shrink = axis === 'x' ? (invert ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown';
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
      setup: s.retargetMode,
    }),
    (a, b) =>
      a.frame === b.frame &&
      a.end === b.end &&
      a.fps === b.fps &&
      a.ready === b.ready &&
      a.playing === b.playing &&
      a.count === b.count &&
      a.autoKey === b.autoKey &&
      a.setup === b.setup,
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
        disabled={s.setup}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (v >= 1 && v <= 2400) studio.updateProject({ end: Math.round(v) });
        }}
      />
      {!s.setup && (
        <>
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
        </>
      )}
      <input
        type="range"
        aria-label="Scrub animation"
        min={0}
        max={s.end}
        value={s.frame}
        onChange={(e) => studio.setFrame(Number(e.target.value))}
      />
      {!s.setup && (
        <>
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
        </>
      )}
    </div>
  );
}

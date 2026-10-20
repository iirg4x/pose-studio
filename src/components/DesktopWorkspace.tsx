import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, ReactNode } from 'react';
import {
  Undo2,
  Redo2,
  Library,
  Settings2,
  ChevronLeft,
  ListVideo,
  Play,
  Pause,
  Diamond,
  ChevronDown,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { studio } from '../core/store';
import { usePresence, useStudioChrome, useStudioSelector } from '../hooks';
import { Timeline, KeyLockButton, frameRateOptions } from './Timeline';
import { ActiveLayer } from './PoseActions';
import { LoopControls } from './LoopControls';
import { ScrubNumber } from './ScrubNumber';
import { consumeSceneDismiss } from '../hooks/transientPopover';
import './desktop-workspace.css';
import './desktop-system.css';

export type DesktopLayout = { editors: boolean; properties: boolean };
const LAYOUT_KEY = 'pose-desktop-layout-v3';
function loadLayout(): DesktopLayout {
  try {
    const p = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}');
    // Properties are enabled for a new install. Keep an explicitly stored
    // value, including `false`, so closing the inspector remains a preference.
    return {
      editors: p.editors === true,
      properties: typeof p.properties === 'boolean' ? p.properties : true,
    };
  } catch {
    return { editors: false, properties: true };
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
  controllerTools,
  animations,
  sizes,
  resize,
  retarget,
  toolbarSlot,
  layout,
  openSettings,
  toggleProperties,
  toggleEditors,
}: {
  scene: ReactNode;
  /** Setup: character list. */
  controls: ReactNode;
  /** Animate: selection properties. Setup: bone mapping. */
  inspector: ReactNode;
  /** Fine-pointer pose actions docked beside the contextual properties panel. */
  controllerTools?: ReactNode;
  animations: ReactNode;
  sizes: { controls: number; inspector: number; timeline: number };
  resize: (panel: 'controls' | 'inspector' | 'timeline', size: number) => void;
  retarget: boolean;
  /** Title bar element that hosts the tool toolbars. */
  toolbarSlot?: HTMLElement | null;
  layout: DesktopLayout;
  openSettings: () => void;
  toggleProperties: () => void;
  toggleEditors: () => void;
}) {
  const s = useStudioChrome({ frame: 'none' });
  useEffect(() => {
    const onToggleProperties = () => toggleProperties();
    window.addEventListener('pose-toggle-properties', onToggleProperties);
    return () => window.removeEventListener('pose-toggle-properties', onToggleProperties);
  }, [toggleProperties]);
  // The library opens as a dropdown under its trigger, kept inside the window.
  const [library, setLibraryOpen] = useState<CSSProperties | null>(null);
  const libraryPresence = usePresence(library);
  const setLibrary = (open: boolean, trigger?: HTMLElement) => {
    if (!open || !trigger) return setLibraryOpen(null);
    const r = trigger.getBoundingClientRect(),
      width = 360;
    setLibraryOpen({
      top: r.bottom + 4,
      left: Math.max(8, Math.min(r.right - width, innerWidth - width - 8)),
    });
  };
  const libraryRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!library) return;
    const outside = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (
        !t ||
        (!libraryRoot.current?.contains(t) &&
          !t.closest('.desktop-clip-trigger, .animation-context-menu, [role=dialog], dialog'))
      ) {
        consumeSceneDismiss(e);
        setLibrary(false);
      }
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
  const toolbars = (
    <>
      <div className="desktop-context-cluster">
        <nav className="desktop-panel-nav" aria-label="Animation">
          <button
            className="desktop-header-trigger desktop-clip-trigger"
            title="Animation library"
            aria-label="Animation library"
            aria-expanded={!!library}
            onClick={(e) => setLibrary(!library, e.currentTarget)}
          >
            <Library size={14} />
            <strong>{s.project?.name ?? 'Animations'}</strong>
            <ChevronDown className="header-chevron" size={12} />
          </button>
        </nav>
      </div>
      <nav className="desktop-utilities" aria-label="Workspace utilities">
        {s.project && !retarget && <ActiveLayer />}
        <button
          className="desktop-header-trigger desktop-settings-trigger"
          onClick={openSettings}
          title="Settings"
          aria-label="Settings"
        >
          <Settings2 size={15} />
        </button>
      </nav>
    </>
  );
  const style = {
    '--side-width': sizes.inspector + 'px',
    '--setup-width': sizes.controls + 60 + 'px',
    '--editors-height': sizes.timeline + 'px',
  } as CSSProperties;
  const showEditors = !retarget && layout.editors,
    // Selection changes the inspector's contents, never the reserved dock.
    // Only the user's explicit collapse preference changes the scene bounds.
    showProperties = retarget || layout.properties;
  const editorsPresence = usePresence(showEditors ? true : null),
    // Retain content during an explicit collapse transition.
    propertiesPresence = usePresence(showProperties ? { inspector, retarget } : null);
  const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? true;
  const hasControllerTools = controllerTools != null && s.selection.length > 0;
  const showControllerRail = finePointer && !retarget && (hasControllerTools || !showProperties);
  const controllerRail = showControllerRail ? (
    <PropertiesControllerRail
      tools={hasControllerTools ? controllerTools : null}
      expanded={showProperties && !propertiesPresence.exiting}
    />
  ) : null;
  return (
    <div
      className={'animate-layout' + (retarget ? ' setup-layout' : '')}
      data-side={showProperties}
      data-editors={showEditors}
      style={style}
    >
      {toolbarSlot ? createPortal(toolbars, toolbarSlot) : toolbars}
      {/* Keep the embedded animation bar mounted while the popover closes. Its
          rename dialog is portaled to body, so duplicate → rename can finish
          after the new clip becomes active and this popover is hidden. */}
      <div
        className="library-popover"
        style={libraryPresence.value ?? { display: 'none' }}
        ref={libraryRoot}
        role={libraryPresence.value ? 'dialog' : undefined}
        aria-label="Animation library"
        aria-hidden={libraryPresence.exiting || !libraryPresence.value || undefined}
        data-motion="popover"
        data-state={libraryPresence.exiting ? 'closing' : 'open'}
        inert={libraryPresence.exiting || !libraryPresence.value || undefined}
        hidden={!libraryPresence.value}
      >
        {animations}
      </div>
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
      {editorsPresence.value && (
        <>
          <Splitter
            className="split-editors"
            label="Resize editors"
            axis="y"
            size={sizes.timeline}
            resize={(size) => resize('timeline', size)}
            exiting={editorsPresence.exiting}
          />
          <div
            className="area area-editors"
            data-motion="desktop-editors"
            data-state={editorsPresence.exiting ? 'closing' : 'open'}
            inert={editorsPresence.exiting || undefined}
            aria-hidden={editorsPresence.exiting || undefined}
          >
            <Timeline split />
          </div>
        </>
      )}
      {propertiesPresence.value && (
        <>
          <Splitter
            className="split-side"
            label="Resize properties"
            axis="x"
            size={sizes.inspector}
            resize={(size) => resize('inspector', size)}
            exiting={propertiesPresence.exiting}
          />
          <aside
            className="area area-side"
            aria-label={propertiesPresence.value.retarget ? 'Bone mapping' : 'Properties'}
            aria-hidden={propertiesPresence.exiting || undefined}
            data-motion="desktop-side"
            data-state={propertiesPresence.exiting ? 'closing' : 'open'}
            inert={propertiesPresence.exiting || undefined}
          >
            {propertiesPresence.value.retarget && (
              <header className="desktop-inspector-header">
                <h2>Bone mapping</h2>
              </header>
            )}
            <div className="properties-dock-shell">
              {controllerRail}
              <div className="side-content">{propertiesPresence.value.inspector}</div>
            </div>
          </aside>
        </>
      )}
      {!propertiesPresence.value && controllerRail && (
        <aside className="properties-collapsed-rail" aria-label="Pose tools">
          {controllerRail}
        </aside>
      )}
      <TimeSlider editors={showEditors} toggleEditors={toggleEditors} />
    </div>
  );
}

function PropertiesControllerRail({ tools, expanded }: { tools: ReactNode; expanded: boolean }) {
  const toggle = () => window.dispatchEvent(new Event('pose-toggle-properties'));
  return (
    <div className="properties-controller-rail" data-expanded={expanded}>
      {tools && <div className="properties-controller-tools">{tools}</div>}
      {!expanded && (
        <button
          type="button"
          className="properties-rail-toggle"
          aria-label="Expand properties"
          title="Expand properties"
          aria-expanded={false}
          onClick={toggle}
        >
          <ChevronLeft size={17} />
        </button>
      )}
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
  exiting = false,
}: {
  className: string;
  label: string;
  axis: 'x' | 'y';
  size: number;
  resize: (size: number) => void;
  invert?: boolean;
  exiting?: boolean;
}) {
  const drag = useRef<{ at: number; size: number } | null>(null);
  const sign = invert ? -1 : 1;
  return (
    <div
      className={'area-splitter ' + className}
      role="separator"
      tabIndex={exiting ? -1 : 0}
      aria-label={label}
      aria-hidden={exiting || undefined}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(size)}
      data-state={exiting ? 'closing' : 'open'}
      inert={exiting || undefined}
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

function TimeSlider({ editors, toggleEditors }: { editors: boolean; toggleEditors: () => void }) {
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
      <div className="transport-history joined" role="group" aria-label="History">
        <button aria-label="Undo" title="Undo (Ctrl Z)" onClick={() => studio.undo()}>
          <Undo2 size={16} />
        </button>
        <button aria-label="Redo" title="Redo (Ctrl Y)" onClick={() => studio.redo()}>
          <Redo2 size={16} />
        </button>
      </div>
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
      <ScrubNumber
        className="time-current-frame"
        aria-label="Current frame"
        title="Current frame"
        type="number"
        min={0}
        max={s.end}
        step={0.01}
        value={s.frame}
        disabled={!s.ready || s.setup}
        onChange={(e) => {
          if (e.target.value === '') return;
          const value = Number(e.target.value);
          if (Number.isFinite(value)) {
            studio.setFrame(Math.max(0, Math.min(s.end, value)));
          }
        }}
      />
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
            {frameRateOptions(s.fps).map((v) => (
              <option key={v} value={v}>
                {v} fps
              </option>
            ))}
          </select>
          <LoopControls />
          <KeyLockButton />
          <button
            className="timeline-toggle"
            aria-label={editors ? 'Hide timeline' : 'Show timeline'}
            aria-pressed={editors}
            onClick={toggleEditors}
          >
            <ListVideo size={15} />
            <span>Timeline</span>
          </button>
        </>
      )}
    </div>
  );
}

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
  ListVideo,
  PanelRightClose,
  PanelBottomClose,
  PinOff,
  X,
  Play,
  Pause,
  Diamond,
  ChevronDown,
} from 'lucide-react';
import { studio } from '../core/store';
import { useStudioChrome, useStudioSelector, usePresence } from '../hooks';
import { TransformOptions } from './TransformOptions';
import { Timeline } from './Timeline';
import './desktop-workspace.css';

type SidePanel = 'properties' | 'animations' | 'tools';
type Layout = {
  rig: boolean;
  right: SidePanel | null;
  timeline: boolean;
  dockRig: boolean;
  dockRight: boolean;
  dockTimeline: boolean;
};
const defaults: Layout = {
  rig: false,
  right: null,
  timeline: false,
  dockRig: false,
  dockRight: false,
  dockTimeline: false,
};
function loadLayout(): Layout {
  try {
    const p = JSON.parse(localStorage.getItem('pose-desktop-layout-v1') ?? '{}');
    return {
      ...defaults,
      dockRig: p.dockRig === true,
      dockRight: p.dockRight === true,
      dockTimeline: p.dockTimeline === true,
      rig: p.dockRig === true && p.rig === true,
      right:
        p.dockRight === true && ['properties', 'animations', 'tools'].includes(p.right)
          ? p.right
          : null,
      timeline: p.dockTimeline === true && p.timeline === true,
    };
  } catch {
    return defaults;
  }
}
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
    s = useStudioChrome({ frame: 'none' }),
    ref = useRef<HTMLDivElement>(null);
  const change = (patch: Partial<Layout>) =>
    setLayout((old) => {
      const next = { ...old, ...patch };
      try {
        localStorage.setItem('pose-desktop-layout-v1', JSON.stringify(next));
      } catch {}
      return next;
    });
  const rig = usePresence(layout.rig ? true : null),
    right = usePresence(layout.right),
    timing = usePresence(layout.timeline ? true : null);
  useEffect(() => {
    if (retarget) change({ rig: true, right: 'properties' });
  }, [retarget]);
  useEffect(() => {
    const dismiss = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          '[role=dialog],dialog,.desktop-panel,.desktop-panel-nav,.desktop-tools,[data-editor-overlay],.timeline,.file-menu,.title-menu',
        )
      )
        return;
      change({
        ...(!layout.dockRig ? { rig: false } : {}),
        ...(!layout.dockRight ? { right: null } : {}),
        ...(!layout.dockTimeline ? { timeline: false } : {}),
      });
    };
    const escape = (e: KeyboardEvent) => {
      if (
        e.key !== 'Escape' ||
        e.defaultPrevented ||
        document.querySelector('[role=dialog],dialog[open]')
      )
        return;
      change({
        ...(!layout.dockRig ? { rig: false } : {}),
        ...(!layout.dockRight ? { right: null } : {}),
        ...(!layout.dockTimeline ? { timeline: false } : {}),
      });
    };
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('keydown', escape);
    };
  }, [layout.dockRig, layout.dockRight, layout.dockTimeline]);
  const sideTitle =
    right.value === 'properties'
      ? 'Pose properties'
      : right.value === 'animations'
        ? 'Animations'
        : 'Workspace tools';
  const toolbars = (
    <>
      <nav className="desktop-tools" aria-label="Animation tools" data-editor-overlay>
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
            <Icon size={18} />
          </button>
        ))}
        <i />
        <TransformOptions />
        <i />
        <button aria-label="Undo" title="Undo (Ctrl Z)" onClick={() => studio.undo()}>
          <Undo2 size={17} />
        </button>
        <button aria-label="Redo" title="Redo (Ctrl Y)" onClick={() => studio.redo()}>
          <Redo2 size={17} />
        </button>
      </nav>
      <nav className="desktop-panel-nav" aria-label="Workspace panels" data-editor-overlay>
        <button
          className="desktop-clip-trigger"
          title="Browse animations"
          aria-label="Animations panel"
          aria-expanded={layout.right === 'animations'}
          onClick={() => change({ right: layout.right === 'animations' ? null : 'animations' })}
        >
          <Library size={16} />
          <strong>{s.project?.name ?? 'Animations'}</strong>
          <ChevronDown size={12} />
        </button>
        <i />
        <button
          aria-label="Rig panel"
          title="Rig controls"
          aria-expanded={layout.rig}
          onClick={() => change({ rig: !layout.rig })}
        >
          <Waypoints size={18} />
        </button>
        <button
          aria-label="Pose panel"
          title="Pose properties"
          aria-expanded={layout.right === 'properties'}
          onClick={() => change({ right: layout.right === 'properties' ? null : 'properties' })}
        >
          <SlidersHorizontal size={18} />
        </button>
        <button
          aria-label="Tools panel"
          title="Workspace tools"
          aria-expanded={layout.right === 'tools'}
          onClick={() => change({ right: layout.right === 'tools' ? null : 'tools' })}
        >
          <Settings2 size={18} />
        </button>
        <button
          aria-label={layout.timeline ? 'Hide timeline' : 'Show timeline'}
          title="Timeline"
          aria-expanded={layout.timeline}
          onClick={() => change({ timeline: !layout.timeline })}
        >
          <ListVideo size={18} />
        </button>
      </nav>
    </>
  );
  const style = {
    '--dock-left': layout.rig && layout.dockRig ? sizes.controls + 'px' : '0px',
    '--dock-right': layout.right && layout.dockRight ? sizes.inspector + 'px' : '0px',
    '--dock-bottom': layout.timeline && layout.dockTimeline ? sizes.timeline + 'px' : '0px',
    '--floating-timeline': sizes.timeline + 'px',
  } as CSSProperties;
  return (
    <div
      ref={ref}
      className={
        'desktop-stage' +
        (layout.timeline ? ' has-timeline' : '') +
        (layout.right && !layout.dockRight ? ' has-floating-right' : '') +
        (layout.timeline && !layout.dockTimeline ? ' floating-timing' : '')
      }
      style={style}
    >
      <div className="desktop-scene">
        {scene}
        {toolbarSlot ? createPortal(toolbars, toolbarSlot) : toolbars}
        {!timing.value && <DesktopTransport />}
      </div>
      {rig.value && (
        <DesktopPanel
          title="Rig controls"
          side="left"
          docked={layout.dockRig}
          exiting={rig.exiting}
          toggleDock={() => change({ dockRig: !layout.dockRig })}
          close={() => change({ rig: false })}
          resize={(size) => resize('controls', size)}
          size={sizes.controls}
        >
          {controls}
        </DesktopPanel>
      )}
      {right.value && (
        <DesktopPanel
          title={sideTitle}
          side="right"
          docked={layout.dockRight}
          exiting={right.exiting}
          toggleDock={() => change({ dockRight: !layout.dockRight })}
          close={() => change({ right: null })}
          resize={(size) => resize('inspector', size)}
          size={sizes.inspector}
        >
          {right.value === 'properties'
            ? inspector
            : right.value === 'animations'
              ? animations
              : tools}
        </DesktopPanel>
      )}
      {timing.value && (
        <DesktopPanel
          title="Timeline"
          side="bottom"
          docked={layout.dockTimeline}
          exiting={timing.exiting}
          toggleDock={() => change({ dockTimeline: !layout.dockTimeline })}
          close={() => change({ timeline: false })}
          resize={(size) => resize('timeline', size)}
          size={sizes.timeline}
        >
          <Timeline />
        </DesktopPanel>
      )}
    </div>
  );
}
function DesktopPanel({
  title,
  side,
  docked,
  exiting,
  toggleDock,
  close,
  children,
  resize,
  size,
}: {
  title: string;
  side: 'left' | 'right' | 'bottom';
  docked: boolean;
  exiting: boolean;
  toggleDock: () => void;
  close: () => void;
  children: ReactNode;
  resize: (size: number) => void;
  size: number;
}) {
  const drag = useRef<{ x: number; y: number; size: number } | null>(null);
  return (
    <section
      className={'desktop-panel panel-' + side + (docked ? ' docked' : ' floating')}
      aria-label={title + ' panel'}
      data-state={exiting ? 'closing' : 'open'}
      aria-hidden={exiting || undefined}
      inert={exiting || undefined}
      data-editor-overlay
    >
      {/* No title bar: the panel's own first row carries these. */}
      <div className="desktop-panel-actions">
        <button
          aria-label={(docked ? 'Undock ' : 'Dock ') + title}
          title={docked ? 'Float over scene' : 'Dock beside scene'}
          aria-pressed={docked}
          onClick={toggleDock}
        >
          {docked ? (
            <PinOff size={15} />
          ) : side === 'bottom' ? (
            <PanelBottomClose size={15} />
          ) : (
            <PanelRightClose size={15} />
          )}
        </button>
        <button aria-label={'Close ' + title} title="Close panel" onClick={close}>
          <X size={17} />
        </button>
      </div>
      <div className="desktop-panel-content">{children}</div>
      <div
        className="desktop-panel-resize"
        role="separator"
        tabIndex={0}
        aria-label={'Resize ' + title}
        aria-orientation={side === 'bottom' ? 'horizontal' : 'vertical'}
        aria-valuenow={Math.round(size)}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, size };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          resize(
            d.size +
              (side === 'left'
                ? e.clientX - d.x
                : side === 'right'
                  ? d.x - e.clientX
                  : d.y - e.clientY),
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            resize(size + (['ArrowLeft', 'ArrowUp'].includes(e.key) ? -20 : 20));
          }
        }}
      />
    </section>
  );
}
function DesktopTransport() {
  const s = useStudioSelector(
    (s) => ({
      frame: s.frame,
      end: s.project?.end ?? 1,
      ready: s.ready,
      playing: s.playing,
      count: s.selection.length,
      autoKey: s.autoKey,
    }),
    (a, b) =>
      a.frame === b.frame &&
      a.end === b.end &&
      a.ready === b.ready &&
      a.playing === b.playing &&
      a.count === b.count &&
      a.autoKey === b.autoKey,
  );
  return (
    <div className="desktop-transport" aria-label="Playback" data-editor-overlay>
      <button
        aria-label={s.playing ? 'Pause' : 'Play'}
        title="Play / pause (Space)"
        disabled={!s.ready}
        onClick={() => studio.patch({ playing: !s.playing, drafts: {} })}
      >
        {s.playing ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
      </button>
      <output aria-label="Current frame">
        {s.frame}
        <small> / {s.end}</small>
      </output>
      <input
        type="range"
        aria-label="Scrub animation"
        min={0}
        max={s.end}
        value={s.frame}
        onChange={(e) => studio.setFrame(Number(e.target.value))}
      />
      <button
        aria-label="Auto key"
        title="Auto key"
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
        <Diamond size={17} />
      </button>
    </div>
  );
}

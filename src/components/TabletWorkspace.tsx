import type { StudioScene } from '../scene/StudioScene';
import { ActiveLayer } from './PoseActions';
import { PreviewModel } from './PreviewModel';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import {
  ListChecks,
  BoxSelect,
  Undo2,
  Redo2,
  SlidersHorizontal,
  Waypoints,
  Library,
  Settings2,
  Diamond,
  Play,
  Pause,
  ChevronsLeft,
  ChevronsRight,
  ListVideo,
  X,
  Camera,
  PersonStanding,
  Box,
  Workflow,
  Clapperboard,
  Save,
  HelpCircle,
  ChevronDown,
  Eye,
  CircleDot,
} from 'lucide-react';
import { useStudioSelector, useStudioChrome } from '../hooks';
import { studio } from '../core/store';
import './tablet-drawer.css';
export type TabletPanel = 'rig' | 'properties' | 'animations' | 'tools';
const panels = [
  ['rig', Waypoints, 'Rig'],
  ['properties', SlidersHorizontal, 'Pose'],
  ['animations', Library, 'Clips'],
] as const;
export function TabletWorkspace({
  panel,
  toggle,
  timeline,
  toggleTimeline,
  boxSelect,
}: {
  boxSelect: () => void;
  panel: TabletPanel | null;
  toggle: (p: TabletPanel) => void;
  timeline: boolean;
  toggleTimeline: () => void;
}) {
  const s = useStudioChrome();
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const menuRoot = useRef<HTMLDivElement>(null),
    menuTrigger = useRef<HTMLButtonElement>(null);
  const closeMenu = (restoreFocus = false) => {
    setWorkspaceMenu(false);
    if (restoreFocus)
      requestAnimationFrame(() => menuTrigger.current?.focus({ preventScroll: true }));
  };
  useEffect(() => {
    if (!workspaceMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || menuRoot.current?.contains(event.target)) return;
      setWorkspaceMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) closeMenu(true);
    };
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('keydown', escape);
    };
  }, [workspaceMenu]);
  useEffect(() => {
    if (!workspaceMenu) return;
    menuRoot.current
      ?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')
      ?.focus({ preventScroll: true });
  }, [workspaceMenu]);
  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role^="menuitem"]:not(:disabled)',
      ),
    ];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'Tab') {
      // The menu is a transient command surface; return to its launcher when
      // the user leaves it so focus never lands on a removed menu item.
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus({ preventScroll: true });
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus({ preventScroll: true });
    }
  };
  const run = (action: () => void) => {
    closeMenu(true);
    action();
  };
  return (
    <>
      <button
        className="touch-clip-context"
        aria-label="Current clip"
        aria-expanded={panel === 'animations'}
        onClick={() => toggle('animations')}
      >
        <Clapperboard size={20} />
        <span>{s.project?.name ?? 'Animation'}</span>
        <ChevronDown size={16} />
      </button>
      <div className="touch-workspace-menu-root" ref={menuRoot}>
        <button
          ref={menuTrigger}
          className="touch-workspace-menu-trigger"
          aria-label="Panels and tools"
          aria-haspopup="menu"
          aria-expanded={workspaceMenu}
          aria-controls="touch-workspace-menu"
          onClick={() => setWorkspaceMenu((open) => !open)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setWorkspaceMenu(true);
            } else if (event.key === 'Escape' && workspaceMenu) {
              event.preventDefault();
              closeMenu(true);
            }
          }}
        >
          <SlidersHorizontal size={20} />
          <span>Panels / tools</span>
          <ChevronDown size={16} />
        </button>
        {workspaceMenu && (
          <div
            className="touch-workspace-menu"
            id="touch-workspace-menu"
            role="menu"
            aria-label="Panels and tools"
            onKeyDown={onMenuKeyDown}
          >
            <section>
              <strong>Panels</strong>
              {panels.map(([id, Icon, label]) => (
                <button
                  key={id}
                  role="menuitemradio"
                  aria-checked={panel === id}
                  tabIndex={-1}
                  onClick={() => run(() => toggle(id))}
                >
                  <Icon size={20} />
                  <span>{label}</span>
                </button>
              ))}
            </section>
            <section>
              <strong>Selection</strong>
              <button
                role="menuitemcheckbox"
                aria-checked={!!s.boxSelection}
                tabIndex={-1}
                disabled={s.gameView || s.retargetMode}
                onClick={() => run(boxSelect)}
              >
                <BoxSelect size={20} />
                <span>Box select</span>
              </button>
              <button
                role="menuitemcheckbox"
                aria-checked={s.multiSelect}
                tabIndex={-1}
                disabled={s.gameView || s.retargetMode}
                onClick={() => run(() => studio.patch({ multiSelect: !s.multiSelect }))}
              >
                <ListChecks size={20} />
                <span>Multi select</span>
              </button>
            </section>
            <section>
              <strong>Workspace</strong>
              <button
                role="menuitem"
                tabIndex={-1}
                onClick={() =>
                  run(() => {
                    (document.querySelector('.touch-view-toggle') as HTMLButtonElement)?.click();
                  })
                }
              >
                <Eye size={20} />
                <span>View</span>
              </button>
              <button role="menuitem" tabIndex={-1} onClick={() => run(() => toggle('tools'))}>
                <Settings2 size={20} />
                <span>Settings</span>
              </button>
            </section>
            <section className="touch-menu-history">
              <strong>History</strong>
              <button role="menuitem" tabIndex={-1} onClick={() => run(() => studio.undo())}>
                <Undo2 size={20} />
                <span>Undo</span>
              </button>
              <button role="menuitem" tabIndex={-1} onClick={() => run(() => studio.redo())}>
                <Redo2 size={20} />
                <span>Redo</span>
              </button>
            </section>
          </div>
        )}
      </div>
      <ActiveLayer />
      <TabletTransport timeline={timeline} toggleTimeline={toggleTimeline} />
    </>
  );
}
function TabletTransport({
  timeline,
  toggleTimeline,
}: {
  timeline: boolean;
  toggleTimeline: () => void;
}) {
  const s = useStudioSelector(
      (s) => ({
        frame: s.frame,
        playing: s.playing,
        ready: s.ready,
        count: s.selection.length,
        end: s.project?.end ?? 1,
        autoKey: s.autoKey,
      }),
      (a, b) =>
        a.frame === b.frame &&
        a.playing === b.playing &&
        a.ready === b.ready &&
        a.count === b.count &&
        a.end === b.end &&
        a.autoKey === b.autoKey,
    ),
    end = s.end;
  return (
    <div className="touch-transport" role="group" aria-label="Playback and keyframes">
      <div className="touch-history" role="group" aria-label="History">
        <button aria-label="Undo" onClick={() => studio.undo()}>
          <Undo2 size={20} />
        </button>
        <button aria-label="Redo" onClick={() => studio.redo()}>
          <Redo2 size={20} />
        </button>
      </div>
      <div className="touch-playback" role="group" aria-label="Playback">
        <button aria-label="Previous frame" onClick={() => studio.setFrame(s.frame - 1)}>
          <ChevronsLeft size={18} />
        </button>
        <button
          aria-label={s.playing ? 'Pause animation' : 'Play animation'}
          aria-pressed={s.playing}
          disabled={!s.ready}
          onClick={() => studio.patch({ playing: !s.playing, drafts: {} })}
        >
          {s.playing ? (
            <Pause size={24} fill="currentColor" />
          ) : (
            <Play size={24} fill="currentColor" />
          )}
        </button>
        <button aria-label="Next frame" onClick={() => studio.setFrame(s.frame + 1)}>
          <ChevronsRight size={18} />
        </button>
      </div>
      <output className="touch-frame" aria-label="Frame">
        {s.frame}
        <small> / {end}</small>
      </output>
      <div className="touch-scrubber">
        <input
          type="range"
          aria-label="Scrub animation"
          min={0}
          max={end}
          step={1}
          value={s.frame}
          onChange={(e) => {
            studio.setFrame(Number(e.target.value));
          }}
        />
      </div>
      <button
        className="touch-key"
        aria-label="Key selected controls"
        disabled={!s.ready || !s.count}
        onClick={() => studio.keySelected()}
      >
        <Diamond size={23} />
        <span>Key</span>
      </button>
      <button
        className="touch-auto"
        aria-label="Auto key"
        aria-pressed={s.autoKey}
        onClick={() => studio.patch({ autoKey: !s.autoKey })}
      >
        <CircleDot size={21} />
        <span>Auto</span>
      </button>
      <button
        className="touch-timeline-toggle"
        aria-label={timeline ? 'Hide timeline' : 'Show timeline'}
        aria-pressed={timeline}
        aria-controls="touch-timeline"
        onClick={toggleTimeline}
      >
        <ListVideo size={21} />
        <span>Timeline</span>
      </button>
    </div>
  );
}
export function TabletDrawer({
  panel,
  close,
  children,
  exiting = false,
  hideHeader = false,
}: {
  panel: TabletPanel;
  close: () => void;
  children: ReactNode;
  exiting?: boolean;
  hideHeader?: boolean;
}) {
  const titles = {
    rig: 'Rig controls',
    properties: 'Control properties',
    animations: 'Animations & poses',
    tools: 'Workspace tools',
  };
  return (
    <section
      className={'tablet-sheet tablet-sheet-' + panel}
      id={'touch-panel-' + panel}
      aria-label={titles[panel]}
      aria-hidden={exiting || undefined}
      inert={exiting || undefined}
      data-state={exiting ? 'closing' : 'open'}
      data-editor-overlay
    >
      {!hideHeader && (
        <header>
          <h2 className="context-flair attached-flair">{titles[panel]}</h2>
          <button aria-label={'Close ' + titles[panel]} onClick={close}>
            <X size={20} />
          </button>
        </header>
      )}
      <div className="tablet-sheet-content">{children}</div>
    </section>
  );
}

export function TabletSettings({
  retarget,
  setRetarget,
  chooseAction,
  openAssets,
  runtime,
  save,
  help,
}: {
  retarget: boolean;
  setRetarget: (v: boolean) => void;
  chooseAction: (v: 'firstPerson' | 'body') => void;
  openAssets: () => void;
  runtime: StudioScene | null;
  save: () => void;
  help: () => void;
}) {
  const s = useStudioChrome();
  return (
    <div className="touch-settings">
      <section>
        <h3>Workspace</h3>
        <div className="touch-setting-pair joined">
          <button aria-pressed={!retarget} onClick={() => setRetarget(false)}>
            <Clapperboard size={20} />
            Animate
          </button>
          <button aria-pressed={retarget} onClick={() => setRetarget(true)}>
            <Workflow size={20} />
            Character setup
          </button>
        </div>
      </section>
      <section>
        <h3>Action</h3>
        <div className="touch-setting-pair joined">
          <button
            aria-pressed={s.project?.editing === 'firstPerson'}
            onClick={() => chooseAction('firstPerson')}
          >
            <Camera size={20} />
            First person
          </button>
          <button aria-pressed={s.project?.editing === 'body'} onClick={() => chooseAction('body')}>
            <PersonStanding size={20} />
            Full body
          </button>
        </div>
      </section>
      <section>
        <h3>Preview model</h3>
        <PreviewModel runtime={runtime} configure={() => setRetarget(true)} />
      </section>
      <section className="touch-settings-actions">
        <button onClick={openAssets}>
          <Box size={20} />
          Models, props & animations
        </button>
        <button onClick={save}>
          <Save size={20} />
          Save project
        </button>
        <button onClick={help}>
          <HelpCircle size={20} />
          Touch & keyboard help
        </button>
      </section>
    </div>
  );
}

import { MotionSize } from './Motion';
import type { StudioScene } from '../scene/StudioScene';
import { ActiveLayer, PoseActions } from './PoseActions';
import { TransformOptions } from './TransformOptions';
import { PreviewModel } from './PreviewModel';
import type { ReactNode } from 'react';
import {
  ListChecks,
  BoxSelect,
  Move,
  RotateCw,
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
} from 'lucide-react';
import { useStudioSelector, useStudioChrome } from '../hooks';
import { studio } from '../core/store';
import './tablet-drawer.css';
export type TabletPanel = 'rig' | 'properties' | 'animations' | 'tools';
const panels = [
  ['rig', Waypoints, 'Rig'],
  ['properties', SlidersHorizontal, 'Pose'],
  ['animations', Library, 'Clips'],
  ['tools', Settings2, 'Tools'],
] as const;
export function TabletWorkspace({
  panel,
  toggle,
  timeline,
  toggleTimeline,
  mirror,
  pasteMirrored,
  boxSelect,
}: {
  pasteMirrored: () => void;
  boxSelect: () => void;
  mirror: () => void;
  panel: TabletPanel | null;
  toggle: (p: TabletPanel) => void;
  timeline: boolean;
  toggleTimeline: () => void;
}) {
  const s = useStudioChrome();
  return (
    <>
      <nav
        className={'touch-pose-rail' + (s.selection.length ? '' : ' no-selection')}
        aria-label="Pose tools"
      >
        <button
          aria-label="Move controls"
          aria-pressed={s.mode === 'translate'}
          onClick={() => studio.patch({ mode: 'translate' })}
        >
          <Move size={23} />
          <span>Move</span>
        </button>
        <button
          aria-label="Rotate controls"
          aria-pressed={s.mode === 'rotate'}
          onClick={() => studio.patch({ mode: 'rotate' })}
        >
          <RotateCw size={23} />
          <span>Rotate</span>
        </button>
        <button
          aria-label="Box select controls"
          aria-pressed={!!s.boxSelection}
          disabled={s.gameView || s.retargetMode}
          onClick={boxSelect}
        >
          <BoxSelect size={23} />
          <span>Box</span>
        </button>
        <button
          aria-label="Multi select controls"
          aria-pressed={s.multiSelect}
          disabled={s.gameView || s.retargetMode}
          onClick={() => studio.patch({ multiSelect: !s.multiSelect })}
        >
          <ListChecks size={23} />
          <span>Multi</span>
        </button>
        <TransformOptions compact />
        <i />
        <button aria-label="Undo" onClick={() => studio.undo()}>
          <Undo2 size={22} />
        </button>
        <button aria-label="Redo" onClick={() => studio.redo()}>
          <Redo2 size={22} />
        </button>
      </nav>
      <nav className="touch-panel-rail" aria-label="Workspace panels">
        {panels.map(([id, Icon, label]) => (
          <button
            key={id}
            aria-label={label + ' panel'}
            aria-expanded={panel === id}
            aria-controls={'touch-panel-' + id}
            onClick={() => toggle(id)}
          >
            <Icon size={22} />
            <span>{label}</span>
          </button>
        ))}
        {/* The timeline is a panel too; it has its own play and key controls. */}
        <button
          aria-label={timeline ? 'Hide timeline' : 'Show timeline'}
          aria-expanded={timeline}
          aria-controls="touch-timeline"
          onClick={toggleTimeline}
        >
          <ListVideo size={22} />
          <span>Timeline</span>
        </button>
      </nav>
      <ActiveLayer />
      <PoseActions pasteMirrored={pasteMirrored} mirror={mirror} timeline={timeline} />
      <TabletTransport />
    </>
  );
}
function TabletTransport() {
  const s = useStudioSelector(
      (s) => ({
        frame: s.frame,
        playing: s.playing,
        ready: s.ready,
        count: s.selection.length,
        end: s.project?.end ?? 1,
      }),
      (a, b) =>
        a.frame === b.frame &&
        a.playing === b.playing &&
        a.ready === b.ready &&
        a.count === b.count &&
        a.end === b.end,
    ),
    end = s.end;
  return (
    <div className="touch-transport" role="group" aria-label="Playback and keyframes">
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
      <div className="touch-scrubber">
        <div>
          <button aria-label="Previous frame" onClick={() => studio.setFrame(s.frame - 1)}>
            <ChevronsLeft size={17} />
          </button>
          <output aria-label="Frame">
            {s.frame}
            <small> / {end}</small>
          </output>
          <button aria-label="Next frame" onClick={() => studio.setFrame(s.frame + 1)}>
            <ChevronsRight size={17} />
          </button>
        </div>
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
    </div>
  );
}
export function TabletDrawer({
  panel,
  close,
  children,
  exiting = false,
}: {
  panel: TabletPanel;
  close: () => void;
  children: ReactNode;
  exiting?: boolean;
}) {
  const titles = {
    rig: 'Rig controls',
    properties: 'Pose properties',
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
      <header>
        <h2 className="context-flair attached-flair">{titles[panel]}</h2>
        <button aria-label={'Close ' + titles[panel]} onClick={close}>
          <X size={20} />
        </button>
      </header>
      <MotionSize className="tablet-sheet-content" contentKey={panel}>
        {children}
      </MotionSize>
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
        <div className="touch-setting-pair">
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
        <div className="touch-setting-pair">
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

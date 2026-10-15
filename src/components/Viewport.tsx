import { PoseActions } from './PoseActions';
import { isTouch as isAndroid } from '../platform/storage';
import { useEffect, useRef, useState } from 'react';
import {
  BoxSelect,
  Camera,
  Scan,
  Route,
  Clapperboard,
  Gamepad2,
  Eye,
  PictureInPicture2,
  X,
} from 'lucide-react';
import { StudioScene } from '../scene/StudioScene';
import { studio } from '../core/store';
import { useStudioChrome } from '../hooks';
import { useTransientPopover } from '../hooks/transientPopover';
import { GraphicsFallback } from './GraphicsFallback';
export function Viewport({
  onRuntime,
  onThumbs,
}: {
  onRuntime: (r: StudioScene | null) => void;
  onThumbs: (t: string[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    runtime = useRef<StudioScene | null>(null),
    s = useStudioChrome(),
    [trail, setTrail] = useState(false),
    [failure, setFailure] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0),
    [viewOptions, setViewOptions] = useState(false),
    viewPanel = useRef<HTMLDivElement>(null),
    viewTrigger = useRef<HTMLButtonElement>(null),
    viewPopover = useTransientPopover({
      owner: 'scene-view',
      open: viewOptions,
      onClose: () => setViewOptions(false),
      rootRef: viewPanel,
      triggerRef: viewTrigger,
    });
  useEffect(() => {
    let r: StudioScene | undefined;
    let active = true;
    setFailure(null);
    try {
      r = new StudioScene(
        ref.current!,
        studio,
        () => {
          if (active && r) onThumbs(r.gripThumbnails());
        },
        (message) => {
          if (active) setFailure(message);
        },
      );
      runtime.current = r;
      onRuntime(r);
    } catch (error) {
      setFailure((error as Error).message || 'The browser could not create a WebGL 2 context.');
      onRuntime(null);
    }
    return () => {
      active = false;
      r?.dispose();
      runtime.current = null;
      onRuntime(null);
    };
  }, [onRuntime, onThumbs, attempt]);
  return (
    <main
      className={
        'viewport' + (s.gameView ? ' game-view' : '') + (s.retargetMode ? ' retarget-viewport' : '')
      }
      ref={ref}
    >
      {isAndroid && (
        <div className="desktop-pose-context controller-overlay-layer">
          <PoseActions
            pasteMirrored={() => runtime.current?.pasteMirroredPose()}
            timeline
            mirror={() => runtime.current?.mirrorSelectedPose()}
          />
        </div>
      )}
      {isAndroid && (
        <button
          ref={viewTrigger}
          className="touch-view-toggle"
          aria-label="View options"
          aria-expanded={viewOptions}
          onClick={() => {
            if (viewOptions) setViewOptions(false);
            else {
              viewPopover.announce();
              if (s.boxSelection) studio.patch({ boxSelection: null });
              setViewOptions(true);
            }
          }}
        >
          <Eye size={22} />
          <span>View</span>
        </button>
      )}
      {s.boxSelection && (
        <div className="scene-selection-tools" role="group" aria-label="Box selection">
          <span className="context-flair">Drag around controls</span>
          {(['replace', 'add', 'subtract'] as const).map((mode) => (
            <button
              key={mode}
              aria-pressed={s.boxSelection === mode}
              onClick={() => studio.patch({ boxSelection: mode })}
            >
              {mode === 'replace' ? 'Replace' : mode === 'add' ? 'Add' : 'Remove'}
            </button>
          ))}
          <button
            aria-label="Cancel box selection"
            onClick={() => runtime.current?.beginBoxSelection()}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <span className="pose-view-label">
        {s.retargetMode
          ? 'Character setup'
          : s.playerView
            ? 'Player camera · Numpad 0 to return'
            : 'Pose view'}
        {(s.workspace?.previewCharacterId || s.retargetMode) && (
          <small>
            {s.retargetLoading
              ? 'Preparing model…'
              : s.workspace?.characters?.find(
                  (c) =>
                    c.id ===
                    (s.retargetMode
                      ? s.workspace?.activeCharacterId
                      : s.workspace?.previewCharacterId),
                )?.name}
          </small>
        )}
      </span>
      <div
        className="preview-border"
        hidden={!s.cameraPreview || s.playerView || s.gameView || s.retargetMode}
      >
        <span>
          Player camera <small>(16:9)</small>
        </span>
        <button
          title="Select player camera"
          aria-label="Select player camera"
          onClick={() => {
            studio.setLayer('firstPerson');
            studio.patch({ selected: 'camera' });
          }}
        >
          <Camera size={13} />
        </button>
      </div>
      {failure && (
        <GraphicsFallback message={failure} retry={() => setAttempt((value) => value + 1)} />
      )}
      {!s.ready && !failure && (
        <div className="loading-overlay">
          <div className="spinner" />
          <strong>Preparing Manny</strong>
          <span>Loading the character and animation controls…</span>
        </div>
      )}
      <div className="viewport-orientation">
        <svg viewBox="0 0 80 80" aria-label="Unreal orientation axes">
          {['X', 'Y', 'Z'].map((axis) => (
            <g key={axis} data-axis={axis}>
              <line x1="40" y1="40" x2="40" y2="40" />
              <text x="40" y="40">
                {axis}
              </text>
            </g>
          ))}
        </svg>
        <span>10 cm · 1 m</span>
      </div>
      <div
        ref={viewPanel}
        className={'viewport-bottom' + (viewOptions ? ' view-options-open' : '')}
      >
        <span />
        <div>
          {isAndroid && (
            <header>
              <strong className="context-flair">Scene view</strong>
              <button aria-label="Close view options" onClick={() => setViewOptions(false)}>
                <X size={20} />
              </button>
            </header>
          )}
          {!isAndroid && (
            <button
              title="Box select controls (B)"
              aria-label="Box select controls"
              aria-pressed={!!s.boxSelection}
              disabled={s.gameView || s.retargetMode}
              onClick={() => runtime.current?.beginBoxSelection()}
            >
              <BoxSelect size={18} />
            </button>
          )}
          <button
            title="Game View · hide editor overlays (Shift G)"
            aria-label="Game View"
            aria-pressed={s.gameView}
            onClick={() => runtime.current?.toggleGameView()}
          >
            <Gamepad2 size={18} />
            {isAndroid && <span>Game view</span>}
          </button>
          <button
            title="Cinematic view · reflections, ambient occlusion and antialiasing"
            aria-label="Cinematic view"
            aria-pressed={s.cinematic}
            onClick={() => studio.setCinematic(!s.cinematic)}
          >
            <Clapperboard size={18} />
            {isAndroid && <span>Cinematic</span>}
          </button>
          <button
            title="Player camera view (Numpad 0)"
            disabled={s.retargetMode}
            aria-label="Player camera view"
            aria-pressed={s.playerView}
            onClick={() => studio.patch({ playerView: !s.playerView })}
          >
            <Camera size={18} />
            {isAndroid && <span>Player camera</span>}
          </button>
          <button
            aria-label="Camera preview"
            aria-pressed={s.cameraPreview}
            onClick={() => studio.patch({ cameraPreview: !s.cameraPreview })}
          >
            <PictureInPicture2 size={18} />
            {isAndroid && <span>Camera preview</span>}
          </button>
          <button
            disabled={s.retargetMode}
            title="Show motion trail for selected control"
            className={trail ? 'active' : ''}
            onClick={() => {
              runtime.current?.toggleTrail();
              setTrail(!trail);
            }}
          >
            <Route size={18} />
            {isAndroid && <span>Motion trail</span>}
          </button>
          <button
            title="Reset view"
            onClick={() =>
              isAndroid ? runtime.current?.frameScene() : runtime.current?.resetView()
            }
          >
            <Scan size={18} />
            {isAndroid && <span>Frame scene</span>}
          </button>
        </div>
      </div>
    </main>
  );
}

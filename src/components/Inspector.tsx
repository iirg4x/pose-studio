import { useCompactViewport } from '../hooks/compactViewport';
import { isTouch } from '../platform/storage';
import { ControlLayerSettings } from './ControlLayerSettings';
import { TransformFields } from './TransformFields';
import type { StudioScene } from '../scene/StudioScene';
import { PreviewLink } from './PreviewLink';
import { ControllerLimits } from './ControllerLimits';
import { AttachmentPanel } from './AttachmentPanel';
import { PropSettings } from './PropSettings';
import type { AttachmentTarget } from '../scene/attachments';
import type { LayerSpace } from '../core/layerSpaces';
import { ScrubNumber } from './ScrubNumber';
import { LayerPanel } from './LayerPanel';
import { PropertySection } from './PropertySection';
import { activeAnimationLayer } from '../core/layers';
import { MotionSettings, type UiMotionMode, type UiMotionOptions } from './MotionSettings';
import { interpolationChoicesFor, isMotionInterpolation } from './interpolationOptions';
import type { InterpolationMode } from './interpolationOptions';
import { BodyBasePanel } from './BodyBasePanel';
import { GripPresets } from './GripPresets';
import { controlTint } from '../core/controlStyle';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { Bone, Layers, Move3D, SlidersHorizontal, ChevronRight } from 'lucide-react';
import { useStudioChrome } from '../hooks';
import { studio } from '../core/store';
import { controlLabels, clone, limbMode, controlEnabled, evaluate } from '../core/model';
import { CONTROLS, isOffsetControl, isBoneControl } from '../core/controls';
import type { LimbId, LimbMode } from '../core/controls';
import type { Pose, Interpolation, Project } from '../core/model';
import type { MotionOptions } from '../core/interpolation';

type ControlPropertiesTab = 'transform' | 'rig' | 'layer';

export function Inspector({
  runtime,
  onClose,
  switchLimb,
  attach,
  pick,
}: {
  runtime: StudioScene | null;
  onClose: () => void;
  attach: (target: AttachmentTarget, position: boolean, rotation: boolean) => void;
  pick: () => void;
  switchLimb: (limb: LimbId, mode: LimbMode) => void;
}) {
  const compactViewport = useCompactViewport(),
    compact = isTouch && compactViewport;
  const s = useStudioChrome({ edits: 'live' }),
    [context, setContext] = useState<'control' | 'animation'>(() => {
      try {
        return localStorage.getItem('pose-properties-context') === 'animation'
          ? 'animation'
          : 'control';
      } catch {
        return 'control';
      }
    });
  const [controlTab, setControlTab] = useState<ControlPropertiesTab>(() => {
    try {
      const value = localStorage.getItem('pose-control-properties-tab');
      return value === 'rig' || value === 'layer' ? value : 'transform';
    } catch {
      return 'transform';
    }
  });
  const choose = (value: 'control' | 'animation') => {
    setContext(value);
    try {
      localStorage.setItem('pose-properties-context', value);
    } catch {}
  };
  useEffect(() => {
    // The scene ribbon always opens the selected control, even when the last
    // inspector session was looking at animation-wide settings.
    const openControl = () => choose('control');
    window.addEventListener('pose-open-properties', openControl);
    return () => window.removeEventListener('pose-open-properties', openControl);
  }, []);
  useEffect(() => setControlTab('transform'), [s.selected]);
  // Empty selection exposes animation-wide work without changing the user's
  // control/animation preference for the next selected controller.
  const displayedContext = s.selection.length ? context : 'animation';
  const p = studio.currentPose();
  if (!p || !s.project) return <aside className="inspector loading-panel">Preparing Manny…</aside>;
  const labels = controlLabels(s.project),
    id = s.selected,
    hand = id.startsWith('hand'),
    body = isOffsetControl(id),
    definition = CONTROLS[id],
    enabled = controlEnabled(s.project, id, s.frame),
    limb = definition.limb,
    activeLayer = activeAnimationLayer(s.project);
  const trackMode = s.project.tracks[id].interpolation as unknown as InterpolationMode | 'smooth',
    displayedTrackMode: InterpolationMode = trackMode === 'smooth' ? 'bezier' : trackMode,
    trackMotionMode = isMotionInterpolation(displayedTrackMode)
      ? (displayedTrackMode as UiMotionMode)
      : undefined,
    interpolationOptions = interpolationChoicesFor(displayedTrackMode);
  const hasLoop = Object.values(s.project.tracks[id].curves ?? {}).some((c) => c?.loop);
  const edit = (value: Pose) => (body ? studio.editRaw(id, value) : studio.editWorld(id, value));
  const showControlTab = (tab: ControlPropertiesTab) => !compact || controlTab === tab;
  const chooseControlTab = (value: ControlPropertiesTab) => {
    setControlTab(value);
    try {
      localStorage.setItem('pose-control-properties-tab', value);
    } catch {}
  };
  const grip = (index: number, value: number) => {
    const next = clone(p);
    if (index === -1) for (let i = 1; i < 5; i++) next.grip[i] = value;
    else next.grip[index] = value;
    edit(next);
  };
  const setPose = (kind: number) => {
    const next = clone(p);
    next.grip =
      kind === 0
        ? [0.05, 0.05, 0.08, 0.09, 0.1]
        : kind === 1
          ? [0.45, 0.5, 0.72, 0.76, 0.76]
          : [0.65, 0.65, 0.18, 0.18, 0.18];
    edit(next);
  };
  return (
    <aside
      className="inspector properties-editor"
      data-context={displayedContext}
      data-layout={compact ? 'compact' : 'full'}
    >
      <header className="properties-heading">
        <div className="properties-heading-title">
          <h2>{displayedContext === 'control' ? 'Control properties' : 'Animation properties'}</h2>
          <div
            className="property-context-heading"
            style={
              {
                '--control-tint': displayedContext === 'control' ? controlTint(id) : 'var(--cyan)',
              } as CSSProperties
            }
          >
            <i />
            <strong
              aria-label={displayedContext === 'control' ? 'Active control' : 'Active animation'}
            >
              {displayedContext === 'control' ? labels[id] : s.project.name}
            </strong>
            {displayedContext === 'control' && s.selection.length > 1 && (
              <small>{s.selection.length} selected</small>
            )}
          </div>
        </div>
        {s.selection.length > 0 && (
          <button
            className="property-context-switch"
            type="button"
            title={displayedContext === 'control' ? 'Animation properties' : 'Control properties'}
            aria-label={
              displayedContext === 'control'
                ? 'Show animation properties'
                : 'Show control properties'
            }
            onClick={() => choose(displayedContext === 'control' ? 'animation' : 'control')}
          >
            {displayedContext === 'control' ? <Layers size={18} /> : <Bone size={18} />}
          </button>
        )}
        <button
          className="properties-close"
          aria-label="Collapse properties"
          title="Collapse properties"
          onClick={onClose}
        >
          <ChevronRight size={20} />
        </button>
      </header>
      {compact && displayedContext === 'control' && (
        <div className="property-control-tabs" role="tablist" aria-label="Control properties">
          {(
            [
              ['transform', Move3D, 'Transform'],
              ['rig', SlidersHorizontal, 'Rig'],
              ['layer', Layers, 'Layer'],
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={'control-properties-tab-' + key}
              aria-controls="control-properties-content"
              aria-selected={controlTab === key}
              tabIndex={controlTab === key ? 0 : -1}
              onClick={() => chooseControlTab(key)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                e.preventDefault();
                const index = ['transform', 'rig', 'layer'].indexOf(key),
                  next = (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3,
                  value = ['transform', 'rig', 'layer'][next] as ControlPropertiesTab;
                chooseControlTab(value);
                e.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  .item(next)
                  ?.focus();
              }}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
      <div
        className="inspector-scroll properties-content"
        id="control-properties-content"
        role={compact && displayedContext === 'control' ? 'tabpanel' : 'region'}
        aria-labelledby={
          compact && displayedContext === 'control'
            ? 'control-properties-tab-' + controlTab
            : undefined
        }
        aria-label={displayedContext === 'control' ? 'Control properties' : 'Animation properties'}
      >
        {displayedContext === 'animation' ? (
          <>
            {!s.selection.length && (
              <PropertySection id="selection" title="Controls">
                <p className="property-note">
                  Select a control in the scene or timeline to edit its pose.
                </p>
                <div className="property-mask-actions">
                  <button type="button" onClick={() => studio.selectAll()}>
                    Select all controls
                  </button>
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new Event('pose-box-select'))}
                  >
                    Box select
                  </button>
                </div>
              </PropertySection>
            )}
            {s.project.editing === 'firstPerson' && (
              <PropertySection id="animation-camera" title="Player camera">
                <CameraMotion project={s.project} />
                <Slider
                  label="Field of view"
                  value={evaluate(s.project, s.frame, s.drafts).camera.fov}
                  min={20}
                  max={120}
                  step={1}
                  change={(v) => studio.editCameraFov(v)}
                />
                <div className="property-mask-actions">
                  <button
                    onClick={() => {
                      studio.selectControl('camera');
                      choose('control');
                    }}
                  >
                    Camera controls
                  </button>
                </div>
              </PropertySection>
            )}
            <LayerPanel />
            <PreviewLink />
            <BodyBasePanel />
          </>
        ) : (
          <>
            {showControlTab('transform') && (
              <>
                <TransformFields runtime={runtime} compact={compact} />
                {id === 'camera' && (
                  <PropertySection id="camera" title="Player camera">
                    <CameraMotion project={s.project} />
                    <Slider
                      label="Field of view"
                      value={p.fov}
                      min={20}
                      max={120}
                      step={1}
                      change={(v) => studio.editCameraFov(v)}
                    />
                    <div className="property-mask-actions">
                      <button onClick={() => edit({ ...p, q: [0, 1, 0, 0] })}>Look forward</button>
                      <button
                        onClick={() =>
                          edit({
                            ...p,
                            q: [0, Math.cos((Math.PI * 2) / 9), Math.sin((Math.PI * 2) / 9), 0],
                          })
                        }
                      >
                        Look down
                      </button>
                    </div>
                  </PropertySection>
                )}
              </>
            )}
            {showControlTab('layer') && (
              <>
                <PropertySection id="layer-space" title="Layer space" defaultOpen={false}>
                  {activeLayer?.nativeSpace && isBoneControl(id) && (
                    <div className="property-row">
                      <span>Motion space</span>
                      <output>
                        {activeLayer.nativeSpace === 'mesh' ? 'Mesh additive' : 'Local additive'}
                      </output>
                    </div>
                  )}
                  {activeLayer && activeLayer.kind !== 'base' && (
                    <label className="property-row">
                      <span>Offset space</span>
                      <select
                        aria-label="Layer space for this control"
                        value={activeLayer.spaces?.[id] ?? 'layer'}
                        onChange={(event) => {
                          const spaces = { ...activeLayer.spaces };
                          if (event.target.value === 'layer') delete spaces[id];
                          else spaces[id] = event.target.value as LayerSpace;
                          studio.configureLayer(activeLayer.id, { spaces });
                        }}
                      >
                        <option value="layer">
                          Layer default ({activeLayer.space ?? 'local'})
                        </option>
                        <option value="local">Local</option>
                        <option value="parent">Parent</option>
                        <option value="world">World</option>
                      </select>
                    </label>
                  )}
                  {(!activeLayer || activeLayer.kind === 'base') && (
                    <p className="property-note">Base animation uses the control’s stored space.</p>
                  )}
                </PropertySection>
                <ControlLayerSettings />
              </>
            )}
            {showControlTab('rig') && (
              <>
                {limb && (
                  <PropertySection
                    id="limb-posing"
                    title={limb.startsWith('arm') ? 'Arm posing' : 'Leg posing'}
                    defaultOpen={false}
                  >
                    <div className="property-section-inline-action">
                      <span>Pose mode</span>
                      <div
                        className="segmented rig-mode-switch"
                        title="Matches the current pose and keys the IK/FK mode"
                      >
                        {(['ik', 'fk'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={limbMode(s.project!, limb, s.frame) === mode}
                            onClick={() => switchLimb(limb, mode)}
                          >
                            {mode.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>
                    {!enabled && (
                      <p className="property-note">
                        Switch to {definition.only?.toUpperCase()} to pose this control.
                      </p>
                    )}
                  </PropertySection>
                )}
                <ControllerLimits
                  project={s.project}
                  id={id}
                  ground={() => runtime?.groundSelected([id])}
                />
                <PropSettings />
                <AttachmentPanel attach={attach} pick={pick} />
                {hand && (
                  <PropertySection id="grip" title="Grip" defaultOpen={false}>
                    <Slider
                      label="Curl"
                      value={p.grip.slice(1).reduce((a, b) => a + b, 0) / 4}
                      change={(v) => grip(-1, v)}
                    />
                    {['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].map((label, i) => (
                      <Slider
                        key={label}
                        label={label}
                        value={p.grip[i]}
                        change={(v) => grip(i, v)}
                      />
                    ))}
                    <p className="property-note">−1 outward · 0 rest · 1 closed</p>
                    <GripPresets runtime={runtime} ready={s.ready} apply={setPose} />
                  </PropertySection>
                )}
              </>
            )}
            {showControlTab('transform') && (
              <PropertySection id="interpolation" title="Interpolation" defaultOpen={false}>
                <label className="property-row">
                  <span>Between keys</span>
                  <select
                    aria-label="Between keys"
                    value={hasLoop ? 'loop' : displayedTrackMode}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === 'loop') studio.setInterpolation('loop');
                      else
                        studio.setInterpolation(
                          (value === 'bezier' ? 'smooth' : value) as unknown as Interpolation,
                        );
                    }}
                  >
                    <option value="loop">Loop</option>
                    {interpolationOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {trackMotionMode && (
                  <MotionSettings
                    mode={trackMotionMode}
                    options={s.project.tracks[id] as UiMotionOptions}
                    change={(value) => studio.setMotionOptions(value as unknown as MotionOptions)}
                  />
                )}
              </PropertySection>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
function Slider({
  label,
  value,
  change,
  min = -1,
  max = 1,
  step = 0.01,
}: {
  label: string;
  value: number;
  change: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="slider-row">
      <label htmlFor={'slider-' + label} title={label}>
        {label === 'Field of view' ? 'FOV' : label}
      </label>
      <input
        id={'slider-' + label}
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => studio.beginGesture()}
        onPointerUp={() => studio.endGesture()}
        onPointerCancel={() => studio.cancelGesture()}
        onBlur={() => studio.endGesture()}
        onKeyDown={() => studio.beginGesture()}
        onKeyUp={() => studio.endGesture()}
        onChange={(e) => change(Number(e.target.value))}
      />
      <ScrubNumber
        className="slider-number"
        type="number"
        aria-label={label + ' value'}
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(2))}
        onFocus={() => studio.beginGesture()}
        onBlur={() => studio.endGesture()}
        onChange={(e) => {
          if (e.target.value !== '') change(Math.max(min, Math.min(max, Number(e.target.value))));
        }}
      />
    </div>
  );
}

function CameraMotion({ project }: { project: Project }) {
  const binding = project.cameraBinding;
  if (!binding) return null;
  return (
    <label className="property-row" title="Follow the source animation's camera attachment">
      <span>{binding.bone === 'head' ? 'Head motion' : 'Bone motion'}</span>
      <input
        type="checkbox"
        aria-label="Source camera motion"
        checked={binding.enabled}
        onChange={(e) => studio.setCameraMotion(e.target.checked)}
      />
    </label>
  );
}

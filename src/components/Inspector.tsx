import { ControlLayerSettings } from './ControlLayerSettings';
import { TransformFields } from './TransformFields';
import type { StudioScene } from '../scene/StudioScene';
import { PreviewLink } from './PreviewLink';
import { ControllerLimits } from './ControllerLimits';
import { AttachmentPanel } from './AttachmentPanel';
import { PropSettings } from './PropSettings';
import type { AttachmentTarget } from '../scene/attachments';
import type { LayerSpace } from '../core/layerSpaces';
import { boneFollowing } from '../core/boneFollowing';
import { ScrubNumber } from './ScrubNumber';
import { LayerPanel } from './LayerPanel';
import { PropertySection } from './PropertySection';
import { activeAnimationLayer } from '../core/layers';
import { MotionSettings } from './MotionSettings';
import { BodyBasePanel } from './BodyBasePanel';
import { controlTint } from '../core/controlStyle';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Unlink, Hand, Bone, Layers, ChevronRight } from 'lucide-react';
import { Euler, Quaternion } from 'three';
import { useStudioChrome } from '../hooks';
import { studio } from '../core/store';
import { controlLabels, clone, limbMode, controlEnabled, evaluate } from '../core/model';
import { CONTROLS, isOffsetControl, isBoneControl } from '../core/controls';
import type { LimbId, LimbMode } from '../core/controls';
import type { ControlId, ParentId, Pose, Q4, Interpolation, Project } from '../core/model';
export function Inspector({
  runtime,
  thumbs,
  switchLimb,
  setBoneFollowing,
  attach,
  pick,
}: {
  runtime: StudioScene | null;
  attach: (target: AttachmentTarget, position: boolean, rotation: boolean) => void;
  pick: () => void;
  thumbs: string[];
  setBoneFollowing: (position: boolean, rotation: boolean) => void;
  switchLimb: (limb: LimbId, mode: LimbMode) => void;
}) {
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
  const choose = (value: 'control' | 'animation') => {
    setContext(value);
    try {
      localStorage.setItem('pose-properties-context', value);
    } catch {}
  };
  const p = studio.currentPose();
  if (!p || !s.project) return <aside className="inspector loading-panel">Preparing Manny…</aside>;
  const labels = controlLabels(s.project),
    id = s.selected,
    hand = id.startsWith('hand'),
    body = isOffsetControl(id),
    parent = studio.parent(),
    definition = CONTROLS[id],
    enabled = controlEnabled(s.project, id, s.frame),
    limb = definition.limb,
    activeLayer = activeAnimationLayer(s.project);
  const following = boneFollowing(s.project, s.frame)[id];
  const layerOffset = !!s.project.tracks[id].additive;
  const edit = (value: Pose) => (body ? studio.editRaw(id, value) : studio.editWorld(id, value));
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
    <aside className="inspector properties-editor">
      <div className="property-context-tabs" role="tablist" aria-label="Properties context">
        {(
          [
            ['control', Bone, 'Control'],
            ['animation', Layers, 'Animation'],
          ] as const
        ).map(([key, Icon, label]) => (
          <button
            key={key}
            role="tab"
            id={'properties-tab-' + key}
            aria-controls={'properties-' + key}
            aria-selected={context === key}
            tabIndex={context === key ? 0 : -1}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const next = context === 'control' ? 'animation' : 'control';
                choose(next);
                document.getElementById('properties-tab-' + next)?.focus();
              }
            }}
            onClick={() => choose(key)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>
      <div
        className="property-context-heading context-flair"
        style={
          {
            '--control-tint': context === 'control' ? controlTint(id) : 'var(--green)',
          } as CSSProperties
        }
      >
        <i />
        <strong aria-label={context === 'control' ? 'Active control' : 'Active animation'}>
          {context === 'control'
            ? s.selection.length
              ? labels[id]
              : 'No control selected'
            : s.project.name}
        </strong>
        {context === 'control' && s.selection.length > 1 && (
          <small>{s.selection.length} selected</small>
        )}
      </div>
      <div
        className="inspector-scroll properties-content"
        role="tabpanel"
        id={'properties-' + context}
        aria-labelledby={'properties-tab-' + context}
      >
        {context === 'animation' ? (
          <>
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
        ) : !s.selection.length ? (
          <p className="property-empty-selection">
            Select a control in the scene or Rig panel to edit its pose.
          </p>
        ) : (
          <>
            {activeLayer && (
              <button
                className="property-edit-target"
                title="Choose the layer that receives edits"
                onClick={() => choose('animation')}
              >
                <Layers size={12} />
                <span>{activeLayer.name}</span>
                <small>Editing</small>
                <ChevronRight size={12} />
              </button>
            )}
            <PropertySection id="transform" title="Transform">
              {activeLayer?.nativeSpace && isBoneControl(id) && (
                <div className="property-row">
                  <span>Motion space</span>
                  <output>
                    {activeLayer.nativeSpace === 'mesh' ? 'Mesh additive' : 'Local additive'}
                  </output>
                </div>
              )}
              {activeLayer &&
                activeLayer.kind !== 'base' &&
                !(activeLayer.nativeSpace && isBoneControl(id)) && (
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
                      <option value="layer">Layer default ({activeLayer.space ?? 'local'})</option>
                      <option value="local">Local</option>
                      <option value="parent">Parent</option>
                      <option value="world">World</option>
                    </select>
                  </label>
                )}
              <TransformFields runtime={runtime} />
            </PropertySection>
            <ControlLayerSettings />
            {limb && (
              <PropertySection
                id="limb-posing"
                title={limb.startsWith('arm') ? 'Arm posing' : 'Leg posing'}
              >
                <div className="property-row">
                  <span>Mode</span>
                  <div
                    className="segmented rig-mode-switch"
                    title="Matches the current pose and keys the IK/FK mode"
                  >
                    {(['ik', 'fk'] as const).map((mode) => (
                      <button
                        key={mode}
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
              <PropertySection id="grip" title="Grip">
                <Slider
                  label="Curl"
                  value={p.grip.slice(1).reduce((a, b) => a + b, 0) / 4}
                  change={(v) => grip(-1, v)}
                />
                {['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].map((label, i) => (
                  <Slider key={label} label={label} value={p.grip[i]} change={(v) => grip(i, v)} />
                ))}
                <p className="property-note">−1 outward · 0 rest · 1 closed</p>
                <div className="pose-presets">
                  {['Relaxed', 'Rifle', 'Pinch'].map((label, i) => (
                    <button
                      key={label}
                      className="pose-preset"
                      onClick={() => setPose(i)}
                      title={'Apply ' + label.toLowerCase() + ' grip'}
                    >
                      {thumbs[i] ? <img src={thumbs[i]} alt="" /> : <Hand size={30} />}
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </PropertySection>
            )}
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
            <PropertySection id="interpolation" title="Interpolation">
              <label className="property-row">
                <span>Between keys</span>
                <select
                  aria-label="Between keys"
                  value={
                    Object.values(s.project.tracks[id].curves ?? {}).some((c) => c?.loop)
                      ? 'loop'
                      : s.project.tracks[id].interpolation
                  }
                  onChange={(e) =>
                    studio.setInterpolation(e.target.value as Interpolation | 'loop')
                  }
                >
                  <option value="smooth">Smooth</option>
                  <option value="loop">Loop</option>
                  <option value="linear">Linear</option>
                  <option value="step">Stepped</option>
                  <option value="spring">Spring</option>
                  <option value="bounce">Bounce</option>
                </select>
              </label>
              {(s.project.tracks[id].interpolation === 'spring' ||
                s.project.tracks[id].interpolation === 'bounce') && (
                <MotionSettings
                  mode={s.project.tracks[id].interpolation as 'spring' | 'bounce'}
                  options={s.project.tracks[id]}
                  change={(value) => studio.setMotionOptions(value)}
                />
              )}
            </PropertySection>
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

import { Collapse } from './Motion';
import type { LayerSpace } from '../core/layerSpaces';
import { ControlMask } from './ControlMask';
import { PropertySection } from './PropertySection';
import { ScrubNumber } from './ScrubNumber';
import { controlLabels, visibleControls } from '../core/model';
import { useState } from 'react';
import {
  Plus,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Trash2,
  Copy,
  Link2,
  Pin,
  Diamond,
  Clapperboard,
  Circle,
  ExternalLink,
} from 'lucide-react';
import { useStudioChrome } from '../hooks';
import { studio } from '../core/store';
import { activeAnimationLayer } from '../core/layers';
export function LayerPanel() {
  const s = useStudioChrome({ frame: 'none', edits: 'live' }),
    [add, setAdd] = useState(false),
    p = s.project;
  if (!p) return null;
  const active = activeAnimationLayer(p),
    editable = active && active.kind !== 'base';
  return (
    <>
      <PropertySection id="layers" title="Layer stack">
        <div className="property-layer-editor">
          <div className="layer-stack" role="list" aria-label="Animation layers">
            {p.layers ? (
              [...p.layers].reverse().map((l) => (
                <div
                  role="listitem"
                  key={l.id}
                  className={'layer-row ' + (l.id === p.activeLayerId ? 'selected' : '')}
                >
                  <button
                    className="layer-select"
                    aria-label={'Edit layer ' + l.name}
                    aria-pressed={l.id === p.activeLayerId}
                    title={
                      l.poseLinks?.length
                        ? 'Edit shared source pose · updates linked animations'
                        : l.kind === 'pose' || l.static
                          ? 'Static pose · applies to every frame'
                          : l.kind === 'additive'
                            ? 'Animated adjustment · independent keys'
                            : 'Base correction keys'
                    }
                    onClick={() => studio.selectLayer(l.id)}
                  >
                    {l.poseLinks?.length ? (
                      <Link2 size={13} />
                    ) : l.static || l.kind === 'pose' ? (
                      <Pin size={13} />
                    ) : l.kind === 'base' ? (
                      <Clapperboard size={13} />
                    ) : (
                      <Diamond size={13} />
                    )}
                    <span>{l.name}</span>
                  </button>
                  {l.kind !== 'base' && (
                    <>
                      <button
                        aria-label={(l.enabled ? 'Mute ' : 'Enable ') + l.name}
                        title={l.enabled ? 'Mute layer' : 'Enable layer'}
                        onClick={() => studio.configureLayer(l.id, { enabled: !l.enabled })}
                      >
                        {l.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                      <button
                        aria-label={'Solo ' + l.name}
                        title="Solo this adjustment"
                        aria-pressed={l.solo}
                        onClick={() => studio.configureLayer(l.id, { solo: !l.solo })}
                      >
                        <Circle size={10} fill={l.solo ? 'currentColor' : 'none'} />
                      </button>
                    </>
                  )}
                </div>
              ))
            ) : (
              <div className="layer-row selected">
                <span className="layer-select">
                  <Clapperboard size={13} />
                  {p.bodyBase
                    ? p.editing === 'body'
                      ? 'Body corrections'
                      : 'First-person corrections'
                    : 'Base animation'}
                </span>
              </div>
            )}
          </div>
          <div className="property-stack-tools">
            <button
              aria-label="Add animation layer"
              title="Add layer"
              aria-expanded={add}
              onClick={() => setAdd(!add)}
            >
              <Plus size={14} />
            </button>
            <button
              aria-label="Move layer up"
              title="Move up · evaluate later"
              disabled={!editable || p.layers!.at(-1)!.id === active.id}
              onClick={() => active && studio.moveLayer(active.id, 1)}
            >
              <ChevronUp size={14} />
            </button>
            <button
              aria-label="Move layer down"
              title="Move down · evaluate earlier"
              disabled={!editable || p.layers![1].id === active.id}
              onClick={() => active && studio.moveLayer(active.id, -1)}
            >
              <ChevronDown size={14} />
            </button>
            <span />
            <button
              aria-label="Duplicate layer"
              title="Duplicate layer"
              disabled={!editable}
              onClick={() => active && studio.duplicateLayer(active.id)}
            >
              <Copy size={14} />
            </button>
            <button
              aria-label="Delete layer"
              title="Delete layer"
              disabled={!editable}
              onClick={() => active && studio.removeLayer(active.id)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
        <Collapse open={add}>
          <div className="property-add-layer" data-editor-overlay>
            <button
              onClick={() => {
                studio.addLayer('pose');
                setAdd(false);
              }}
            >
              <Pin size={13} />
              <span>
                Pose layer<small>One pose for the whole action</small>
              </span>
            </button>
            <button
              onClick={() => {
                studio.addLayer('additive');
                setAdd(false);
              }}
            >
              <Diamond size={13} />
              <span>
                Adjustment layer<small>Animated corrections</small>
              </span>
            </button>
          </div>
        </Collapse>
        {p.layers?.[0].poseLinks?.map((link) => (
          <button
            key={link.clipId}
            className="property-source-link"
            aria-label={
              'Edit source pose ' +
              (s.workspace?.clips.find((c) => c.id === link.clipId)?.project.name ??
                p.layers![0].name)
            }
            onClick={() => studio.openPoseSource(link)}
          >
            <Link2 size={13} />
            <span>
              {s.workspace?.clips.find((c) => c.id === link.clipId)?.project.name ??
                p.layers![0].name}
            </span>
            <ExternalLink size={12} />
          </button>
        ))}
        {p.layers?.[0].poseLinks?.length ? (
          <p className="property-note">
            Linked base pose. Edit its source to update every animation using it.
          </p>
        ) : null}
        {p.bodyBase && (
          <button
            className="property-source-link"
            aria-label="Open base animation"
            title="Open source animation"
            onClick={() => studio.activate(p.bodyBase!.sourceId)}
          >
            <Link2 size={13} />
            <span>{p.bodyBase.source.name}</span>
            <ExternalLink size={12} />
          </button>
        )}
      </PropertySection>
      <PropertySection id="active-layer" title="Active layer">
        {active ? (
          <label className="property-row">
            <span>Name</span>
            <input
              aria-label="Layer name"
              key={active.id + '-' + active.name}
              defaultValue={active.name}
              maxLength={100}
              onBlur={(e) => studio.configureLayer(active.id, { name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
            />
          </label>
        ) : (
          <div className="property-row">
            <span>Name</span>
            <output>
              {p.bodyBase
                ? p.editing === 'body'
                  ? 'Body corrections'
                  : 'First-person corrections'
                : 'Base animation'}
            </output>
          </div>
        )}
        <div className="property-row">
          <span>Type</span>
          <output>
            {active?.nativeSpace
              ? active.nativeSpace === 'mesh'
                ? 'Native mesh additive'
                : 'Native local additive'
              : active?.static
                ? 'Base pose'
                : active?.kind === 'pose'
                  ? 'Static pose'
                  : active?.kind === 'additive'
                    ? 'Animated adjustment'
                    : 'Base animation'}
          </output>
        </div>
        {editable && (
          <>
            <label className="property-row">
              <span>{active.nativeSpace ? 'IK / prop space' : 'Default space'}</span>
              <select
                aria-label="Layer default space"
                value={active.space ?? 'local'}
                onChange={(e) =>
                  studio.configureLayer(active.id, { space: e.target.value as LayerSpace })
                }
              >
                <option value="local">Local</option>
                <option value="parent">Parent</option>
                <option value="world">World</option>
              </select>
            </label>
            <p className="property-note">
              {active.nativeSpace
                ? 'Bone channels keep the imported additive space. IK and prop offsets use this setting.'
                : 'Override space per bone in Control properties.'}
            </p>
            <label className="property-row">
              <span>Influence</span>
              <div className="property-percent">
                <ScrubNumber
                  aria-label="Layer influence"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(active.weight * 100)}
                  onFocus={() => studio.beginGesture()}
                  onBlur={() => studio.endGesture()}
                  onChange={(e) =>
                    studio.configureLayer(active.id, {
                      weight: Math.max(0, Math.min(1, Number(e.target.value) / 100)),
                    })
                  }
                />
                <span>%</span>
              </div>
            </label>
            <div className="property-row">
              <span>Contacts</span>
              <label className="property-checkbox">
                <input
                  type="checkbox"
                  aria-label="Preserve contacts on layer"
                  checked={active.contacts}
                  onChange={(e) => studio.configureLayer(active.id, { contacts: e.target.checked })}
                />
                Carry attachments
              </label>
            </div>
          </>
        )}
        {active?.source?.referenceAsset && (
          <p className="property-note">
            Authored on{' '}
            {active.source.referenceAsset
              .split('.')
              .at(-1)
              ?.replace(/^A_(FP_PCH|TP_CH|FP_WEP|TP_WEP|WEP)_/, '')
              .replaceAll('_', ' ')}
            .
          </p>
        )}
        {(active?.kind === 'pose' || active?.static) && (
          <p className="property-note">Edits apply to every frame.</p>
        )}
      </PropertySection>
      {editable && (
        <PropertySection id="layer-mask" title="Layer bone mask" defaultOpen={false}>
          <p className="property-note">Checked bones receive this layer.</p>
          <ControlMask
            ids={visibleControls(p.editing, p)}
            labels={controlLabels(p)}
            excluded={active.excluded}
            mode="include"
            change={(excluded) => studio.configureLayer(active.id, { excluded })}
          />
          <div className="property-mask-actions">
            <button
              disabled={!s.selection.length}
              title={
                !s.selection.length ? 'Select controls to include them in this layer' : undefined
              }
              onClick={() =>
                studio.configureLayer(active.id, {
                  excluded: active.excluded.filter((id) => !s.selection.includes(id)),
                })
              }
            >
              Include selected
            </button>
            <button
              disabled={!s.selection.length}
              title={
                !s.selection.length ? 'Select controls to exclude them from this layer' : undefined
              }
              onClick={() =>
                studio.configureLayer(active.id, {
                  excluded: [...new Set([...active.excluded, ...s.selection])],
                })
              }
            >
              Exclude selected
            </button>
          </div>
        </PropertySection>
      )}
    </>
  );
}

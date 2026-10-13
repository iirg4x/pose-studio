import { useEffect, useState } from 'react';
import { Diamond, Layers, RefreshCw } from 'lucide-react';
import { studio } from '../core/store';
import { useStudioChrome } from '../hooks';
import { activeAnimationLayer } from '../core/layers';
import { blendValue } from '../core/layerBlend';
import { blendChannel } from '../core/blendChannels';
import type { BlendChannel, TransformAxis } from '../core/blendChannels';
import { PropertySection } from './PropertySection';
import { ScrubNumber } from './ScrubNumber';
import { Collapse } from './Motion';
export function ControlLayerSettings() {
  const s = useStudioChrome({ edits: 'live' }),
    p = s.project,
    layer = p && activeAnimationLayer(p);
  const [animateChoice, setAnimate] = useState<boolean | null>(null),
    [duration, setDuration] = useState(6),
    [easing, setEasing] = useState<'bezier' | 'linear' | 'step'>('bezier');
  useEffect(() => setAnimate(null), [s.selected, layer?.id]);
  if (!p || !layer || layer.kind === 'base' || !s.selection.length) return null;
  const ids = s.selection,
    track = p.tracks[s.selected],
    f = s.frame,
    animate =
      animateChoice ??
      Object.entries(track.curves ?? {}).some(
        ([c, v]) => c.startsWith('blend') && ((v?.keys.length ?? 0) > 1 || !!v?.modifiers.length),
      );
  const value = (c: BlendChannel) => blendValue(track, c, f),
    mixed = (c: BlendChannel) =>
      ids.some((id) => Math.abs(blendValue(p.tracks[id], c, f) - value(c)) > 0.01);
  const change = (c: BlendChannel, v: number) =>
    studio.setControlLayerSetting(c, v, animate, duration, easing);
  const keyed = (c: BlendChannel) =>
    ids.every((id) => p.tracks[id].curves?.[c]?.keys.some((k) => Math.abs(k.frame - f) < 0.001));
  const key = (cs: BlendChannel[]) => {
    studio.beginGesture();
    for (const c of cs)
      for (const id of ids)
        studio.setControlLayerSetting(c, blendValue(p.tracks[id], c, f), true, 0, easing, [id]);
    studio.endGesture();
  };
  const number = (c: BlendChannel, label: string) => (
    <div className="blend-percent">
      <ScrubNumber
        type="number"
        min={0}
        max={100}
        step={1}
        aria-label={label}
        title={mixed(c) ? 'Multiple values' : label}
        value={mixed(c) ? '' : Number(value(c).toFixed(1))}
        placeholder="Mixed"
        onFocus={() => studio.beginGesture()}
        onBlur={() => studio.endGesture()}
        onChange={(e) => {
          if (e.target.value !== '') change(c, Number(e.target.value));
        }}
      />
      <span>%</span>
    </div>
  );
  const row = (axis: TransformAxis) => {
    const weight = blendChannel(axis, 'Weight'),
      mode = blendChannel(axis, 'Replace'),
      m = value(mode),
      next = track.curves?.[mode]?.keys.find((k) => k.frame > f),
      transitioning = !!next && Math.abs(next.value - m) > 0.01,
      label = (axis.startsWith('p') ? 'Location ' : 'Rotation ') + axis.at(-1)!.toUpperCase();
    return (
      <div className="blend-axis" key={axis} data-axis={axis.at(-1)}>
        <b>{axis.at(-1)!.toUpperCase()}</b>
        <select
          aria-label={label + ' layer mode'}
          value={
            mixed(mode)
              ? 'mixed'
              : transitioning
                ? 'transition'
                : m === 0
                  ? '0'
                  : m === 100
                    ? '100'
                    : 'transition'
          }
          onChange={(e) => change(mode, Number(e.target.value))}
        >
          {(mixed(mode) || transitioning || (m > 0 && m < 100)) && (
            <option value={mixed(mode) ? 'mixed' : 'transition'} disabled>
              {mixed(mode)
                ? 'Mixed'
                : transitioning
                  ? (m === 0 ? 'Add' : Math.round(m) + '%') +
                    ' → ' +
                    (next!.value >= 100
                      ? 'Replace'
                      : next!.value <= 0
                        ? 'Add'
                        : Math.round(next!.value) + '%')
                  : Math.round(m) + '% replace'}
            </option>
          )}
          <option value="0">Additive</option>
          <option value="100">Replace</option>
        </select>
        {number(weight, label + ' layer weight')}
        <button
          className={'blend-key' + (keyed(weight) && keyed(mode) ? ' keyed' : '')}
          aria-label={'Key ' + label + ' layer settings'}
          title={'Key ' + label + ' blend at frame ' + Math.round(f)}
          onClick={() => key([mode, weight])}
        >
          <Diamond size={13} />
        </button>
      </div>
    );
  };
  return (
    <PropertySection id="control-layer-blend" title="Layer blending">
      <div className="blend-context">
        <Layers size={13} />
        <strong>{layer.name}</strong>
        <small>{ids.length > 1 ? ids.length + ' controls' : 'This control'}</small>
      </div>
      <div className="blend-overall">
        <span>Weight</span>
        {number('blendWeight', 'Control layer weight')}
        <button
          className={'blend-key' + (keyed('blendWeight') ? ' keyed' : '')}
          aria-label="Key control layer weight"
          onClick={() => key(['blendWeight'])}
        >
          <Diamond size={13} />
        </button>
      </div>
      <div className="blend-channel-group">
        <div className="blend-column-head">
          <strong>Location</strong>
          <span>Mode</span>
          <span>Weight</span>
        </div>
        {(['px', 'py', 'pz'] as const).map(row)}
      </div>
      <div className="blend-channel-group">
        <div className="blend-column-head">
          <strong>Rotation</strong>
          <span>Mode</span>
          <span>Weight</span>
        </div>
        {(['rx', 'ry', 'rz'] as const).map(row)}
      </div>
      <div className="blend-animation">
        <label>
          <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} />
          Animate changes
        </label>
        <button
          aria-label="Key all control layer settings"
          title="Key all blend settings at the playhead"
          onClick={() => studio.keyControlLayerSettings()}
        >
          <Diamond size={13} />
          Key all
        </button>
      </div>
      <Collapse open={animate}>
        <div className="blend-transition">
          <label>
            Transition
            <div>
              <ScrubNumber
                type="number"
                min={0}
                max={Math.max(0, p.end - Math.round(f))}
                step={1}
                aria-label="Layer transition frames"
                value={duration}
                onChange={(e) => {
                  if (e.target.value !== '')
                    setDuration(Math.max(0, Math.round(Number(e.target.value))));
                }}
              />
              <span>frames</span>
            </div>
          </label>
          <label>
            Easing
            <select
              aria-label="Layer transition easing"
              value={easing}
              onChange={(e) => setEasing(e.target.value as typeof easing)}
            >
              <option value="bezier">Smooth</option>
              <option value="linear">Linear</option>
              <option value="step">Hold</option>
            </select>
          </label>
          <small>
            From frame {Math.round(f)} to {Math.min(p.end, Math.round(f) + duration)}. Edit keys and
            tangents in Curves.
          </small>
        </div>
      </Collapse>
      <div className="blend-reference">
        <span>
          Replace pose{track.layerReference ? ' · frame ' + track.layerReference.frame : ''}
        </span>
        <button
          aria-label="Capture replacement pose"
          title="Use the pose beneath this layer at the current frame"
          onClick={() => studio.recaptureLayerReference()}
        >
          <RefreshCw size={12} />
          Capture
        </button>
      </div>
      <p className="property-note">
        Additive offsets the motion below. Replace holds the captured pose plus this layer’s edits.{' '}
        {animate
          ? 'Changes create a keyed transition.'
          : 'Changes apply throughout the clip; enable Animate changes to key them.'}
      </p>
    </PropertySection>
  );
}

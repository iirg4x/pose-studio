import { Check, Link2 } from 'lucide-react';
import type { CurveKey, HandleMode } from '../core/curves';
import { InterpolationConnector } from './InterpolationConnector';
import { interpolationChoicesFor } from './interpolationOptions';
import type { InterpolationMode } from './interpolationOptions';

export function InterpolationSettings({
  mode,
  change,
  loop,
  loopChange,
  range,
  disabled = false,
}: {
  mode: (CurveKey['interpolation'] | InterpolationMode | 'smooth') | 'mixed';
  change: (mode: InterpolationMode) => void;
  loop: boolean;
  loopChange: (enabled: boolean) => void;
  range: { start: number; end: number };
  disabled?: boolean;
}) {
  const active: InterpolationMode | 'mixed' =
      mode === 'smooth' || mode === 'loop' ? 'bezier' : mode,
    choices = interpolationChoicesFor(active);
  return (
    <section className="interpolation-settings" aria-label="Interpolation settings">
      <div className="interpolation-section-label">
        <span>Between keys</span>
        {mode === 'mixed' && <small>Mixed</small>}
      </div>
      <div
        className="interpolation-choices"
        role="group"
        aria-label="Keyframe interpolation"
        data-interpolation-count={choices.length}
      >
        {choices.map(({ value, label, hint, legacy }) => (
          <button
            type="button"
            className="interpolation-choice"
            key={value}
            data-interpolation={value}
            data-legacy={legacy ? 'true' : undefined}
            aria-label={label + ' interpolation'}
            aria-pressed={active === value}
            title={hint}
            disabled={disabled}
            onClick={() => change(value)}
          >
            <span className="interpolation-choice-line">
              <InterpolationConnector kind={value} modified={false} />
            </span>
            <span>{label}</span>
            <Check className="interpolation-choice-check" size={12} aria-hidden="true" />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="interpolation-loop"
        aria-label="Loop endpoints"
        aria-pressed={loop}
        disabled={disabled}
        onClick={() => loopChange(!loop)}
      >
        <Link2 size={17} />
        <span>
          <strong>Loop endpoints</strong>
          <small>First and last keys only</small>
        </span>
        <span className="interpolation-loop-range">
          {range.start}
          <span aria-hidden="true">↔</span>
          {range.end}
        </span>
      </button>
    </section>
  );
}
export function HandleSettings({
  value,
  change,
}: {
  value: HandleMode | 'mixed';
  change: (handle: HandleMode) => void;
}) {
  return (
    <section className="handle-settings">
      <div className="interpolation-section-label">
        <span>Tangents</span>
        {value === 'mixed' && <small>Mixed</small>}
      </div>
      <div className="handle-choices" role="group" aria-label="Tangent handles">
        {(
          [
            ['auto', 'Auto'],
            ['clamped', 'Clamped'],
            ['flat', 'Flat'],
            ['vector', 'Vector'],
            ['aligned', 'Aligned'],
            ['free', 'Free'],
          ] as const
        ).map(([mode, label]) => (
          <button
            type="button"
            key={mode}
            aria-label={label + ' handles'}
            aria-pressed={mode === value}
            onClick={() => change(mode)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

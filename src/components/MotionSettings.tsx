import { ScrubNumber } from './ScrubNumber';
import {
  DEFAULT_SPRING,
  DEFAULT_BOUNCE,
  DEFAULT_BACK,
  DEFAULT_ELASTIC,
  blenderInterpolationValue,
  isBlenderInterpolation,
  motionProgress,
} from '../core/interpolation';
import type {
  MotionMode,
  MotionOptions,
  EaseDirection,
  InterpolationName,
  ElasticSettings,
  BackSettings,
} from '../core/interpolation';
import { studio } from '../core/store';
import { interpolationLabel } from './interpolationOptions';
import type { InterpolationMode as UiInterpolationMode } from './interpolationOptions';

export type UiMotionMode = Exclude<UiInterpolationMode, 'bezier' | 'linear' | 'step'>;
type UiEaseDirection = EaseDirection;
export interface MotionPreviewContext {
  begin: number;
  end: number;
  duration: number;
}

export type UiMotionOptions = Omit<MotionOptions, 'easing'> & {
  elastic?: ElasticSettings;
  back?: BackSettings;
  easing?: UiEaseDirection;
};

export function MotionSettings({
  mode,
  options,
  change,
  segment,
}: {
  mode: UiMotionMode;
  options: UiMotionOptions;
  change: (options: UiMotionOptions) => void;
  segment?: MotionPreviewContext;
}) {
  const spring = options.spring ?? DEFAULT_SPRING,
    bounce = options.bounce ?? DEFAULT_BOUNCE,
    elastic = options.elastic ?? DEFAULT_ELASTIC,
    back = options.back ?? DEFAULT_BACK,
    title = interpolationLabel(mode),
    previewBegin = segment && Number.isFinite(segment.begin) ? segment.begin : 0,
    previewEnd = segment && Number.isFinite(segment.end) ? segment.end : 1,
    previewDuration =
      segment && Number.isFinite(segment.duration) && segment.duration > 0 ? segment.duration : 24,
    previewChange = previewEnd - previewBegin;
  const values = Array.from({ length: 161 }, (_, i) => {
      const t = i / 160;
      const time = t * previewDuration;
      return isBlenderInterpolation(mode)
        ? blenderInterpolationValue(
            mode as InterpolationName,
            time,
            previewBegin,
            previewChange,
            previewDuration,
            options as MotionOptions,
          )
        : previewBegin +
            previewChange * motionProgress(mode as MotionMode, t, options as MotionOptions);
    }),
    padding =
      Math.max(Math.abs(previewChange), Math.max(...values) - Math.min(...values), 1e-9) * 0.08,
    lo = Math.min(previewBegin, previewEnd, ...values) - padding,
    hi = Math.max(previewBegin, previewEnd, ...values) + padding;
  const x = (i: number) => 8 + (i / 160) * 204,
    y = (value: number) => 8 + ((hi - value) / (hi - lo)) * 48;
  const path = values
    .map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(2) + ',' + y(v).toFixed(2))
    .join(' ');
  const field = (
    key: string,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    target: 'spring' | 'bounce' | 'elastic' | 'back',
    scale = 1,
  ) => {
    const update = (n: number) => {
      const raw = n / scale;
      const next: UiMotionOptions =
        target === 'spring'
          ? { spring: { ...spring, [key]: raw } }
          : target === 'bounce'
            ? { bounce: { ...bounce, [key]: raw } }
            : target === 'elastic'
              ? { elastic: { ...elastic, [key]: raw } }
              : { back: { ...back, [key]: raw } };
      change(next);
    };
    const changeNumber = (raw: string) => {
      if (raw !== '' && Number.isFinite(Number(raw))) {
        const next = Math.max(min, Math.min(max, Number(raw)));
        update(step === 1 ? Math.round(next) : next);
      }
    };
    return (
      <label className="motion-parameter" key={key}>
        <span>{label}</span>
        <input
          type="range"
          aria-label={title + ' ' + label}
          value={value}
          min={min}
          max={max}
          step={step}
          onPointerDown={() => studio.beginGesture()}
          onPointerUp={() => studio.endGesture()}
          onPointerCancel={() => studio.endGesture()}
          onKeyDown={() => studio.beginGesture()}
          onKeyUp={() => studio.endGesture()}
          onBlur={() => studio.endGesture()}
          onChange={(e) => update(Number(e.target.value))}
        />
        <ScrubNumber
          type="number"
          aria-label={title + ' ' + label + ' value'}
          value={Number(value.toFixed(3))}
          min={min}
          max={max}
          step={step}
          onFocus={() => studio.beginGesture()}
          onBlur={() => studio.endGesture()}
          onChange={(e) => changeNumber(e.target.value)}
        />
      </label>
    );
  };
  const easing = (options.easing ?? 'auto') as UiEaseDirection;
  return (
    <fieldset className="motion-settings" data-motion-mode={mode}>
      <legend>{title} settings</legend>
      <div className="motion-direction" role="group" aria-label={title + ' easing direction'}>
        {(
          [
            ['auto', 'Auto'],
            ['in', 'Ease in'],
            ['out', 'Ease out'],
            ['inOut', 'Ease in / out'],
          ] as [UiEaseDirection, string][]
        ).map(([direction, label]) => (
          <button
            type="button"
            key={direction}
            aria-pressed={easing === direction}
            onClick={() => change({ easing: direction })}
          >
            {label}
          </button>
        ))}
      </div>
      <svg
        viewBox="0 0 220 72"
        className="motion-preview"
        role="img"
        aria-label={title + ' response preview'}
      >
        <line x1="8" y1={y(previewBegin)} x2="212" y2={y(previewBegin)} />
        <line x1="8" y1={y(previewEnd)} x2="212" y2={y(previewEnd)} />
        <path d={path} />
        <circle cx="8" cy={y(previewBegin)} r="2.5" />
        <circle cx="212" cy={y(previewEnd)} r="2.5" />
        <text x="8" y="69">
          First key
        </text>
        <text x="212" y="69" textAnchor="end">
          Next key
        </text>
      </svg>
      {mode === 'spring' ? (
        <>
          {field('strength', 'Strength', spring.strength, 0, 2, 0.05, 'spring')}
          {field('oscillations', 'Oscillations', spring.oscillations, 0.5, 8, 0.1, 'spring')}
          {field('damping', 'Damping', spring.damping, 0, 20, 0.5, 'spring')}
        </>
      ) : mode === 'bounce' ? (
        <>
          {field('bounces', 'Bounces', bounce.bounces, 1, 8, 1, 'bounce')}
          {field('height', 'Height', bounce.height, 0, 1, 0.05, 'bounce')}
          {field('decay', 'Decay', bounce.decay, 0.1, 0.95, 0.05, 'bounce')}
          {field('impact', 'Impact %', bounce.impact * 100, 10, 80, 1, 'bounce', 100)}
        </>
      ) : mode === 'elastic' ? (
        <>
          {field('amplitude', 'Amplitude · units', elastic.amplitude, 0, 1000, 0.01, 'elastic')}
          {field('period', 'Period · frames', elastic.period, 0, 2400, 0.1, 'elastic')}
        </>
      ) : mode === 'back' ? (
        <>{field('overshoot', 'Overshoot', back.overshoot, 0, 5, 0.01, 'back')}</>
      ) : null}
      <div className="motion-setting-footer">
        <span>
          {mode === 'elastic'
            ? 'Amplitude uses channel units; period uses timeline frames.'
            : mode === 'back'
              ? 'Overshoot controls how far the curve passes its target.'
              : mode === 'spring'
                ? 'Higher damping settles sooner.'
                : mode === 'bounce' || mode === 'blenderBounce'
                  ? 'Impact timing is relative to the segment.'
                  : 'Direction follows the selected Blender easing mode.'}
        </span>
        <button
          type="button"
          onClick={() =>
            change(
              mode === 'spring'
                ? { spring: { ...DEFAULT_SPRING }, easing: 'auto' }
                : mode === 'bounce'
                  ? { bounce: { ...DEFAULT_BOUNCE }, easing: 'auto' }
                  : mode === 'elastic'
                    ? { elastic: { ...DEFAULT_ELASTIC }, easing: 'auto' }
                    : mode === 'back'
                      ? { back: { ...DEFAULT_BACK }, easing: 'auto' }
                      : { easing: 'auto' },
            )
          }
        >
          Reset
        </button>
      </div>
    </fieldset>
  );
}

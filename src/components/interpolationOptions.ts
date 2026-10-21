import type { InterpolationName } from '../core/interpolation';

/**
 * UI-friendly interpolation ids. Core stores the smooth Bézier mode as
 * `smooth`; the UI keeps the more descriptive `bezier` alias for pickers.
 */
export type InterpolationMode = 'bezier' | Exclude<InterpolationName, 'smooth'>;

interface InterpolationOption {
  value: InterpolationMode;
  label: string;
  hint: string;
  /** Legacy modes remain visible only while editing a project that uses one. */
  legacy?: boolean;
}

/** The one catalogue used by every interpolation picker and motion editor. */
const INTERPOLATION_CATALOGUE: readonly InterpolationOption[] = [
  { value: 'step', label: 'Constant', hint: 'Hold until the next key' },
  { value: 'linear', label: 'Linear', hint: 'Even speed' },
  { value: 'bezier', label: 'Bézier', hint: 'Editable tangent handles' },
  { value: 'sine', label: 'Sinusoidal', hint: 'Sine ease' },
  { value: 'quad', label: 'Quadratic', hint: 'Quadratic ease' },
  { value: 'cubic', label: 'Cubic', hint: 'Cubic ease' },
  { value: 'quart', label: 'Quartic', hint: 'Quartic ease' },
  { value: 'quint', label: 'Quintic', hint: 'Quintic ease' },
  { value: 'expo', label: 'Exponential', hint: 'Exponential ease' },
  { value: 'circ', label: 'Circular', hint: 'Circular ease' },
  { value: 'back', label: 'Back', hint: 'Overshoot and return' },
  { value: 'blenderBounce', label: 'Bounce', hint: 'Blender bounce response' },
  { value: 'elastic', label: 'Elastic', hint: 'Elastic overshoot and settle' },
  { value: 'spring', label: 'Spring (legacy)', hint: 'Legacy spring response', legacy: true },
  { value: 'bounce', label: 'Bounce (legacy)', hint: 'Legacy bounce response', legacy: true },
];

const auxiliaryLabels: Record<string, string> = {
  smooth: 'Bézier',
  loop: 'Loop',
  hold: 'Hold',
  mixed: 'Mixed channels',
};

export function interpolationLabel(value: string) {
  return (
    INTERPOLATION_CATALOGUE.find((option) => option.value === value)?.label ??
    auxiliaryLabels[value] ??
    value
  );
}

export function interpolationChoicesFor(mode: InterpolationMode | 'smooth' | 'mixed') {
  const active = mode === 'smooth' ? 'bezier' : mode;
  const canonical = INTERPOLATION_CATALOGUE.filter((option) => !option.legacy);
  const legacy = INTERPOLATION_CATALOGUE.filter(
    (option) => option.legacy && option.value === active,
  );
  return [...canonical, ...legacy];
}

export function isMotionInterpolation(
  mode: InterpolationMode | 'smooth' | 'mixed' | 'loop',
): mode is Exclude<InterpolationMode, 'bezier' | 'linear' | 'step'> {
  return !['bezier', 'smooth', 'linear', 'step', 'loop', 'mixed'].includes(mode);
}

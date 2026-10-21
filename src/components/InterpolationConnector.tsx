// These are timing signatures, not value plots. Axis lanes show the actual curves.
// Every signature starts and ends at the key centers, including narrow spans.
import { interpolationLabel } from './interpolationOptions';

const paths: Record<string, string> = {
  loop: 'M0 12 C12 1 38 1 50 12 S88 23 100 12',
  smooth: 'M0 12 C22 12 22 2 50 2 S78 12 100 12',
  linear: 'M0 12 H100',
  bezier: 'M0 12 C22 12 22 2 50 2 S78 12 100 12',
  step: 'M0 12 H28 V2 H72 V12 H100',
  sine: 'M0 12 C12 12 16 3 50 2 S88 12 100 12',
  quad: 'M0 12 C26 12 58 2 100 2',
  cubic: 'M0 12 C16 12 58 2 100 2',
  quart: 'M0 12 C22 12 72 2 100 2',
  quint: 'M0 12 C28 12 80 2 100 2',
  expo: 'M0 12 C48 12 68 3 100 2',
  circ: 'M0 12 C22 12 33 2 100 2',
  back: 'M0 12 C14 14 19 1 42 2 S76 2 100 2',
  blenderBounce: 'M0 12 C20 12 28 -2 40 12 S58 4 70 12 S86 8 100 12',
  elastic: 'M0 12 C8 12 8 -1 18 2 S24 23 34 10 S42 1 50 5 S58 17 66 10 S80 5 100 12',
  spring: 'M0 12 C8 12 10 1 20 2 S30 23 42 19 S54 3 64 7 S76 17 84 14 S94 12 100 12',
  bounce: 'M0 12 Q18 -8 36 12 Q50 -2 64 12 Q74 3 84 12 Q92 7 100 12',
  hold: 'M0 12 H100',
  mixed: 'M0 12 L24 3 H48 V12 C63 12 65 3 78 6 S92 12 100 12',
};
export function InterpolationConnector({ kind, modified }: { kind: string; modified: boolean }) {
  const path = paths[kind] ?? paths.bezier,
    label = interpolationLabel(kind);
  return (
    <>
      <svg
        className={'interpolation-connector' + (modified ? ' modified' : '')}
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path className="interpolation-line" d={path} vectorEffect="non-scaling-stroke" />
        {modified && (
          <path
            className="interpolation-modifier-line"
            d="M0 19 H100"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <span className="interpolation-caption" aria-hidden="true">
        {label}
        {modified ? ' · FX' : ''}
      </span>
    </>
  );
}

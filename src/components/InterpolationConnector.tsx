import type { SegmentKind } from '../core/timelineSettings';

// These are timing signatures, not value plots. Axis lanes show the actual curves.
// Every signature starts and ends at the key centers, including narrow spans.
const paths: Record<SegmentKind, string> = {
  loop: 'M0 12 C12 1 38 1 50 12 S88 23 100 12',
  linear: 'M0 12 H100',
  bezier: 'M0 12 C22 12 22 2 50 2 S78 12 100 12',
  step: 'M0 12 H28 V2 H72 V12 H100',
  spring: 'M0 12 C8 12 10 1 20 2 S30 23 42 19 S54 3 64 7 S76 17 84 14 S94 12 100 12',
  bounce: 'M0 12 Q18 -8 36 12 Q50 -2 64 12 Q74 3 84 12 Q92 7 100 12',
  hold: 'M0 12 H100',
  mixed: 'M0 12 L24 3 H48 V12 C63 12 65 3 78 6 S92 12 100 12',
};
const labels: Record<SegmentKind, string> = {
  loop: 'Loop',
  linear: 'Linear',
  bezier: 'Smooth',
  step: 'Step',
  spring: 'Spring',
  bounce: 'Bounce',
  hold: 'Hold',
  mixed: 'Mixed',
};
export function InterpolationConnector({
  kind,
  modified,
}: {
  kind: SegmentKind;
  modified: boolean;
}) {
  return (
    <>
      <svg
        className={'interpolation-connector' + (modified ? ' modified' : '')}
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path className="interpolation-line" d={paths[kind]} vectorEffect="non-scaling-stroke" />
        {modified && (
          <path
            className="interpolation-modifier-line"
            d="M0 19 H100"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <span className="interpolation-caption" aria-hidden="true">
        {labels[kind]}
        {modified ? ' · FX' : ''}
      </span>
    </>
  );
}

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link2 } from 'lucide-react';
import type { Channel } from '../core/curves';
import { channelValue, CHANNEL_LABELS, channelColor } from '../core/curves';
import { evaluate, controlLabel } from '../core/model';
import type { ControlId, Project } from '../core/model';
import { MirrorDriverNotice } from './AnimationMirror';
import { CurvePlayhead } from './TimelinePlayhead';
import { studio } from '../core/store';

/** Linked channels are deliberately read-only. Show their evaluated motion,
 * rather than the destination's dormant keys, and make the driver one tap away. */
export function MirrorCurve({
  project: p,
  id,
  channel,
  sidebar,
}: {
  project: Project;
  id: ControlId;
  channel: Channel;
  sidebar?: ReactNode;
}) {
  const data = useMemo(
    () =>
      Array.from({ length: 121 }, (_, i) => {
        const frame = (i * p.end) / 120;
        return {
          frame,
          value: channelValue(evaluate(p, frame)[id], channel, p.tracks[id].rotationOrder),
        };
      }),
    [p, id, channel],
  );
  const lo = Math.min(...data.map((v) => v.value)),
    hi = Math.max(...data.map((v) => v.value)),
    pad = Math.max((hi - lo) * 0.15, 0.01),
    min = lo - pad,
    max = hi + pad;
  const path = data
    .map(
      (v, i) =>
        (i ? 'L' : 'M') +
        (v.frame / p.end) * 1000 +
        ',' +
        (12 + ((max - v.value) / (max - min)) * 180),
    )
    .join(' ');
  return (
    <div className="curve-editor mirror-curve-editor">
      {sidebar}
      <div className="curve-center">
        <div className="curve-tools">
          <Link2 size={17} />
          <strong style={{ color: channelColor(channel) }}>
            <span className="curve-bone-flair">{controlLabel(id, p)}</span>
            {CHANNEL_LABELS[channel]}
          </strong>
          <small>Linked · read only</small>
        </div>
        <MirrorDriverNotice project={p} id={id} />
        <div
          className="mirror-curve-plot"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const r = e.currentTarget.getBoundingClientRect();
            studio.setFrame(
              Math.round(Math.max(0, Math.min(p.end, ((e.clientX - r.left) / r.width) * p.end))),
            );
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const r = e.currentTarget.getBoundingClientRect();
            studio.setFrame(
              Math.round(Math.max(0, Math.min(p.end, ((e.clientX - r.left) / r.width) * p.end))),
            );
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
        >
          <svg viewBox="0 0 1000 210" preserveAspectRatio="none" aria-label="Live mirrored curve">
            <path
              d={path}
              fill="none"
              stroke={channelColor(channel)}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <CurvePlayhead
              from={0}
              to={p.end}
              left={0}
              width={1000}
              top={0}
              bottom={188}
              onScrubStart={() => {}}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

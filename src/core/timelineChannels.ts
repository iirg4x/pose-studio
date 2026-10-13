import { channelsFor, channelSample, readCurve, handles } from './curves';
import type { Channel, Curve, CurveKey } from './curves';
import { controlLabels, visibleControls } from './model';
import type { ControlId, Project, Track } from './model';
import { timelineHierarchy } from './timelineHierarchy';

export type TimelineRow = {
  key: string;
  label: string;
  ids: ControlId[];
  control?: ControlId;
  channel?: Channel;
  depth: number;
  children: ControlId[];
  collapsed: boolean;
};
/** Follow viewport selection; clearing it returns to the complete bone list. */
export function timelineVisibleControls(p: Project, selection: readonly ControlId[]) {
  const visible = visibleControls(p.editing, p);
  return selection.length ? visible.filter((id) => selection.includes(id)) : visible;
}

/** The dope-sheet summary groups only the explicit viewport selection. Curves
 * and single-control timelines never get a duplicate track. */
export function selectedControlSummary(
  rows: TimelineRow[],
  selection: readonly ControlId[],
): TimelineRow[] {
  const ids = [...new Set(selection)].filter((id) => rows.some((row) => row.ids.includes(id)));
  return ids.length > 1
    ? [
        {
          key: 'all',
          label: 'All selected controls',
          ids,
          depth: 0,
          children: [],
          collapsed: false,
        },
        ...rows,
      ]
    : rows;
}

/** Channel expansion is independent of child-bone folding and never creates curves. */
export function timelineChannelRows(
  p: Project,
  ids: ControlId[],
  collapsed: ReadonlySet<ControlId>,
  expanded: ReadonlySet<ControlId>,
  query = '',
): TimelineRow[] {
  const labels = controlLabels(p),
    search = query.trim().toLocaleLowerCase();
  const tree = timelineHierarchy(ids, search ? new Set() : collapsed).filter(
    (row) => !search || labels[row.control].toLocaleLowerCase().includes(search),
  );
  const rows: TimelineRow[] = [];
  for (const row of tree) {
    const depth = search ? 0 : row.depth,
      control = row.control;
    rows.push({
      ...row,
      key: control,
      label: labels[control],
      depth,
      ids: search ? [control] : row.ids,
      children: search ? [] : row.children,
    });
    if (expanded.has(control))
      for (const channel of channelsFor(control, p.tracks[control]))
        rows.push({
          key: control + ':' + channel,
          label: labels[control],
          ids: [control],
          control,
          channel,
          depth: depth + 1,
          children: [],
          collapsed: false,
        });
  }
  return rows;
}

/** Screen-sized preview; only called for mounted, visible channel rows. */
export function channelPreview(track: Track, channel: Channel, end: number, samples = 120) {
  const keys = readCurve(track, channel).keys.filter((k) => k.frame <= end);
  const count = Math.max(2, Math.min(240, samples));
  const points = Array.from({ length: count + 1 }, (_, i) => ({
    frame: (i / count) * end,
    value: channelSample(track, channel, (i / count) * end),
  }));
  const values = [...points.map((p) => p.value), ...keys.map((k) => k.value)],
    lo = Math.min(...values),
    hi = Math.max(...values),
    pad = Math.max((hi - lo) * 0.18, 0.001);
  return { keys, points, min: lo - pad, max: hi + pad };
}

/** A group moves as one, snaps to frames, and cannot overwrite another key. */
export function translateCurveKeys(
  keys: CurveKey[],
  frames: number[],
  df: number,
  dv: number,
  end: number,
) {
  const selected = new Set(frames),
    picked = keys.filter((k) => selected.has(k.frame));
  if (!picked.length || !Number.isFinite(df) || !Number.isFinite(dv)) return null;
  const delta = Math.max(
    -Math.min(...picked.map((k) => k.frame)),
    Math.min(end - Math.max(...picked.map((k) => k.frame)), Math.round(df)),
  );
  const moved = picked.map((k) => k.frame + delta);
  if (keys.some((k) => !selected.has(k.frame) && moved.includes(k.frame))) return null;
  return {
    keys: keys.map((k) =>
      selected.has(k.frame) ? { ...k, frame: k.frame + delta, value: k.value + dv } : k,
    ),
    frames: moved,
  };
}

export function editCurveHandle(
  curve: Curve,
  index: number,
  side: 'left' | 'right',
  value: [number, number],
): CurveKey {
  const key = curve.keys[index],
    hs = handles(curve, index);
  const dx = side === 'left' ? Math.min(-0.001, value[0]) : Math.max(0.001, value[0]);
  const next: CurveKey = {
    ...key,
    handle: key.handle === 'aligned' ? 'aligned' : 'free',
    left: hs.left,
    right: hs.right,
    [side]: [dx, value[1]],
  };
  if (next.handle === 'aligned') {
    const other = side === 'left' ? 'right' : 'left',
      ox = next[other]![0];
    next[other] = [ox, (value[1] / dx) * ox];
  }
  return next;
}

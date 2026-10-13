import { describe, it, expect } from 'vitest';
import { createProject, putKey, pose } from '../src/core/model';
import { timelineMarqueeKeys, marqueeScrollSpeed } from '../src/core/timelineMarquee';
import type { TimelineRow } from '../src/core/timelineChannels';
const p = createProject({}, false);
p.end = 48;
for (const id of ['hand_l', 'hand_r'] as const)
  for (const frame of [8, 16, 24]) putKey(p.tracks[id], frame, pose());
const rows: TimelineRow[] = [
  {
    key: 'all',
    label: 'All selected controls',
    ids: ['hand_l', 'hand_r'],
    depth: 0,
    children: [],
    collapsed: false,
  },
  ...(['hand_l', 'hand_r'] as const).map((id) => ({
    key: id,
    label: id,
    ids: [id],
    control: id,
    depth: 0,
    children: [],
    collapsed: false,
  })),
];
const layout = { width: 480, rowHeight: 32, rulerHeight: 30, scrollTop: 0 };
describe('timeline box selection', () => {
  it('selects only the keys inside a specific bone and frame region in either drag direction', () => {
    const expected = [
      { id: 'hand_l', frame: 8 },
      { id: 'hand_l', frame: 16 },
    ];
    expect(timelineMarqueeKeys(p, rows, { x: 65, y: 65, toX: 170, toY: 91 }, layout)).toEqual(
      expected,
    );
    expect(timelineMarqueeKeys(p, rows, { x: 170, y: 91, toX: 65, toY: 65 }, layout)).toEqual(
      expected,
    );
  });
  it('does not let the sticky summary sweep unrelated controls while edge scrolling', () => {
    const result = timelineMarqueeKeys(
      p,
      rows,
      { x: 70, y: 120, toX: 170, toY: 61 },
      { ...layout, scrollTop: 35 },
    );
    expect(result).toEqual([
      { id: 'hand_l', frame: 8 },
      { id: 'hand_l', frame: 16 },
      { id: 'hand_r', frame: 8 },
      { id: 'hand_r', frame: 16 },
    ]);
    const specific = timelineMarqueeKeys(
      p,
      rows,
      { x: 70, y: 95, toX: 170, toY: 120 },
      { ...layout, scrollTop: 70 },
    );
    expect(specific.every((k) => k.id === 'hand_r')).toBe(true);
  });
  it('deliberately starting on the summary selects all controls at that frame', () => {
    expect(timelineMarqueeKeys(p, rows, { x: 150, y: 40, toX: 170, toY: 54 }, layout)).toEqual([
      { id: 'hand_l', frame: 16 },
      { id: 'hand_r', frame: 16 },
    ]);
  });
  it('allows selection across expanded channel strips without including unkeyed frames', () => {
    p.tracks.hand_l.curves = {
      px: {
        keys: [{ frame: 12, value: 0, interpolation: 'linear', handle: 'flat' }],
        modifiers: [],
      },
    };
    const axis: TimelineRow = { ...rows[1], key: 'hand_l:px', channel: 'px' };
    expect(timelineMarqueeKeys(p, [axis], { x: 110, y: 35, toX: 130, toY: 58 }, layout)).toEqual([
      { id: 'hand_l', frame: 12 },
    ]);
  });
  it('scrolls only near a visible edge, at bounded speed in either direction', () => {
    expect(marqueeScrollSpeed(200, 100, 400)).toBe(0);
    expect(marqueeScrollSpeed(101, 100, 400)).toBeLessThan(0);
    expect(marqueeScrollSpeed(399, 100, 400)).toBeGreaterThan(0);
    expect(marqueeScrollSpeed(900, 100, 400)).toBe(18);
  });
});

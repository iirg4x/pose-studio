import { describe, it, expect } from 'vitest';
import { createProject } from '../src/core/model';
import { recordingPlan, recordingFrame, recordingSampleDuration } from '../src/core/recording';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { createRecordingWriter } = createRequire(import.meta.url)('../electron/recording.cjs');
const options = {
  loops: 3,
  range: 'animation',
  view: 'player',
  width: 1280,
  height: 720,
  format: 'mp4',
} as const;
describe('recording', () => {
  it('renders exact repeated playback ranges without adding closing-pose holds', () => {
    const p = createProject({}, false);
    p.end = 20;
    p.fps = 24;
    const plan = recordingPlan(p, options);
    expect(plan.totalFrames).toBe(150);
    expect(plan.duration).toBe(2.5);
    expect([0, 25, 50, 75, 100, 125].map((i) => recordingFrame(plan, i))).toEqual([
      0, 10, 0, 10, 0, 10,
    ]);
  });
  it('uses a nonzero loop range and rejects invalid settings', () => {
    const p = createProject({}, false);
    p.loop = { enabled: true, start: 12, end: 36 };
    const plan = recordingPlan(p, { ...options, range: 'loop', loops: 2 });
    expect(plan.totalFrames).toBe(120);
    expect(recordingFrame(plan, 60)).toBe(12);
    for (const loops of [0, -1, 1.5, 101, NaN])
      expect(() => recordingPlan(p, { ...options, loops })).toThrow();
  });
  it('samples fractional source frames at 60 fps and retains exact duration for odd ranges', () => {
    const p = createProject({}, false);
    p.fps = 24;
    p.end = 21;
    const plan = recordingPlan(p, { ...options, loops: 1 });
    expect(plan.fps).toBe(60);
    expect(recordingFrame(plan, 1)).toBe(0.4);
    expect(plan.totalFrames).toBe(53);
    expect(plan.duration).toBe(0.875);
    expect(52 / 60 + recordingSampleDuration(plan, 52)).toBeCloseTo(0.875, 10);
  });
  it('writes positioned chunks and preserves an existing video when canceled', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pose-recording-')),
      filename = path.join(dir, 'clip.mp4'),
      writer = createRecordingWriter();
    try {
      await fs.writeFile(filename, 'original');
      const canceled = await writer.begin(filename);
      await writer.write(canceled.id, new Uint8Array([1, 2]), 0);
      await writer.cancel(canceled.id);
      expect(await fs.readFile(filename, 'utf8')).toBe('original');
      expect(await fs.readdir(dir)).toEqual(['clip.mp4']);
      const saved = await writer.begin(filename);
      await writer.write(saved.id, new Uint8Array([3, 4]), 2);
      await writer.write(saved.id, new Uint8Array([1, 2]), 0);
      await expect(writer.write('wrong', new Uint8Array([1]), 0)).rejects.toThrow();
      await writer.finish(saved.id);
      expect([...(await fs.readFile(filename))]).toEqual([1, 2, 3, 4]);
      expect(writer.busy).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

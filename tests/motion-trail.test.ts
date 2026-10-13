import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as T from 'three';
import { MotionTrail } from '../src/scene/MotionTrail';
import { createProject } from '../src/core/model';

// Run idle callbacks on demand so each test controls when sampling happens.
let pending = new Map<number, IdleRequestCallback>(),
  nextId = 1;
const runIdle = () => {
  for (let i = 0; i < 1000 && pending.size; i++) {
    const [id, cb] = pending.entries().next().value!;
    pending.delete(id);
    cb({ didTimeout: true, timeRemaining: () => 0 } as IdleDeadline);
  }
};
beforeEach(() => {
  pending = new Map();
  vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback) => {
    pending.set(nextId, cb);
    return nextId++;
  });
  vi.stubGlobal('cancelIdleCallback', (id: number) => pending.delete(id));
});

function setup() {
  const project = createProject({}, false),
    added: T.Line[] = [];
  const host = {
    key: 'a',
    busy: false,
    restored: 0,
    sampled: [] as number[],
  };
  const trail = new MotionTrail({
    add: (line) => added.push(line),
    key: () => host.key,
    busy: () => host.busy,
    current: () => ({ id: 'hand_l', project }),
    positionAt: (frame) => {
      host.sampled.push(frame);
      return new T.Vector3(frame, 0, 0);
    },
    restore: () => host.restored++,
    controlVisible: () => true,
    redraw: () => {},
  });
  return { trail, host, added, project };
}

describe('motion trail', () => {
  it('samples the whole action in idle time and restores the live pose', () => {
    const { trail, host, added, project } = setup();
    trail.toggle();
    runIdle();
    expect(added).toHaveLength(1);
    expect(host.sampled.at(-1)).toBe(project.end);
    expect(host.restored).toBeGreaterThan(0);
  });
  it('waits while busy and resamples when the key changes', () => {
    const { trail, host, added } = setup();
    host.busy = true;
    trail.toggle();
    runIdle();
    expect(added).toHaveLength(0);
    host.busy = false;
    trail.update();
    runIdle();
    expect(added).toHaveLength(1);
    trail.update();
    runIdle();
    expect(added).toHaveLength(1);
    host.key = 'b';
    trail.update();
    runIdle();
    expect(added).toHaveLength(2);
    expect(added[0].parent).toBeNull();
  });
  it('removes the line when turned off', () => {
    const { trail, added } = setup();
    const overlay = new T.Group();
    trail.toggle();
    runIdle();
    overlay.add(added[0]);
    trail.toggle();
    expect(overlay.children).toHaveLength(0);
  });
});

import { afterEach, expect, it, vi } from 'vitest';
import { StudioScene } from '../src/scene/StudioScene';
import type { Project } from '../src/core/model';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('does not resume an old preparation task after its timeout', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  let finishProps!: () => void;
  const props = new Promise<void>((resolve) => {
    finishProps = resolve;
  });
  const project = {} as Project;
  const patch = vi.fn();
  const drawFrame = vi.fn();
  const scene = {
    disposed: false,
    store: {
      state: { project, frame: 0, opening: { name: 'first' }, retargetLoading: false },
      patch,
    },
    apply: vi.fn(),
    projectObjects: { ready: () => props },
    previewObjects: { ready: async () => {} },
    drawFrame,
  } as unknown as StudioScene;
  const settled = StudioScene.prototype.settled.call(scene, 10);
  await vi.advanceTimersByTimeAsync(10);
  await settled;
  expect(patch).toHaveBeenCalledTimes(1);
  // Simulate a later load after the old preparation deadline has expired.
  finishProps();
  await vi.advanceTimersByTimeAsync(100);
  expect(patch).toHaveBeenCalledTimes(1);
  expect(drawFrame).not.toHaveBeenCalled();
});

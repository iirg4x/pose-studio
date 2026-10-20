import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../src/core/model';
import type { ImportMotionReply, ImportMotionRequest } from '../src/core/importMotion.worker';
import { reduceImportedMotion } from '../src/core/importMotionWorker';

type MessageHandler = ((event: MessageEvent<ImportMotionReply>) => void) | null;

class MockWorker {
  static instances: MockWorker[] = [];
  static postMessageError: Error | undefined;
  onmessage: MessageHandler = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted?: ImportMotionRequest;
  terminated = false;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    MockWorker.instances.push(this);
  }

  postMessage(value: ImportMotionRequest) {
    if (MockWorker.postMessageError) throw MockWorker.postMessageError;
    this.posted = value;
  }

  terminate() {
    this.terminated = true;
  }
}

const tolerance = { position: 0.0002, rotation: 0.01 };
const track = (): Track => ({
  keys: [
    { frame: 0, p: [0, 0, 0], q: [0, 0, 0, 1], grip: [0, 0, 0, 0, 0], fov: 70 },
    { frame: 1, p: [0.1, 0, 0], q: [0, 0, 0, 1], grip: [0, 0, 0, 0, 0], fov: 70 },
  ],
  spaces: [],
  interpolation: 'linear',
});

beforeEach(() => {
  MockWorker.instances = [];
  MockWorker.postMessageError = undefined;
  vi.stubGlobal('Worker', MockWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reduceImportedMotion worker lifecycle', () => {
  it('serializes dense tracks, reports completed progress, and resolves results', async () => {
    const progress: [number, number, string][] = [],
      source = track(),
      pending = reduceImportedMotion({ root: source }, tolerance, (completed, total, id) =>
        progress.push([completed, total, id]),
      ),
      worker = MockWorker.instances[0];
    expect(worker.posted).toMatchObject({
      tolerance,
      entries: [{ id: 'root', keys: source.keys }],
    });
    worker.onmessage?.({ data: { progress: 1, id: 'root' } } as MessageEvent<ImportMotionReply>);
    const result = {
      keys: source.keys,
      rotationMode: 'quaternion' as const,
      interpolation: 'linear' as const,
    };
    worker.onmessage?.({
      data: { results: { root: result } },
    } as unknown as MessageEvent<ImportMotionReply>);
    await expect(pending).resolves.toEqual({ root: result });
    expect(progress).toEqual([[1, 1, 'root']]);
    expect(worker.terminated).toBe(true);
  });

  it('rejects worker errors and always terminates the worker', async () => {
    const pending = reduceImportedMotion({ root: track() }, tolerance),
      worker = MockWorker.instances[0];
    worker.onmessage?.({ data: { error: 'fit failed' } } as MessageEvent<ImportMotionReply>);
    await expect(pending).rejects.toThrow('fit failed');
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it('cleans up when posting the request throws a clone error', async () => {
    MockWorker.postMessageError = Error('DataCloneError');
    const pending = reduceImportedMotion({ root: track() }, tolerance),
      worker = MockWorker.instances[0];
    await expect(pending).rejects.toThrow('DataCloneError');
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it('aborts and removes the signal listener before settling', async () => {
    const controller = new AbortController(),
      add = vi.spyOn(controller.signal, 'addEventListener'),
      remove = vi.spyOn(controller.signal, 'removeEventListener'),
      pending = reduceImportedMotion({ root: track() }, tolerance, undefined, controller.signal),
      worker = MockWorker.instances[0];
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
  });

  it('does not create a worker for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const pending = reduceImportedMotion(
      { root: track() },
      tolerance,
      undefined,
      controller.signal,
    );
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(MockWorker.instances).toHaveLength(0);
  });
});

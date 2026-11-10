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

  it('spreads bones over spare cores and merges progress and results', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    const ids = ['root', 'pelvis', 'spine_01', 'spine_02', 'head'],
      progress: [number, number][] = [],
      pending = reduceImportedMotion(
        Object.fromEntries(ids.map((id) => [id, track()])),
        tolerance,
        (completed, total) => progress.push([completed, total]),
      );
    expect(MockWorker.instances).toHaveLength(3);
    expect(MockWorker.instances.flatMap((w) => w.posted!.entries.map((e) => e.id)).sort()).toEqual(
      [...ids].sort(),
    );
    const result = { keys: track().keys, interpolation: 'linear' as const };
    for (const worker of MockWorker.instances) {
      for (const entry of worker.posted!.entries)
        worker.onmessage?.({
          data: { progress: 1, id: entry.id },
        } as MessageEvent<ImportMotionReply>);
      worker.onmessage?.({
        data: { results: Object.fromEntries(worker.posted!.entries.map((e) => [e.id, result])) },
      } as unknown as MessageEvent<ImportMotionReply>);
    }
    expect(Object.keys(await pending).sort()).toEqual([...ids].sort());
    expect(progress).toEqual([1, 2, 3, 4, 5].map((n) => [n, 5]));
    expect(MockWorker.instances.every((w) => w.terminated)).toBe(true);
  });

  it('stops every worker when one of them fails', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 4 });
    const pending = reduceImportedMotion(
      { root: track(), pelvis: track(), head: track() },
      tolerance,
    );
    MockWorker.instances[1].onmessage?.({
      data: { error: 'fit failed' },
    } as MessageEvent<ImportMotionReply>);
    await expect(pending).rejects.toThrow('fit failed');
    expect(MockWorker.instances.every((w) => w.terminated)).toBe(true);
  });
});

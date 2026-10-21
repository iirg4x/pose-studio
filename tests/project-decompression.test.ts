import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeProject } from '../shared/project-codec.mjs';
import {
  copyCompressedInput,
  NativeOutputBatcher,
  nextCompressedInputSlice,
  NATIVE_GZIP_INPUT_CHUNK_BYTES,
  NATIVE_GZIP_OUTPUT_BATCH_BYTES,
} from '../src/platform/gzipDecode';
import { decodeDocumentProject } from '../src/platform/projectDecoding';

interface LargeFallbackProject {
  version: number;
  rig: string;
  name: string;
  workerFallbackPayload: string;
}

let largeProject: LargeFallbackProject;
let largeProjectBytes: Uint8Array<ArrayBuffer>;
let largeProjectSource: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  const random = new Uint8Array(6 * 1024 * 1024);
  let state = 0x9e3779b9;
  for (let index = 0; index < random.length; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    random[index] = state;
  }
  largeProject = {
    version: 1,
    rig: 'ue5-manny-simple',
    name: 'Worker fallback fixture',
    workerFallbackPayload: Buffer.from(random).toString('base64'),
  };
  largeProjectBytes = await encodeProject(largeProject);
  largeProjectSource = largeProjectBytes.slice();
  expect(largeProjectBytes.length).toBeGreaterThan(4 * 1024 * 1024);
  expect([...largeProjectBytes.subarray(0, 3)]).toEqual([0x1f, 0x8b, 8]);
}, 30_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

async function gzip(bytes: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('native project gzip batching', () => {
  it('copies the complete compressed input without detaching the recovery source', () => {
    const source = new Uint8Array([1, 2, 3, 4]);
    const copy = copyCompressedInput(source);
    const transferred = structuredClone(copy, { transfer: [copy.buffer] });
    expect(transferred).toEqual(source);
    expect(source).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('feeds native decompression in bounded 1 MiB source slices', () => {
    const source = new Uint8Array(NATIVE_GZIP_INPUT_CHUNK_BYTES * 2 + 17);
    let offset = 0;
    while (offset < source.length) {
      const slice = nextCompressedInputSlice(source, offset);
      expect(slice.data.length).toBeLessThanOrEqual(NATIVE_GZIP_INPUT_CHUNK_BYTES);
      expect(slice.data.buffer).toBe(source.buffer);
      offset = slice.nextOffset;
    }
  });

  it('aggregates irregular native output into bounded 1 MiB batches', () => {
    const source = new Uint8Array(NATIVE_GZIP_OUTPUT_BATCH_BYTES * 3 + 78);
    for (let index = 0; index < source.length; index++) source[index] = (index * 131 + 47) & 0xff;
    const batcher = new NativeOutputBatcher();
    batcher.push(source.subarray(0, NATIVE_GZIP_OUTPUT_BATCH_BYTES + 31));
    batcher.push(source.subarray(NATIVE_GZIP_OUTPUT_BATCH_BYTES + 31));
    const batches: Uint8Array[] = [];
    for (;;) {
      const batch = batcher.takeFull();
      if (!batch) break;
      batches.push(batch);
    }
    const remainder = batcher.takeRemainder();
    if (remainder) batches.push(remainder);
    expect(batches.every((batch) => batch.length <= NATIVE_GZIP_OUTPUT_BATCH_BYTES)).toBe(true);
    const reconstructed = new Uint8Array(source.length);
    let offset = 0;
    for (const batch of batches) {
      reconstructed.set(batch, offset);
      offset += batch.length;
    }
    expect(offset).toBe(source.length);
    expect(Buffer.from(reconstructed).equals(Buffer.from(source))).toBe(true);
  });

  it('round-trips through the native gzip implementation', async () => {
    const source = new TextEncoder().encode('native worker gzip 🚀 '.repeat(20_000));
    const result = await gunzip(await gzip(source));
    expect(Buffer.from(result).equals(Buffer.from(source))).toBe(true);
  });

  it('rejects corrupt gzip through native footer validation', async () => {
    const compressed = await gzip(new TextEncoder().encode('integrity'));
    compressed[compressed.length - 8] ^= 0x80;
    await expect(gunzip(compressed)).rejects.toThrow();
  });

  it('falls back to native decoding when the worker constructor is blocked', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('Worker blocked by policy');
        }
      },
    );

    await expect(decodeDocumentProject(largeProjectBytes)).resolves.toEqual(largeProject);
    expect(Buffer.from(largeProjectBytes).equals(Buffer.from(largeProjectSource))).toBe(true);
  });

  it('terminates a failed worker and retries the complete native decode', async () => {
    let worker: { terminated: boolean } | undefined;
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: ErrorEvent) => void) | null = null;
        onmessageerror: ((event: MessageEvent) => void) | null = null;
        terminated = false;

        constructor() {
          worker = this;
        }

        postMessage(message: { type?: string }) {
          if (message.type !== 'decode') return;
          queueMicrotask(() => this.onerror?.({ message: 'Worker gzip failure' } as ErrorEvent));
        }

        terminate() {
          this.terminated = true;
        }
      },
    );

    await expect(decodeDocumentProject(largeProjectBytes)).resolves.toEqual(largeProject);
    expect(worker?.terminated).toBe(true);
    expect(Buffer.from(largeProjectBytes).equals(Buffer.from(largeProjectSource))).toBe(true);
  });

  it('keeps small Uint8Array and Blob documents on the compatible native path', async () => {
    vi.stubGlobal('Worker', undefined);
    const project = {
      version: 1,
      rig: 'ue5-manny-simple',
      name: 'Small native document',
    };
    const bytes = await encodeProject(project);

    await expect(decodeDocumentProject(bytes)).resolves.toEqual(project);
    await expect(decodeDocumentProject(new Blob([bytes]))).resolves.toEqual(project);
  });
});

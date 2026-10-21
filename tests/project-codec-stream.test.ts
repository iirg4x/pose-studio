import { describe, expect, it, vi } from 'vitest';
import { decodeProject } from '../shared/project-codec.mjs';

async function gzipChunkedBytes(bytes: Uint8Array, splitOffsets: number[] = []) {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      const offsets = [
        0,
        ...splitOffsets.filter((offset) => offset > 0 && offset < bytes.length),
        bytes.length,
      ].sort((a, b) => a - b);
      for (let index = 1; index < offsets.length; index++)
        controller.enqueue(bytes.subarray(offsets[index - 1], offsets[index]));
      controller.close();
    },
  });
  return new Uint8Array(
    await new Response(source.pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
  );
}

async function gzipChunked(text: string, splitOffsets: number[] = []) {
  return gzipChunkedBytes(new TextEncoder().encode(text), splitOffsets);
}

async function textDecoderStreamText(bytes: Uint8Array) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(new TextDecoderStream());
  const reader = stream.getReader();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return text;
    text += value;
  }
}

describe('streaming project codec', () => {
  it('decodes a large Unicode record split across chunks and a final record without a newline', async () => {
    const symbols = ['🚀', 'é', '中', '𝄞', '🧩'];
    const title = Array.from(
      { length: 120_000 },
      (_, index) => `pose-${index % 997}-${symbols[index % symbols.length]}|`,
    ).join('');
    const project = { version: 1, rig: 'ue5-manny-simple', title };
    const text =
      JSON.stringify({ format: 'pose-project', version: 1 }) +
      '\n' +
      JSON.stringify({ kind: 'metadata', value: project }) +
      '\n' +
      JSON.stringify({ kind: 'end' });

    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(32 * 1024);
    const restored = await decodeProject(await gzipChunked(text));

    expect(restored).toEqual(project);
  });

  it('rejects a record beyond the bounded record limit before parsing it', async () => {
    const nativeDecoder = globalThis.TextDecoder,
      oversized = {
        length: 1,
        indexOf: () => -1,
        slice: () => ({ length: 48 * 1024 * 1024 + 1 }),
      };
    vi.stubGlobal(
      'TextDecoder',
      class {
        decode() {
          return oversized;
        }
      },
    );
    try {
      const compressed = await gzipChunked('bounded');
      await expect(decodeProject(new Blob([compressed]))).rejects.toThrow(
        'Project record is too large.',
      );
    } finally {
      vi.stubGlobal('TextDecoder', nativeDecoder);
    }
  });

  it('preserves multibyte UTF-8 characters when a sequence crosses a chunk boundary', async () => {
    const project = {
      version: 1,
      rig: 'ue5-manny-simple',
      title: 'before 🚀 中 é 𝄞 after',
    };
    const text =
      JSON.stringify({ format: 'pose-project', version: 1 }) +
      '\n' +
      JSON.stringify({ kind: 'metadata', value: project }) +
      '\n' +
      JSON.stringify({ kind: 'end' });
    const bytes = new TextEncoder().encode(text),
      marker = new TextEncoder().encode(text.slice(0, text.indexOf('🚀'))).length,
      compressed = await gzipChunkedBytes(bytes, [marker + 1]);

    expect(await decodeProject(compressed)).toEqual(project);
  });

  it('decodes gzip and legacy JSON Blob inputs without an ArrayBuffer copy', async () => {
    const project = {
      version: 1,
      rig: 'ue5-manny-simple',
      title: 'blob 🚀 中',
    };
    const text =
      JSON.stringify({ format: 'pose-project', version: 1 }) +
      '\n' +
      JSON.stringify({ kind: 'metadata', value: project }) +
      '\n' +
      JSON.stringify({ kind: 'end' });
    const compressed = await gzipChunked(text);

    await expect(decodeProject(new Blob([compressed]))).resolves.toEqual(project);
    await expect(decodeProject(new Blob([JSON.stringify(project)]))).resolves.toEqual(project);
  });

  it('settles bounded parser cancellation on malformed gzip records', async () => {
    const text =
      JSON.stringify({ format: 'pose-project', version: 1 }) +
      '\n' +
      JSON.stringify({ kind: 'metadata', value: { version: 1, rig: 'ue5-manny-simple' } }) +
      '\n' +
      JSON.stringify({ kind: 'end' }) +
      '\n' +
      JSON.stringify({ kind: 'unexpected' });

    await expect(decodeProject(await gzipChunked(text))).rejects.toThrow(
      'Unexpected data after the project.',
    );
  });

  it('flushes an incomplete UTF-8 sequence at EOF like TextDecoderStream', async () => {
    const text =
      JSON.stringify({ format: 'pose-project', version: 1 }) +
      '\n' +
      JSON.stringify({
        kind: 'metadata',
        value: { version: 1, rig: 'ue5-manny-simple', title: 'complete' },
      }) +
      '\n' +
      JSON.stringify({ kind: 'end' }) +
      '\n';
    const encoded = new TextEncoder().encode(text),
      malformed = new Uint8Array(encoded.length + 1);
    malformed.set(encoded);
    malformed[encoded.length] = 0xe2;
    const compressed = await gzipChunkedBytes(malformed, [encoded.length]);

    expect(await textDecoderStreamText(compressed)).toBe(text + '\ufffd');
    await expect(decodeProject(compressed)).rejects.toThrow();
  });
});

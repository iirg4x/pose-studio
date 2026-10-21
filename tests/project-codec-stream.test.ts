import { describe, expect, it } from 'vitest';
import { decodeProject } from '../shared/project-codec.mjs';

async function gzipChunked(text: string) {
  const bytes = new TextEncoder().encode(text);
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 32 * 1024)
        controller.enqueue(bytes.subarray(offset, offset + 32 * 1024));
      controller.close();
    },
  });
  return new Uint8Array(
    await new Response(source.pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
  );
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
});

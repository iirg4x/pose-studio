import { describe, expect, it, vi } from 'vitest';
import { readGLBFile } from './browser';
import { MAX_GLB_BYTES } from './portableAssets';

describe('browser GLB file preflight', () => {
  it('rejects an oversized model before asking the File for bytes', async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));

    await expect(
      readGLBFile({ size: MAX_GLB_BYTES + 1, arrayBuffer } as Pick<File, 'size' | 'arrayBuffer'>),
    ).rejects.toThrow('below 32 MB');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});

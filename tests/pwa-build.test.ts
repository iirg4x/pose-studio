import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { posePwa } from '../shared/pwa-build.mjs';

vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn(),
    copyFile: vi.fn(),
    cp: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

describe('PWA application asset packaging', () => {
  it('copies the bundled gun into the offline shell with the existing props', async () => {
    const out = path.resolve('test-pwa-output'),
      files = new Set([path.join(out, 'index.html')]);
    vi.mocked(fs.copyFile).mockImplementation(async (_source, destination) => {
      files.add(String(destination));
    });
    vi.mocked(fs.readdir).mockImplementation(async (directory) => {
      const names = [...files]
        .filter((file) => file.startsWith(String(directory) + path.sep))
        .map((file) => path.relative(String(directory), file).split(path.sep)[0]);
      return [...new Set(names)].map((name) => ({
        name,
        isDirectory: () => !files.has(path.join(String(directory), name)),
      })) as unknown as Awaited<ReturnType<typeof fs.readdir>>;
    });
    vi.mocked(fs.readFile).mockResolvedValue('<html><head></head></html>');
    const hook = posePwa().writeBundle;
    if (typeof hook !== 'function') throw Error('Expected a writeBundle function.');
    await hook.call({} as never, { dir: out } as never, {});
    for (const name of ['axe', 'rifle', 'magazine', 'unreal-fp-gun'])
      expect(files.has(path.join(out, 'assets', 'builtin-' + name + '.glb'))).toBe(true);
    const worker = vi
      .mocked(fs.writeFile)
      .mock.calls.find(([file]) => file === path.join(out, 'sw.js'));
    expect(worker?.[1]).toContain('assets/builtin-unreal-fp-gun.glb');
  });
});

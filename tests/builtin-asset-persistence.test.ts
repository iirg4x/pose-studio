import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { encodeProject, decodeProject } from '../shared/project-codec.mjs';
import { blankProject } from '../src/core/assets';
import { library, validateLibrary } from '../src/core/library';
import { readProjectDocument } from '../src/platform/projectDocuments';

const require = createRequire(import.meta.url),
  { createCharacters } = require('../electron/characters.cjs');

describe('desktop bundled props', () => {
  it('resolves the new gun and existing props from application assets', () => {
    const assets = path.resolve('public/assets'),
      service = createCharacters('unused-cache', assets, 'backend');
    for (const id of ['builtin-axe', 'builtin-rifle', 'builtin-magazine', 'builtin-unreal-fp-gun'])
      expect(service.filename(id)).toBe(path.join(assets, id + '.glb'));
    for (const id of ['builtin-unknown', 'builtin-unreal-fp-gun/../rifle'])
      expect(() => service.filename(id)).toThrow('Invalid character asset');
  });
  it('embeds and restores the gun without creating an imported model copy', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pose-builtin-assets-'));
    try {
      const cache = path.join(directory, 'cache'),
        service = createCharacters(cache, path.resolve('public/assets'), 'backend'),
        id = 'builtin-unreal-fp-gun',
        action = blankProject();
      action.props = {
        'prop:weapon': {
          name: 'Unreal First Person Gun',
          asset: id,
          scale: 1,
          rotation: [0, 0, 0],
          offset: [0, 0, 0],
          visible: true,
        },
      };
      const project = validateLibrary(library(action)),
        bytes = await service.read(id),
        encoded = await encodeProject(await service.embed(project)),
        saved = await decodeProject(encoded);
      expect(Buffer.from(saved.characterAssets[id], 'base64')).toEqual(Buffer.from(bytes));
      expect(await service.restore(saved)).toEqual(project);
      const writes: string[] = [],
        portable = await readProjectDocument(encoded, async (asset) => {
          writes.push(asset);
        });
      expect(portable.clips[0].project.props).toEqual(action.props);
      expect(writes).toEqual([]);
      await expect(fs.stat(cache)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await service.read(id)).toEqual(bytes);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

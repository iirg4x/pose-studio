import { describe, it, expect, vi } from 'vitest';
import { encodeProject } from '../shared/project-codec.mjs';
import { blankProject } from '../src/core/assets';
import { library, validateLibrary } from '../src/core/library';
import { CONTROL_IDS } from '../src/core/controls';
import { readProjectDocument, consumeProjectDocument } from '../src/platform/projectDocuments';

describe('prepared project documents', () => {
  it('opens fresh file bytes without a second copy, then discards the validation receipt', async () => {
    const original = library(blankProject()),
      document = await readProjectDocument(await encodeProject(original), vi.fn());
    const tracks = document.clips[0].project.tracks;
    expect(consumeProjectDocument(document)).toBe(document);
    expect(document.clips[0].project.tracks).toBe(tracks);
    expect(tracks).not.toBe(original.clips[0].project.tracks);
    tracks.root.keys[0].q = [0, 0, 0, 0];
    expect(() => consumeProjectDocument(document)).toThrow('Invalid pose');
  });
  it('validates ordinary in-memory snapshots with an independent copy', () => {
    const original = library(blankProject()),
      document = consumeProjectDocument(original);
    document.clips[0].project.tracks.root.keys[0].p[0] = 5;
    expect(original.clips[0].project.tracks.root.keys[0].p[0]).toBe(0);
    const owned = validateLibrary(original, { takeOwnership: true });
    expect(owned.clips[0].project.tracks).toBe(original.clips[0].project.tracks);
  });
  it('rejects invalid animation data before writing embedded assets', async () => {
    const original = library(blankProject()),
      write = vi.fn();
    original.clips[0].project.tracks.root.keys[0].q = [0, 0, 0, 0];
    await expect(readProjectDocument(await encodeProject(original), write)).rejects.toThrow(
      'Invalid pose',
    );
    expect(write).not.toHaveBeenCalled();
  });
  it('does not register controls when embedded asset restore fails', async () => {
    const original = library(blankProject()),
      id = 'prop:restore-failure';
    original.clips[0].project.props = {
      [id]: {
        name: 'Embedded prop',
        asset: 'builtin-rifle',
        scale: 1,
        rotation: [0, 0, 0],
        offset: [0, 0, 0],
        visible: true,
      },
    };
    (original as unknown as { characterAssets: Record<string, string> }).characterAssets = {
      'builtin-rifle': 'AA',
    };
    const beforeControls = [...CONTROL_IDS];
    await expect(readProjectDocument(await encodeProject(original), vi.fn())).rejects.toThrow();
    expect([...CONTROL_IDS]).toEqual(beforeControls);
    expect(CONTROL_IDS).not.toContain(id);
  });
});

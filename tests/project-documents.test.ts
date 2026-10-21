import { describe, it, expect, vi } from 'vitest';
import { encodeProject } from '../shared/project-codec.mjs';
import { blankProject } from '../src/core/assets';
import { entry, library, validateLibrary } from '../src/core/library';
import { CONTROL_IDS } from '../src/core/controls';
import { createFirstPersonAction } from '../src/core/model';
import {
  consumeProjectDocument,
  consumeProjectRecoverySource,
  discardProjectRecoveryRecords,
  readProjectDocument,
} from '../src/platform/projectDocuments';

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
  it('retains the original compressed Blob and eligible clip IDs for one recovery pass', async () => {
    const original = library(blankProject()),
      blob = new Blob([await encodeProject(original)]),
      document = await readProjectDocument(blob, vi.fn(), undefined, true);
    expect(consumeProjectDocument(document)).toBe(document);
    const source = consumeProjectRecoverySource(document);
    expect(source?.bytes).toBe(blob);
    expect([...source!.clipIds]).toEqual([document.clips[0].id]);
    expect(consumeProjectRecoverySource(document)).toBeUndefined();
  });
  it('retains owned compressed bytes for byte-array callers', async () => {
    const bytes = await encodeProject(library(blankProject())),
      document = await readProjectDocument(bytes, vi.fn(), undefined, true);
    expect(consumeProjectDocument(document)).toBe(document);
    expect(consumeProjectRecoverySource(document)?.bytes).toBe(bytes);
  });
  it('does not retain source bytes when recovery capture is disabled', async () => {
    const document = await readProjectDocument(
      await encodeProject(library(blankProject())),
      vi.fn(),
    );
    expect(consumeProjectRecoverySource(document)).toBeUndefined();
  });
  it('keeps body-base clips on canonical recovery while retaining safe clips', async () => {
    const original = library(blankProject()),
      bodyClip = entry(createFirstPersonAction(original.clips[0].project, original.clips[0].id));
    original.clips.push(bodyClip);
    original.openIds.push(bodyClip.id);
    const bytes = await encodeProject(original),
      document = await readProjectDocument(bytes, vi.fn(), undefined, true),
      source = consumeProjectRecoverySource(document);
    expect(source).toBeDefined();
    expect(source!.clipIds.has(original.clips[0].id)).toBe(true);
    expect(source!.clipIds.has(bodyClip.id)).toBe(false);
  });
  it('invalidates an unconsumed source receipt when a prepared document is revalidated', async () => {
    const document = await readProjectDocument(
      await encodeProject(library(blankProject())),
      vi.fn(),
      undefined,
      true,
    );
    expect(consumeProjectDocument(document)).toBe(document);
    expect(consumeProjectDocument(document)).not.toBe(document);
    expect(consumeProjectRecoverySource(document)).toBeUndefined();
  });
  it('clears a source receipt when an open is cancelled', async () => {
    const document = await readProjectDocument(
      await encodeProject(library(blankProject())),
      vi.fn(),
      undefined,
      true,
    );
    await discardProjectRecoveryRecords(document);
    expect(consumeProjectRecoverySource(document)).toBeUndefined();
    document.clips[0].project.tracks.root.keys[0].q = [0, 0, 0, 0];
    expect(() => consumeProjectDocument(document)).toThrow('Invalid pose');
  });
  it('does not retain source bytes for legacy JSON documents', async () => {
    const document = await readProjectDocument(
      new TextEncoder().encode(JSON.stringify(library(blankProject()))),
      vi.fn(),
      undefined,
      true,
    );
    expect(consumeProjectRecoverySource(document)).toBeUndefined();
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

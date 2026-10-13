import { describe, it, expect } from 'vitest';
import { encodeProject, decodeProject } from '../shared/project-codec.mjs';
import { createProject, evaluate, matrix } from '../src/core/model';
import { addAnimationLayer } from '../src/core/layers';
import { library, validateLibrary } from '../src/core/library';

describe('compact layered project documents', () => {
  it('stores active tracks once and preserves unsynchronized layer edits', async () => {
    const p = addAnimationLayer(createProject({}, false), 'additive');
    p.tracks = structuredClone(p.tracks);
    p.tracks.rifle.keys[0].p[1] = 0.2;
    const bytes = await encodeProject(library(p)),
      text = await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
      ).text(),
      rows = text
        .trim()
        .split('\n')
        .map((s) => JSON.parse(s)),
      clip = rows.find((r) => r.kind === 'clip');
    expect(rows[0].version).toBe(2);
    expect(clip.reuseActiveLayerTracks).toBe(true);
    expect(clip.value.project.tracks).toBeUndefined();
    const data = validateLibrary(await decodeProject(bytes)),
      restored = data.clips[0].project;
    expect(restored.tracks).toBe(
      restored.layers!.find((l) => l.id === restored.activeLayerId)!.tracks,
    );
    for (const frame of [0, 12, 43])
      expect(matrix(evaluate(restored, frame).rifle).elements).toEqual(
        matrix(evaluate(p, frame).rifle).elements,
      );
  });
  it('continues reading legacy JSON and version-one documents', async () => {
    const data = library(createProject({}, false));
    expect(
      (await decodeProject(new TextEncoder().encode(JSON.stringify(data)))).clips,
    ).toHaveLength(1);
    const bytes = await encodeProject(data),
      text = await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
      ).text();
    expect(JSON.parse(text.split('\n')[0]).version).toBe(1);
    expect(validateLibrary(await decodeProject(bytes)).clips[0].project.name).toBe(
      data.clips[0].project.name,
    );
  });
  it('marks parent-linked native rotations as requiring a newer reader', async () => {
    const p = addAnimationLayer(createProject({}, false), 'additive');
    p.layers![1].nativeSpace = 'mesh';
    p.layers![1].nativeRotationLinks = { thumb_01_l: 'wrist_l' };
    const data = library(p),
      bytes = await encodeProject(data),
      text = await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
      ).text();
    expect(JSON.parse(text.split('\n')[0]).version).toBe(3);
    const restored = await decodeProject(bytes);
    expect(restored.clips[0].project.layers[1].nativeRotationLinks).toEqual({
      thumb_01_l: 'wrist_l',
    });
  });
});

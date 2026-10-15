import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { blankProject, projectProps, validateProps } from '../src/core/assets';
import { StudioStore } from '../src/core/store';
import { library, validateLibrary } from '../src/core/library';
import { evaluate, visibleControls, validateProject } from '../src/core/model';
import { rigLoader } from './rig-loader';
describe('standalone project assets', () => {
  it('starts with a blank action and no example props or attachments', () => {
    const p = blankProject();
    expect(projectProps(p)).toEqual({});
    expect(visibleControls('body', p)).not.toContain('rifle');
    expect(Object.values(p.tracks).every((t) => !t.spaces.length)).toBe(true);
  });
  it('adds named dynamic prop tracks, round trips, undoes and restores old actions', () => {
    const s = new StudioStore(),
      p = blankProject();
    s.patch({ project: p, workspace: library(p) });
    const id = s.addProp({
      name: 'Lantern',
      asset: 'a'.repeat(64),
      scale: 0.3,
      rotation: [0, 90, 0],
      offset: [0, -0.2, 0],
      visible: true,
    });
    expect(visibleControls('body', s.state.project)).toContain(id);
    expect(evaluate(s.state.project!, 0)[id].p).toEqual([0, 1, 0]);
    const saved = validateLibrary(s.snapshot());
    expect(saved.clips[0].project.props?.[id]?.name).toBe('Lantern');
    s.undo();
    expect(visibleControls('body', s.state.project)).not.toContain(id);
    expect(() => evaluate(s.state.project!, 0)).not.toThrow();
    s.redo();
    expect(s.state.project!.props?.[id]?.name).toBe('Lantern');
    expect(() => validateProject(p)).not.toThrow();
  });
  it('keeps weapon meshes as independent loadable assets', async () => {
    for (const name of ['axe', 'rifle', 'magazine', 'unreal-fp-gun']) {
      const bytes = await fs.readFile('public/assets/builtin-' + name + '.glb');
      const asset = await rigLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      );
      expect(asset.scene.children.length).toBeGreaterThan(0);
    }
  });
  it.each(['builtin-rifle', 'builtin-magazine', 'builtin-unreal-fp-gun'])(
    'preserves %s as a named prop through project save and validation',
    (asset) => {
      const s = new StudioStore(),
        p = blankProject();
      s.patch({ project: p, workspace: library(p) });
      const id = s.addProp({
        name: 'Weapon',
        asset,
        scale: 0.75,
        rotation: [0, 90, 0],
        offset: [0.1, -0.2, 0],
        visible: true,
      });
      const saved = validateLibrary(JSON.parse(JSON.stringify(s.snapshot())));
      expect(saved.clips[0].project.props?.[id]).toEqual(s.state.project!.props![id]);
      expect(visibleControls('body', saved.clips[0].project)).toContain(id);
      expect(() => validateProject(saved.clips[0].project)).not.toThrow();
    },
  );
  it('rejects unknown built-in prop IDs', () => {
    expect(() =>
      validateProps({
        rifle: {
          name: 'Unknown',
          asset: 'builtin-unknown',
          scale: 1,
          rotation: [0, 0, 0],
          offset: [0, 0, 0],
          visible: true,
        },
      }),
    ).toThrow('Invalid prop asset');
  });
});

it('retains body-only props with neutral adjustment tracks after refreshing the linked base', async () => {
  const { createBodyAction } = await import('../src/core/model'),
    { addAnimationLayer } = await import('../src/core/layers'),
    { entry } = await import('../src/core/library');
  const first = blankProject();
  first.actionType = 'firstPerson';
  first.editing = 'firstPerson';
  const w = library(first),
    body = createBodyAction(first, w.activeId);
  const clip = entry(addAnimationLayer(body, 'pose'));
  w.clips.push(clip);
  w.activeId = clip.id;
  w.openIds.push(clip.id);
  const s = new StudioStore();
  s.patch({ project: clip.project, workspace: w });
  const id = s.addProp({
    name: 'Lantern',
    asset: 'a'.repeat(64),
    scale: 1,
    rotation: [0, 0, 0],
    offset: [0, 0, 0],
    visible: true,
  });
  expect(s.state.project!.tracks[id].keys[0].p).toEqual([0, 0, 0]);
  expect(evaluate(s.state.project!, 0)[id].p).toEqual([0, 1, 0]);
  const saved = validateLibrary(s.snapshot());
  expect(saved.clips.find((c) => c.id === clip.id)!.project.props![id]!.name).toBe('Lantern');
  s.resetSelected('all');
  expect(() => evaluate(s.state.project!, 0)).not.toThrow();
});

it('restores inactive prop tracks even when the asset has been removed from every action', () => {
  const p = blankProject();
  const id = 'prop:orphan-on-restart' as const;
  p.tracks[id] = {
    keys: [{ p: [0, 1, 0], q: [0, 0, 0, 1], grip: [0, 0, 0, 0, 0], fov: 70, frame: 0 }],
    spaces: [],
    interpolation: 'smooth',
  };
  expect(() => validateLibrary(library(p))).not.toThrow();
  expect(visibleControls('body', p)).not.toContain(id);
});

it('keeps the current editor usable while a file with new prop IDs is awaiting open confirmation', () => {
  const current = blankProject();
  const incoming = blankProject();
  const id = 'prop:new-file-control' as const;
  incoming.props = {
    [id]: {
      name: 'Incoming',
      asset: 'c'.repeat(64),
      scale: 1,
      rotation: [0, 0, 0],
      offset: [0, 0, 0],
      visible: true,
    },
  };
  validateLibrary(library(incoming));
  expect(() => evaluate(current, 0)).not.toThrow();
  expect(evaluate(current, 0)[id].p).toEqual([0, 1, 0]);
});

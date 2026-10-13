import { describe, it, expect } from 'vitest';
import { geometryData } from '../src/scene/props';
import { rigLoader } from './rig-loader';
import { createProject, validateProject, controlLabels, visibleControls } from '../src/core/model';
import { StudioStore } from '../src/core/store';
import fs from 'node:fs/promises';
import { validateLibrary } from '../src/core/library';
describe('axe reference clips', () => {
  it('loads the axe as an independent example asset', async () => {
    const b = await fs.readFile('public/assets/builtin-axe.glb');
    const g = (
      await rigLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '')
    ).scene;
    const parts = geometryData(g) as { vertices: number[][]; indices: number[] }[];
    expect(parts).toHaveLength(1);
    expect(parts[0].vertices).toHaveLength(4842);
  });
  it('restores the axe preset and excludes the absent magazine from selection', () => {
    const p = createProject({}, false);
    p.propPreset = 'axe';
    expect(validateProject(p).propPreset).toBe('axe');
    expect(controlLabels(p).rifle).toBe('Axe');
    expect(visibleControls('firstPerson', p)).not.toContain('magazine');
    const store = new StudioStore();
    store.patch({ project: p });
    store.selectAll();
    expect(store.state.selection).not.toContain('magazine');
    expect(() => validateProject({ ...p, propPreset: 'invalid' })).toThrow();
  });
  it('loads both reference actions with independent rigs, IK hands, and a closed idle loop', async () => {
    const file = JSON.parse(await fs.readFile('tests/fixtures/axe-equip-idle.manny.json', 'utf8'));
    const lib = validateLibrary(file);
    expect(lib.clips.map((c) => c.project.end)).toEqual([20, 80]);
    expect(lib.openIds).toHaveLength(2);
    for (const clip of lib.clips) {
      expect(clip.project.propPreset).toBe('axe');
      expect(clip.project.fps).toBe(24);
      expect(clip.project.tracks).not.toBe(clip.project.otherTracks);
      expect(clip.project.limbModes?.firstPerson?.arm_r?.[0].mode).toBe('ik');
    }
    const idle = lib.clips[1].project;
    expect(idle.loop?.enabled).toBe(true);
    expect(idle.tracks.rifle.keys.at(-1)!.p).toEqual(idle.tracks.rifle.keys[0].p);
    expect(idle.tracks.rifle.keys.at(-1)!.q).toEqual(idle.tracks.rifle.keys[0].q);
  });
});

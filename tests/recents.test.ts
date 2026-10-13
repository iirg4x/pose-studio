import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const { createRecentProjects } = createRequire(import.meta.url)('../electron/recent-projects.cjs');
it('labels Pose and legacy Pose files without their extensions', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'pose-recents-test-')),
    recent = createRecentProjects(path.join(folder, 'recents.json'));
  for (const ext of ['.pose', '.pose.json', '.manny.json', '.json']) {
    await recent.record(path.join(folder, 'Example' + ext));
    expect((await recent.list())[0].name).toBe('Example');
  }
});
it('persists recent paths, deduplicates them, bounds the list and rejects unlisted opens', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'manny-recents-test-')),
    file = path.join(folder, 'recents.json'),
    recent = createRecentProjects(file);
  expect(await recent.list()).toEqual([]);
  for (let i = 0; i < 15; i++)
    await recent.record(path.join(folder, 'Project ' + i + '.manny.json'));
  expect(await recent.list()).toHaveLength(12);
  await recent.record(path.join(folder, 'Project 7.manny.json'));
  const rows = await createRecentProjects(file).list();
  expect(rows[0].name).toBe('Project 7');
  expect(rows.filter((r: any) => r.name === 'Project 7')).toHaveLength(1);
  await expect(recent.resolve(path.join(folder, 'unlisted.json'))).rejects.toThrow();
  expect(await recent.resolve(rows[0].path)).toBe(rows[0].path);
  await recent.clear();
  expect(await recent.list()).toEqual([]);
});

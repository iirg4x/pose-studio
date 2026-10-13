import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import path from 'node:path';
const {projectFilename,projectSavePath,projectArguments,createProjectQueue,associationEntries}=createRequire(import.meta.url)('../electron/project-files.cjs');
describe('Pose file integration',()=>{
 it('saves new and legacy projects with the dedicated extension',()=>{
  for(const name of ['My project','My project.pose','My project.pose.json','My project.manny.json','My project.json'])expect(projectFilename(name)).toBe('My project.pose');
  expect(projectFilename('My: project?')).toBe('My_ project_.pose');
  expect(projectSavePath(path.join('folder.json','My project.json'))).toBe(path.join('folder.json','My project.pose'));
 });
 it('opens file arguments with spaces and relative paths, skipping flags and Electron entry points',()=>{
  const cwd=path.resolve('projects');
  expect(projectArguments(['Pose.exe','My project.POSE','legacy.manny.json','--inspect=thing.json','model.fbx'],cwd)).toEqual([path.join(cwd,'My project.POSE'),path.join(cwd,'legacy.manny.json')]);
  expect(projectArguments(['electron.exe','package.json','file.pose'],cwd,false)).toEqual([path.join(cwd,'file.pose')]);
 });
 it('retains OS requests until the renderer is ready and processes multiple opens in order',()=>{
  const queue=createProjectQueue();queue.add('one.pose');queue.add('one.pose');queue.add('two.pose');
  expect(queue.take()).toBe('one.pose');expect(queue.take()).toBe('two.pose');expect(queue.take()).toBeUndefined();
 });
 it('associates only .pose for this user and quotes both executable and project paths',()=>{
  const rows=associationEntries('C:\\Pose Editor\\Pose.exe');
  expect(rows.every(([key]:string[])=>key.startsWith('HKCU\\Software\\Classes\\'))).toBe(true);
  expect(rows[0]).toEqual(['HKCU\\Software\\Classes\\.pose','Pose.Project']);
  expect(rows.at(-1)[1]).toBe('"C:\\Pose Editor\\Pose.exe" "%1"');
  expect(rows.some(([key]:string[])=>key.includes('.json'))).toBe(false);
 });
});

import { expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { blankProject } from '../src/core/assets';
import { library } from '../src/core/library';
import { pose, putKey, sample, validateProject } from '../src/core/model';
import type { Q4 } from '../src/core/model';
import { StudioStore } from '../src/core/store';

const turn = (angle: number) =>
  new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle).toArray() as Q4;

it('resets a control to the rest pose of the skeleton its clip came from', () => {
  const project = blankProject();
  // The imported skeleton rests with its head turned; the clip then turns it further.
  project.referencePose = { head: pose([0, 0, 0], turn(0.4), [0, 0, 0, 0, 0]) };
  putKey(project.tracks.head, 0, pose([0, 0, 0], turn(1.1), [0, 0, 0, 0, 0]));
  const studio = new StudioStore();
  studio.openValidated(library(validateProject(project)));
  studio.selectControl('head');
  studio.resetSelected('all');
  const head = sample(studio.state.project!.tracks.head, 0);
  expect(new Quaternion(...head.q).angleTo(new Quaternion(...turn(0.4)))).toBeLessThan(1e-6);

  // A control the reference does not mention still goes back to zero.
  putKey(studio.state.project!.tracks.chest, 0, pose([0, 0, 0], turn(0.7), [0, 0, 0, 0, 0]));
  studio.selectControl('chest');
  studio.resetSelected('all');
  const chest = sample(studio.state.project!.tracks.chest, 0);
  expect(new Quaternion(...chest.q).angleTo(new Quaternion())).toBeLessThan(1e-6);
});

it('rejects a malformed reference pose', () => {
  const project = blankProject();
  expect(() =>
    validateProject({ ...project, referencePose: { head: { p: [0, 0, 0], q: [0, 0, 0, 0] } } }),
  ).toThrow('Invalid reference pose');
  expect(() => validateProject({ ...project, referencePose: { nothing: pose() } })).toThrow(
    'Invalid reference pose',
  );
});

import { expect, it } from 'vitest';
import { blankProject } from '../src/core/assets';
import { library } from '../src/core/library';
import { StudioStore } from '../src/core/store';

it('copies the whole pose when the selected control is switched off', () => {
  const studio = new StudioStore();
  // Like an imported clip: every limb is FK and the clip opens on an IK hand.
  studio.openValidated(library(blankProject()));
  expect(studio.state.selected).toBe('hand_l');
  expect(studio.selectedControls()).toEqual([]);
  studio.copySelectedPose();
  expect(studio.state.clipboard?.scope).toBe('rig');
  expect(Object.keys(studio.state.clipboard!.poses).length).toBeGreaterThan(10);
});

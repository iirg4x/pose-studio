import { CurveStore } from './store/curves';
export type { StudioState } from './store/core';

/**
 * The editor's single state container. Each file in ./store adds one job on top of
 * the previous: core, selection, workspace, layers, posing, keyframes, curves.
 */
export class StudioStore extends CurveStore {}
export const studio = new StudioStore();

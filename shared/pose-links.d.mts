import type { AnimationLibrary } from '../src/core/library';
import type { Project } from '../src/core/model';
export function inferPoseLinks<T extends AnimationLibrary>(data: T): T;
export function poseDependencies(project: Project): string[];

import { describe, it, expect } from 'vitest';
import { copyPose } from '../src/core/poseCopy';
import type { Key } from '../src/core/model';

describe('copyPose', () => {
  it('copies values like structuredClone and shares nothing mutable', () => {
    const key: Key = {
      frame: 4,
      p: [1, 2, 3],
      q: [0, 0, 0, 1],
      grip: [0.1, 0.2, 0.3, 0.4, 0.5],
      fov: 70,
      interpolation: 'spring',
      spring: { oscillations: 2, damping: 5, strength: 1 },
      layerPosition: true,
    };
    const copy = copyPose(key);
    expect(copy).toEqual(structuredClone(key));
    copy.p[0] = 9;
    copy.q[3] = 0;
    copy.grip[0] = 9;
    copy.spring!.damping = 0;
    expect(key.p[0]).toBe(1);
    expect(key.q[3]).toBe(1);
    expect(key.grip[0]).toBe(0.1);
    expect(key.spring!.damping).toBe(5);
  });
});

import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { rigLoader } from './rig-loader';
import { MannyRig } from '../src/scene/rig';
import { createProject, evaluate, forLayer, pose, putKey } from '../src/core/model';
import { BONE_CONTROLS, CONTROLS } from '../src/core/controls';

let rig: MannyRig;
beforeAll(async () => {
  const bytes = await fs.readFile('public/assets/manny.glb');
  rig = new MannyRig(
    (
      await rigLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      )
    ).scene,
  );
});

describe('rig world matrices', () => {
  it('leaves every bone consistent with its parent after posing the body', () => {
    const p = forLayer(createProject(rig.restControls, false), 'body');
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (const id of BONE_CONTROLS)
      if (CONTROLS[id].group === 'Body' || id.startsWith('shoulder'))
        putKey(
          p.tracks[id],
          0,
          pose(
            [rand() * 0.02, rand() * 0.02, rand() * 0.02],
            new Quaternion()
              .setFromAxisAngle(new Vector3(rand(), rand(), rand()).normalize(), rand() * 0.6)
              .toArray(),
          ),
        );
    rig.apply(evaluate(p, 0));
    let worst = 0;
    rig.root.traverse((b) => {
      if (!b.parent) return;
      b.updateMatrix();
      const expected = new Matrix4().multiplyMatrices(b.parent.matrixWorld, b.matrix);
      expected.elements.forEach(
        (v, i) => (worst = Math.max(worst, Math.abs(v - b.matrixWorld.elements[i]))),
      );
    });
    expect(worst).toBeLessThan(1e-6);
  });
});

import { describe, expect, it } from 'vitest';
import {
  addRecoveryGeneration,
  documentRecoveryId,
  emptyRecoveryManifest,
  MAX_RECOVERY_GENERATIONS,
  MAX_RECOVERY_SESSIONS,
  normalizeRecoveryManifest,
  orderedRecoveryGenerations,
  referencedRecoveryClips,
} from '../src/platform/recoveryGenerations';
import type { RecoveryGeneration } from '../src/platform/recoveryGenerations';
import type { AnimationLibrary } from '../src/core/library';
import type { AnimationEntry } from '../src/core/library';

const metadata = {
  version: 3,
  rig: 'ue5-manny-simple',
  name: 'Recovery test',
  activeId: 'clip',
  openIds: ['clip'],
  poses: [],
} as Omit<AnimationLibrary, 'clips'>;

function generation(sessionId: string, sequence: number): RecoveryGeneration {
  return {
    id: `${sessionId}-${sequence}`,
    sessionId,
    documentId: `${sessionId}-document`,
    createdAt: sequence,
    metadata,
    clips: [{ id: 'clip', key: `${sessionId}:${sequence}:clip` }],
  };
}

describe('recovery generations', () => {
  it('keeps bounded independent histories for concurrent sessions', () => {
    let manifest = emptyRecoveryManifest();
    for (let session = 0; session < MAX_RECOVERY_SESSIONS + 2; session++)
      for (let revision = 1; revision < MAX_RECOVERY_GENERATIONS + 3; revision++)
        manifest = addRecoveryGeneration(
          manifest,
          generation(`session-${session}`, session * 10 + revision),
        );

    expect(manifest.sessions).toHaveLength(MAX_RECOVERY_SESSIONS);
    expect(manifest.sessions[0].id).toBe(`session-${MAX_RECOVERY_SESSIONS + 1}`);
    expect(manifest.sessions[0].generations).toHaveLength(MAX_RECOVERY_GENERATIONS);
    expect(manifest.sessions[0].generations.map((item) => item.createdAt)).toEqual([
      96, 95, 94, 93,
    ]);
    expect(referencedRecoveryClips(manifest).size).toBe(
      MAX_RECOVERY_SESSIONS * MAX_RECOVERY_GENERATIONS,
    );
  });

  it('prefers the current tab history without merging another tab into it', () => {
    let manifest = addRecoveryGeneration(undefined, generation('tab-a', 1));
    manifest = addRecoveryGeneration(manifest, generation('tab-b', 2));
    manifest = addRecoveryGeneration(manifest, generation('tab-a', 3));

    expect(orderedRecoveryGenerations(manifest, 'tab-b').map((item) => item.id)).toEqual([
      'tab-b-2',
      'tab-a-3',
      'tab-a-1',
    ]);
  });

  it('keeps document identity when the first animation is deleted', () => {
    const previous = {
      ...generation('tab-a', 1),
      documentId: 'stable-document',
      clips: [
        { id: 'deleted-first', key: 'old:first' },
        { id: 'remaining', key: 'old:remaining' },
      ],
    };
    expect(
      documentRecoveryId([{ id: 'remaining' } as AnimationEntry], previous, 'new-document'),
    ).toBe('stable-document');
    expect(
      documentRecoveryId([{ id: 'unrelated' } as AnimationEntry], previous, 'new-document'),
    ).toBe('new-document');
  });

  it('drops malformed manifests and malformed generation records', () => {
    expect(normalizeRecoveryManifest({ format: 1, sessions: [] })).toEqual(emptyRecoveryManifest());
    expect(
      normalizeRecoveryManifest({
        format: 2,
        sessions: [
          {
            id: 'broken',
            updatedAt: 1,
            generations: [{ ...generation('broken', 1), clips: [{ id: 'clip' }] }],
          },
        ],
      }),
    ).toEqual(emptyRecoveryManifest());
  });
});

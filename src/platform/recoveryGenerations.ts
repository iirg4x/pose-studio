import type { AnimationEntry, AnimationLibrary } from '../core/library';

const RECOVERY_FORMAT = 2;
export const MAX_RECOVERY_SESSIONS = 8;
export const MAX_RECOVERY_GENERATIONS = 4;

export interface RecoveryClipReference {
  id: string;
  key: string;
}

export interface RecoveryGeneration {
  id: string;
  sessionId: string;
  documentId: string;
  createdAt: number;
  metadata: Omit<AnimationLibrary, 'clips'>;
  clips: RecoveryClipReference[];
}

interface RecoverySession {
  id: string;
  updatedAt: number;
  generations: RecoveryGeneration[];
}

export interface RecoveryManifest {
  format: typeof RECOVERY_FORMAT;
  sessions: RecoverySession[];
}

export const emptyRecoveryManifest = (): RecoveryManifest => ({
  format: RECOVERY_FORMAT,
  sessions: [],
});

export function normalizeRecoveryManifest(value: unknown): RecoveryManifest {
  if (!value || typeof value !== 'object') return emptyRecoveryManifest();
  const raw = value as Partial<RecoveryManifest>;
  if (raw.format !== RECOVERY_FORMAT || !Array.isArray(raw.sessions))
    return emptyRecoveryManifest();
  const sessions = raw.sessions
    .filter(
      (session): session is RecoverySession =>
        !!session &&
        typeof session.id === 'string' &&
        Number.isFinite(session.updatedAt) &&
        Array.isArray(session.generations),
    )
    .map((session) => ({
      ...session,
      generations: session.generations.filter(
        (generation) =>
          !!generation &&
          typeof generation.id === 'string' &&
          generation.sessionId === session.id &&
          typeof generation.documentId === 'string' &&
          Number.isFinite(generation.createdAt) &&
          !!generation.metadata &&
          typeof generation.metadata === 'object' &&
          Array.isArray(generation.clips) &&
          generation.clips.every(
            (clip) =>
              !!clip &&
              typeof clip.id === 'string' &&
              typeof clip.key === 'string' &&
              clip.key.length > 0,
          ),
      ),
    }))
    .filter((session) => session.generations.length > 0);
  return { format: RECOVERY_FORMAT, sessions };
}

export function addRecoveryGeneration(
  value: unknown,
  generation: RecoveryGeneration,
): RecoveryManifest {
  const manifest = normalizeRecoveryManifest(value);
  const existing = manifest.sessions.find((session) => session.id === generation.sessionId);
  const session: RecoverySession = {
    id: generation.sessionId,
    updatedAt: generation.createdAt,
    generations: [
      generation,
      ...(existing?.generations ?? []).filter((item) => item.id !== generation.id),
    ].slice(0, MAX_RECOVERY_GENERATIONS),
  };
  return {
    format: RECOVERY_FORMAT,
    sessions: [session, ...manifest.sessions.filter((item) => item.id !== generation.sessionId)]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_RECOVERY_SESSIONS),
  };
}

export function orderedRecoveryGenerations(value: unknown, sessionId: string) {
  const sessions = normalizeRecoveryManifest(value).sessions;
  return [
    ...sessions.filter((session) => session.id === sessionId),
    ...sessions.filter((session) => session.id !== sessionId),
  ].flatMap((session) => [...session.generations].sort((a, b) => b.createdAt - a.createdAt));
}

export function referencedRecoveryClips(manifest: RecoveryManifest) {
  return new Set(
    manifest.sessions.flatMap((session) =>
      session.generations.flatMap((generation) => generation.clips.map((clip) => clip.key)),
    ),
  );
}

export function documentRecoveryId(
  clips: AnimationEntry[],
  previous: RecoveryGeneration | undefined,
  freshId: string,
) {
  if (previous) {
    const previousIds = new Set(previous.clips.map((clip) => clip.id));
    if (clips.some((clip) => previousIds.has(clip.id))) return previous.documentId;
  }
  return freshId;
}

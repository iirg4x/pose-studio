import type { Project } from './model';
import type { AnimationLibrary } from './library';

/** The serialized project shape used by the current signature. */
type SignatureProject = Omit<Project, 'activeLayerId' | 'bodyBase' | 'tracks' | 'otherTracks'> & {
  activeLayerId?: Project['activeLayerId'];
  bodyBase?: Omit<NonNullable<Project['bodyBase']>, 'source'> & {
    source?: SignatureProject;
  };
  otherTracks?: Project['otherTracks'];
  tracks?: Project['tracks'];
};

/**
 * Build the editable project payload used by the v3 save signature.
 *
 * Keep this implementation intact so a baseline written by an older build
 * can still be compared byte-for-byte. In particular, v3 retained the
 * layered project's active tracks both in the layer and at the top level.
 */
function legacyContent(project: Project): Project {
  const p = { ...project };
  if (project.layers) {
    p.layers = project.layers.map((l) =>
      l.id === project.activeLayerId ? { ...l, tracks: project.tracks } : l,
    );
    const base = p.layers[0];
    if (base.poseLinks?.length) {
      const linked = new Set(
        base.poseLinks.flatMap((link) => link.controls ?? Object.keys(base.tracks)),
      );
      p.layers[0] = {
        ...base,
        tracks: Object.fromEntries(
          Object.entries(base.tracks).filter(([id]) => !linked.has(id)),
        ) as Project['tracks'],
      };
    }
    p.tracks = p.layers[0].tracks;
    delete p.activeLayerId;
  }
  if (p.bodyBase) p.bodyBase = { ...p.bodyBase, source: legacyContent(p.bodyBase.source) };
  return p;
}

/**
 * Build the editable project payload used by the current save signature.
 *
 * A layered project has one canonical copy of the active layer tracks. The
 * top-level `tracks` field is a compatibility alias maintained by the live
 * model, so retaining it in a save signature serializes the same data twice.
 * Synchronize the active layer and apply the same linked-base filtering as v3,
 * then omit that alias from the signature payload.
 */
type SignatureContext = ReadonlyMap<string, Project>;

function content(project: Project, context: SignatureContext): SignatureProject {
  let p: SignatureProject;
  if (project.layers) {
    // Keep the canonical payload as plain fast properties. Deleting an early
    // field from a spread object can force the whole JSON subtree onto the
    // serializer's slower dictionary-property path.
    const { tracks: _tracks, activeLayerId: _activeLayerId, ...editable } = project;
    p = editable;
    p.layers = project.layers.map((l) =>
      l.id === project.activeLayerId ? { ...l, tracks: project.tracks } : l,
    );
    const base = p.layers[0];
    if (base.poseLinks?.length) {
      const linked = new Set(
        base.poseLinks.flatMap((link) => link.controls ?? Object.keys(base.tracks)),
      );
      p.layers[0] = {
        ...base,
        tracks: Object.fromEntries(
          Object.entries(base.tracks).filter(([id]) => !linked.has(id)),
        ) as Project['tracks'],
      };
    }
  } else p = { ...project };
  const source = project.bodyBase && context.get(project.bodyBase.sourceId);
  const resolvedSource = !!source && source.editing !== project.editing;
  if (resolvedSource) {
    const { otherTracks: _otherTracks, ...editable } = p;
    p = editable;
    if (p.bodyBase) {
      const { source: _source, ...settings } = p.bodyBase;
      p.bodyBase = settings;
    }
  } else if (project.bodyBase) {
    p.bodyBase = {
      ...project.bodyBase,
      source: content(project.bodyBase.source, context),
    };
  }
  return p;
}
// Hash one clip at a time: a large library must not allocate another complete JSON copy.
function digest(text: string) {
  let a = 0x811c9dc5,
    b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822519);
  }
  return (a >>> 0).toString(16) + ':' + (b >>> 0).toString(16) + ':' + text.length;
}
// Playback, selection, tabs and active-layer changes are view state, not edits.
const legacyPrefix = 'pose-save-v3:';
const prefix = 'pose-save-v4:';
type Content = (project: Project, context: SignatureContext) => unknown;
function signatureParts(data: AnimationLibrary, projectContent: Content) {
  const context: SignatureContext = new Map(data.clips.map((clip) => [clip.id, clip.project]));
  const clips = data.clips
    .map(
      (c) =>
        [
          c.id,
          digest(
            JSON.stringify({
              id: c.id,
              folder: c.folder,
              previewId: c.previewId,
              previewSync: c.previewSync,
              project: projectContent(c.project, context),
              drafts: c.drafts,
              ...(Object.keys(c.drafts).length ? { draftFrame: c.frame } : {}),
            }),
          ),
        ] as [string, string],
    )
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    meta: digest(
      JSON.stringify({
        version: data.version,
        rig: data.rig,
        name: data.name,
        poses: data.poses,
        characters: data.characters,
      }),
    ),
    clips,
  };
}

function signature(data: AnimationLibrary, signaturePrefix: string, projectContent: Content) {
  return signaturePrefix + JSON.stringify(signatureParts(data, projectContent));
}

/** The exact signature algorithm used before layered aliases were removed. */
export function projectSaveSignatureV3(data: AnimationLibrary): string {
  return signature(data, legacyPrefix, legacyContent);
}

export function projectSaveSignature(data: AnimationLibrary): string {
  return signature(data, prefix, content);
}

function abortError() {
  const error = Error('Project signature computation was cancelled.');
  error.name = 'AbortError';
  return error;
}

function yieldToEventLoop() {
  return new Promise<void>((resolve) => {
    if (typeof MessageChannel === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    // Nested timers are clamped in browsers. A task message yields without
    // adding that delay hundreds of times to a large library signature.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * Compute the current v4 signature while yielding between batches of clips.
 *
 * Opening a large project should be able to paint and finish other startup
 * work while this CPU-heavy comparison runs. The sync function remains the
 * public path for quick dirty checks and saves; this variant has the same
 * result and never mutates the source library.
 */
async function signatureAsync(
  data: AnimationLibrary,
  signaturePrefix: string,
  projectContent: Content,
  shouldCancel?: () => boolean,
): Promise<string> {
  const clips: [string, string][] = [];
  const context: SignatureContext = new Map(data.clips.map((clip) => [clip.id, clip.project]));
  let batchStarted = Date.now();
  for (const c of data.clips) {
    if (shouldCancel?.()) throw abortError();
    clips.push([
      c.id,
      digest(
        JSON.stringify({
          id: c.id,
          folder: c.folder,
          previewId: c.previewId,
          previewSync: c.previewSync,
          project: projectContent(c.project, context),
          drafts: c.drafts,
          ...(Object.keys(c.drafts).length ? { draftFrame: c.frame } : {}),
        }),
      ),
    ]);
    if (Date.now() - batchStarted >= 8) {
      if (shouldCancel?.()) throw abortError();
      await yieldToEventLoop();
      batchStarted = Date.now();
      if (shouldCancel?.()) throw abortError();
    }
  }
  if (shouldCancel?.()) throw abortError();
  clips.sort(([a], [b]) => a.localeCompare(b));
  const parts = {
    meta: digest(
      JSON.stringify({
        version: data.version,
        rig: data.rig,
        name: data.name,
        poses: data.poses,
        characters: data.characters,
      }),
    ),
    clips,
  };
  return signaturePrefix + JSON.stringify(parts);
}

export function projectSaveSignatureAsync(data: AnimationLibrary, shouldCancel?: () => boolean) {
  return signatureAsync(data, prefix, content, shouldCancel);
}

/** Yielding dirty comparison, including exact baselines from older builds. */
export async function projectMatchesSaveSignatureAsync(
  data: AnimationLibrary,
  baseline: string | null | undefined,
  shouldCancel?: () => boolean,
) {
  if (!baseline) return false;
  const legacy = baseline.startsWith(legacyPrefix);
  return (
    (await signatureAsync(
      data,
      legacy ? legacyPrefix : prefix,
      legacy ? legacyContent : content,
      shouldCancel,
    )) === baseline
  );
}

/**
 * Compare a live library against a persisted baseline without silently
 * upgrading legacy baselines. Recovery may still contain an old v3 value, so
 * it must be checked with the exact v3 payload until the next explicit save.
 */
export function projectMatchesSaveSignature(
  data: AnimationLibrary,
  baseline: string | null | undefined,
): boolean {
  if (!baseline) return false;
  return baseline.startsWith(legacyPrefix)
    ? projectSaveSignatureV3(data) === baseline
    : projectSaveSignature(data) === baseline;
}

import { decodeDocumentProject } from './projectDecoding';
import { validateLibrary } from '../core/library';
import type { AnimationLibrary } from '../core/library';
import { collectPropControlIds, commitPropControls } from '../core/controls';
import { restoreAssets } from './portableAssets';
import type { AssetBatchWriter } from './portableAssets';
import type { ProjectRecoverySource } from './recoveryRecords';

// Only fresh file bytes can create a prepared document. The opening UI consumes
// the receipt once; subsequent uses validate normally rather than trusting a
// potentially edited object. No in-memory editing snapshot transfers ownership.
const prepared = new WeakSet<object>();
const recoverySources = new WeakMap<AnimationLibrary, ProjectRecoverySource>();

interface TrackInventory {
  tracks: ReadonlySet<string>;
  otherTracks: ReadonlySet<string>;
  layers: ReadonlyMap<string, ReadonlySet<string>>;
  bodyBase: boolean;
}

function trackIds(value: unknown): ReadonlySet<string> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? new Set(Object.keys(value))
    : new Set();
}

function captureTrackInventory(project: unknown): TrackInventory {
  if (!project || typeof project !== 'object')
    return { tracks: new Set(), otherTracks: new Set(), layers: new Map(), bodyBase: false };
  const raw = project as {
    tracks?: unknown;
    otherTracks?: unknown;
    bodyBase?: unknown;
    layers?: unknown;
  };
  const layers = new Map<string, ReadonlySet<string>>();
  if (Array.isArray(raw.layers))
    for (const layer of raw.layers) {
      if (!layer || typeof layer !== 'object') continue;
      const value = layer as { id?: unknown; tracks?: unknown };
      if (typeof value.id === 'string') layers.set(value.id, trackIds(value.tracks));
    }
  return {
    tracks: trackIds(raw.tracks),
    otherTracks: trackIds(raw.otherTracks),
    layers,
    bodyBase: !!raw.bodyBase,
  };
}

function hasNoAddedTrackIds(
  before: ReadonlySet<string>,
  after: unknown,
  allowedAdded: ReadonlySet<string>,
) {
  for (const id of trackIds(after)) if (!before.has(id) && !allowedAdded.has(id)) return false;
  return true;
}

/**
 * A raw clip can be replayed only when validation did not synthesize an
 * unrelated track. Prop controls are the one legitimate source of new track
 * IDs. Body-base clips carry copied source state, so they deliberately use
 * canonical recovery instead.
 */
function canReuseSourceRecord(
  inventory: TrackInventory,
  project: unknown,
  allowedAdded: ReadonlySet<string>,
) {
  if (!project || typeof project !== 'object') return false;
  const normalized = project as {
    tracks?: unknown;
    otherTracks?: unknown;
    bodyBase?: unknown;
    layers?: unknown;
  };
  if (inventory.bodyBase || normalized.bodyBase) return false;
  if (!hasNoAddedTrackIds(inventory.tracks, normalized.tracks, allowedAdded)) return false;
  if (!hasNoAddedTrackIds(inventory.otherTracks, normalized.otherTracks, allowedAdded))
    return false;
  if (!Array.isArray(normalized.layers)) return true;
  for (const layer of normalized.layers) {
    if (!layer || typeof layer !== 'object') return false;
    const value = layer as { id?: unknown; tracks?: unknown };
    if (typeof value.id !== 'string') return false;
    const before = inventory.layers.get(value.id);
    if (!before || !hasNoAddedTrackIds(before, value.tracks, allowedAdded)) return false;
  }
  return true;
}

async function isGzip(input: Uint8Array | Blob) {
  const header =
    input instanceof Blob ? new Uint8Array(await input.slice(0, 2).arrayBuffer()) : input;
  return header[0] === 0x1f && header[1] === 0x8b;
}

/**
 * Read a project and optionally retain its original compressed source for one
 * recovery write. Blob inputs stay native and Uint8Array inputs transfer their
 * existing ownership; neither path creates a second full source copy.
 */
export async function readProjectDocument(
  bytes: Uint8Array | Blob,
  writeAsset: (id: string, data: Uint8Array) => Promise<void>,
  writeAssets?: AssetBatchWriter,
  captureRecoverySource = false,
): Promise<AnimationLibrary> {
  const gzip = captureRecoverySource ? await isGzip(bytes) : false;
  const parsed = await decodeDocumentProject(bytes);
  const inventories = new Map<string, TrackInventory>();
  if (Array.isArray(parsed.clips))
    for (const clip of parsed.clips)
      if (clip && typeof clip.id === 'string')
        inventories.set(clip.id, captureTrackInventory(clip.project));

  const propControls = collectPropControlIds(parsed);
  const allowedAddedTrackIds = new Set(propControls);
  const library = validateLibrary(parsed, { takeOwnership: true, commitPropControls: false });
  const eligibleIds = new Set<string>();
  if (gzip)
    for (const clip of library.clips) {
      const inventory = inventories.get(clip.id);
      if (inventory && canReuseSourceRecord(inventory, clip.project, allowedAddedTrackIds))
        eligibleIds.add(clip.id);
    }

  await restoreAssets(parsed, writeAsset, writeAssets);
  commitPropControls(propControls);
  prepared.add(library);
  if (gzip && eligibleIds.size) recoverySources.set(library, { bytes, clipIds: eligibleIds });
  return library;
}

/** Consume the fresh source receipt exactly once. */
export function consumeProjectRecoverySource(
  data: AnimationLibrary,
): ProjectRecoverySource | undefined {
  const source = recoverySources.get(data);
  if (source) recoverySources.delete(data);
  return source;
}

/** Compatibility-shaped async cleanup for cancelled or superseded opens. */
export async function discardProjectRecoveryRecords(input: unknown): Promise<void> {
  if (input && typeof input === 'object') {
    recoverySources.delete(input as AnimationLibrary);
    prepared.delete(input);
  }
}

export function consumeProjectDocument(input: unknown): AnimationLibrary {
  if (input && typeof input === 'object' && prepared.delete(input))
    return input as AnimationLibrary;
  // A revalidated or otherwise stale object must never retain a receipt tied
  // to bytes that are no longer the accepted document representation.
  if (input && typeof input === 'object') recoverySources.delete(input as AnimationLibrary);
  return validateLibrary(input);
}

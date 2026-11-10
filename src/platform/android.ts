import { encodeProject } from '../../shared/project-codec.mjs';
import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { isAndroid, initializeStorage, readAsset, writeAsset, writeAssets } from './storage';
import {
  assetHash,
  assertGLBSize,
  builtInAsset,
  decode64,
  encode64,
  embedAssets,
  restoreAssets,
  validateGLB,
} from './portableAssets';
import type { AssetBatchWriter } from './portableAssets';
import {
  ANIMATION_EXTENSIONS,
  CHARACTER_EXTENSIONS,
  MAX_SOURCE_BYTES,
  PROP_EXTENSIONS,
} from './sourceFiles';
import { activateDocument, documentIdentity, rememberDocument } from './linkedDocuments';
import { validateLibrary } from '../core/library';
import type { AnimationLibrary } from '../core/library';
import { readProjectDocument } from './projectDocuments';
import { createZipExports } from './exportZip';
type Document = { id: string; name: string; uri: string; size: number };
type Destination = { id: string; path: string; uri: string };
interface Files {
  open(options?: { maxBytes?: number }): Promise<Document>;
  openUri(o: { uri: string }): Promise<Document>;
  takeProject(): Promise<Document>;
  read(o: { id: string; position: number }): Promise<{ data: string }>;
  create(o: { name: string; mime: string }): Promise<Destination>;
  write(o: { id: string; data: string; position: number }): Promise<void>;
  finish(o: { id: string }): Promise<{ path: string; uri: string }>;
  close(o: { id: string }): Promise<void>;
  exit(): Promise<void>;
  addListener(event: string, fn: () => void): Promise<PluginListenerHandle>;
}
const native = registerPlugin<Files>('PoseFiles');
const CHUNK = 512 * 1024;
const MAX_DOCUMENT_BYTES = 512 * 1024 * 1024;
const writeProjectAssets: AssetBatchWriter = (entries) =>
  writeAssets(entries.map(([id, data]) => [`asset:${id}`, data] as const));
function assertDocumentSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_DOCUMENT_BYTES)
    throw Error('Choose a document below 512 MB.');
}
async function bytes(doc: Document, checkSize: (size: number) => void = assertDocumentSize) {
  if (!doc?.id) return null;
  try {
    // Check bridge metadata before allocating the destination or requesting
    // the first base64 chunk. GLB callers pass the stricter shared 32 MiB cap.
    checkSize(doc.size);
    const data = new Uint8Array(doc.size);
    let position = 0;
    while (position < data.length) {
      const block = decode64((await native.read({ id: doc.id, position })).data);
      if (!block.length || position + block.length > data.length)
        throw Error('Incomplete document.');
      data.set(block, position);
      position += block.length;
    }
    return data;
  } finally {
    await native.close({ id: doc.id });
  }
}
async function write(id: string, data: Uint8Array, position = 0) {
  for (let i = 0; i < data.length; i += CHUNK)
    await native.write({ id, data: encode64(data.subarray(i, i + CHUNK)), position: position + i });
}
async function saveAndroidFile(data: Uint8Array, name: string, mime = 'application/octet-stream') {
  const file = await native.create({ name: name.replace(/[\\/:*?"<>|]/g, '_'), mime });
  if (!file?.id) return null;
  try {
    await write(file.id, data);
    return (await native.finish({ id: file.id })).path;
  } finally {
    await native.close({ id: file.id });
  }
}
async function readCharacter(id: string) {
  if (builtInAsset(id)) {
    const r = await fetch(new URL('assets/' + id + '.glb', document.baseURI));
    if (!r.ok) throw Error('Bundled asset missing.');
    return validateGLB(new Uint8Array(await r.arrayBuffer()));
  }
  if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid asset ID.');
  const data = await readAsset('asset:' + id);
  if (!(data instanceof Uint8Array))
    throw Error('Asset missing. Open a saved .pose project containing this model.');
  return validateGLB(data);
}
/** Let the user choose a source file. The system picker cannot filter by extension, so check here. */
async function pickSource(extensions: string[]) {
  const doc = await native.open({ maxBytes: MAX_SOURCE_BYTES });
  if (!doc?.id) return null;
  const type = doc.name.slice(doc.name.lastIndexOf('.') + 1).toLowerCase();
  if (!extensions.includes(type)) {
    await native.close({ id: doc.id });
    throw Error('Choose one of: ' + extensions.map((e) => '.' + e).join(', ') + '.');
  }
  const data = await bytes(doc, (size) => {
    if (type === 'glb') assertGLBSize(size);
    else if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SOURCE_BYTES)
      throw Error('Choose a file below 256 MB.');
  });
  return data ? { name: doc.name, data } : null;
}
async function storeModel(bytes: Uint8Array) {
  const data = validateGLB(bytes),
    asset = await assetHash(data);
  await writeAsset('asset:' + asset, data);
  return asset;
}
const recentKey = 'pose-android-recent';
function recent(): { path: string; name: string; openedAt: string }[] {
  try {
    return JSON.parse(localStorage.getItem(recentKey) ?? '[]');
  } catch {
    return [];
  }
}
async function project(doc: Document, knownHashes: string[] = []) {
  const data = await bytes(doc);
  if (!data) return null;
  const hash = await assetHash(data);
  if (knownHashes.includes(hash)) return null;
  const parsed = await readProjectDocument(
    data,
    (id, value) => writeAsset('asset:' + id, value),
    writeProjectAssets,
  );
  rememberDocument(parsed, {
    uri: doc.uri,
    name: doc.name,
    hash,
    identity: documentIdentity(parsed),
  });
  try {
    localStorage.setItem(
      recentKey,
      JSON.stringify(
        [
          { path: doc.uri, name: doc.name, openedAt: new Date().toISOString() },
          ...recent().filter((r) => r.path !== doc.uri),
        ].slice(0, 12),
      ),
    );
  } catch {}
  return parsed;
}
export async function checkLinkedProject(uri: string, knownHashes: string[]) {
  return project(await native.openUri({ uri }), knownHashes);
}
async function saveProject(p: unknown) {
  const data = await encodeProject(await embedAssets(p, readCharacter)),
    file = await native.create({
      name: ((p as { name?: string }).name ?? 'Project').replace(/[\\/:*?"<>|]/g, '_') + '.pose',
      mime: 'application/octet-stream',
    });
  if (!file?.id) return null;
  try {
    await write(file.id, data);
    const result = await native.finish({ id: file.id });
    const snapshot = p as AnimationLibrary;
    activateDocument({
      uri: result.uri,
      name: result.path,
      hash: await assetHash(data),
      identity: documentIdentity(snapshot.version === 3 ? snapshot : validateLibrary(p)),
    });
    return result.path;
  } finally {
    await native.close({ id: file.id });
  }
}
function listen(event: string, fn: () => void) {
  let removed = false,
    handle: PluginListenerHandle | undefined;
  void native.addListener(event, fn).then((h) => {
    handle = h;
    if (removed) void h.remove();
  });
  return () => {
    removed = true;
    void handle?.remove();
  };
}
export async function initializeAndroid() {
  await initializeStorage();
  if (!isAndroid) return;
  document.documentElement.classList.add('android');
  window.studioDesktop = {
    platform: 'android',
    pickAnimation: () => pickSource(ANIMATION_EXTENSIONS),
    pickModel: (kind) => pickSource(kind === 'prop' ? PROP_EXTENSIONS : CHARACTER_EXTENSIONS),
    readSidecar: async () => null,
    storeModel,
    readCharacter,
    openExample: async () => {
      const r = await fetch('examples/Axe%20studio.pose.json');
      if (!r.ok) throw Error('Example unavailable. Open your .pose project from Files.');
      return restoreAssets(
        await r.json(),
        (id, data) => writeAsset('asset:' + id, data),
        writeProjectAssets,
      );
    },
    saveProject,
    openProject: async () => project(await native.open()),
    takeProject: async () => project(await native.takeProject()),
    onProjectQueued: (fn) => listen('projectQueued', fn),
    recentProjects: async () => recent(),
    openRecentProject: async (uri) => project(await native.openUri({ uri })),
    clearRecentProjects: async () => {
      localStorage.removeItem(recentKey);
    },
    beginRecording: async (o) => {
      const r = await native.create({
        name: o.name + '.' + o.format,
        mime: o.format === 'mp4' ? 'video/mp4' : 'video/webm',
      });
      return r?.id ? r : null;
    },
    writeRecording: write,
    finishRecording: async (id) => (await native.finish({ id })).path,
    cancelRecording: async (id) => native.close({ id }),
    exportCharacter: async (data, o) =>
      saveAndroidFile(
        data,
        o.name + '.' + o.format,
        o.format === 'glb' ? 'model/gltf-binary' : 'application/octet-stream',
      ),
    revealRecording: async () => {},
    showFolder: async () => {},
    status: async () => ({ maximized: true }),
    confirmClose: () => native.exit(),
    onCloseRequest: (fn) => listen('closeRequest', fn),
    onWindowState: () => () => {},
    windowAction: () => {},
    ...createZipExports((data, name) => saveAndroidFile(data, name, 'application/zip')),
  };
}

import { encodeProject } from '../../shared/project-codec.mjs';
import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { isAndroid, initializeStorage, readAsset, writeAsset } from './storage';
import {
  assetHash,
  builtInAsset,
  decode64,
  encode64,
  embedAssets,
  restoreAssets,
  validateGLB,
} from './portableAssets';
import { activateDocument, documentIdentity, rememberDocument } from './linkedDocuments';
import { validateLibrary } from '../core/library';
import type { AnimationLibrary } from '../core/library';
import { readProjectDocument } from './projectDocuments';
type Document = { id: string; name: string; uri: string; size: number };
type Destination = { id: string; path: string; uri: string };
interface Files {
  open(): Promise<Document>;
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
async function bytes(doc: Document) {
  if (!doc?.id) return null;
  try {
    if (doc.size > 512 * 1024 * 1024) throw Error('Choose a document below 512 MB.');
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
async function importModel() {
  const doc = await native.open();
  const data = await bytes(doc);
  if (!data) return null;
  if (!/\.glb$/i.test(doc.name))
    throw Error(
      'Android imports self-contained GLB models. Convert FBX, OBJ or Blender models to GLB, or transfer them inside a desktop .pose project.',
    );
  validateGLB(data);
  const asset = await assetHash(data);
  await writeAsset('asset:' + asset, data);
  return { asset, name: doc.name.replace(/\.glb$/i, ''), data };
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
  const parsed = await readProjectDocument(data, (id, value) => writeAsset('asset:' + id, value));
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
const desktopOnly = async (): Promise<never> => {
  throw Error(
    'FBX / Unreal packaging requires desktop Pose. Save a .pose project to continue there. Android supports GLB and video export.',
  );
};
export async function initializeAndroid() {
  await initializeStorage();
  if (!isAndroid) return;
  document.documentElement.classList.add('android');
  const { AndroidAnimationImport } = await import('./androidAnimation');
  const animations = new AndroidAnimationImport(async () => {
    const doc = await native.open(),
      data = await bytes(doc);
    return data ? { name: doc.name, data } : null;
  });
  window.studioDesktop = {
    platform: 'android',
    importCharacter: importModel,
    importProp: importModel,
    readCharacter,
    inspectAnimation: () => animations.inspect(),
    sampleAnimation: (token, options) => animations.sample(token, options),
    openExample: async () => {
      const r = await fetch('examples/Axe%20studio.pose.json');
      if (!r.ok) throw Error('Example unavailable. Open your .pose project from Files.');
      return restoreAssets(await r.json(), (id, data) => writeAsset('asset:' + id, data));
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
    exportCharacter: async (data, o) => {
      if (o.format !== 'glb') return desktopOnly();
      return saveAndroidFile(data, o.name + '.glb', 'model/gltf-binary');
    },
    revealRecording: async () => {},
    showFolder: async () => {},
    status: async () => ({ blender: null, maximized: true }),
    chooseBlender: desktopOnly,
    confirmClose: () => native.exit(),
    onCloseRequest: (fn) => listen('closeRequest', fn),
    onWindowState: () => () => {},
    windowAction: () => {},
    beginSharedExport: desktopOnly,
    writeSharedExport: desktopOnly,
    finishSharedExport: desktopOnly,
    cancelSharedExport: desktopOnly,
    exportAnimation: desktopOnly,
  };
}

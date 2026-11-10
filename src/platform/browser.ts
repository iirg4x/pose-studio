import { initializePwa } from './pwa';
import { measureTouchViewport } from './touchViewport';
import { randomId } from '../core/crypto';
import { createZipExports } from './exportZip';
import { encodeProject } from '../../shared/project-codec.mjs';
import { readProjectDocument } from './projectDocuments';
import { readAsset, writeAsset, writeAssets, isTouch } from './storage';
import {
  assetHash,
  assertGLBSize,
  builtInAsset,
  embedAssets,
  restoreAssets,
  validateGLB,
} from './portableAssets';
import type { AssetBatchWriter } from './portableAssets';
import type { PickedFile } from './imports';
import {
  ANIMATION_EXTENSIONS,
  CHARACTER_EXTENSIONS,
  MAX_SOURCE_BYTES,
  PROP_EXTENSIONS,
} from './sourceFiles';
const noop = () => () => {};
const writeProjectAssets: AssetBatchWriter = (entries) =>
  writeAssets(entries.map(([id, data]) => [`asset:${id}`, data] as const));
function download(data: Uint8Array, name: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data.slice().buffer], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}
function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}
const pick = async (accept: string): Promise<File | null> => (await pickFiles(accept))[0] ?? null;
const IMAGES = ['png', 'jpg', 'jpeg', 'tga', 'bmp', 'psd', 'webp', 'gif', 'bin'];
const extensionOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
/**
 * Choose a model, optionally with its textures selected alongside it: a page
 * cannot look into the model's folder by itself.
 */
async function pickModelFiles(extensions: string[]) {
  const files = await pickFiles([...extensions, ...IMAGES].map((e) => '.' + e).join(','), true),
    main = files.find((f) => extensions.includes(extensionOf(f.name)));
  if (!main) {
    if (files.length) throw Error('Choose one of: ' + extensions.map((e) => '.' + e).join(', '));
    return null;
  }
  const others = files.filter((f) => f !== main);
  return {
    ...(await readSourceFile(main)),
    sidecar: async (wanted: string) => {
      const name = (wanted.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase(),
        png = name.replace(/\.[^.]+$/, '') + '.png';
      const file =
        others.find((f) => f.name.toLowerCase() === png) ??
        others.find((f) => f.name.toLowerCase() === name);
      return file && file.size <= 64 * 1024 * 1024
        ? new Uint8Array(await file.arrayBuffer())
        : null;
    },
  };
}
/** Read a user-selected GLB only after its metadata passes the shared limit. */
export async function readGLBFile(file: Pick<File, 'size' | 'arrayBuffer'>) {
  assertGLBSize(file.size);
  return new Uint8Array(await file.arrayBuffer());
}
/** Read a chosen source file; GLB keeps its stricter limit, other formats are converted first. */
async function readSourceFile(file: File): Promise<PickedFile> {
  if (/\.glb$/i.test(file.name)) return { name: file.name, data: await readGLBFile(file) };
  if (file.size > MAX_SOURCE_BYTES) throw Error('Choose a file below 256 MB.');
  return { name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
}
async function readCharacter(id: string) {
  if (!/^(?:[a-f0-9]{64}|builtin-[a-z-]+|example-fantasy-(?:male|female))$/.test(id))
    throw Error('Invalid model ID');
  const cached = await readAsset('asset:' + id);
  if (cached instanceof Uint8Array) return cached;
  const response = builtInAsset(id) ? await fetch('assets/' + id + '.glb') : null;
  if (!response?.ok) throw Error('Model unavailable. Reopen the project containing this asset.');
  const data = validateGLB(new Uint8Array(await response.arrayBuffer()));
  if (!builtInAsset(id) && (await assetHash(data)) !== id) throw Error('Model checksum mismatch');
  await writeAsset('asset:' + id, data);
  return data;
}
async function storeModel(bytes: Uint8Array) {
  const data = validateGLB(bytes),
    asset = await assetHash(data);
  await writeAsset('asset:' + asset, data);
  return asset;
}
/** Keep the touch layout inside the currently visible CSS viewport. */
function initializeTouchViewport() {
  const root = document.documentElement;
  if (root.dataset.touchViewportInitialized === 'true') return;
  root.dataset.touchViewportInitialized = 'true';

  let frame = 0;
  const measure = () => {
    frame = 0;
    const visualViewport = window.visualViewport;
    const viewport = measureTouchViewport({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      visualViewport,
    });
    root.style.setProperty('--touch-viewport-width', viewport.width + 'px');
    root.style.setProperty('--touch-viewport-height', viewport.height + 'px');
    root.style.setProperty('--touch-viewport-left', viewport.offsetLeft + 'px');
    root.style.setProperty('--touch-viewport-top', viewport.offsetTop + 'px');
  };
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(measure);
  };

  schedule();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  window.addEventListener('pageshow', schedule, { passive: true });
  window.addEventListener('focusin', schedule, { passive: true });
  window.addEventListener('focusout', schedule, { passive: true });
  window.visualViewport?.addEventListener('resize', schedule, { passive: true });
  window.visualViewport?.addEventListener('scroll', schedule, { passive: true });
}
export async function initializeBrowser() {
  if (window.studioDesktop) return;
  if (isTouch) {
    document.documentElement.classList.add('android');
    initializeTouchViewport();
  }
  document.documentElement.classList.add('web');
  void initializePwa();
  const choose = async (extensions: string[]) => {
    const file = await pick(extensions.map((e) => '.' + e).join(','));
    return file ? readSourceFile(file) : null;
  };
  const recordings = new Map<
    string,
    { name: string; chunks: { position: number; data: Uint8Array }[]; size: number }
  >();
  window.studioDesktop = {
    platform: 'web',
    readCharacter,
    pickAnimation: () => choose(ANIMATION_EXTENSIONS),
    pickModel: (kind) => pickModelFiles(kind === 'prop' ? PROP_EXTENSIONS : CHARACTER_EXTENSIONS),
    readSidecar: async () => null,
    storeModel,
    openExample: async () => {
      const r = await fetch('examples/Axe%20studio.pose.json');
      if (!r.ok) throw Error('Example unavailable');
      return restoreAssets(
        await r.json(),
        (id, data) => writeAsset('asset:' + id, data),
        writeProjectAssets,
      );
    },
    openProject: async (options) => {
      const file = await pick('.pose,.json,.manny');
      if (!file) return null;
      if (file.size > 512 * 1024 * 1024) throw Error('Choose a project below 512 MB');
      return readProjectDocument(
        new Uint8Array(await file.arrayBuffer()),
        (id, data) => writeAsset('asset:' + id, data),
        writeProjectAssets,
        options?.recovery !== false,
      );
    },
    takeProject: async () => null,
    saveProject: async (data) =>
      download(
        await encodeProject(await embedAssets(data, readCharacter)),
        ((data as { name?: string }).name ?? 'Project') + '.pose',
      ),
    onProjectQueued: noop,
    recentProjects: async () => [],
    openRecentProject: async () => null,
    clearRecentProjects: async () => {},
    exportCharacter: async (data, o) =>
      download(
        data,
        o.name + '.' + o.format,
        o.format === 'glb' ? 'model/gltf-binary' : 'application/octet-stream',
      ),
    beginRecording: async (o) => {
      const id = randomId(),
        name = o.name + '.' + o.format;
      recordings.set(id, { name, chunks: [], size: 0 });
      return { id, path: name };
    },
    writeRecording: async (id, data, position) => {
      const r = recordings.get(id);
      if (!r) throw Error('Recording not found');
      if (position + data.length > 512 * 1024 * 1024) throw Error('Recording exceeds 512 MB');
      r.chunks.push({ position, data: data.slice() });
      r.size = Math.max(r.size, position + data.length);
    },
    finishRecording: async (id) => {
      const r = recordings.get(id);
      if (!r) throw Error('Recording not found');
      const data = new Uint8Array(r.size);
      for (const part of r.chunks) data.set(part.data, part.position);
      recordings.delete(id);
      return download(data, r.name);
    },
    cancelRecording: async (id) => {
      recordings.delete(id);
    },
    revealRecording: async () => {},
    showFolder: async () => {},
    status: async () => ({ maximized: true }),
    confirmClose: async () => {},
    onCloseRequest: noop,
    onWindowState: noop,
    windowAction: () => {},
    ...createZipExports(async (data, name) => download(data, name, 'application/zip')),
  };
}

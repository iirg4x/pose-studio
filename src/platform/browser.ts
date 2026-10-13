import { initializePwa } from './pwa';
import { randomId } from '../core/crypto';
import { encodeProject } from '../../shared/project-codec.mjs';
import { readProjectDocument } from './projectDocuments';
import { readAsset, writeAsset, isTouch } from './storage';
import { assetHash, builtInAsset, embedAssets, restoreAssets, validateGLB } from './portableAssets';
const noop = () => () => {};
function download(data: Uint8Array, name: string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data.slice().buffer], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return name;
}
function pick(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
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
async function importModel() {
  const file = await pick('.glb');
  if (!file) return null;
  const data = validateGLB(new Uint8Array(await file.arrayBuffer())),
    asset = await assetHash(data);
  await writeAsset('asset:' + asset, data);
  return { asset, name: file.name.replace(/\.glb$/i, ''), data };
}
/** Installed on an iPhone or iPad, CSS viewport units can report less than the screen
 * (the gap is the status bar's height), leaving a strip at the bottom. The installed app
 * always owns the whole screen, so size it from the screen itself. */
function fillInstalledScreen() {
  const nav = navigator as Navigator & { standalone?: boolean };
  if (!nav.standalone) return;
  const root = document.documentElement;
  root.classList.add('ios-standalone');
  const measure = () => {
    const long = Math.max(screen.width, screen.height),
      short = Math.min(screen.width, screen.height),
      landscape = matchMedia('(orientation: landscape)').matches;
    const full = landscape ? short : long;
    // Only the status-bar-sized shortfall is the bug; a windowed app (iPad split view,
    // Stage Manager) really is smaller than the screen.
    const height = full - innerHeight > 0 && full - innerHeight <= 80 ? full : innerHeight;
    root.style.setProperty('--app-height', height + 'px');
  };
  measure();
  addEventListener('resize', measure);
  addEventListener('orientationchange', measure);
}
export async function initializeBrowser() {
  if (window.studioDesktop) return;
  if (isTouch) document.documentElement.classList.add('android');
  document.documentElement.classList.add('web');
  fillInstalledScreen();
  void initializePwa();
  const { AndroidAnimationImport } = await import('./androidAnimation');
  const animations = new AndroidAnimationImport(async () => {
    const file = await pick('.glb');
    return file ? { name: file.name, data: new Uint8Array(await file.arrayBuffer()) } : null;
  });
  const unsupported = async (): Promise<never> => {
    throw Error(
      'Use desktop Pose for FBX and Unreal export. Browser Pose supports GLB, project files and video.',
    );
  };
  const recordings = new Map<
    string,
    { name: string; chunks: { position: number; data: Uint8Array }[]; size: number }
  >();
  window.studioDesktop = {
    platform: 'web',
    readCharacter,
    importCharacter: importModel,
    importProp: importModel,
    inspectAnimation: () => animations.inspect(),
    sampleAnimation: (token, options) => animations.sample(token, options),
    openExample: async () => {
      const r = await fetch('examples/Axe%20studio.pose.json');
      if (!r.ok) throw Error('Example unavailable');
      return restoreAssets(await r.json(), (id, data) => writeAsset('asset:' + id, data));
    },
    openProject: async () => {
      const file = await pick('.pose,.json,.manny');
      if (!file) return null;
      if (file.size > 512 * 1024 * 1024) throw Error('Choose a project below 512 MB');
      return readProjectDocument(new Uint8Array(await file.arrayBuffer()), (id, data) =>
        writeAsset('asset:' + id, data),
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
    exportCharacter: async (data, o) => {
      if (o.format !== 'glb') return unsupported();
      return download(data, o.name + '.glb', 'model/gltf-binary');
    },
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
    status: async () => ({ blender: null, maximized: true }),
    chooseBlender: unsupported,
    confirmClose: async () => {},
    onCloseRequest: noop,
    onWindowState: noop,
    windowAction: () => {},
    beginSharedExport: unsupported,
    writeSharedExport: unsupported,
    finishSharedExport: unsupported,
    cancelSharedExport: unsupported,
    exportAnimation: unsupported,
  };
}

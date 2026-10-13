import { initializePwa } from './pwa';
import { detectTouchKeyboard, measureTouchViewport } from './touchViewport';
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
/** Keep the touch layout inside the visible browser viewport. Installed iPhone PWAs use
 * their oriented CSS screen size while the keyboard is closed so iOS safe-area chrome
 * cannot leave a blank strip; keyboard and all other browsers use the visible viewport. */
function initializeTouchViewport() {
  const root = document.documentElement;
  if (root.dataset.touchViewportInitialized === 'true') return;
  root.dataset.touchViewportInitialized = 'true';

  let frame = 0;
  const standaloneIPhone =
    /\b(?:iPhone|iPod)\b/i.test(navigator.userAgent) &&
    (Boolean((navigator as Navigator & { standalone?: boolean }).standalone) ||
      window.matchMedia?.('(display-mode: standalone)').matches === true);
  const orientation = () => {
    const type = screen.orientation?.type;
    if (type) return type.startsWith('landscape') ? 'landscape' : 'portrait';
    const angle = (window as Window & { orientation?: number }).orientation;
    if (typeof angle === 'number') return Math.abs(angle) === 90 ? 'landscape' : 'portrait';
    if (standaloneIPhone && screen.width && screen.height)
      return screen.width > screen.height ? 'landscape' : 'portrait';
    return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  };
  const editableFocused = () => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return false;
    if (element.isContentEditable) return true;
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
    if (element instanceof HTMLInputElement)
      return ![
        'button',
        'checkbox',
        'file',
        'hidden',
        'image',
        'radio',
        'range',
        'reset',
        'submit',
      ].includes(element.type);
    return false;
  };
  const closedHeights = new Map<string, number>();
  let previous = {
    innerHeight: window.innerHeight,
    visualHeight: window.visualViewport?.height ?? window.innerHeight,
  };
  let keyboardWasOpen = false;
  const keyboardOpen = () => {
    const currentOrientation = orientation();
    const innerHeight = window.innerHeight;
    const visualHeight = window.visualViewport?.height ?? innerHeight;
    const storedClosedHeight = closedHeights.get(currentOrientation);
    const provisionalClosedHeight =
      standaloneIPhone && screen.width && screen.height
        ? currentOrientation === 'landscape'
          ? Math.min(screen.width, screen.height)
          : Math.max(screen.width, screen.height)
        : undefined;
    const focused = editableFocused();
    const open = detectTouchKeyboard({
      focused,
      wasOpen: keyboardWasOpen,
      closedHeight: storedClosedHeight ?? provisionalClosedHeight,
      previousInnerHeight: previous.innerHeight,
      previousVisualHeight: previous.visualHeight,
      innerHeight,
      visualHeight,
    });
    const baselineShortfall =
      storedClosedHeight == null
        ? 0
        : Math.max(0, storedClosedHeight - innerHeight, storedClosedHeight - visualHeight);

    // Keep the closed baseline while the viewport is shrinking or recovering. Updating
    // it during the keyboard animation would make the next measurement look normal.
    if (!open && (storedClosedHeight == null || baselineShortfall === 0)) {
      closedHeights.set(currentOrientation, innerHeight);
    }
    keyboardWasOpen = open;
    previous = { innerHeight, visualHeight };
    return open;
  };
  const measure = () => {
    frame = 0;
    const visualViewport = window.visualViewport;
    const viewport = measureTouchViewport({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      visualViewport,
      standaloneIPhone,
      fullscreenScreen: standaloneIPhone ? { width: screen.width, height: screen.height } : null,
      keyboardOpen: keyboardOpen(),
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

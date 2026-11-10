import type { AnimationFileImport } from './animationFiles';
import type { AnimationInspection, MotionSource } from '../core/importAnimation';
import { validateGLB } from './portableAssets';

/** A file the user chose. `token` lets the desktop app look beside it for textures. */
export interface PickedFile {
  name: string;
  data: Uint8Array;
  token?: string;
  /** Other files chosen together with a model in the browser, such as its textures. */
  sidecar?: (name: string) => Promise<Uint8Array | null>;
}
/** One line for the user when a model named textures that could not be found. */
export const missingTextures = (missing: string[]) =>
  missing.length
    ? `Imported without ${missing.length === 1 ? 'a texture' : 'textures'}: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}. ` +
      (window.studioDesktop?.platform === 'web'
        ? 'Select the texture files together with the model, or use a GLB.'
        : 'Keep textures next to the model or in a Textures folder, as PNG, JPG or TGA.')
    : '';
const bridge = () => {
  if (!window.studioDesktop) throw Error('File import is unavailable here.');
  return window.studioDesktop;
};
let animations: Promise<AnimationFileImport> | undefined,
  picked: PickedFile | null = null;
const importer = () =>
  (animations ??= import('./animationFiles').then(
    (m) => new m.AnimationFileImport(async () => picked),
  ));

/** Ask for an animation file and list its skeletons and actions. The app reads it itself. */
export async function inspectAnimation(): Promise<AnimationInspection | null> {
  // The file dialog opens before the reader loads: a browser only allows it straight from a click.
  picked = await bridge().pickAnimation();
  if (!picked) return null;
  try {
    return await (await importer()).inspect();
  } finally {
    picked = null;
  }
}
export const sampleAnimation = async (
  token: string,
  options: Record<string, unknown>,
): Promise<MotionSource> => (await importer()).sample(token, options);

/** Ask for a character or prop file, convert it to GLB inside the app and store it. */
export async function importModel(kind: 'character' | 'prop') {
  const desktop = bridge(),
    file = await desktop.pickModel(kind);
  if (!file) return null;
  const { convertModel } = await import('./modelFiles');
  const { data, missing } = await convertModel(file.name, file.data, kind, async (name) =>
    file.sidecar ? file.sidecar(name) : file.token ? desktop.readSidecar(file.token, name) : null,
  );
  validateGLB(data);
  return {
    asset: await desktop.storeModel(data),
    name: file.name.replace(/\.[^.]+$/, ''),
    data,
    /** Texture files the model names but that could not be found or read. */
    missing,
  };
}

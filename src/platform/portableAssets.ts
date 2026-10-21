import { sha256Hex } from '../core/crypto';
/** Maximum size accepted for one self-contained GLB asset. */
export const MAX_GLB_BYTES = 32 * 1024 * 1024;
const GLB_SIZE_ERROR = 'Choose a valid GLB file below 32 MB.';

/**
 * Reject a portable asset from its metadata before allocating or reading its
 * contents. Browser File.size and the Android bridge document size both use
 * this check before their respective byte readers run.
 */
export function assertGLBSize(size: number) {
  if (!Number.isFinite(size) || size < 0 || size > MAX_GLB_BYTES) throw Error(GLB_SIZE_ERROR);
}

export function decode64(text: string) {
  const raw = atob(text),
    bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
export function encode64(data: Uint8Array) {
  let text = '';
  for (let i = 0; i < data.length; i += 8192)
    text += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(text);
}
export function validateGLB(data: Uint8Array) {
  assertGLBSize(data.length);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (
    data.length < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== data.length
  )
    throw Error('Choose a valid GLB file below 32 MB.');
  const size = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || size > data.length - 20)
    throw Error('Invalid GLB contents.');
  const json = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + size)));
  // Standalone files must contain their own geometry and textures.
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])])
    if (item.uri && !item.uri.startsWith('data:'))
      throw Error('Pack textures and geometry into the GLB before importing.');
  return data;
}
export const assetHash = sha256Hex;
export function builtInAsset(id: string) {
  return /^(example-fantasy-(male|female)|builtin-(axe|rifle|magazine|unreal-fp-gun))$/.test(id);
}
function assetIds(project: unknown) {
  const p = project as {
    characters?: { asset: string }[];
    clips?: { project: { props?: Record<string, { asset: string }> } }[];
  };
  return [
    ...new Set(
      [
        ...(p.characters ?? []),
        ...(p.clips ?? []).flatMap((c) => Object.values(c.project.props ?? {})),
      ].map((c) => c.asset),
    ),
  ];
}
export async function embedAssets(project: unknown, read: (id: string) => Promise<Uint8Array>) {
  const data = structuredClone(project) as Record<string, unknown>,
    assets: Record<string, string> = {};
  let total = 0;
  for (const id of assetIds(data)) {
    const bytes = validateGLB(await read(id));
    total += bytes.length;
    if (total > 64 * 1024 * 1024) throw Error('Embedded assets exceed the 64 MB project limit.');
    assets[id] = encode64(bytes);
  }
  if (Object.keys(assets).length) data.characterAssets = assets;
  return data;
}
export async function restoreAssets(
  project: unknown,
  write: (id: string, data: Uint8Array) => Promise<void>,
) {
  const data = project as Record<string, unknown>;
  const assets = data.characterAssets as Record<string, unknown> | undefined;
  if (assets) {
    if (typeof assets !== 'object' || Array.isArray(assets) || Object.keys(assets).length > 2000)
      throw Error('Invalid embedded assets.');
    let total = 0;
    const checked: [string, Uint8Array][] = [];
    for (const id of assetIds(data)) {
      if (assets[id] === undefined) continue;
      const encoded = assets[id];
      if (typeof encoded !== 'string' || encoded.length > MAX_GLB_BYTES * 1.4)
        throw Error('Invalid embedded asset.');
      const bytes = validateGLB(decode64(encoded));
      total += bytes.length;
      if (total > 64 * 1024 * 1024) throw Error('Embedded assets exceed 64 MB.');
      if (!builtInAsset(id) && (await assetHash(bytes)) !== id)
        throw Error('Asset checksum mismatch.');
      checked.push([id, bytes]);
    }
    for (const [id, bytes] of checked) if (!builtInAsset(id)) await write(id, bytes);
    delete data.characterAssets;
  }
  return data;
}

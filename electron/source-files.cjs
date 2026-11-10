const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const MAX_SOURCE = 256 * 1024 * 1024,
  MAX_SIDECAR = 64 * 1024 * 1024;
// Files a model may refer to: textures and glTF buffers. Nothing else is read on its behalf.
const SIDECARS = new Set(['png', 'jpg', 'jpeg', 'tga', 'bmp', 'psd', 'webp', 'gif', 'bin']);
const extension = (name) => path.extname(name).slice(1).toLowerCase();
/**
 * Hands chosen animation and model files to the window, which reads them itself.
 * A model's token lets the window ask for textures stored beside that one file.
 */
function createSourceFiles() {
  const sources = new Map();
  async function read(filename, extensions) {
    if (!extensions.includes(extension(filename)))
      throw Error('Choose one of: ' + extensions.map((e) => '.' + e).join(', ') + '.');
    if ((await fs.stat(filename)).size > MAX_SOURCE) throw Error('Choose a file below 256 MB.');
    const token = randomUUID();
    sources.set(token, filename);
    while (sources.size > 12) sources.delete(sources.keys().next().value);
    return {
      name: path.basename(filename),
      data: new Uint8Array(await fs.readFile(filename)),
      token,
    };
  }
  /** Candidate locations for a file a model names, most specific first. */
  function candidates(source, wanted) {
    const parts = String(wanted)
        .replace(/\\/g, '/')
        .split('/')
        .filter((p) => p && p !== '.'),
      name = parts[parts.length - 1],
      directory = path.dirname(source),
      list = [];
    if (!name) return list;
    // A relative path is honoured only while it stays inside the model's folder.
    if (!/^[a-zA-Z]:$/.test(parts[0]) && !String(wanted).startsWith('/') && !parts.includes('..'))
      list.push(path.join(directory, ...parts));
    // Then the usual places a pack keeps textures, preferring a PNG over a PSD atlas.
    const stem = name.replace(/\.[^.]+$/, '');
    for (const folder of ['.', 'Textures', '../Textures', '../../Textures', 'textures'])
      for (const file of [stem + '.png', name]) list.push(path.join(directory, folder, file));
    return list.filter((f) => SIDECARS.has(extension(f)));
  }
  return {
    read,
    candidates,
    async sidecar(token, wanted) {
      const source = sources.get(token);
      if (!source || typeof wanted !== 'string' || wanted.length > 1024) return null;
      for (const filename of candidates(source, wanted)) {
        try {
          const stat = await fs.stat(filename);
          if (stat.isFile() && stat.size <= MAX_SIDECAR)
            return new Uint8Array(await fs.readFile(filename));
        } catch {}
      }
      return null;
    },
  };
}
module.exports = { createSourceFiles };

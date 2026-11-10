import { zipSync } from 'three/addons/libs/fflate.module.js';
import { randomId } from '../core/crypto';

const MAX_BYTES = 512 * 1024 * 1024;
const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'Project';

/**
 * Unreal exports where the app cannot write a folder: the files are gathered
 * and handed to `save` as one zip archive.
 */
export function createZipExports(save: (data: Uint8Array, name: string) => Promise<string | null>) {
  const sessions = new Map<
    string,
    { name: string; files: Record<string, Uint8Array>; size: number }
  >();
  const session = (id: string) => {
    const found = sessions.get(id);
    if (!found) throw Error('Export session expired.');
    return found;
  };
  return {
    beginExport: async (name: string, shared = false) => {
      const id = randomId(),
        file = safe(name) + (shared ? '_Shared' : '') + '.zip';
      sessions.clear();
      sessions.set(id, { name: file, files: {}, size: 0 });
      return { id, directory: file };
    },
    writeExport: async (id: string, path: string, data: Uint8Array) => {
      const s = session(id);
      s.size += data.length - (s.files[path]?.length ?? 0);
      if (s.size > MAX_BYTES) {
        sessions.delete(id);
        throw Error('This export is larger than 512 MB. Export fewer animations at a time.');
      }
      s.files[path] = data;
    },
    finishExport: async (id: string) => {
      const s = session(id),
        files = Object.keys(s.files);
      if (!files.length) throw Error('The export wrote no files.');
      sessions.delete(id);
      // Textures and FBX arrays are already compressed, so the archive only stores them.
      const saved = await save(zipSync(s.files, { level: 0 }), s.name);
      if (saved === null) throw Error('The export was not saved.');
      return { directory: saved, files };
    },
    cancelExport: async (id: string) => {
      sessions.delete(id);
    },
  };
}

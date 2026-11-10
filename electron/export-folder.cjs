const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const safe = (value) =>
  String(value)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 60) || 'Project';
const MAX_FILE = 512 * 1024 * 1024;
const TYPES = new Set(['.fbx', '.png', '.jpg', '.json', '.txt', '.py']);
/** A path inside the export folder: plain names, forward slashes, a known file type. */
function exportPath(directory, relative) {
  if (
    typeof relative !== 'string' ||
    relative.length > 240 ||
    !/^[A-Za-z0-9_-][A-Za-z0-9_ .-]*(\/[A-Za-z0-9_-][A-Za-z0-9_ .-]*)*$/.test(relative) ||
    relative.split('/').some((part) => part.endsWith('.') || part.endsWith(' ')) ||
    !TYPES.has(path.extname(relative).toLowerCase())
  )
    throw Error('Invalid export file name.');
  const resolved = path.resolve(directory, relative);
  if (!resolved.startsWith(path.resolve(directory) + path.sep))
    throw Error('Invalid export file name.');
  return resolved;
}
/** Writes the files of one export, which the window builds, into a new folder. */
function createExportFolders() {
  let session;
  const current = (id) => {
    if (!session || session.id !== id) throw Error('Export session expired.');
    return session;
  };
  return {
    get busy() {
      return !!session;
    },
    async begin(parent, name, shared = false) {
      if (session) throw Error('An export is already running.');
      if (typeof name !== 'string' || !name.length || name.length > 160)
        throw Error('Invalid export name.');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-'),
        directory = path.resolve(
          parent,
          safe(name) + (shared ? '_Shared_' + stamp + '_' + randomUUID().slice(0, 6) : '_' + stamp),
        );
      await fs.mkdir(directory, { recursive: true });
      session = { id: randomUUID(), directory, files: new Set(), finishing: false };
      return { id: session.id, directory };
    },
    async write(id, relative, bytes) {
      const s = current(id);
      if (s.finishing) throw Error('The export is already being finished.');
      const filename = exportPath(s.directory, relative),
        data = Buffer.from(bytes);
      if (!data.length || data.length > MAX_FILE) throw Error('Invalid export file.');
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await fs.writeFile(filename, data);
      s.files.add(relative);
    },
    async finish(id) {
      const s = current(id);
      if (!s.files.size) throw Error('The export wrote no files.');
      s.finishing = true;
      try {
        for (const file of s.files)
          if ((await fs.stat(exportPath(s.directory, file))).size === 0)
            throw Error('Export produced an invalid file.');
        session = undefined;
        return { directory: s.directory, files: [...s.files] };
      } catch (e) {
        s.finishing = false;
        throw e;
      }
    },
    async cancel(id) {
      const s = current(id);
      await fs.writeFile(
        path.join(s.directory, 'incomplete-export.txt'),
        'Export did not finish. Do not import this folder.\n',
      );
      session = undefined;
    },
  };
}
module.exports = { createExportFolders };

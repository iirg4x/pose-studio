const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const MAX = 32 * 1024 * 1024;
function glb(data) {
  const b = Buffer.from(data);
  if (
    b.length < 20 ||
    b.length > MAX ||
    b.readUInt32LE(0) !== 0x46546c67 ||
    b.readUInt32LE(4) !== 2 ||
    b.readUInt32LE(8) !== b.length
  )
    throw Error('Choose a valid GLB character below 32 MB.');
  return b;
}
async function blenderJob(blender, script, args, logPath) {
  if (!blender)
    throw Error(
      'Choose Blender in Export to Unreal before importing FBX or exporting a retargeted FBX.',
    );
  const log = await fs.open(logPath, 'w');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        blender,
        [
          '--background',
          '--factory-startup',
          '--disable-autoexec',
          '--python-exit-code',
          '1',
          '--python',
          script,
          '--',
          ...args,
        ],
        { windowsHide: true, stdio: ['ignore', log.fd, log.fd] },
      );
      const timer = setTimeout(() => {
        child.kill();
        reject(Error('Character conversion timed out.'));
      }, 180000);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(
              Error(
                'Could not convert the character. Use one skinned humanoid armature. Details: ' +
                  logPath,
              ),
            );
      });
    });
  } finally {
    await log.close();
  }
}
function createCharacters(directory, assets, backend) {
  const filename = (id) => {
    if (/^(example-fantasy-(male|female)|builtin-(axe|rifle|magazine))$/.test(id))
      return path.join(assets, id + '.glb');
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid character asset.');
    return path.join(directory, id + '.glb');
  };
  const read = async (id) =>
    new Uint8Array(
      glb(
        await fs.readFile(filename(id)).catch((e) => {
          if (e.code === 'ENOENT')
            throw Error(
              'Character file is missing. Reimport it or open a saved project containing the character.',
            );
          throw e;
        }),
      ),
    );
  const cache = async (bytes) => {
    const data = glb(bytes),
      id = createHash('sha256').update(data).digest('hex');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(filename(id), data);
    return id;
  };
  return {
    read,
    cache,
    filename,
    async importFile(source, blender) {
      if (!['.fbx', '.glb', '.gltf'].includes(path.extname(source).toLowerCase()))
        throw Error('Choose an FBX, GLB or glTF character.');
      let bytes;
      if (path.extname(source).toLowerCase() === '.glb') bytes = await fs.readFile(source);
      else {
        await fs.mkdir(directory, { recursive: true });
        const converted = path.join(directory, 'import-' + randomUUID() + '.glb');
        try {
          await blenderJob(
            blender,
            path.join(backend, 'import_character.py'),
            [source, converted],
            converted + '.log',
          );
          bytes = await fs.readFile(converted);
        } finally {
          await fs.unlink(converted).catch(() => {});
        }
      }
      const asset = await cache(bytes);
      return {
        asset,
        name: path.basename(source, path.extname(source)),
        data: new Uint8Array(bytes),
      };
    },
    async embed(project) {
      const data = structuredClone(project),
        characterAssets = {};
      let total = 0;
      for (const c of [
        ...(data.characters ?? []),
        ...(data.clips ?? []).flatMap((c) => Object.values(c.project.props ?? {})),
      ]) {
        if (characterAssets[c.asset]) continue;
        const bytes = await read(c.asset);
        total += bytes.length;
        if (total > 64 * 1024 * 1024)
          throw Error('Character assets exceed 64 MB. Remove unused characters before saving.');
        characterAssets[c.asset] = Buffer.from(bytes).toString('base64');
      }
      if (Object.keys(characterAssets).length) data.characterAssets = characterAssets;
      return data;
    },
    async restore(project) {
      if (project.characterAssets) {
        const assets = project.characterAssets,
          seen = new Set();
        let total = 0;
        if (typeof assets !== 'object' || Object.keys(assets).length > 2000)
          throw Error('Invalid embedded characters.');
        for (const c of [
          ...(project.characters ?? []),
          ...(project.clips ?? []).flatMap((c) => Object.values(c.project.props ?? {})),
        ]) {
          if (seen.has(c.asset)) continue;
          seen.add(c.asset);
          const encoded = assets[c.asset];
          if (encoded !== undefined) {
            if (typeof encoded !== 'string' || encoded.length > MAX * 1.4)
              throw Error('Invalid embedded character.');
            const bytes = glb(Buffer.from(encoded, 'base64'));
            total += bytes.length;
            if (total > 64 * 1024 * 1024) throw Error('Embedded assets exceed 64 MB.');
            if (c.asset.startsWith('example-') || c.asset.startsWith('builtin-')) continue;
            if ((await cache(bytes)) !== c.asset) throw Error('Character checksum mismatch.');
          }
        }
        delete project.characterAssets;
      }
      return project;
    },
    async exportFile(bytes, destination, format, blender, fps = 24, end = 96) {
      const data = glb(bytes);
      await fs.mkdir(directory, { recursive: true });
      const temporary = path.join(
        path.dirname(destination),
        '.pose-' + randomUUID() + '.' + format,
      );
      try {
        if (format === 'glb') await fs.writeFile(temporary, data);
        else {
          const input = path.join(directory, 'export-' + randomUUID() + '.glb');
          try {
            await fs.writeFile(input, data);
            await blenderJob(
              blender,
              path.join(backend, 'export_character.py'),
              [input, temporary, String(fps), String(end)],
              input + '.log',
            );
          } finally {
            await fs.unlink(input).catch(() => {});
          }
        }
        await fs.rename(temporary, destination);
      } finally {
        await fs.unlink(temporary).catch(() => {});
      }
      return destination;
    },
  };
}
module.exports = { createCharacters, blenderJob };

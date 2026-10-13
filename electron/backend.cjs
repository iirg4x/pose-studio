const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
function validateBake(p, skeleton) {
  if (
    !p ||
    p.version !== 2 ||
    p.rig !== 'ue5-manny-simple' ||
    typeof p.name !== 'string' ||
    p.name.length > 100 ||
    !Number.isInteger(p.fps) ||
    p.fps < 1 ||
    p.fps > 120 ||
    !Number.isInteger(p.end) ||
    p.end < 1 ||
    p.end > 2400 ||
    !Array.isArray(p.frames) ||
    p.frames.length !== p.end + 1
  )
    throw Error('Invalid animation export.');
  if (p.rootMotion !== undefined && !['keep', 'extract'].includes(p.rootMotion))
    throw Error('Invalid root motion export mode.');
  const vector = (v, n) =>
    Array.isArray(v) &&
    v.length === n &&
    v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e6);
  const affine = (m) =>
    vector(m, 16) && Math.abs(m[3]) + Math.abs(m[7]) + Math.abs(m[11]) + Math.abs(m[15] - 1) < 1e-5;
  const names = skeleton.bones.map((b) => b.name),
    props = Object.keys(p.geometry ?? {});
  if (
    props.some(
      (id) => !['rifle', 'magazine'].includes(id) && !/^prop:[a-zA-Z0-9_-]{1,100}$/.test(id),
    )
  )
    throw Error('Invalid prop identity.');
  for (let i = 0; i < p.frames.length; i++) {
    const f = p.frames[i];
    if (
      f.frame !== i ||
      !f.bones ||
      Object.keys(f.bones).length !== names.length ||
      !names.every((n) => affine(f.bones[n]) && affine(f.bodyBones?.[n])) ||
      props.some((id) => !affine(f.bodyProps?.[id]) || !affine(f.props?.[id])) ||
      !affine(f.camera?.matrix) ||
      !Number.isFinite(f.camera.fov) ||
      f.camera.fov < 20 ||
      f.camera.fov > 120
    )
      throw Error('Invalid baked pose at frame ' + i);
  }
  let count = 0;
  for (const id of props) {
    const parts = p.geometry?.[id];
    if (!Array.isArray(parts) || !parts.length || parts.length > 256)
      throw Error('Invalid prop geometry.');
    for (const part of parts) {
      if (
        !Array.isArray(part.vertices) ||
        !part.vertices.length ||
        !part.vertices.every((v) => vector(v, 3)) ||
        !Array.isArray(part.indices) ||
        part.indices.length % 3 ||
        !part.indices.every((i) => Number.isInteger(i) && i >= 0 && i < part.vertices.length) ||
        !vector(part.color, 3)
      )
        throw Error('Invalid prop mesh.');
      count += part.vertices.length;
    }
  }
  if (count > 500000) throw Error('Prop geometry is too large.');
  return p;
}
async function runExport({ blender, backend, directory, payload, includeMesh }) {
  const skeleton = JSON.parse(await fs.readFile(path.join(backend, 'skeleton.json'), 'utf8'));
  validateBake(payload, skeleton);
  await fs.mkdir(directory, { recursive: true });
  const input = path.join(directory, 'animation-bake.json');
  await fs.writeFile(input, JSON.stringify(payload));
  const args = [
    '--background',
    '--factory-startup',
    '--disable-autoexec',
    '--python',
    path.join(backend, 'export_fbx.py'),
    '--',
    input,
    directory,
    includeMesh ? '1' : '0',
  ];
  const log = await fs.open(path.join(directory, 'export.log'), 'w');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(blender, args, { windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
      const timer = setTimeout(() => {
        child.kill();
        reject(Error('Blender export timed out. See export.log in the chosen folder.'));
      }, 300000);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(
              Error('Blender could not export the clip. See export.log in the chosen folder.'),
            );
      });
    });
  } finally {
    await log.close();
  }
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  for (const f of manifest.files) {
    const file = path.resolve(directory, f);
    if (
      path.isAbsolute(f) ||
      !file.startsWith(path.resolve(directory) + path.sep) ||
      (await fs.stat(file)).size === 0
    )
      throw Error('Export produced an invalid file.');
  }
  await fs.unlink(input);
  return { directory, files: manifest.files };
}
module.exports = { validateBake, runExport };

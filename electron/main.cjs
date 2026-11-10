const codec = import('../shared/project-codec.mjs');
const { app, BrowserWindow, ipcMain, dialog, shell, session, screen } = require('electron');
const { createRecentProjects } = require('./recent-projects.cjs');
const { createRecordingWriter } = require('./recording.cjs');
const { createCharacters } = require('./characters.cjs');
const { createExportFolders } = require('./export-folder.cjs');
const { createSourceFiles } = require('./source-files.cjs');
const {
  PROJECT_FILTERS,
  projectFilename,
  projectSavePath,
  projectArguments,
  createProjectQueue,
  registerProjectAssociation,
} = require('./project-files.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let win,
  exporting = false,
  closingAllowed = false;
const exportedDirectories = new Set();
const projectQueue = createProjectQueue();
function queueProject(filename) {
  projectQueue.add(filename);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('studio:project-queued');
  }
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  for (const filename of projectArguments(process.argv, process.cwd(), app.isPackaged))
    queueProject(filename);
  app.on('second-instance', (_event, argv, cwd) => {
    for (const filename of projectArguments(argv, cwd, app.isPackaged)) queueProject(filename);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.on('open-file', (event, filename) => {
    event.preventDefault();
    queueProject(filename);
  });
}
const recordings = createRecordingWriter(),
  recordedFiles = new Set();
let choosingRecording = false;
const base = path.resolve(__dirname, '..'),
  entry = path.join(base, 'dist', 'index.html');
app.whenReady().then(async () => {
  if (!app.hasSingleInstanceLock()) return;
  if (app.isPackaged)
    registerProjectAssociation(
      process.execPath,
      path.join(process.resourcesPath, 'refresh-file-associations.ps1'),
    ).catch((e) => console.error('Could not register .pose projects:', e.message));
  const characters = createCharacters(
    path.join(app.getPath('userData'), 'characters'),
    path.join(base, 'dist', 'assets'),
  );
  const folders = createExportFolders();
  const sources = createSourceFiles();
  const recents = createRecentProjects(path.join(app.getPath('userData'), 'recent-projects.json'));
  async function readProject(filename) {
    let stat;
    try {
      stat = await fs.stat(filename);
    } catch {
      throw Error('Project file is missing. Use Open project to locate it.');
    }
    if (stat.size > 512 * 1024 * 1024) throw Error('Project file is too large.');
    const p = await (await codec).decodeProject(await fs.readFile(filename));
    await recents.record(filename);
    return characters.restore(p);
  }
  handle('recents', () => recents.list());
  handle('clear-recents', () => recents.clear());
  handle('open-recent', async (filename) => readProject(await recents.resolve(filename)));
  handle('take-project', async () => {
    if (exporting || recordings.busy || choosingRecording) return null;
    const filename = projectQueue.take();
    return filename ? readProject(filename) : null;
  });
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1560, area.width),
    height: Math.min(1000, area.height),
    minWidth: Math.min(1024, area.width),
    minHeight: Math.min(720, area.height),
    maximizable: true,
    resizable: true,
    backgroundColor: '#101318',
    frame: false,
    show: false,
    title: 'Pose',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  handle('status', () => ({ maximized: win.isMaximized() }));
  const windowState = () =>
    win.webContents.send('studio:window-state', { maximized: win.isMaximized() });
  win.on('maximize', windowState);
  win.on('unmaximize', windowState);
  win.on('restore', windowState);
  handle('save', async (p) => {
    const text = await (await codec).encodeProject(await characters.embed(p));
    const r = await dialog.showSaveDialog(win, {
      title: 'Save Pose project',
      defaultPath: projectFilename(p.name),
      filters: [PROJECT_FILTERS[0]],
    });
    if (r.canceled) return null;
    const filename = projectSavePath(r.filePath);
    if (filename !== r.filePath) {
      try {
        await fs.access(filename);
        const confirmation = await dialog.showMessageBox(win, {
          type: 'question',
          message: 'Replace this Pose project?',
          detail: filename,
          buttons: ['Cancel', 'Replace'],
          defaultId: 0,
          cancelId: 0,
        });
        if (confirmation.response !== 1) return null;
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    await fs.writeFile(filename, text);
    await recents.record(filename);
    return filename;
  });
  handle('open', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Open Pose project',
      filters: [{ name: 'All Pose projects', extensions: ['pose', 'json'] }, ...PROJECT_FILTERS],
      properties: ['openFile'],
    });
    if (r.canceled) return null;
    return readProject(r.filePaths[0]);
  });
  handle('character-read', (id) => characters.read(id));
  // The window builds every export file itself; this side chooses the folder and writes them.
  handle('export-begin', async (name, shared) => {
    if (exporting || recordings.busy || choosingRecording)
      throw Error('Wait for the current export.');
    exporting = true;
    try {
      const r = await dialog.showOpenDialog(win, {
        title: shared === true ? 'Export shared Unreal skeleton' : 'Choose export destination',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (r.canceled) {
        exporting = false;
        return null;
      }
      return await folders.begin(r.filePaths[0], name, shared === true);
    } catch (e) {
      exporting = false;
      throw e;
    }
  });
  handle('export-write', (id, file, bytes) => folders.write(id, file, bytes));
  handle('export-finish', async (id) => {
    const result = await folders.finish(id);
    exporting = false;
    exportedDirectories.add(result.directory);
    return result;
  });
  handle('export-cancel', async (id) => {
    await folders.cancel(id);
    exporting = false;
  });
  // The window reads animation and model files itself; this side only opens them.
  async function pickSource(title, name, extensions) {
    if (exporting || recordings.busy) throw Error('Wait for the current export.');
    const r = await dialog.showOpenDialog(win, {
      title,
      filters: [{ name, extensions }],
      properties: ['openFile'],
    });
    return r.canceled ? null : sources.read(r.filePaths[0], extensions);
  }
  handle('animation-pick', () =>
    pickSource('Import animation', 'Animation', ['fbx', 'glb', 'gltf', 'bvh']),
  );
  handle('model-pick', (kind) =>
    kind === 'prop'
      ? pickSource('Import prop', '3D prop', ['glb', 'gltf', 'fbx', 'obj'])
      : pickSource('Import humanoid character', 'Rigged character', ['fbx', 'glb', 'gltf']),
  );
  handle('model-sidecar', (token, name) => sources.sidecar(token, name));
  handle('model-store', (bytes) => characters.cache(bytes));
  handle('open-example', async () =>
    characters.restore(
      JSON.parse(
        await fs.readFile(path.join(base, 'dist', 'examples', 'Axe studio.pose.json'), 'utf8'),
      ),
    ),
  );
  handle('character-export', async (bytes, options) => {
    if (exporting || recordings.busy) throw Error('Wait for the current export.');
    if (!options || !['glb', 'fbx'].includes(options.format))
      throw Error('Invalid character export.');
    const result = await dialog.showSaveDialog(win, {
      title: 'Export retargeted animation',
      defaultPath: safeName(options.name) + '.' + options.format,
      filters: [{ name: options.format.toUpperCase(), extensions: [options.format] }],
    });
    if (result.canceled) return null;
    exporting = true;
    try {
      const file = await characters.exportFile(bytes, result.filePath, options.format);
      recordedFiles.add(file);
      return file;
    } finally {
      exporting = false;
    }
  });
  handle('recording-begin', async (options) => {
    if (exporting || recordings.busy || choosingRecording)
      throw Error('An export is already running.');
    if (!options || !['mp4', 'webm'].includes(options.format)) throw Error('Invalid video format.');
    choosingRecording = true;
    try {
      const r = await dialog.showSaveDialog(win, {
        title: 'Export recording',
        defaultPath: safeName(options.name) + '.' + options.format,
        filters: [
          {
            name: options.format === 'mp4' ? 'MP4 video' : 'WebM video',
            extensions: [options.format],
          },
        ],
      });
      if (r.canceled || !r.filePath) return null;
      return await recordings.begin(r.filePath);
    } finally {
      choosingRecording = false;
    }
  });
  handle('recording-write', (id, data, position) => recordings.write(id, data, position));
  handle('recording-finish', async (id) => {
    const filename = await recordings.finish(id);
    recordedFiles.add(filename);
    return filename;
  });
  handle('recording-cancel', (id) => recordings.cancel(id));
  handle('recording-reveal', (filename) => {
    if (!recordedFiles.has(filename)) throw Error('Unknown recording.');
    shell.showItemInFolder(filename);
  });
  handle('folder', (directory) => {
    if (!exportedDirectories.has(directory)) throw Error('Unknown export folder.');
    return shell.openPath(directory);
  });
  ipcMain.on('studio:window', (e, action) => {
    trusted(e);
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
  });
  handle('confirm-close', () => {
    closingAllowed = true;
    win.close();
  });
  win.on('close', (e) => {
    if (exporting || recordings.busy || choosingRecording) {
      e.preventDefault();
      closingAllowed = false;
      dialog.showMessageBox(win, {
        message: 'An export is still running.',
        detail: 'Wait for it to finish, or cancel the recording before closing the editor.',
        buttons: ['OK'],
      });
      return;
    }
    if (!closingAllowed) {
      e.preventDefault();
      win.webContents.send('studio:request-close');
    }
  });
  await win.loadFile(entry);
  win.show();
});
app.on('window-all-closed', () => app.quit());

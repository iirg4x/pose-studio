const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'studioDesktop',
  Object.freeze({
    beginExport: (name, shared) => ipcRenderer.invoke('studio:export-begin', name, shared),
    writeExport: (id, file, data) => ipcRenderer.invoke('studio:export-write', id, file, data),
    finishExport: (id) => ipcRenderer.invoke('studio:export-finish', id),
    cancelExport: (id) => ipcRenderer.invoke('studio:export-cancel', id),
    pickAnimation: () => ipcRenderer.invoke('studio:animation-pick'),
    pickModel: (kind) => ipcRenderer.invoke('studio:model-pick', kind),
    readSidecar: (token, name) => ipcRenderer.invoke('studio:model-sidecar', token, name),
    storeModel: (data) => ipcRenderer.invoke('studio:model-store', data),
    openExample: () => ipcRenderer.invoke('studio:open-example'),
    readCharacter: (id) => ipcRenderer.invoke('studio:character-read', id),
    exportCharacter: (data, options) =>
      ipcRenderer.invoke('studio:character-export', data, options),
    beginRecording: (options) => ipcRenderer.invoke('studio:recording-begin', options),
    writeRecording: (id, data, position) =>
      ipcRenderer.invoke('studio:recording-write', id, data, position),
    finishRecording: (id) => ipcRenderer.invoke('studio:recording-finish', id),
    cancelRecording: (id) => ipcRenderer.invoke('studio:recording-cancel', id),
    revealRecording: (filename) => ipcRenderer.invoke('studio:recording-reveal', filename),
    confirmClose: () => ipcRenderer.invoke('studio:confirm-close'),
    onCloseRequest: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('studio:request-close', listener);
      return () => ipcRenderer.removeListener('studio:request-close', listener);
    },
    status: () => ipcRenderer.invoke('studio:status'),
    saveProject: (p) => ipcRenderer.invoke('studio:save', p),
    openProject: () => ipcRenderer.invoke('studio:open'),
    takeProject: () => ipcRenderer.invoke('studio:take-project'),
    onProjectQueued: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('studio:project-queued', listener);
      return () => ipcRenderer.removeListener('studio:project-queued', listener);
    },
    recentProjects: () => ipcRenderer.invoke('studio:recents'),
    openRecentProject: (p) => ipcRenderer.invoke('studio:open-recent', p),
    clearRecentProjects: () => ipcRenderer.invoke('studio:clear-recents'),
    showFolder: (directory) => ipcRenderer.invoke('studio:folder', directory),
    windowAction: (action) => ipcRenderer.send('studio:window', action),
    onWindowState: (callback) => {
      const listener = (_event, state) => callback({ maximized: state.maximized === true });
      ipcRenderer.on('studio:window-state', listener);
      return () => ipcRenderer.removeListener('studio:window-state', listener);
    },
  }),
);

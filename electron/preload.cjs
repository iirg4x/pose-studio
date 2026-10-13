const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'studioDesktop',
  Object.freeze({
    beginSharedExport: (plan) => ipcRenderer.invoke('studio:shared-begin', plan),
    writeSharedExport: (id, item, data) =>
      ipcRenderer.invoke('studio:shared-write', id, item, data),
    finishSharedExport: (id) => ipcRenderer.invoke('studio:shared-finish', id),
    cancelSharedExport: (id) => ipcRenderer.invoke('studio:shared-cancel', id),
    importProp: () => ipcRenderer.invoke('studio:prop-import'),
    inspectAnimation: () => ipcRenderer.invoke('studio:animation-inspect'),
    sampleAnimation: (token, options) =>
      ipcRenderer.invoke('studio:animation-sample', token, options),
    openExample: () => ipcRenderer.invoke('studio:open-example'),
    importCharacter: () => ipcRenderer.invoke('studio:character-import'),
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
    chooseBlender: () => ipcRenderer.invoke('studio:choose-blender'),
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
    exportAnimation: (payload, options) => ipcRenderer.invoke('studio:export', payload, options),
    showFolder: (directory) => ipcRenderer.invoke('studio:folder', directory),
    windowAction: (action) => ipcRenderer.send('studio:window', action),
    onWindowState: (callback) => {
      const listener = (_event, state) => callback({ maximized: state.maximized === true });
      ipcRenderer.on('studio:window-state', listener);
      return () => ipcRenderer.removeListener('studio:window-state', listener);
    },
  }),
);

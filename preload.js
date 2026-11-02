const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('projectLog', Object.freeze({
  selectFolder: () => ipcRenderer.invoke('projectlog:select-folder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('projectlog:scan-folder', folderPath),
  exportPDF: (html, suggestedName) => ipcRenderer.invoke('projectlog:export-pdf', html, suggestedName),
  checkForUpdates: () => ipcRenderer.invoke('projectlog:check-for-updates'),
  localAIRequest: (payload) => ipcRenderer.invoke('projectlog:local-ai-request', payload),
  updateAction: (action) => ipcRenderer.invoke('projectlog:update-action', action),
  onUpdateState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('projectlog:update-state', listener);
    return () => ipcRenderer.removeListener('projectlog:update-state', listener);
  }
}));

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('projectLog', Object.freeze({
  selectFolder: () => ipcRenderer.invoke('projectlog:select-folder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('projectlog:scan-folder', folderPath),
  exportPDF: (html, suggestedName) => ipcRenderer.invoke('projectlog:export-pdf', html, suggestedName)
}));

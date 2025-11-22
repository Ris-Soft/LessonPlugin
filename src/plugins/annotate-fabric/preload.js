const { contextBridge, ipcRenderer } = require('electron');

try {
  contextBridge.exposeInMainWorld('annotateAPI', {
    minimize: () => { try { ipcRenderer.send('annotate:minimize'); } catch {} },
    close: () => { try { ipcRenderer.send('annotate:close'); } catch {} },
  });
} catch {}


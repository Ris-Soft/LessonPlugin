const { contextBridge, ipcRenderer } = require('electron');

try {
  contextBridge.exposeInMainWorld('annotateAPI', {
    minimize: () => { try { ipcRenderer.send('annotate:minimize'); } catch {} },
    close: () => { try { ipcRenderer.send('annotate:close'); } catch {} },
    saveJSON: (filePath, json) => { try { ipcRenderer.send('annotate:saveJSON', { filePath, json }); } catch {} },
    loadJSON: async (filePath) => {
      try {
        return await ipcRenderer.invoke('annotate:loadJSON', { filePath });
      } catch { return null; }
    },
    minimizeWithSave: (filePath, json) => { try { ipcRenderer.send('annotate:minimizeWithSave', { filePath, json }); } catch {} },
  });
} catch {}

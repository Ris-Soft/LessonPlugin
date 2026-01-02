const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('consoleAPI', {
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
  showAppMenu: (coords) => ipcRenderer.invoke('settings:showMenu', coords),
  openConsole: () => ipcRenderer.invoke('console:open'),
  backendLogsGetEntries: (count) => ipcRenderer.invoke('debug:logs:getEntries', count),
  onBackendLogEntry: (handler) => {
    const listener = (_e, entry) => handler && handler(entry);
    ipcRenderer.on('backend:log:entry', listener);
    try { ipcRenderer.send('debug:logs:subscribe'); } catch (e) {}
    return () => { ipcRenderer.removeListener('backend:log:entry', listener); };
  }
  ,
  getMetrics: () => ipcRenderer.invoke('console:metrics'),
  listWindows: () => ipcRenderer.invoke('console:listWindows'),
  openDevTools: (windowId) => ipcRenderer.invoke('console:openDevTools', windowId),
  focusWindow: (windowId) => ipcRenderer.invoke('console:focusWindow', windowId)
  ,
  controlWindow: (windowId, action) => ipcRenderer.invoke('console:controlWindow', windowId, action)
  ,
  exportText: (text, defaultName) => ipcRenderer.invoke('console:exportText', text, defaultName)
});

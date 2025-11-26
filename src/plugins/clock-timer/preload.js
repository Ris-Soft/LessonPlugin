const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clockAPI', {
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
  call: (fn, args) => ipcRenderer.invoke('plugin:call', 'clock.timer', fn, args),
  isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
  getBounds: () => ipcRenderer.invoke('window:getBounds'),
  pluginCall: (pid, fn, args) => ipcRenderer.invoke('plugin:call', pid, fn, args),
  onEvent: (handler) => { ipcRenderer.on('plugin:event', (_e, { name, payload }) => handler(name, payload)); },
  getCurrentTime: () => ipcRenderer.invoke('system:getTime'),
  configGet: (scope, key) => ipcRenderer.invoke('config:get', scope, key)
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashAPI', {
  onProgress: (cb) => ipcRenderer.on('plugin-progress', (_e, payload) => cb(payload)),
  // 配置存取（用于名言源与缓存）
  configGetAll: (scope) => ipcRenderer.invoke('config:getAll', scope),
  configGet: (scope, key) => ipcRenderer.invoke('config:get', scope, key),
  configSet: (scope, key, value) => ipcRenderer.invoke('config:set', scope, key, value),
  configEnsureDefaults: (scope, defaults) => ipcRenderer.invoke('config:ensureDefaults', scope, defaults),
  // 允许在加载完成后手动关闭窗口
  windowControl: (action) => ipcRenderer.invoke('window:control', action)
});
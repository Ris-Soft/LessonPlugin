const { contextBridge, ipcRenderer } = require('electron');

try { ipcRenderer.send('plugin:register', 'screen.compass', ['performAction','getBounds','moveTo','snap','setDragging','setExpandedWindow']); } catch {}

contextBridge.exposeInMainWorld('compassAPI', {
  pluginCall: (targetPluginId, fnName, args) => ipcRenderer.invoke('plugin:call', targetPluginId, fnName, args),
  getBounds: () => ipcRenderer.invoke('plugin:call', 'screen.compass', 'getBounds', []),
  moveTo: (x, y) => ipcRenderer.invoke('plugin:call', 'screen.compass', 'moveTo', [x, y]),
  snap: () => ipcRenderer.invoke('plugin:call', 'screen.compass', 'snap', []),
  subscribe: (eventName) => ipcRenderer.send('plugin:event:subscribe', eventName),
  onEvent: (handler) => { try { ipcRenderer.on('plugin:event', (_e, { name, payload }) => handler && handler(name, payload)); } catch {} },
  configGetAll: (scope) => ipcRenderer.invoke('config:getAll', scope),
  configGet: (scope, key) => ipcRenderer.invoke('config:get', scope, key),
  configSet: (scope, key, value) => ipcRenderer.invoke('config:set', scope, key, value),
  configEnsureDefaults: (scope, defaults) => ipcRenderer.invoke('config:ensureDefaults', scope, defaults)
});

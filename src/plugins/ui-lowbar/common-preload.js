module.exports.buildCommonLowbarAPI = (ipcRenderer) => ({
  pluginCall: (targetPluginId, fnName, args) => ipcRenderer.invoke('plugin:call', targetPluginId, fnName, args),
  emitEvent: (name, payload) => ipcRenderer.invoke('plugin:event:emit', name, payload),
  subscribe: (eventName) => ipcRenderer.send('plugin:event:subscribe', eventName),
  onEvent: (handler) => { try { ipcRenderer.on('plugin:event', (_e, { name, payload }) => handler && handler(name, payload)); } catch {} },
  configGetAll: (scope) => ipcRenderer.invoke('config:getAll', scope),
  configGet: (scope, key) => ipcRenderer.invoke('config:get', scope, key),
  configSet: (scope, key, value) => ipcRenderer.invoke('config:set', scope, key, value),
  configEnsureDefaults: (scope, defaults) => ipcRenderer.invoke('config:ensureDefaults', scope, defaults)
});
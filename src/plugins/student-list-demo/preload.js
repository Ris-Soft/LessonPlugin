const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pluginAPI', {
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
  register: (pluginId, functions) => {
    ipcRenderer.send('plugin:register', pluginId, functions);
  },
  call: (targetPluginId, fnName, args) => ipcRenderer.invoke('plugin:call', targetPluginId, fnName, args),
  onInvoke: (handler) => {
    ipcRenderer.on('plugin:invoke', async (_e, payload) => {
      try {
        const result = await handler(payload.fn, payload.args);
        ipcRenderer.send('plugin:invoke:result', payload.id, { ok: true, result });
      } catch (err) {
        ipcRenderer.send('plugin:invoke:result', payload.id, { ok: false, error: err?.message || String(err) });
      }
    });
  },
  subscribe: (eventName) => ipcRenderer.send('plugin:event:subscribe', eventName),
  emit: (eventName, payload) => ipcRenderer.invoke('plugin:event:emit', eventName, payload),
  onEvent: (handler) => {
    ipcRenderer.on('plugin:event', (_e, { name, payload }) => handler(name, payload));
  },
  // 档案管理/系统配置存取
  configGetAll: (scope) => ipcRenderer.invoke('config:getAll', scope),
  configGet: (scope, key) => ipcRenderer.invoke('config:get', scope, key),
  configSet: (scope, key, value) => ipcRenderer.invoke('config:set', scope, key, value),
  configEnsureDefaults: (scope, defaults) => ipcRenderer.invoke('config:ensureDefaults', scope, defaults),
  // 学生列表列定义（聚合自所有插件）
  profilesGetColumnDefs: () => ipcRenderer.invoke('profiles:columnDefs'),
  // 获取当前时间（按系统设置偏移与精确开关）
  getCurrentTime: () => ipcRenderer.invoke('system:getTime')
});
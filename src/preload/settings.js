const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  getPlugins: () => ipcRenderer.invoke('plugin:list'),
  togglePlugin: (name, enabled) => ipcRenderer.invoke('plugin:toggle', name, enabled),
  openPluginWindow: (name) => ipcRenderer.invoke('plugin:openWindow', name),
  installNpm: (name) => ipcRenderer.invoke('plugin:install', name),
  installPluginZip: (zipPath) => ipcRenderer.invoke('plugin:installZip', zipPath),
  installPluginZipData: (fileName, data) => ipcRenderer.invoke('plugin:installZipData', fileName, data),
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
  npmGetVersions: (name) => ipcRenderer.invoke('npm:versions', name),
  npmDownload: (name, version) => ipcRenderer.invoke('npm:download', name, version),
  npmSwitch: (pluginName, name, version) => ipcRenderer.invoke('npm:switch', pluginName, name, version)
  ,npmListInstalled: () => ipcRenderer.invoke('npm:installed'),
  // 档案管理：列定义
  profilesGetColumnDefs: () => ipcRenderer.invoke('profiles:columnDefs'),
  // 统一配置存储 API
  configGetAll: (scope) => ipcRenderer.invoke('config:getAll', scope),
  configGet: (scope, key) => ipcRenderer.invoke('config:get', scope, key),
  configSet: (scope, key, value) => ipcRenderer.invoke('config:set', scope, key, value),
  configEnsureDefaults: (scope, defaults) => ipcRenderer.invoke('config:ensureDefaults', scope, defaults),
  // 自动化管理 API
  automationList: () => ipcRenderer.invoke('automation:list'),
  automationGet: (id) => ipcRenderer.invoke('automation:get', id),
  automationCreate: (payload) => ipcRenderer.invoke('automation:create', payload),
  automationUpdate: (id, patch) => ipcRenderer.invoke('automation:update', id, patch),
  automationRemove: (id) => ipcRenderer.invoke('automation:remove', id),
  automationToggle: (id, enabled) => ipcRenderer.invoke('automation:toggle', id, enabled),
  automationInvokeProtocol: (text) => ipcRenderer.invoke('automation:invokeProtocol', text),
  automationTest: (id) => ipcRenderer.invoke('automation:test', id),
  // 插件自动化事件查询
  pluginAutomationListEvents: (pluginId) => ipcRenderer.invoke('plugin:automation:listEvents', pluginId),
  // 自动化执行确认覆盖层通信
  onAutomationConfirmInit: (handler) => {
    ipcRenderer.on('automation:confirm:init', (_e, payload) => handler && handler(payload));
  },
  automationConfirm: (id, approved) => {
    ipcRenderer.send('automation:confirm:result', id, !!approved);
  },
  // 系统接口
  getAppInfo: () => ipcRenderer.invoke('system:getAppInfo'),
  getAutostart: () => ipcRenderer.invoke('system:getAutostart'),
  setAutostart: (enabled, highPriority) => ipcRenderer.invoke('system:setAutostart', enabled, highPriority),
  getCurrentTime: () => ipcRenderer.invoke('system:getTime')
});
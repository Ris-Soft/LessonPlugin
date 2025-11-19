const { contextBridge, ipcRenderer } = require('electron');

// 注册到事件总线：记录当前窗口的 webContents 以便主进程路由事件
try { ipcRenderer.send('plugin:register', 'ui.lowbar', []); } catch {}

// 暴露模板专用 API，调用者可通过窗口参数进行定制
let __windowId = null;
contextBridge.exposeInMainWorld('lowbarAPI', {
  // 初始化参数下发
  onInit: (handler) => {
    ipcRenderer.on('lowbar:init', (_e, payload) => {
      try { if (payload && typeof payload.windowId === 'number') __windowId = payload.windowId; } catch {}
      try { handler(payload); } catch {}
    });
  },
  // 窗口控制（顶栏/底栏按钮调用）
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
  // 切换全屏（通过主进程插件函数，避免直接操作）
  toggleFullscreen: () => ipcRenderer.invoke('plugin:call', 'ui.lowbar', 'toggleFullscreen', __windowId),
  // 切换窗口置顶
  toggleAlwaysOnTop: () => ipcRenderer.invoke('plugin:call', 'ui.lowbar', 'toggleAlwaysOnTop', __windowId),
  // 切换窗口模式（可选）
  setWindowMode: (mode) => ipcRenderer.invoke('plugin:call', 'ui.lowbar', 'setWindowMode', mode, __windowId),
  // 提供事件上报用于按键点击
  emitEvent: (name, payload) => ipcRenderer.invoke('plugin:event:emit', name, payload),
  // 订阅事件总线（用于与调用方后端通讯）
  subscribe: (eventName) => ipcRenderer.send('plugin:event:subscribe', eventName),
  // 事件总线回调（接收调用方后端发来的更新）
  onEvent: (handler) => {
    try { ipcRenderer.on('plugin:event', (_e, { name, payload }) => handler && handler(name, payload)); } catch {}
  },
  // 直接调用其他插件后端函数（可选）
  pluginCall: (targetPluginId, fnName, args) => ipcRenderer.invoke('plugin:call', targetPluginId, fnName, args),
  
  // 统一配置存储（供模板直接读写配置）
  configGetAll: (scope) => ipcRenderer.invoke('config:getAll', scope),
  configGet: (scope, key) => ipcRenderer.invoke('config:get', scope, key),
  configSet: (scope, key, value) => ipcRenderer.invoke('config:set', scope, key, value),
  configEnsureDefaults: (scope, defaults) => ipcRenderer.invoke('config:ensureDefaults', scope, defaults)
});
const { contextBridge, ipcRenderer } = require('electron');

const __progressListeners = new Map();

contextBridge.exposeInMainWorld('settingsAPI', {
  getPlugins: () => ipcRenderer.invoke('plugin:list'),
  togglePlugin: (name, enabled) => ipcRenderer.invoke('plugin:toggle', name, enabled),
  installNpm: (name) => ipcRenderer.invoke('plugin:install', name),
  installPluginZip: (zipPath) => ipcRenderer.invoke('plugin:installZip', zipPath),
  installPluginZipData: (fileName, data) => ipcRenderer.invoke('plugin:installZipData', fileName, data),
  // 新增：安装前ZIP检查
  inspectPluginZip: (zipPath) => ipcRenderer.invoke('plugin:inspectZip', zipPath),
  inspectPluginZipData: (fileName, data) => ipcRenderer.invoke('plugin:inspectZipData', fileName, data),
  // 新增：打包插件/自动化为 zip (返回 Uint8Array buffer)
  packPlugin: (pluginId) => ipcRenderer.invoke('plugin:pack', pluginId),
  updatePluginVersion: (id, version) => ipcRenderer.invoke('plugin:updateVersion', id, version),
  packAutomation: (id) => ipcRenderer.invoke('automation:pack', id),
  uninstallPlugin: (name) => ipcRenderer.invoke('plugin:uninstall', name),
  // 新增：重载本地插件（仅开发环境）
  reloadPlugin: (name) => ipcRenderer.invoke('plugin:reload', name),
  // 新增：获取插件 README Markdown 文本（如果存在）
  getPluginReadme: (name) => ipcRenderer.invoke('plugin:readme', name),
  // 新增：在线获取插件 README（优先 npm registry）
  getPluginReadmeOnline: (name) => ipcRenderer.invoke('plugin:readmeOnline', name),
  // 新增：获取插件统计信息（大小、文件数、时间）
  getPluginStats: (name) => ipcRenderer.invoke('plugin:stats', name),
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
  showAppMenu: (coords) => ipcRenderer.invoke('settings:showMenu', coords),
  npmGetVersions: (name) => ipcRenderer.invoke('npm:versions', name),
  npmDownload: (name, version) => ipcRenderer.invoke('npm:download', name, version),
  npmSwitch: (pluginName, name, version) => ipcRenderer.invoke('npm:switch', pluginName, name, version)
  ,npmListInstalled: () => ipcRenderer.invoke('npm:installed'),
  npmModuleUsers: (name) => ipcRenderer.invoke('npm:moduleUsers', name),
  npmRemove: (name, versions) => ipcRenderer.invoke('npm:remove', name, versions),
  // 插件依赖状态与确保（下载+链接）
  pluginDepsStatus: (idOrName) => ipcRenderer.invoke('plugin:deps:status', idOrName),
  pluginEnsureDeps: (idOrName) => ipcRenderer.invoke('plugin:deps:ensure', idOrName),
  // 档案管理：列定义
  profilesGetColumnDefs: () => ipcRenderer.invoke('profiles:columnDefs'),
  // 统一配置存储 API
  configGetAll: (scope) => ipcRenderer.invoke('config:getAll', scope),
  configGet: (scope, key) => ipcRenderer.invoke('config:get', scope, key),
  configSet: (scope, key, value) => ipcRenderer.invoke('config:set', scope, key, value),
  configDeleteScope: (scope) => ipcRenderer.invoke('config:deleteScope', scope),
  configEnsureDefaults: (scope, defaults) => ipcRenderer.invoke('config:ensureDefaults', scope, defaults),
  configListScopes: () => ipcRenderer.invoke('config:listScopes'),
  configPluginGetAll: (pluginKey) => ipcRenderer.invoke('config:plugin:getAll', pluginKey),
  configPluginGet: (pluginKey, key) => ipcRenderer.invoke('config:plugin:get', pluginKey, key),
  configPluginSet: (pluginKey, key, value) => ipcRenderer.invoke('config:plugin:set', pluginKey, key, value),
  configPluginMigrateScope: (sourceScope, targetPluginKey, deleteSource) => ipcRenderer.invoke('config:plugin:migrateScope', sourceScope, targetPluginKey, deleteSource),
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
  // 新增：手动触发插件事件
  pluginEmitEvent: (eventName, payload) => ipcRenderer.invoke('plugin:event:emit', eventName, payload),
  // 为插件创建桌面快捷方式（包装自动化动作）
  pluginAutomationCreateShortcut: (pluginId, options) => ipcRenderer.invoke('plugin:automation:createShortcut', pluginId, options),
  // 直接调用插件函数（用于 actions 目标指向 functions 中的函数）
  pluginCall: (targetPluginId, fnName, args) => ipcRenderer.invoke('plugin:call', targetPluginId, fnName, args),
  // 动作名：聚合、默认映射与调用
  actionsList: () => ipcRenderer.invoke('actions:list'),
  actionsGetDefaults: () => ipcRenderer.invoke('actions:getDefaults'),
  actionsSetDefault: (actionId, pluginId) => ipcRenderer.invoke('actions:setDefault', actionId, pluginId),
  actionCall: (actionId, args, preferredPluginId) => ipcRenderer.invoke('actions:call', actionId, args, preferredPluginId),
  // 行为（behavior）：聚合、默认映射与调用
  behaviorsList: () => ipcRenderer.invoke('behaviors:list'),
  behaviorsGetDefaults: () => ipcRenderer.invoke('behaviors:getDefaults'),
  behaviorsSetDefault: (behaviorId, pluginId) => ipcRenderer.invoke('behaviors:setDefault', behaviorId, pluginId),
  behaviorCall: (behaviorId, args, preferredPluginId) => ipcRenderer.invoke('behaviors:call', behaviorId, args, preferredPluginId),
  // 插件变量：列表与取值
  pluginVariablesList: (pluginId) => ipcRenderer.invoke('plugin:variables:list', pluginId),
  pluginVariableGet: (pluginId, varName) => ipcRenderer.invoke('plugin:variables:get', pluginId, varName),
  // 组件管理：列表与入口URL
  componentsList: (group) => ipcRenderer.invoke('components:list', group),
  componentEntryUrl: (idOrName) => ipcRenderer.invoke('components:entryUrl', idOrName),
  // 设置页导航事件订阅（供主进程触发页面切换）
  onNavigate: (handler) => {
    ipcRenderer.on('settings:navigate', (_e, page) => handler && handler(page));
  },
  // 进度事件订阅（主进程通过 'plugin-progress' 推送）
  onProgress: (handler) => {
    try {
      const listener = (_e, payload) => handler && handler(payload);
      __progressListeners.set(handler, listener);
      ipcRenderer.on('plugin-progress', listener);
      return () => {
        const l = __progressListeners.get(handler);
        if (l) {
          ipcRenderer.removeListener('plugin-progress', l);
          __progressListeners.delete(handler);
        }
      };
    } catch (e) {}
  },
  // 取消进度事件订阅（用于安装完成后解绑）
  offProgress: (handler) => {
    try {
      const listener = __progressListeners.get(handler);
      if (listener) {
        ipcRenderer.removeListener('plugin-progress', listener);
        __progressListeners.delete(handler);
      }
    } catch (e) {}
  },
  // 打开插件信息模态框事件订阅
  onOpenPluginInfo: (handler) => {
    ipcRenderer.on('settings:openPluginInfo', (_e, pluginKey) => handler && handler(pluginKey));
  },
  onOpenStoreItem: (handler) => {
    ipcRenderer.on('settings:openStoreItem', (_e, payload) => handler && handler(payload));
  },
  onMarketInstall: (handler) => {
    ipcRenderer.on('settings:marketInstall', (_e, payload) => handler && handler(payload));
  },
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
  getCurrentTime: () => ipcRenderer.invoke('system:getTime'),
  getUserDataSize: () => ipcRenderer.invoke('system:getUserDataSize'),
  cleanupUserData: () => ipcRenderer.invoke('system:cleanupUserData'),
  getUserDataPath: () => ipcRenderer.invoke('system:getUserDataPath'),
  openUserData: () => ipcRenderer.invoke('system:openUserData'),
  changeUserData: () => ipcRenderer.invoke('system:changeUserData'),
  // 快速重启应用
  restartApp: () => ipcRenderer.invoke('system:restart'),
  // 图标释放（Canvas PNG -> 用户数据 renderer/icons）
  getIconsDir: () => ipcRenderer.invoke('icons:dir'),
  writeIconPng: (fileName, dataUrl) => ipcRenderer.invoke('icons:write', fileName, dataUrl),
  openIconsDir: async () => {
    const dir = await ipcRenderer.invoke('icons:dir');
    return require('electron').shell.openPath(dir);
  },
  openInstallDir: async () => ipcRenderer.invoke('system:openInstallDir'),
  quitApp: async () => ipcRenderer.invoke('system:quit'),
  uninstallAllPlugins: async () => ipcRenderer.invoke('plugin:uninstallAll'),
  // 检查与更新
  checkUpdate: (checkOnly) => ipcRenderer.invoke('system:checkUpdate', checkOnly),
  performUpdate: () => ipcRenderer.invoke('system:performUpdate'),
  // 查询依赖反向引用（依赖此插件的插件与自动化）
  pluginDependents: (idOrName) => ipcRenderer.invoke('plugin:dependents', idOrName),

  // 获取上次自动更新结果
  pluginGetLastAutoUpdateResult: () => ipcRenderer.invoke('plugin:lastAutoUpdateResult'),

  // Notification Test
  testNotification: (type) => ipcRenderer.invoke('notification:test', type),
  // 后端日志（调试）：获取最近记录与订阅实时日志
  backendLogsGet: () => ipcRenderer.invoke('debug:logs:get'),
  onBackendLog: (handler) => {
    const listener = (_e, line) => handler && handler(line);
    ipcRenderer.on('backend:log', listener);
    try { ipcRenderer.send('debug:logs:subscribe'); } catch (e) {}
    return () => {
      ipcRenderer.removeListener('backend:log', listener);
    };
  }
  ,
  consoleOpen: () => ipcRenderer.invoke('console:open'),
  backendLogWrite: (level, ...args) => ipcRenderer.invoke('debug:log:write', level, ...args)
});

const path = require('path');
const fs = require('fs');
const Registry = require('./Registry');
const Utils = require('./Utils');
const PackageManager = require('./PackageManager');
const Discovery = require('./Discovery');
const Installer = require('./Installer');
const Runtime = require('./Runtime');

// -------- 初始化 --------
module.exports.setMissingPluginHandler = function setMissingPluginHandler(handler) {
  Registry.setMissingPluginHandler(handler);
};

module.exports.setAutomationManager = function setAutomationManager(am) {
  Registry.setAutomationManager(am);
};

// 暴露规范化函数供主进程其它模块与IPC使用
module.exports.canonicalizePluginId = (key) => Registry.canonicalizePluginId(key);

module.exports.init = function init(paths) {
  Registry.init(paths);
  Discovery.scanPlugins();
  
  // 确保 config 对象包含所有必要的属性 (already done in Registry.init but safe to double check or just rely on Registry)
  PackageManager.refreshGlobalModulePaths();

  for (const p of Registry.manifest.plugins) {
    // 兼容旧配置：优先使用 id 键，其次回退 name 键
    if (typeof Registry.config.enabled[p.id] !== 'boolean' && typeof Registry.config.enabled[p.name] === 'boolean') {
      Registry.config.enabled[p.id] = !!Registry.config.enabled[p.name];
    }
    if (typeof Registry.config.enabled[p.id] !== 'boolean') {
      Registry.config.enabled[p.id] = !!p.enabled;
    }
  }
  Registry.saveConfig();
  Registry.actionRegistry = null;
  Registry.behaviorRegistry = null;
};

// -------- 插件加载与生命周期 --------
module.exports.loadPlugins = async function loadPlugins(onProgress) {
  // 保存进度报告函数，供插件入口通过 API 更新启动页状态
  Registry.setProgressReporter(typeof onProgress === 'function' ? onProgress : null);
  const statuses = [];
  for (const p of Registry.manifest.plugins) {
    const isComponent = String(p.type || '').toLowerCase() === 'component';
    const status = { name: p.name, stage: 'checking', message: '检查插件...' };
    statuses.push(status);
    onProgress && onProgress(status);

    if (!isComponent && p.npm) {
      status.stage = 'npm';
      status.message = `检测并准备安装NPM包: ${p.npm}`;
      onProgress && onProgress({ ...status });
      // 仅报告，实际安装由用户在设置页面触发，以避免启动阻塞
    }

    if (p.local) {
      const isEnabled = !!(Registry.config.enabled[p.id] ?? Registry.config.enabled[p.name]);
      if (!isEnabled) {
        status.stage = 'disabled';
        status.message = '插件已禁用，跳过初始化';
        onProgress && onProgress({ ...status });
        continue;
      }
      const localPath = path.resolve(Registry.pluginsRoot, p.local);
      if (fs.existsSync(localPath)) {
        status.stage = 'local';
        status.message = '本地插件就绪';
        
        // 注册后端函数（如存在），使插件无需打开窗口即可被调用
        try {
          const modPath = path.resolve(localPath, 'index.js');
          if (fs.existsSync(modPath)) {
            // 启动阶段仅链接已有依赖，不触发下载以加速启动
            try { await PackageManager.ensureDeps(p.id, { downloadIfMissing: false }); } catch (e) {}
            
            // 清除缓存以确保重载
            try { delete require.cache[require.resolve(modPath)]; } catch(e) {}
            
            const mod = require(modPath);
            // 仅从 functions 中注册函数，排除 actions
            const fnObj = (mod && typeof mod.functions === 'object') ? mod.functions : null;
            if (fnObj) {
              if (!Registry.functionRegistry.has(p.id)) Registry.functionRegistry.set(p.id, new Map());
              const map = Registry.functionRegistry.get(p.id);
              for (const [fn, impl] of Object.entries(fnObj)) {
                if (fn === 'actions') continue;
                if (typeof impl === 'function') map.set(fn, impl);
              }
            } else if (mod && typeof mod === 'object') {
              // 兼容直接导出函数的情况
              const keys = Object.keys(mod).filter(k => typeof mod[k] === 'function' && k !== 'init' && k !== 'functions');
              if (keys.length > 0) {
                 if (!Registry.functionRegistry.has(p.id)) Registry.functionRegistry.set(p.id, new Map());
                 const map = Registry.functionRegistry.get(p.id);
                 for (const k of keys) map.set(k, mod[k]);
              }
            }
            // 自动化事件：若插件导出 automationEvents，则直接注册以便设置页可查询
            if (mod && Array.isArray(mod.automationEvents)) {
              Runtime.registerAutomationEvents(p.id, mod.automationEvents);
            }
            // 允许插件入口在主进程侧使用 API；若 init 为异步，则等待完成
            if (mod && typeof mod.init === 'function') {
              try {
                // 报告插件初始化开始
                Registry.progressReporter && Registry.progressReporter({ stage: 'plugin:init', message: `初始化插件 ${p.name}...` });
                await Promise.resolve(mod.init(Runtime.createPluginApi(p.id, module.exports._ipcMain || require('electron').ipcMain)));
                // 报告插件初始化结束
                Registry.progressReporter && Registry.progressReporter({ stage: 'plugin:init', message: `插件 ${p.name} 初始化完成` });
              } catch (e) {
                Registry.progressReporter && Registry.progressReporter({ stage: 'plugin:error', message: `插件 ${p.name} 初始化失败：${e?.message || e}` });
              }
            }
          }
        } catch (e) {}
      } else {
        status.stage = 'missing';
        status.message = '本地插件路径不存在';
      }
      onProgress && onProgress({ ...status });
    }
  }
  return statuses;
};

module.exports.toggle = async function toggle(idOrName, enabled) {
  const p = Registry.findPluginByIdOrName(idOrName);
  if (!p) return { ok: false, error: 'not_found' };
  const logs = [];
  const canonId = p.id || p.name;
  // 更新配置
  Registry.config.enabled[p.id] = !!enabled;
  // 兼容旧键
  Registry.config.enabled[p.name] = !!enabled;
  Registry.saveConfig();

  try {
    if (!enabled) {
      try { console.info('plugin:toggle', { id: p.id, name: p.name, enabled: false }); } catch (e) {}
      logs.push(`[disable] 开始禁用插件 ${p.name}`);
      // 调用插件导出的生命周期函数进行清理
      try {
        const fnMap = Registry.functionRegistry.get(canonId);
        const disabledFn = fnMap && (fnMap.get('disabled') || fnMap.get('__plugin_disabled__'));
        if (typeof disabledFn === 'function') {
          disabledFn({ pluginId: canonId, name: p.name, version: p.version });
          logs.push('[disable] 已调用插件的禁用生命周期（disabled / __plugin_disabled__）');
        }
      } catch (e) {
        logs.push(`[disable] 调用禁用生命周期失败: ${e?.message || e}`);
      }
      // 触发插件禁用事件，便于插件自行清理资源（保持兼容事件名）
      try { Runtime.emitEvent('__plugin_disabled__', { pluginId: canonId, name: p.name, version: p.version }); } catch (e) {}
      // 清理事件订阅
      try {
        const winById = Registry.pluginWindows.get(p.id);
        const winByName = Registry.pluginWindows.get(p.name);
        const pluginWebContentsIds = [];
        if (winById?.webContents?.id) pluginWebContentsIds.push(winById.webContents.id);
        if (winByName?.webContents?.id && winByName !== winById) pluginWebContentsIds.push(winByName.webContents.id);
        for (const [eventName, subscriberSet] of Registry.eventSubscribers.entries()) {
          try { pluginWebContentsIds.forEach(id => subscriberSet.delete(id)); } catch (e) {}
          if (subscriberSet.size === 0) { try { Registry.eventSubscribers.delete(eventName); } catch (e) {} }
        }
      } catch (e) {}
      try { Registry.apiRegistry.delete(canonId); logs.push('[disable] 已清理已注册 API'); } catch (e) {}
      try { Registry.functionRegistry.delete(canonId); logs.push('[disable] 已清理已注册函数'); } catch (e) {}
      try { Registry.automationEventRegistry.delete(canonId); logs.push('[disable] 已清理自动化事件'); } catch (e) {}
      // 关闭窗口
      try {
        const winById = Registry.pluginWindows.get(p.id);
        const winByName = Registry.pluginWindows.get(p.name);
        if (winById) {
          try { if (winById.webContents && !winById.webContents.isDestroyed()) winById.webContents.destroy(); } catch (e) {}
          try { if (winById.destroy && !winById.isDestroyed()) winById.destroy(); } catch (e) {}
        }
        if (winByName && winByName !== winById) {
          try { if (winByName.webContents && !winByName.webContents.isDestroyed()) winByName.webContents.destroy(); } catch (e) {}
          try { if (winByName.destroy && !winByName.isDestroyed()) winByName.destroy(); } catch (e) {}
        }
        Registry.pluginWindows.delete(p.id);
        Registry.pluginWindows.delete(p.name);
        logs.push('[disable] 已关闭相关窗口');
      } catch (e) {}
      // 清理自动化触发器
      try {
        if (Registry.automationManagerRef) {
          try { Registry.automationManagerRef.clearPluginMinuteTriggers(canonId); logs.push('[disable] 已清理分钟触发器'); } catch (e) {}
          try { if (typeof Registry.automationManagerRef.clearPluginTimers === 'function') Registry.automationManagerRef.clearPluginTimers(canonId); } catch (e) {}
        }
      } catch (e) {}
      logs.push(`[disable] 插件 ${p.name} 已禁用`);
    } else {
      try { console.info('plugin:toggle', { id: p.id, name: p.name, enabled: true }); } catch (e) {}
      logs.push(`[enable] 开始启用插件 ${p.name}`);
      const baseDir = p.local ? path.join(Registry.pluginsRoot, p.local) : null;
      const modPath = baseDir ? path.resolve(baseDir, 'index.js') : null;
      try { if (modPath) { delete require.cache[require.resolve(modPath)]; } } catch (e) {}
      if (modPath && fs.existsSync(modPath)) {
        try {
          // 启用前确保依赖注入到插件目录
          try {
            const depsRes = await PackageManager.ensureDeps(p.id);
            try { console.info('plugin:deps', { id: p.id, name: p.name, ok: !!depsRes?.ok }); } catch (e) {}
          } catch (e) {}
          const mod = require(modPath);
          // 注册函数
          const fnObj = (mod && typeof mod.functions === 'object') ? mod.functions : null;
          if (fnObj) {
            if (!Registry.functionRegistry.has(p.id)) Registry.functionRegistry.set(p.id, new Map());
            const map = Registry.functionRegistry.get(p.id);
            for (const [fn, impl] of Object.entries(fnObj)) {
              if (fn === 'actions') continue;
              if (typeof impl === 'function') map.set(fn, impl);
            }
            logs.push('[enable] 已注册后端函数');
          } else if (mod && typeof mod === 'object') {
             // 兼容直接导出函数的情况
             const keys = Object.keys(mod).filter(k => typeof mod[k] === 'function' && k !== 'init' && k !== 'functions');
             if (keys.length > 0) {
                if (!Registry.functionRegistry.has(p.id)) Registry.functionRegistry.set(p.id, new Map());
                const map = Registry.functionRegistry.get(p.id);
                for (const k of keys) map.set(k, mod[k]);
                logs.push(`[enable] 已注册顶层导出函数: ${keys.join(', ')}`);
             }
          }
          // 注册自动化事件
          if (mod && Array.isArray(mod.automationEvents)) {
            Runtime.registerAutomationEvents(p.id, mod.automationEvents);
            logs.push('[enable] 已注册自动化事件');
          }
          // 执行 init
          if (mod && typeof mod.init === 'function') {
            logs.push(`[enable] 正在初始化 ${p.name} ...`);
            try {
              await Promise.resolve(mod.init(Runtime.createPluginApi(p.id, module.exports._ipcMain || require('electron').ipcMain)));
              logs.push(`[enable] 插件 ${p.name} 初始化完成`);
              try { console.info('plugin:init_done', { id: p.id, name: p.name }); } catch (e) {}
            } catch (e) {
              // 捕获插件初始化错误并显示在日志中
              logs.push(`[enable] 插件 ${p.name} 初始化失败：${e?.message || e}`);
              // 同时记录到后端日志
              try { console.error(`[PluginError] [${p.name}] Init Failed:`, e); } catch (ex) {}
              try { console.info('plugin:init_failed', { id: p.id, name: p.name, error: e?.message || String(e) }); } catch (e) {}
            }
          }
        } catch (e) {
          // 捕获模块加载错误（如语法错误）
          logs.push(`[enable] 启用失败：${e?.message || String(e)}`);
          try { console.error(`[PluginError] [${p.name}] Enable Failed:`, e); } catch (ex) {}
          try { console.info('plugin:enable_failed', { id: p.id, name: p.name, error: e?.message || String(e) }); } catch (e) {}
        }
      } else {
        logs.push('[enable] 未找到本地入口 index.js，跳过注册/初始化');
      }
    }
  } catch (e) {}

  return { ok: true, id: p.id, name: p.name, enabled: !!enabled, logs };
};

module.exports.closeAllWindows = function closeAllWindows() {
  for (const w of (Registry.windows || [])) { // Wait, Registry doesn't have `windows` array, main.js had `let windows = []` but it seemed unused or only for generic windows?
    // main.js line 22: let windows = [];
    // main.js line 1018: for (const w of windows) ...
    // But where are windows added to this array? I don't see `windows.push` in main.js.
    // It seems `windows` array in main.js was unused or legacy.
    // I will ignore it.
    try {
      if (!w.isDestroyed()) w.destroy();
    } catch (e) {}
  }
  
  // 同步清理插件窗口与事件订阅
  try {
    for (const [key, w] of Registry.pluginWindows.entries()) {
      const wc = (w && w.webContents) ? w.webContents : null;
      try { if (wc && !wc.isDestroyed()) wc.destroy(); } catch (e) {}
      try { if (w && typeof w.destroy === 'function' && !w.isDestroyed()) w.destroy(); } catch (e) {}
    }
    Registry.pluginWindows.clear();
  } catch (e) {}
  try { Registry.eventSubscribers.clear(); } catch (e) {}
};

module.exports.getPluginStats = async function getPluginStats(idOrName) {
  try {
    const p = Registry.findPluginByIdOrName(idOrName);
    if (!p) return { ok: false, error: 'plugin_not_found' };
    if (!p.local) return { ok: false, error: 'plugin_not_local' };
    const baseDir = path.resolve(Registry.pluginsRoot, p.local);
    if (!fs.existsSync(baseDir)) return { ok: false, error: 'dir_not_found' };
    
    // 递归计算目录大小和文件数
    let size = 0;
    let files = 0;
    let birthtime = 0; // 最早创建时间
    let mtime = 0; // 最新修改时间
    
    const walk = (dir) => {
      const list = fs.readdirSync(dir);
      for (const item of list) {
        if (item === 'node_modules' || item.startsWith('.')) continue; // 跳过 node_modules 和隐藏文件
        const full = path.join(dir, item);
        try {
          const s = fs.statSync(full);
          if (s.isDirectory()) {
            walk(full);
          } else {
            size += s.size;
            files++;
            if (birthtime === 0 || s.birthtimeMs < birthtime) birthtime = s.birthtimeMs;
            if (s.mtimeMs > mtime) mtime = s.mtimeMs;
          }
        } catch (e) {}
      }
    };
    
    walk(baseDir);
    
    // 如果没有文件，取目录时间
    if (files === 0) {
      try {
        const s = fs.statSync(baseDir);
        birthtime = s.birthtimeMs;
        mtime = s.mtimeMs;
      } catch (e) {}
    }
    
    return { ok: true, stats: { size, files, birthtime, mtime } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

// -------- 导出各模块功能 --------

// Registry / Query
module.exports.getPlugins = function getPlugins() {
  return Registry.manifest.plugins.map((p) => ({
    id: p.id,
    name: p.name,
    npm: p.npm || null,
    local: p.local || null,
    enabled: !!(Registry.config.enabled[p.id] ?? Registry.config.enabled[p.name]),
    icon: p.icon || null,
    description: p.description || '',
    author: (p.author !== undefined ? p.author : null),
    type: p.type || 'plugin',
    group: p.group || null,
    entry: p.entry || null,
    npmDependencies: (typeof p.npmDependencies === 'object' && !Array.isArray(p.npmDependencies) ? p.npmDependencies : undefined),
    actions: Array.isArray(p.actions) ? p.actions : [],
    version: p.version || (Registry.config.npmSelection[p.id]?.version || Registry.config.npmSelection[p.name]?.version || null),
    studentColumns: Array.isArray(p.studentColumns) ? p.studentColumns : [],
    // 输出标准插件依赖字段 dependencies（数组），兼容旧存储
    dependencies: Array.isArray(p.dependencies) ? p.dependencies : (Array.isArray(p.pluginDepends) ? p.pluginDepends : undefined),
    configSchema: (Array.isArray(p.configSchema) || (p.configSchema && typeof p.configSchema === 'object')) ? p.configSchema : undefined
  }));
};

module.exports.findPluginByIdOrName = (key) => Registry.findPluginByIdOrName(key);
module.exports.getPluginDir = (idOrName) => Registry.getPluginDir(idOrName);

// 新增：读取插件 README 文本（优先本地插件目录）
module.exports.getPluginReadme = function getPluginReadme(idOrName) {
  try {
    const p = Registry.findPluginByIdOrName(idOrName);
    if (!p) return null;
    // 仅支持本地插件目录读取（npm 包暂不提供 README 路径）
    const baseDir = Registry.pluginsRoot;
    const fullDir = p.local ? path.join(baseDir, p.local) : null;
    if (fullDir && fs.existsSync(fullDir)) {
      const candidates = ['README.md', 'readme.md', 'README', 'readme'];
      for (const name of candidates) {
        const f = path.join(fullDir, name);
        if (fs.existsSync(f) && fs.statSync(f).isFile()) {
          try { return fs.readFileSync(f, 'utf-8'); } catch (e) {}
        }
      }
    }
    return null;
  } catch (e) { return null; }
};

// PackageManager
module.exports.ensureDeps = PackageManager.ensureDeps;
module.exports.getPluginDependencyStatus = PackageManager.getPluginDependencyStatus;
module.exports.installNpm = PackageManager.installNpm;
module.exports.listInstalledPackages = PackageManager.listInstalledPackages;
module.exports.listPackageUsers = PackageManager.listPackageUsers;
module.exports.removePackageVersions = PackageManager.removePackageVersions;
module.exports.getPackageVersions = PackageManager.getPackageVersions;
module.exports.downloadPackageVersion = PackageManager.downloadPackageVersion;
module.exports.switchPluginVersion = PackageManager.switchPluginVersion;

// Installer
module.exports.uninstall = Installer.uninstall;
module.exports.installFromZip = Installer.installFromZip;
module.exports.inspectZip = Installer.inspectZip;
module.exports.updatePluginVersion = Installer.updatePluginVersion;

// Runtime
module.exports.registerFunctions = Runtime.registerFunctions;
module.exports.registerAutomationEvents = Runtime.registerAutomationEvents;
module.exports.listAutomationEvents = Runtime.listAutomationEvents;
module.exports.callFunction = (target, fn, args, caller) => Runtime.callFunction(target, fn, args, caller, module.exports._ipcMain || require('electron').ipcMain);
module.exports.getPluginIdByWebContentsId = Runtime.getPluginIdByWebContentsId;
module.exports.subscribeEvent = Runtime.subscribeEvent;
module.exports.emitEvent = Runtime.emitEvent;
module.exports.listActions = Runtime.listActions;
module.exports.callAction = (id, args, pref) => Runtime.callAction(id, args, pref, module.exports._ipcMain || require('electron').ipcMain);
module.exports.setDefaultAction = Runtime.setDefaultAction;
module.exports.listBehaviors = Runtime.listBehaviors;
module.exports.callBehavior = (id, args, pref) => Runtime.callBehavior(id, args, pref, module.exports._ipcMain || require('electron').ipcMain);
module.exports.setDefaultBehavior = Runtime.setDefaultBehavior;
module.exports.listComponents = Runtime.listComponents;
module.exports.getComponentEntryUrl = Runtime.getComponentEntryUrl;


// Aggregation / Helpers
module.exports.getStudentColumnDefs = function getStudentColumnDefs() {
  try {
    const defs = [];
    const seen = new Set();
    for (const p of Registry.manifest.plugins) {
      const cols = Array.isArray(p.studentColumns) ? p.studentColumns : [];
      for (const c of cols) {
        const key = String(c?.key || '').trim();
        const label = String(c?.label || key).trim();
        if (!key) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        defs.push({ key, label });
      }
    }
    return { ok: true, columns: defs };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

module.exports.listDependents = function listDependents(idOrName) {
  try {
    const canonId = Registry.nameToId.get(idOrName) || idOrName;
    // 依赖此插件的其他插件（按 dependencies 声明，支持 name@version 形式）
    const pluginDeps = (Registry.manifest.plugins || []).filter((p) => {
      const deps = Array.isArray(p.dependencies) ? p.dependencies : (Array.isArray(p.pluginDepends) ? p.pluginDepends : []);
      return deps.some((d) => {
        const base = String(d).split('@')[0].trim();
        const targetCanon = Registry.nameToId.get(base) || base;
        return targetCanon === canonId;
      });
    }).map((p) => ({ id: p.id, name: p.name }));
    // 引用此插件的自动化（actions 中包含 pluginAction 或 pluginEvent 的 pluginId）
    const autos = [];
    try {
      const items = Array.isArray(Registry.automationManagerRef?.items) ? Registry.automationManagerRef.items : [];
      for (const it of items) {
        const actions = Array.isArray(it.actions) ? it.actions : [];
        const uses = actions.some((a) => {
          if (!a || typeof a !== 'object') return false;
          if (a.type === 'pluginAction' || a.type === 'pluginEvent') {
            const pid = a.pluginId;
            const canon = Registry.nameToId.get(pid) || pid;
            return canon === canonId;
          }
          return false;
        });
        if (uses) autos.push({ id: it.id, name: it.name, enabled: !!it.enabled });
      }
    } catch (e) {}
    return { ok: true, plugins: pluginDeps, automations: autos };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

// -------- 插件变量：列表与取值 --------
module.exports.listVariables = async function listVariables(idOrName) {
  try {
    const p = Registry.findPluginByIdOrName(idOrName);
    if (!p) return { ok: false, error: 'plugin_not_found' };
    let names = [];
    try {
      if (Array.isArray(p.variables)) {
        names = p.variables.map((x) => String(x));
      } else if (p.variables && typeof p.variables === 'object') {
        names = Object.keys(p.variables);
      }
    } catch (e) {}
    if (names.length) return { ok: true, variables: names };
    // 回退：调用插件的 listVariables 函数（若实现）
    try {
      // 增加超时控制，防止插件无响应导致 UI 卡死
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ ok: false, error: 'timeout' }), 1000));
      const callPromise = Runtime.callFunction(p.id || p.name, 'listVariables', [], null, module.exports._ipcMain || require('electron').ipcMain);
      const res = await Promise.race([callPromise, timeoutPromise]);
      
      const payload = res?.result ?? res;
      if (res?.ok) {
        if (Array.isArray(payload)) return { ok: true, variables: payload.map((x) => String(x)) };
        if (payload && typeof payload === 'object') return { ok: true, variables: Object.keys(payload) };
      }
    } catch (e) {}
    return { ok: true, variables: [] };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

module.exports.getVariable = async function getVariable(idOrName, varName) {
  try {
    const p = Registry.findPluginByIdOrName(idOrName);
    if (!p) return { ok: false, error: 'plugin_not_found' };
    const name = String(varName || '').trim();
    if (!name) return { ok: false, error: 'variable_required' };
    // 若 plugin.json.variables 为对象 { key: fnName }，优先按映射调用
    try {
      if (p.variables && typeof p.variables === 'object' && !Array.isArray(p.variables)) {
        const fn = p.variables[name];
        if (fn && typeof fn === 'string') {
          return Runtime.callFunction(p.id || p.name, fn, [], null, module.exports._ipcMain || require('electron').ipcMain);
        }
      }
    } catch (e) {}
    // 标准函数：getVariable(name)
    return Runtime.callFunction(p.id || p.name, 'getVariable', [name], null, module.exports._ipcMain || require('electron').ipcMain);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

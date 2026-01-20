const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const Registry = require('./Registry');
const Utils = require('./Utils');
const PackageManager = require('./PackageManager');
const Runtime = require('./Runtime');

// -------- 卸载本地插件（仅 local 插件） --------
function uninstall(idOrName) {
  try {
    const idx = Registry.manifest.plugins.findIndex((p) => p.id === idOrName || p.name === idOrName);
    if (idx < 0) return { ok: false, error: 'not_found' };
    const p = Registry.manifest.plugins[idx];
    try { console.info('plugin:uninstall', { id: p.id, name: p.name }); } catch (e) {}
    
    // 不允许卸载由插件提供的组件
    if (p.sourcePlugin) return { ok: false, error: 'plugin_provided_component' };

    // 仅支持卸载本地插件
    if (!p.local) return { ok: false, error: 'not_local_plugin' };
    const fullDir = path.join(path.dirname(Registry.manifestPath), p.local);
    
    // 获取插件的规范化ID用于清理各种注册项
    const canonId = p.id || p.name;
    // 调用插件导出的生命周期函数进行清理
    try {
      const fnMap = Registry.functionRegistry.get(canonId);
      const uninstallFn = fnMap && (fnMap.get('uninstall') || fnMap.get('__plugin_uninstall__'));
      if (typeof uninstallFn === 'function') {
        uninstallFn({ pluginId: canonId, name: p.name, version: p.version });
        console.log(`[uninstall] 已调用插件 ${p.name} 的卸载生命周期（uninstall / __plugin_uninstall__）`);
      }
    } catch (e) {
      console.log(`[uninstall] 调用插件 ${p.name} 的卸载生命周期失败: ${e?.message || e}`);
    }
    // 触发插件卸载事件，通知前端与其他插件及时清理（保持兼容事件名）
    try { Runtime.emitEvent('__plugin_uninstall__', { pluginId: canonId, name: p.name, version: p.version }); } catch (e) {}
    
    // 1. 先收集插件窗口信息（用于后续清理）
    const winById = Registry.pluginWindows.get(p.id);
    const winByName = Registry.pluginWindows.get(p.name);
    const pluginWebContentsIds = [];
    
    if (winById?.webContents?.id) {
      pluginWebContentsIds.push(winById.webContents.id);
    }
    if (winByName?.webContents?.id && winByName !== winById) {
      pluginWebContentsIds.push(winByName.webContents.id);
    }
    
    try {
      // 2. 清理插件的事件订阅（在关闭窗口前进行）
      for (const [eventName, subscriberSet] of Registry.eventSubscribers.entries()) {
        pluginWebContentsIds.forEach(id => subscriberSet.delete(id));
        // 如果该事件没有订阅者了，删除整个事件
        if (subscriberSet.size === 0) {
          Registry.eventSubscribers.delete(eventName);
        }
      }
    } catch (e) {}
    
    try {
      // 3. 清理插件注册的API和函数
      Registry.apiRegistry.delete(canonId);
      Registry.functionRegistry.delete(canonId);
    } catch (e) {}
    
    try {
      // 4. 清理插件注册的自动化事件
      Registry.automationEventRegistry.delete(canonId);
    } catch (e) {}
    
    try {
      // 5. 关闭该插件所有已打开的窗口
      // 处理通过ID注册的窗口
      if (winById) {
        if (winById.webContents && !winById.webContents.isDestroyed()) {
          try { winById.webContents.destroy(); } catch (e) {}
        }
        if (winById.destroy && !winById.isDestroyed()) {
          try { winById.destroy(); } catch (e) {}
        }
      }
      
      // 处理通过名称注册的窗口（可能与ID窗口不同）
      if (winByName && winByName !== winById) {
        if (winByName.webContents && !winByName.webContents.isDestroyed()) {
          try { winByName.webContents.destroy(); } catch (e) {}
        }
        if (winByName.destroy && !winByName.isDestroyed()) {
          try { winByName.destroy(); } catch (e) {}
        }
      }
      
      // 从窗口注册表中移除
      Registry.pluginWindows.delete(p.id);
      Registry.pluginWindows.delete(p.name);
    } catch (e) {}
    
    try {
      // 5. 清理插件的分钟触发器和计时器（通过自动化管理器）
      if (Registry.automationManagerRef) {
        try {
          Registry.automationManagerRef.clearPluginMinuteTriggers(canonId);
        } catch (e) {}
        
        // 清理插件计时器（如果自动化管理器有相关方法）
        try {
          if (typeof Registry.automationManagerRef.clearPluginTimers === 'function') {
            Registry.automationManagerRef.clearPluginTimers(canonId);
          }
        } catch (e) {}
      }
    } catch (e) {}
    
    try {
      // 6. 删除插件目录
      if (fs.existsSync(fullDir)) fs.rmSync(fullDir, { recursive: true, force: true });
    } catch (e) {}
    
    // 7. 从清单与配置移除
    Registry.manifest.plugins.splice(idx, 1);
    try { delete Registry.config.enabled[p.id]; } catch (e) {}
    try { delete Registry.config.enabled[p.name]; } catch (e) {}
    Registry.saveConfig();
    
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// -------- ZIP 安装插件 --------
async function installFromZip(zipPath) {
  try {
    const pluginsRootLocal = path.dirname(Registry.manifestPath);
    const tempId = `plugin_tmp_${Date.now()}`;
    const tempDir = path.join(pluginsRootLocal, tempId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const unzip = await Utils.expandZip(zipPath, tempDir);
    if (!unzip.ok) return { ok: false, error: unzip.error };

    // 读取插件元数据（先从plugin.json，再从package.json回退）
    let meta = {};
    const metaPath = path.join(tempDir, 'plugin.json');
    if (fs.existsSync(metaPath)) {
      meta = Utils.readJsonSafe(metaPath, {});
    }
    const pkgPath = path.join(tempDir, 'package.json');
    let pkg = null;
    if (fs.existsSync(pkgPath)) { try { pkg = Utils.readJsonSafe(pkgPath, {}); } catch (e) {} }
    let detectedVersion = meta.version || (pkg?.version || null);

    // 检查入口
    const indexPathTmp = path.join(tempDir, 'index.js');
    const isComponent = String(meta?.type || '').toLowerCase() === 'component';
    const entryHtml = meta?.entry || 'index.html';
    const entryPathTmp = path.join(tempDir, entryHtml);

    if (!fs.existsSync(indexPathTmp)) {
      if (!isComponent || !fs.existsSync(entryPathTmp)) {
        return { ok: false, error: isComponent ? `组件缺少入口文件 ${entryHtml}` : '安装包缺少 index.js' };
      }
    }
    // 获取插件名称（优先 meta.name，其次从入口导出）
    let pluginName = meta.name;
    if (!pluginName && fs.existsSync(indexPathTmp)) {
      try {
        const mod = require(indexPathTmp);
        if (mod?.name) pluginName = mod.name;
      } catch (e) {}
    }
    if (!pluginName) pluginName = 'plugin';

    // 计算稳定目录名：优先 meta.id，否则使用名称 slug
    const pluginId = Utils.generateStableId(meta.id, pluginName, '', 'plugin');
    const finalDir = path.join(pluginsRootLocal, pluginId);

    // 若已存在同名目录，先删除以避免残留
    try {
      if (fs.existsSync(finalDir)) {
        fs.rmSync(finalDir, { recursive: true, force: true });
      }
    } catch (e) {}
    // 将临时目录重命名为稳定目录，失败则复制回退
    try {
      fs.renameSync(tempDir, finalDir);
    } catch (e) {
      try {
        fs.mkdirSync(finalDir, { recursive: true });
        const copyDir = (src, dst) => {
          const names = fs.readdirSync(src);
          for (const name of names) {
            const s = path.join(src, name);
            const d = path.join(dst, name);
            const stat = fs.statSync(s);
            if (stat.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyDir(s, d); }
            else { fs.copyFileSync(s, d); }
          }
        };
        copyDir(tempDir, finalDir);
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (err) {
        return { ok: false, error: '移动插件目录失败：' + (err?.message || String(err)) };
      }
    }

    // Node 模块补全：如果声明packages，尝试下载，否则要求手动导入
    if (Array.isArray(meta.packages)) {
      for (const pkgDef of meta.packages) {
        const versions = Array.isArray(pkgDef.versions) ? pkgDef.versions : (pkgDef.version ? [pkgDef.version] : []);
        for (const v of versions) {
          const segs = String(pkgDef.name).split('/').filter(Boolean);
          const destPath = path.join(Registry.storeRoot, ...segs, v, 'node_modules', ...segs);
          if (fs.existsSync(destPath)) continue; // 已有版本
          const dl = await PackageManager.downloadPackageVersion(pkgDef.name, v);
          if (!dl.ok) {
            // 无法下载且本地不存在
            return { ok: false, error: `无法下载依赖 ${pkgDef.name}@${v}，请手动导入到 src/npm_store/${segs.join('/')}/${v}/node_modules/${segs.join('/')}` };
          }
        }
      }
    }

    // 如存在同名或同ID插件，先清理其已注册资源与窗口，避免残留
    const existingIdx = Registry.manifest.plugins.findIndex((pp) => pp.id === pluginId || pp.name === pluginName);
    if (existingIdx >= 0) {
      const canonId = Registry.manifest.plugins[existingIdx].id || Registry.manifest.plugins[existingIdx].name;
      try {
        // 收集该插件相关的 webContents ID 并从事件订阅中移除
        const ids = [];
        const winById = Registry.pluginWindows.get(canonId);
        const winByName = Registry.pluginWindows.get(Registry.manifest.plugins[existingIdx].name);
        if (winById?.webContents?.id) ids.push(winById.webContents.id);
        if (winByName?.webContents?.id && winByName !== winById) ids.push(winByName.webContents.id);
        for (const [eventName, subs] of Registry.eventSubscribers.entries()) {
          ids.forEach((id) => subs.delete(id));
          if (subs.size === 0) Registry.eventSubscribers.delete(eventName);
        }
      } catch (e) {}
      try {
        Registry.apiRegistry.delete(canonId);
        Registry.functionRegistry.delete(canonId);
        Registry.automationEventRegistry.delete(canonId);
      } catch (e) {}
      try {
        const w1 = Registry.pluginWindows.get(canonId);
        const w2 = Registry.pluginWindows.get(Registry.manifest.plugins[existingIdx].name);
        for (const w of [w1, w2]) {
          if (!w) continue;
          try { if (w.webContents && !w.webContents.isDestroyed()) w.webContents.destroy(); } catch (e) {}
          try { if (w.destroy && !w.isDestroyed()) w.destroy(); } catch (e) {}
        }
        Registry.pluginWindows.delete(canonId);
        Registry.pluginWindows.delete(Registry.manifest.plugins[existingIdx].name);
      } catch (e) {}
      try {
        if (Registry.automationManagerRef) {
          try { Registry.automationManagerRef.clearPluginMinuteTriggers(canonId); } catch (e) {}
          try { if (typeof Registry.automationManagerRef.clearPluginTimers === 'function') Registry.automationManagerRef.clearPluginTimers(canonId); } catch (e) {}
        }
      } catch (e) {}
    }

    // 更新内存清单（使用稳定目录），若存在则覆盖更新
    const rel = path.relative(path.dirname(Registry.manifestPath), finalDir).replace(/\\/g, '/');
      const updated = {
        id: pluginId,
        name: pluginName,
      local: rel,
      enabled: true,
      icon: meta.icon || null,
      description: meta.description || '',
      author: (meta.author !== undefined ? meta.author : (pkg?.author || null)),
      // 统一 npmDependencies：仅接收对象（非数组）；dependencies 为数组表示插件依赖
      npmDependencies: (() => {
        if (meta && typeof meta.npmDependencies === 'object' && !Array.isArray(meta.npmDependencies)) return meta.npmDependencies;
        if (meta && typeof meta.dependencies === 'object' && !Array.isArray(meta.dependencies)) return meta.dependencies;
        if (pkg && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)) return pkg.dependencies;
        return undefined;
      })(),
      // 兼容新旧清单：优先顶层 actions，其次回退到 functions.actions（旧格式）
      actions: Array.isArray(meta.actions) ? meta.actions : (Array.isArray(meta?.functions?.actions) ? meta.functions.actions : []),
      // 保留 functions 以备后续扩展（如声明 backend 名称等）
      functions: typeof meta.functions === 'object' ? meta.functions : undefined,
      packages: Array.isArray(meta.packages) ? meta.packages : undefined,
      version: detectedVersion,
      studentColumns: Array.isArray(meta.studentColumns) ? meta.studentColumns : [],
      // 统一插件依赖为 dependencies（数组），兼容旧字段 pluginDepends
      dependencies: Array.isArray(meta.dependencies) ? meta.dependencies : (Array.isArray(meta.pluginDepends) ? meta.pluginDepends : undefined),
      // 新增：变量声明
      variables: (() => {
        try {
          if (Array.isArray(meta.variables)) return meta.variables.map((x) => String(x));
          if (meta && typeof meta.variables === 'object' && meta.variables) return meta.variables;
        } catch (e) {}
        return undefined;
      })(),
      configSchema: (() => {
        try {
          if (Array.isArray(meta.configSchema)) return meta.configSchema;
          if (meta && typeof meta.configSchema === 'object' && meta.configSchema) return meta.configSchema;
          if (Array.isArray(meta.config)) return meta.config;
          if (meta && typeof meta.config === 'object' && meta.config) return meta.config;
        } catch (e) {}
        return undefined;
      })()
    };
    if (existingIdx >= 0) {
      Registry.manifest.plugins[existingIdx] = updated;
    } else {
      Registry.manifest.plugins.push(updated);
    }
    Registry.nameToId.set(pluginName, pluginId);
    if (typeof Registry.config.enabled[pluginId] !== 'boolean') {
      Registry.config.enabled[pluginId] = true;
      // 兼容旧键
      Registry.config.enabled[pluginName] = true;
      Registry.saveConfig();
    }

    // 重新注册并初始化插件核心资源（functions、automationEvents），并执行插件自身 init
    const logs = [];
    try {
      const modPath = path.resolve(finalDir, 'index.js');
      try { delete require.cache[require.resolve(modPath)]; } catch (e) {}
      if (fs.existsSync(modPath)) {
        const mod = require(modPath);
        // 注册主进程函数
        const fnObj = (mod && typeof mod.functions === 'object') ? mod.functions : null;
        if (fnObj) {
          if (!Registry.functionRegistry.has(pluginId)) Registry.functionRegistry.set(pluginId, new Map());
          const map = Registry.functionRegistry.get(pluginId);
          for (const [fn, impl] of Object.entries(fnObj)) {
            if (fn === 'actions') continue;
            if (typeof impl === 'function') map.set(fn, impl);
          }
        }
        // 注册自动化事件（若插件导出）
        if (mod && Array.isArray(mod.automationEvents)) {
          Runtime.registerAutomationEvents(pluginId, mod.automationEvents);
          logs.push('[install] 已注册自动化事件');
        }
        // 执行插件初始化
        if (mod && typeof mod.init === 'function') {
          try {
            Registry.progressReporter && Registry.progressReporter({ stage: 'plugin:init', message: `初始化插件 ${pluginName}...` });
            await Promise.resolve(mod.init(Runtime.createPluginApi(pluginId, require('electron').ipcMain)));
            Registry.progressReporter && Registry.progressReporter({ stage: 'plugin:init', message: `插件 ${pluginName} 初始化完成` });
            logs.push(`[install] 插件 ${pluginName} 初始化完成`);
            try { console.info('plugin:init_done', { id: pluginId, name: pluginName }); } catch (e) {}
          } catch (e) {
            Registry.progressReporter && Registry.progressReporter({ stage: 'plugin:error', message: `插件 ${pluginName} 初始化失败：${e?.message || e}` });
            logs.push(`[install] 插件 ${pluginName} 初始化失败：${e?.message || e}`);
            try { console.info('plugin:init_failed', { id: pluginId, name: pluginName, error: e?.message || String(e) }); } catch (e) {}
          }
        }
      }
    } catch (e) {}

    try { console.info('plugin:install_success', { id: pluginId, name: pluginName }); } catch (e) {}
    return { ok: true, id: pluginId, name: pluginName, author: (meta.author !== undefined ? meta.author : (pkg?.author || null)), npmDependencies: updated.npmDependencies, dependencies: (typeof meta.dependencies === 'object' ? meta.dependencies : (pkg?.dependencies || undefined)), pluginDepends: Array.isArray(meta.pluginDepends) ? meta.pluginDepends : undefined, logs };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function inspectZip(zipPath) {
  try {
    const pluginsRootLocal = path.dirname(Registry.manifestPath);
    const tempId = `plugin_inspect_${Date.now()}`;
    const tempDir = path.join(pluginsRootLocal, tempId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const unzip = await Utils.expandZip(zipPath, tempDir);
    if (!unzip.ok) return { ok: false, error: unzip.error };
    // 读取元数据
    let meta = {};
    const metaPath = path.join(tempDir, 'plugin.json');
    if (fs.existsSync(metaPath)) meta = Utils.readJsonSafe(metaPath, {});
    const pkgPath = path.join(tempDir, 'package.json');
    let pkg = null;
    if (fs.existsSync(pkgPath)) { try { pkg = Utils.readJsonSafe(pkgPath, {}); } catch (e) {} }
    const indexPathTmp = path.join(tempDir, 'index.js');
    let pluginName = meta.name;
    if (!pluginName) {
      try { const mod = require(indexPathTmp); if (mod?.name) pluginName = mod.name; } catch (e) {}
    }
    if (!pluginName) pluginName = 'plugin';
    const pluginId = Utils.generateStableId(meta.id, pluginName, '', 'plugin');
    const detectedVersion = meta.version || (pkg?.version || null);
    const info = {
      ok: true,
      id: pluginId,
      name: pluginName,
      author: (meta.author !== undefined ? meta.author : (pkg?.author || null)),
      version: detectedVersion,
      // 统一 npmDependencies：仅接收对象（非数组）；dependencies 为数组表示插件依赖
      npmDependencies: (() => {
        if (meta && typeof meta.npmDependencies === 'object' && !Array.isArray(meta.npmDependencies)) return meta.npmDependencies;
        if (meta && typeof meta.dependencies === 'object' && !Array.isArray(meta.dependencies)) return meta.dependencies;
        if (pkg && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)) return pkg.dependencies;
        return undefined;
      })(),
      actions: (Array.isArray(meta?.functions?.actions) ? meta.functions.actions : (Array.isArray(meta.actions) ? meta.actions : [{ id: 'openWindow', icon: 'ri-window-line', text: '打开窗口' }])),
      behaviors: Array.isArray(meta.behaviors) ? meta.behaviors : [],
      functions: typeof meta.functions === 'object' ? meta.functions : undefined,
      packages: meta.packages,
      version: detectedVersion,
      studentColumns: Array.isArray(meta.studentColumns) ? meta.studentColumns : [],
      // 统一插件依赖为 dependencies（数组），兼容旧字段 pluginDepends；同时支持对象形式 { name: range }
      dependencies: (() => {
        if (Array.isArray(meta.dependencies)) return meta.dependencies;
        if (typeof meta.dependencies === 'object' && meta.dependencies) {
          try { return Object.keys(meta.dependencies).map(k => `${k}@${meta.dependencies[k]}`); } catch (e) {}
        }
        if (Array.isArray(meta.pluginDepends)) return meta.pluginDepends;
        return undefined;
      })(),
      // 变量声明（仅预览用途）
      variables: (() => {
        try {
          if (Array.isArray(meta.variables)) return meta.variables.map((x) => String(x));
          if (meta && typeof meta.variables === 'object' && meta.variables) return Object.keys(meta.variables);
        } catch (e) {}
        return undefined;
      })()
    };
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    return info;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function updatePluginVersion(idOrName, newVersion) {
  try {
    const p = Registry.findPluginByIdOrName(idOrName);
    if (!p) return { ok: false, error: 'plugin_not_found' };
    
    // 1. Update running directory
    const runningDir = Registry.getPluginDir(p.id);
    if (runningDir && fs.existsSync(runningDir)) {
      const metaPath = path.join(runningDir, 'plugin.json');
      if (fs.existsSync(metaPath)) {
        const meta = Utils.readJsonSafe(metaPath, {});
        meta.version = newVersion;
        Utils.writeJsonSafe(metaPath, meta);
      }
      // Update memory
      p.version = newVersion;
    }

    // 2. Update source directory (if dev mode / linked)
    try {
       const appPath = app.getAppPath();
       const devConfigPath = path.join(appPath, 'dev-plugins.json');
       let paths = [];
       
       if (fs.existsSync(devConfigPath)) {
         const devConfig = Utils.readJsonSafe(devConfigPath, { paths: [] });
         if (Array.isArray(devConfig.paths)) paths.push(...devConfig.paths);
       }
         
       // Also check components root (sibling to OrbiBoard root)
       const repoRoot = path.resolve(appPath, '..');
       const componentsSrc = path.join(repoRoot, 'components');
       if (fs.existsSync(componentsSrc)) {
          try {
            const items = fs.readdirSync(componentsSrc);
            for (const item of items) {
                if (item === '.git') continue;
                paths.push(path.join(componentsSrc, item));
            }
          } catch(e) {}
       }

       for (const rel of paths) {
         const abs = path.isAbsolute(rel) ? rel : path.resolve(appPath, rel);
         if (!fs.existsSync(abs)) continue;
         
         // Check if this source dir corresponds to our plugin
         const metaPath = path.join(abs, 'plugin.json');
         if (fs.existsSync(metaPath)) {
           const meta = Utils.readJsonSafe(metaPath, {});
           
           const rawId = String(meta.id || '').trim();
           const cleanId = rawId.toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
           const slugFromName = String(meta.name || '').toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
           const computedId = cleanId || slugFromName || String(path.basename(abs)).toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
           
           if (computedId === p.id || meta.id === p.id || meta.name === p.name) {
             // Found source! Update it.
             meta.version = newVersion;
             Utils.writeJsonSafe(metaPath, meta);
             try { console.log(`[updateVersion] Updated source at ${abs}`); } catch(e) {}
           }
         }
       }
    } catch (e) {
      try { console.error('[updateVersion] Error updating source:', e); } catch(e) {}
    }

    return { ok: true, version: newVersion };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  uninstall,
  installFromZip,
  inspectZip,
  updatePluginVersion
};

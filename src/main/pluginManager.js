const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const extract = require('extract-zip');
const { v4: uuidv4 } = require('uuid');
const Module = require('module');
const { app } = require('electron');

let manifestPath = '';
let pluginsRoot = '';
let configPath = '';
let manifest = { plugins: [] };
let config = { enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} };
let nameToId = new Map(); // 兼容旧行为：允许通过中文名查找
let windows = [];
let pluginWindows = new Map(); // pluginId -> BrowserWindow
let apiRegistry = new Map(); // pluginId -> Set(functionName)
let automationEventRegistry = new Map(); // pluginId -> Array<{ id, name, desc, params, expose }>
let functionRegistry = new Map(); // pluginId -> Map(fnName -> function)
let eventSubscribers = new Map(); // eventName -> Set(webContentsId)
let storeRoot = '';
let progressReporter = null; // 供插件在初始化期间更新启动页文本
// 引入自动化管理器引用，供插件入口 API 使用
let automationManagerRef = null;

function readJsonSafe(jsonPath, fallback) {
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeJsonSafe(jsonPath, data) {
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
}

function addNodeModulesToGlobalPaths(baseDir) {
  try {
    if (!baseDir || !fs.existsSync(baseDir)) return;
    const names = fs.readdirSync(baseDir);
    for (const name of names) {
      const nameDir = path.join(baseDir, name);
      try { if (!fs.statSync(nameDir).isDirectory()) continue; } catch { continue; }
      const versions = fs.readdirSync(nameDir);
      for (const v of versions) {
        const nm = path.join(nameDir, v, 'node_modules');
        try {
          if (fs.existsSync(nm) && fs.statSync(nm).isDirectory()) {
            if (!Module.globalPaths.includes(nm)) Module.globalPaths.push(nm);
          }
        } catch {}
      }
    }
  } catch {}
}

function refreshGlobalModulePaths() {
  // 用户数据 npm_store 与内置 src/npm_store 都加入查找路径
  try {
    addNodeModulesToGlobalPaths(storeRoot);
    const shippedStore = path.join(app.getAppPath(), 'src', 'npm_store');
    addNodeModulesToGlobalPaths(shippedStore);
    // 兼容在项目根目录安装的依赖（例如 d:\LessonPlugin\node_modules）
    const appNodeModules = path.join(app.getAppPath(), 'node_modules');
    try {
      if (fs.existsSync(appNodeModules) && fs.statSync(appNodeModules).isDirectory()) {
        if (!Module.globalPaths.includes(appNodeModules)) Module.globalPaths.push(appNodeModules);
      }
    } catch {}
  } catch {}
}

// 由主进程注入自动化管理器实例，使插件可通过统一 API 访问计时器能力
module.exports.setAutomationManager = function setAutomationManager(am) {
  automationManagerRef = am || null;
};

module.exports.init = function init(paths) {
  manifestPath = paths.manifestPath;
  configPath = paths.configPath;
  pluginsRoot = path.dirname(manifestPath);
  // 从各插件目录读取清单（plugin.json），不再依赖集中式 plugins.json
  manifest = { plugins: [] };
  try {
    const entries = fs.readdirSync(pluginsRoot);
    for (const entry of entries) {
      const full = path.join(pluginsRoot, entry);
      // 跳过非目录和已知配置文件目录
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue;
      // 期望存在 index.js 作为插件入口
      const indexPath = path.join(full, 'index.js');
      if (!fs.existsSync(indexPath)) continue;
      // 读取 plugin.json 元数据（如有）
      let meta = {};
      const metaPath = path.join(full, 'plugin.json');
      if (fs.existsSync(metaPath)) {
        meta = readJsonSafe(metaPath, {});
      }
      // 尝试从 package.json 读取版本与作者、依赖
      // 已统一在下方读取 package.json 并解析版本与其它元信息
      const pkgPath = path.join(full, 'package.json');
      let pkg = null;
      if (fs.existsSync(pkgPath)) { try { pkg = readJsonSafe(pkgPath, {}); } catch {} }
      let detectedVersion = meta.version || (pkg?.version || null);
      // 计算相对路径（用于 local 字段）
      const rel = path.relative(pluginsRoot, full).replace(/\\/g, '/');
      // 填充插件信息（name 来自 meta 或 index.js 导出）
      let name = meta.name;
      if (!name) {
        try {
          const mod = require(indexPath);
          if (mod?.name) name = mod.name;
        } catch {}
      }
      if (!name) name = entry; // 回退到目录名

      // 生成稳定 id：优先 meta.id，否则根据 name 生成 slug；若 slug 为空则回退到目录名或随机
      const rawId = String(meta.id || '').trim();
      const cleanId = rawId.toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      const slugFromName = String(name || '').toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      let id = cleanId || slugFromName || String(entry).toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!id) id = `plugin_${Date.now()}`;

      manifest.plugins.push({
        id,
        name,
        npm: meta.npm || null,
        local: rel,
        enabled: meta.enabled !== undefined ? !!meta.enabled : true,
        icon: meta.icon || null,
        description: meta.description || '',
        author: (meta.author !== undefined ? meta.author : (pkg?.author || null)),
        // 统一 npmDependencies：对象表示 NPM 依赖；dependencies 为数组表示插件依赖
        npmDependencies: (typeof meta.npmDependencies === 'object' ? meta.npmDependencies : (Array.isArray(meta.dependencies) ? undefined : (typeof meta.dependencies === 'object' ? meta.dependencies : (pkg?.dependencies || undefined)))),
        // 兼容新旧清单：优先顶层 actions，其次回退到 functions.actions（旧格式）
        actions: Array.isArray(meta.actions) ? meta.actions : (Array.isArray(meta?.functions?.actions) ? meta.functions.actions : []),
        // 保留 functions 以备后续扩展（如声明 backend 名称等）
        functions: typeof meta.functions === 'object' ? meta.functions : undefined,
        packages: Array.isArray(meta.packages) ? meta.packages : undefined,
        version: detectedVersion,
        studentColumns: Array.isArray(meta.studentColumns) ? meta.studentColumns : [],
        // pluginDepends 兼容：优先 meta.pluginDepends；其次 meta.dependencies 为数组视为插件依赖
        pluginDepends: Array.isArray(meta.pluginDepends) ? meta.pluginDepends : (Array.isArray(meta.dependencies) ? meta.dependencies : undefined),
        permissions: Array.isArray(meta.permissions) ? meta.permissions : undefined
      });
      nameToId.set(name, id);
    }
  } catch {}
  config = readJsonSafe(configPath, { enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} });
  storeRoot = path.resolve(path.dirname(manifestPath), '..', 'npm_store');
  if (!fs.existsSync(storeRoot)) fs.mkdirSync(storeRoot, { recursive: true });
  refreshGlobalModulePaths();

  for (const p of manifest.plugins) {
    // 兼容旧配置：优先使用 id 键，其次回退 name 键
    if (typeof config.enabled[p.id] !== 'boolean' && typeof config.enabled[p.name] === 'boolean') {
      config.enabled[p.id] = !!config.enabled[p.name];
    }
    if (typeof config.enabled[p.id] !== 'boolean') {
      config.enabled[p.id] = !!p.enabled;
    }
  }
  writeJsonSafe(configPath, config);
};

module.exports.getPlugins = function getPlugins() {
  return manifest.plugins.map((p) => ({
    id: p.id,
    name: p.name,
    npm: p.npm || null,
    local: p.local || null,
    enabled: !!(config.enabled[p.id] ?? config.enabled[p.name]),
    icon: p.icon || null,
    description: p.description || '',
    author: (p.author !== undefined ? p.author : null),
    npmDependencies: (typeof p.npmDependencies === 'object' ? p.npmDependencies : undefined),
    actions: Array.isArray(p.actions) ? p.actions : [],
    version: p.version || (config.npmSelection[p.id]?.version || config.npmSelection[p.name]?.version || null),
    studentColumns: Array.isArray(p.studentColumns) ? p.studentColumns : [],
    // 输出时兼容插件依赖来源（pluginDepends 或 dependencies 为数组）
    pluginDepends: Array.isArray(p.pluginDepends) ? p.pluginDepends : (Array.isArray(p.dependencies) ? p.dependencies : undefined),
    permissions: Array.isArray(p.permissions) ? p.permissions : undefined
  }));
};

function findPluginByIdOrName(key) {
  return manifest.plugins.find((p) => p.id === key || p.name === key);
}

// 新增：读取插件 README 文本（优先本地插件目录）
module.exports.getPluginReadme = function getPluginReadme(idOrName) {
  try {
    const p = findPluginByIdOrName(idOrName);
    if (!p) return null;
    // 仅支持本地插件目录读取（npm 包暂不提供 README 路径）
    const baseDir = path.dirname(manifestPath);
    const fullDir = p.local ? path.join(baseDir, p.local) : null;
    if (fullDir && fs.existsSync(fullDir)) {
      const candidates = ['README.md', 'readme.md', 'README', 'readme'];
      for (const name of candidates) {
        const f = path.join(fullDir, name);
        if (fs.existsSync(f) && fs.statSync(f).isFile()) {
          try { return fs.readFileSync(f, 'utf-8'); } catch {}
        }
      }
    }
    return null;
  } catch { return null; }
};

module.exports.toggle = function toggle(idOrName, enabled) {
  const p = findPluginByIdOrName(idOrName);
  if (!p) return { ok: false, error: 'not_found' };
  config.enabled[p.id] = !!enabled;
  // 兼容旧键
  config.enabled[p.name] = !!enabled;
  writeJsonSafe(configPath, config);
  return { id: p.id, name: p.name, enabled: !!enabled };
};

module.exports.loadPlugins = async function loadPlugins(onProgress) {
  // 保存进度报告函数，供插件入口通过 API 更新启动页状态
  progressReporter = typeof onProgress === 'function' ? onProgress : null;
  const statuses = [];
  for (const p of manifest.plugins) {
    const status = { name: p.name, stage: 'checking', message: '检查插件...' };
    statuses.push(status);
    onProgress && onProgress(status);

    if (p.npm) {
      status.stage = 'npm';
      status.message = `检测并准备安装NPM包: ${p.npm}`;
      onProgress && onProgress({ ...status });
      // 仅报告，实际安装由用户在设置页面触发，以避免启动阻塞
    }

    if (p.local) {
      const localPath = path.resolve(path.dirname(manifestPath), p.local);
      if (fs.existsSync(localPath)) {
        status.stage = 'local';
        status.message = '本地插件就绪';
        // 注册后端函数（如存在），使插件无需打开窗口即可被调用
        try {
          const modPath = path.resolve(localPath, 'index.js');
          if (fs.existsSync(modPath)) {
            const mod = require(modPath);
            // 仅从 functions 中注册函数，排除 actions
            const fnObj = (mod && typeof mod.functions === 'object') ? mod.functions : null;
            if (fnObj) {
              if (!functionRegistry.has(p.id)) functionRegistry.set(p.id, new Map());
              const map = functionRegistry.get(p.id);
              for (const [fn, impl] of Object.entries(fnObj)) {
                if (fn === 'actions') continue;
                if (typeof impl === 'function') map.set(fn, impl);
              }
            }
            // 自动化事件：若插件导出 automationEvents，则直接注册以便设置页可查询
            if (mod && Array.isArray(mod.automationEvents)) {
              module.exports.registerAutomationEvents(p.id, mod.automationEvents);
            }
            // 允许插件入口在主进程侧使用 API；若 init 为异步，则等待完成
            if (mod && typeof mod.init === 'function') {
              try {
                // 报告插件初始化开始
                progressReporter && progressReporter({ stage: 'plugin:init', message: `初始化插件 ${p.name}...` });
                await Promise.resolve(mod.init(createPluginApi(p.id)));
                // 报告插件初始化结束
                progressReporter && progressReporter({ stage: 'plugin:init', message: `插件 ${p.name} 初始化完成` });
              } catch (e) {
                progressReporter && progressReporter({ stage: 'plugin:error', message: `插件 ${p.name} 初始化失败：${e?.message || e}` });
              }
            }
          }
        } catch {}
      } else {
        status.stage = 'missing';
        status.message = '本地插件路径不存在';
      }
      onProgress && onProgress({ ...status });
    }
  }
  return statuses;
};

module.exports.installNpm = async function installNpm(idOrName, onProgress) {
  const p = findPluginByIdOrName(idOrName);
  if (!p) return { ok: false, error: '插件不存在' };

  const jobs = [];
  // 支持单个 npm 字段
  if (p.npm) {
    if (typeof p.npm === 'string') {
      // 获取最新版本
      const latest = await module.exports.getPackageVersions(p.npm);
      if (!latest.ok || !latest.versions.length) return { ok: false, error: '无法获取最新版本' };
      const version = latest.versions[latest.versions.length - 1];
      jobs.push({ name: p.npm, version });
    } else if (p.npm.name) {
      jobs.push({ name: p.npm.name, version: p.npm.version });
    }
  }

  // 支持 packages 数组: [{ name, versions: ["1.0.0", "2.0.0"] }]
  if (Array.isArray(p.packages)) {
    for (const pkg of p.packages) {
      if (Array.isArray(pkg.versions)) {
        for (const v of pkg.versions) jobs.push({ name: pkg.name, version: v });
      } else if (pkg.version) {
        jobs.push({ name: pkg.name, version: pkg.version });
      }
    }
  }

  if (!jobs.length) return { ok: false, error: '无可安装的NPM包配置' };

  const results = [];
  for (const job of jobs) {
    const res = await module.exports.downloadPackageVersion(job.name, job.version, onProgress);
    results.push({ pkg: `${job.name}@${job.version}`, ok: res.ok, error: res.error });
  }
  return { ok: results.every((r) => r.ok), results };
};

module.exports.closeAllWindows = function closeAllWindows() {
  for (const w of windows) {
    try {
      if (!w.isDestroyed()) w.destroy();
    } catch {}
  }
  windows = [];
};

// --------- NPM 管理 ---------
function runNpm(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn('npm', args, { cwd, shell: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += String(d)));
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

module.exports.getPackageVersions = async function getPackageVersions(name) {
  const args = ['view', name, 'versions', '--json', '--registry', config.registry];
  const result = await runNpm(args, path.dirname(manifestPath));
  if (result.code !== 0) return { ok: false, error: result.err || 'npm view 失败' };
  try {
    const versions = JSON.parse(result.out);
    return { ok: true, versions };
  } catch (e) {
    return { ok: false, error: '解析版本失败' };
  }
};

module.exports.downloadPackageVersion = async function downloadPackageVersion(name, version, onProgress) {
  const dest = path.join(storeRoot, name, version);
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const args = ['install', `${name}@${version}`, '--prefix', dest, '--registry', config.registry];
  onProgress && onProgress({ stage: 'npm', message: `下载 ${name}@${version} ...` });
  const result = await runNpm(args, path.dirname(manifestPath));
  if (result.code !== 0) return { ok: false, error: result.err || 'npm install 失败' };
  onProgress && onProgress({ stage: 'npm', message: `完成 ${name}@${version}` });
  const nm = path.join(dest, 'node_modules');
  try { if (!Module.globalPaths.includes(nm)) Module.globalPaths.push(nm); } catch {}
  return { ok: true, path: path.join(dest, 'node_modules', name) };
};

module.exports.switchPluginVersion = async function switchPluginVersion(pluginName, sel) {
  config.npmSelection[pluginName] = sel;
  writeJsonSafe(configPath, config);
  return { ok: true, selection: sel };
};

module.exports.listInstalledPackages = async function listInstalledPackages() {
  const result = [];
  try {
    if (!fs.existsSync(storeRoot)) return { ok: true, packages: [] };
    const names = fs.readdirSync(storeRoot);
    for (const name of names) {
      const nameDir = path.join(storeRoot, name);
      if (!fs.statSync(nameDir).isDirectory()) continue;
      const versions = fs.readdirSync(nameDir).filter((v) => {
        const vDir = path.join(nameDir, v, 'node_modules', name);
        return fs.existsSync(vDir);
      });
      result.push({ name, versions });
    }
    return { ok: true, packages: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

// -------- 档案管理：学生列表列定义（聚合） --------
module.exports.getStudentColumnDefs = function getStudentColumnDefs() {
  try {
    const defs = [];
    const seen = new Set();
    for (const p of manifest.plugins) {
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

// -------- 卸载本地插件（仅 local 插件） --------
module.exports.uninstall = function uninstall(idOrName) {
  try {
    const idx = manifest.plugins.findIndex((p) => p.id === idOrName || p.name === idOrName);
    if (idx < 0) return { ok: false, error: 'not_found' };
    const p = manifest.plugins[idx];
    // 仅支持卸载本地插件
    if (!p.local) return { ok: false, error: 'not_local_plugin' };
    const fullDir = path.join(path.dirname(manifestPath), p.local);
    
    // 获取插件的规范化ID用于清理各种注册项
    const canonId = p.id || p.name;
    
    // 1. 先收集插件窗口信息（用于后续清理）
    const winById = pluginWindows.get(p.id);
    const winByName = pluginWindows.get(p.name);
    const pluginWebContentsIds = [];
    
    if (winById?.webContents?.id) {
      pluginWebContentsIds.push(winById.webContents.id);
    }
    if (winByName?.webContents?.id && winByName !== winById) {
      pluginWebContentsIds.push(winByName.webContents.id);
    }
    
    try {
      // 2. 清理插件的事件订阅（在关闭窗口前进行）
      for (const [eventName, subscriberSet] of eventSubscribers.entries()) {
        pluginWebContentsIds.forEach(id => subscriberSet.delete(id));
        // 如果该事件没有订阅者了，删除整个事件
        if (subscriberSet.size === 0) {
          eventSubscribers.delete(eventName);
        }
      }
    } catch {}
    
    try {
      // 3. 清理插件注册的API和函数
      apiRegistry.delete(canonId);
      functionRegistry.delete(canonId);
    } catch {}
    
    try {
      // 4. 清理插件注册的自动化事件
      automationEventRegistry.delete(canonId);
    } catch {}
    
    try {
      // 5. 关闭该插件所有已打开的窗口
      // 处理通过ID注册的窗口
      if (winById) {
        if (winById.webContents && !winById.webContents.isDestroyed()) {
          try { winById.webContents.destroy(); } catch {}
        }
        if (winById.destroy && !winById.isDestroyed()) {
          try { winById.destroy(); } catch {}
        }
      }
      
      // 处理通过名称注册的窗口（可能与ID窗口不同）
      if (winByName && winByName !== winById) {
        if (winByName.webContents && !winByName.webContents.isDestroyed()) {
          try { winByName.webContents.destroy(); } catch {}
        }
        if (winByName.destroy && !winByName.isDestroyed()) {
          try { winByName.destroy(); } catch {}
        }
      }
      
      // 从窗口注册表中移除
      pluginWindows.delete(p.id);
      pluginWindows.delete(p.name);
    } catch {}
    
    try {
      // 5. 清理插件的分钟触发器和计时器（通过自动化管理器）
      if (automationManagerRef) {
        try {
          automationManagerRef.clearPluginMinuteTriggers(canonId);
        } catch {}
        
        // 清理插件计时器（如果自动化管理器有相关方法）
        try {
          if (typeof automationManagerRef.clearPluginTimers === 'function') {
            automationManagerRef.clearPluginTimers(canonId);
          }
        } catch {}
      }
    } catch {}
    
    try {
      // 6. 删除插件目录
      if (fs.existsSync(fullDir)) fs.rmSync(fullDir, { recursive: true, force: true });
    } catch {}
    
    // 7. 从清单与配置移除
    manifest.plugins.splice(idx, 1);
    try { delete config.enabled[p.id]; } catch {}
    try { delete config.enabled[p.name]; } catch {}
    writeJsonSafe(configPath, config);
    
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

// -------- ZIP 安装插件 --------
function expandZip(zipPath, dest) {
  // 使用纯 Node 依赖 extract-zip，避免外部命令依赖（如 PowerShell）
  return extract(zipPath, { dir: dest })
    .then(() => ({ ok: true }))
    .catch((e) => ({ ok: false, error: e?.message || String(e) }));
}

module.exports.installFromZip = async function installFromZip(zipPath) {
  try {
    const pluginsRootLocal = path.dirname(manifestPath);
    const tempId = `plugin_tmp_${Date.now()}`;
    const tempDir = path.join(pluginsRootLocal, tempId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const unzip = await expandZip(zipPath, tempDir);
    if (!unzip.ok) return { ok: false, error: unzip.error };

    // 读取插件元数据（先从plugin.json，再从package.json回退）
    let meta = {};
    const metaPath = path.join(tempDir, 'plugin.json');
    if (fs.existsSync(metaPath)) {
      meta = readJsonSafe(metaPath, {});
    }
    const pkgPath = path.join(tempDir, 'package.json');
    let pkg = null;
    if (fs.existsSync(pkgPath)) { try { pkg = readJsonSafe(pkgPath, {}); } catch {} }
    let detectedVersion = meta.version || (pkg?.version || null);

    // 检查入口
    const indexPathTmp = path.join(tempDir, 'index.js');
    if (!fs.existsSync(indexPathTmp)) {
      return { ok: false, error: '安装包缺少 index.js' };
    }
    // 获取插件名称（优先 meta.name，其次从入口导出）
    let pluginName = meta.name;
    if (!pluginName) {
      try {
        const mod = require(indexPathTmp);
        if (mod?.name) pluginName = mod.name;
      } catch {}
    }
    if (!pluginName) pluginName = 'plugin';

    // 计算稳定目录名：优先 meta.id，否则使用名称 slug
    const rawId = String(meta.id || '').trim();
    const cleanId = rawId.toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const slugFromName = String(pluginName || '').toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const pluginId = cleanId || slugFromName || `plugin_${Date.now()}`;
    const finalDir = path.join(pluginsRootLocal, pluginId);

    // 若已存在同名目录，先删除以避免残留
    try {
      if (fs.existsSync(finalDir)) {
        fs.rmSync(finalDir, { recursive: true, force: true });
      }
    } catch {}
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
          const destPath = path.join(storeRoot, pkgDef.name, v, 'node_modules', pkgDef.name);
          if (fs.existsSync(destPath)) continue; // 已有版本
          const dl = await module.exports.downloadPackageVersion(pkgDef.name, v);
          if (!dl.ok) {
            // 无法下载且本地不存在
            return { ok: false, error: `无法下载依赖 ${pkgDef.name}@${v}，请手动导入到 src/npm_store/${pkgDef.name}/${v}/node_modules/${pkgDef.name}` };
          }
        }
      }
    }

    // 如存在同名或同ID插件，先清理其已注册资源与窗口，避免残留
    const existingIdx = manifest.plugins.findIndex((pp) => pp.id === pluginId || pp.name === pluginName);
    if (existingIdx >= 0) {
      const canonId = manifest.plugins[existingIdx].id || manifest.plugins[existingIdx].name;
      try {
        // 收集该插件相关的 webContents ID 并从事件订阅中移除
        const ids = [];
        const winById = pluginWindows.get(canonId);
        const winByName = pluginWindows.get(manifest.plugins[existingIdx].name);
        if (winById?.webContents?.id) ids.push(winById.webContents.id);
        if (winByName?.webContents?.id && winByName !== winById) ids.push(winByName.webContents.id);
        for (const [eventName, subs] of eventSubscribers.entries()) {
          ids.forEach((id) => subs.delete(id));
          if (subs.size === 0) eventSubscribers.delete(eventName);
        }
      } catch {}
      try {
        apiRegistry.delete(canonId);
        functionRegistry.delete(canonId);
        automationEventRegistry.delete(canonId);
      } catch {}
      try {
        const w1 = pluginWindows.get(canonId);
        const w2 = pluginWindows.get(manifest.plugins[existingIdx].name);
        for (const w of [w1, w2]) {
          if (!w) continue;
          try { if (w.webContents && !w.webContents.isDestroyed()) w.webContents.destroy(); } catch {}
          try { if (w.destroy && !w.isDestroyed()) w.destroy(); } catch {}
        }
        pluginWindows.delete(canonId);
        pluginWindows.delete(manifest.plugins[existingIdx].name);
      } catch {}
      try {
        if (automationManagerRef) {
          try { automationManagerRef.clearPluginMinuteTriggers(canonId); } catch {}
          try { if (typeof automationManagerRef.clearPluginTimers === 'function') automationManagerRef.clearPluginTimers(canonId); } catch {}
        }
      } catch {}
    }

    // 更新内存清单（使用稳定目录），若存在则覆盖更新
    const rel = path.relative(path.dirname(manifestPath), finalDir).replace(/\\/g, '/');
    const updated = {
      id: pluginId,
      name: pluginName,
      local: rel,
      enabled: true,
      icon: meta.icon || null,
      description: meta.description || '',
      author: (meta.author !== undefined ? meta.author : (pkg?.author || null)),
      // 统一 npmDependencies：对象表示 NPM 依赖；dependencies 为数组表示插件依赖
      npmDependencies: (typeof meta.npmDependencies === 'object' ? meta.npmDependencies : (Array.isArray(meta.dependencies) ? undefined : (typeof meta.dependencies === 'object' ? meta.dependencies : (pkg?.dependencies || undefined)))),
      // 兼容新旧清单：优先顶层 actions，其次回退到 functions.actions（旧格式）
      actions: Array.isArray(meta.actions) ? meta.actions : (Array.isArray(meta?.functions?.actions) ? meta.functions.actions : []),
      // 保留 functions 以备后续扩展（如声明 backend 名称等）
      functions: typeof meta.functions === 'object' ? meta.functions : undefined,
      packages: Array.isArray(meta.packages) ? meta.packages : undefined,
      version: detectedVersion,
      studentColumns: Array.isArray(meta.studentColumns) ? meta.studentColumns : [],
      // pluginDepends 兼容：优先 meta.pluginDepends；其次 meta.dependencies 为数组视为插件依赖
      pluginDepends: Array.isArray(meta.pluginDepends) ? meta.pluginDepends : (Array.isArray(meta.dependencies) ? meta.dependencies : undefined),
      permissions: Array.isArray(meta.permissions) ? meta.permissions : undefined
    };
    if (existingIdx >= 0) {
      manifest.plugins[existingIdx] = updated;
    } else {
      manifest.plugins.push(updated);
    }
    nameToId.set(pluginName, pluginId);
    if (typeof config.enabled[pluginId] !== 'boolean') {
      config.enabled[pluginId] = true;
      // 兼容旧键
      config.enabled[pluginName] = true;
      writeJsonSafe(configPath, config);
    }

    // 重新注册并初始化插件核心资源（functions、automationEvents），并执行插件自身 init
    try {
      const modPath = path.resolve(finalDir, 'index.js');
      try { delete require.cache[require.resolve(modPath)]; } catch {}
      if (fs.existsSync(modPath)) {
        const mod = require(modPath);
        // 注册主进程函数
        const fnObj = (mod && typeof mod.functions === 'object') ? mod.functions : null;
        if (fnObj) {
          if (!functionRegistry.has(pluginId)) functionRegistry.set(pluginId, new Map());
          const map = functionRegistry.get(pluginId);
          for (const [fn, impl] of Object.entries(fnObj)) {
            if (fn === 'actions') continue;
            if (typeof impl === 'function') map.set(fn, impl);
          }
        }
        // 注册自动化事件（若插件导出）
        if (mod && Array.isArray(mod.automationEvents)) {
          module.exports.registerAutomationEvents(pluginId, mod.automationEvents);
        }
        // 执行插件初始化
        if (mod && typeof mod.init === 'function') {
          try {
            progressReporter && progressReporter({ stage: 'plugin:init', message: `初始化插件 ${pluginName}...` });
            await Promise.resolve(mod.init(createPluginApi(pluginId)));
            progressReporter && progressReporter({ stage: 'plugin:init', message: `插件 ${pluginName} 初始化完成` });
          } catch (e) {
            progressReporter && progressReporter({ stage: 'plugin:error', message: `插件 ${pluginName} 初始化失败：${e?.message || e}` });
          }
        }
      }
    } catch {}

    return { ok: true, id: pluginId, name: pluginName, author: (meta.author !== undefined ? meta.author : (pkg?.author || null)), dependencies: (typeof meta.dependencies === 'object' ? meta.dependencies : (pkg?.dependencies || undefined)), pluginDepends: Array.isArray(meta.pluginDepends) ? meta.pluginDepends : undefined };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

// -------- 插件 API / 事件总线 --------
module.exports.registerFunctions = function registerFunctions(pluginId, functions, senderWC) {
  const canonId = nameToId.get(pluginId) || pluginId;
  if (!apiRegistry.has(canonId)) apiRegistry.set(canonId, new Set());
  const set = apiRegistry.get(canonId);
  for (const fn of functions) set.add(fn);
  // 将 webContents 记录，供路由调用
  const win = pluginWindows.get(canonId);
  if (!win || win.webContents.id !== senderWC.id) {
    // 如果调用来自不同 webContents（异常情况），仍以最新 sender 为准
    pluginWindows.set(canonId, { webContents: senderWC, isProxy: true });
  }
  return { ok: true };
};

// 自动化事件注册/查询
module.exports.registerAutomationEvents = function registerAutomationEvents(pluginId, events) {
  const canonId = nameToId.get(pluginId) || pluginId;
  if (!Array.isArray(events)) return { ok: false, error: 'events_invalid' };
  const filtered = events.filter((e) => e && e.expose !== false).map((e) => ({
    id: e.id || e.name,
    name: e.name || e.id,
    desc: e.desc || '',
    params: Array.isArray(e.params) ? e.params : []
  }));
  automationEventRegistry.set(canonId, filtered);
  return { ok: true, count: filtered.length };
};
module.exports.listAutomationEvents = function listAutomationEvents(pluginId) {
  const canonId = nameToId.get(pluginId) || pluginId;
  return { ok: true, events: automationEventRegistry.get(canonId) || [] };
};

module.exports.callFunction = function callFunction(targetPluginId, fnName, args) {
  return new Promise(async (resolve) => {
    const canonId = nameToId.get(targetPluginId) || targetPluginId;
    // 优先主进程注册的函数，无需窗口
    const fnMap = functionRegistry.get(canonId);
    if (fnMap && fnMap.has(fnName)) {
      try {
        const result = await Promise.resolve(fnMap.get(fnName)(...(Array.isArray(args) ? args : [])));
        return resolve({ ok: true, result });
      } catch (e) {
        return resolve({ ok: false, error: e.message });
      }
    }

    // 回退到插件窗口注册的函数
    const win = pluginWindows.get(canonId);
    const wc = win?.webContents || win;
    if (!wc) return resolve({ ok: false, error: '目标插件未打开窗口或未注册' });
    const reqId = uuidv4();
    const onResult = (event, id, payload) => {
      if (id !== reqId) return;
      try { module.exports._ipcMain.removeListener('plugin:invoke:result', onResult); } catch {}
      resolve(payload);
    };
    module.exports._ipcMain.on('plugin:invoke:result', onResult);
    wc.send('plugin:invoke', { id: reqId, fn: fnName, args: Array.isArray(args) ? args : [] });
  });
};

// 为插件入口提供主进程侧可用的 API
function createPluginApi(pluginId) {
  return {
    call: (targetPluginId, fnName, args) => module.exports.callFunction(targetPluginId, fnName, args),
    emit: (eventName, payload) => module.exports.emitEvent(eventName, payload),
    registerAutomationEvents: (events) => module.exports.registerAutomationEvents(pluginId, events),
    // 为插件提供自动化计时器接口（减少插件自行创建定时器）
    automation: {
      // 新增：注册“分钟触发器”（仅 HH:MM 列表与回调）
      registerMinuteTriggers: (times, cb) => {
        try {
          if (!automationManagerRef) return { ok: false, error: 'automation_manager_missing' };
          return automationManagerRef.registerPluginMinuteTriggers(pluginId, Array.isArray(times) ? times : [], cb);
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },
      clearMinuteTriggers: () => {
        try {
          if (!automationManagerRef) return { ok: false, error: 'automation_manager_missing' };
          return automationManagerRef.clearPluginMinuteTriggers(pluginId);
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },
      listMinuteTriggers: () => {
        try {
          if (!automationManagerRef) return { ok: true, times: [] };
          return automationManagerRef.listPluginMinuteTriggers(pluginId) || { ok: true, times: [] };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },
      // 为插件提供“创建动作快捷方式到桌面”的接口
      createActionShortcut: (options) => {
        try {
          if (!automationManagerRef) return { ok: false, error: 'automation_manager_missing' };
          return automationManagerRef.createActionShortcut(pluginId, options || {});
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      }
    },
    // 启动页文本控制：插件可在初始化期间更新启动页状态文本
    splash: {
      setStatus: (stage, message) => {
        try { progressReporter && progressReporter({ stage, message }); } catch {}
      },
      progress: (stage, message) => {
        try { progressReporter && progressReporter({ stage, message }); } catch {}
      }
    }
  };
}

module.exports.subscribeEvent = function subscribeEvent(eventName, senderWC) {
  if (!eventSubscribers.has(eventName)) eventSubscribers.set(eventName, new Set());
  eventSubscribers.get(eventName).add(senderWC.id);
  return { ok: true };
};

module.exports.emitEvent = function emitEvent(eventName, payload) {
  const subs = eventSubscribers.get(eventName);
  if (!subs || !subs.size) return { ok: true, delivered: 0 };
  let delivered = 0;
  for (const pid of subs) {
    for (const w of windows) {
      if (w.webContents.id === pid) {
        try { w.webContents.send('plugin:event', { name: eventName, payload }); delivered++; } catch {}
      }
    }
  }
  return { ok: true, delivered };
};

module.exports.inspectZip = async function inspectZip(zipPath) {
  try {
    const pluginsRootLocal = path.dirname(manifestPath);
    const tempId = `plugin_inspect_${Date.now()}`;
    const tempDir = path.join(pluginsRootLocal, tempId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const unzip = await expandZip(zipPath, tempDir);
    if (!unzip.ok) return { ok: false, error: unzip.error };
    // 读取元数据
    let meta = {};
    const metaPath = path.join(tempDir, 'plugin.json');
    if (fs.existsSync(metaPath)) meta = readJsonSafe(metaPath, {});
    const pkgPath = path.join(tempDir, 'package.json');
    let pkg = null;
    if (fs.existsSync(pkgPath)) { try { pkg = readJsonSafe(pkgPath, {}); } catch {} }
    const indexPathTmp = path.join(tempDir, 'index.js');
    let pluginName = meta.name;
    if (!pluginName) {
      try { const mod = require(indexPathTmp); if (mod?.name) pluginName = mod.name; } catch {}
    }
    if (!pluginName) pluginName = 'plugin';
    const rawId = String(meta.id || '').trim();
    const cleanId = rawId.toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const slugFromName = String(pluginName || '').toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const pluginId = cleanId || slugFromName || `plugin_${Date.now()}`;
    const detectedVersion = meta.version || (pkg?.version || null);
    const info = {
      ok: true,
      id: pluginId,
      name: pluginName,
      author: (meta.author !== undefined ? meta.author : (pkg?.author || null)),
      version: detectedVersion,
      // 统一 npmDependencies：对象表示 NPM 依赖；dependencies 为数组表示插件依赖
      npmDependencies: (typeof meta.npmDependencies === 'object' ? meta.npmDependencies : (Array.isArray(meta.dependencies) ? undefined : (typeof meta.dependencies === 'object' ? meta.dependencies : (pkg?.dependencies || undefined)))),
      actions: (Array.isArray(meta?.functions?.actions) ? meta.functions.actions : (Array.isArray(meta.actions) ? meta.actions : [{ id: 'openWindow', icon: 'ri-window-line', text: '打开窗口' }])),
      functions: typeof meta.functions === 'object' ? meta.functions : undefined,
      packages: meta.packages,
      version: detectedVersion,
      studentColumns: Array.isArray(meta.studentColumns) ? meta.studentColumns : [],
      // pluginDepends 兼容：优先 meta.pluginDepends；其次 meta.dependencies 为数组视为插件依赖
      pluginDepends: Array.isArray(meta.pluginDepends) ? meta.pluginDepends : (Array.isArray(meta.dependencies) ? meta.dependencies : undefined),
      permissions: Array.isArray(meta.permissions) ? meta.permissions : undefined
    };
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    return info;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

module.exports.listDependents = function listDependents(idOrName) {
  try {
    const canonId = nameToId.get(idOrName) || idOrName;
    // 依赖此插件的其他插件（按 pluginDepends 声明）
    const pluginDeps = (manifest.plugins || []).filter((p) => {
      const deps = Array.isArray(p.pluginDepends) ? p.pluginDepends : (Array.isArray(p.dependencies) ? p.dependencies : []);
      return deps.some((d) => (d === canonId) || (d === p.name) || (nameToId.get(d) === canonId));
    }).map((p) => ({ id: p.id, name: p.name }));
    // 引用此插件的自动化（actions 中包含 pluginAction 或 pluginEvent 的 pluginId）
    const autos = [];
    try {
      const items = Array.isArray(automationManagerRef?.items) ? automationManagerRef.items : [];
      for (const it of items) {
        const actions = Array.isArray(it.actions) ? it.actions : [];
        const uses = actions.some((a) => {
          if (!a || typeof a !== 'object') return false;
          if (a.type === 'pluginAction' || a.type === 'pluginEvent') {
            const pid = a.pluginId;
            const canon = nameToId.get(pid) || pid;
            return canon === canonId;
          }
          return false;
        });
        if (uses) autos.push({ id: it.id, name: it.name, enabled: !!it.enabled });
      }
    } catch {}
    return { ok: true, plugins: pluginDeps, automations: autos };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};
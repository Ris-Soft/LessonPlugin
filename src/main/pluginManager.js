const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

let manifestPath = '';
let pluginsRoot = '';
let configPath = '';
let manifest = { plugins: [] };
let config = { enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} };
let windows = [];
let pluginWindows = new Map(); // pluginId -> BrowserWindow
let apiRegistry = new Map(); // pluginId -> Set(functionName)
let automationEventRegistry = new Map(); // pluginId -> Array<{ id, name, desc, params, expose }>
let backendRegistry = new Map(); // pluginId -> Map(fnName -> function)
let eventSubscribers = new Map(); // eventName -> Set(webContentsId)
let storeRoot = '';

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

      manifest.plugins.push({
        name,
        npm: meta.npm || null,
        local: rel,
        enabled: meta.enabled !== undefined ? !!meta.enabled : true,
        icon: meta.icon || null,
        description: meta.description || '',
        actions: Array.isArray(meta.actions) ? meta.actions : [],
        packages: Array.isArray(meta.packages) ? meta.packages : undefined
      });
    }
  } catch {}
  config = readJsonSafe(configPath, { enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} });
  storeRoot = path.resolve(path.dirname(manifestPath), '..', 'npm_store');
  if (!fs.existsSync(storeRoot)) fs.mkdirSync(storeRoot, { recursive: true });

  for (const p of manifest.plugins) {
    if (typeof config.enabled[p.name] !== 'boolean') {
      config.enabled[p.name] = !!p.enabled;
    }
  }
  writeJsonSafe(configPath, config);
};

module.exports.getPlugins = function getPlugins() {
  return manifest.plugins.map((p) => ({
    name: p.name,
    npm: p.npm || null,
    local: p.local || null,
    enabled: !!config.enabled[p.name],
    icon: p.icon || null,
    description: p.description || '',
    actions: Array.isArray(p.actions) ? p.actions : []
  }));
};

module.exports.toggle = function toggle(name, enabled) {
  config.enabled[name] = !!enabled;
  writeJsonSafe(configPath, config);
  return { name, enabled: !!enabled };
};

module.exports.loadPlugins = async function loadPlugins(onProgress) {
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
            if (mod && mod.backend && typeof mod.backend === 'object') {
              if (!backendRegistry.has(p.name)) backendRegistry.set(p.name, new Map());
              const map = backendRegistry.get(p.name);
              for (const [fn, impl] of Object.entries(mod.backend)) {
                if (typeof impl === 'function') map.set(fn, impl);
              }
            }
            // 自动化事件：若插件导出 automationEvents，则直接注册以便设置页可查询
            if (mod && Array.isArray(mod.automationEvents)) {
              module.exports.registerAutomationEvents(p.name, mod.automationEvents);
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

module.exports.openWindow = async function openWindow(name, BrowserWindow, app) {
  const p = manifest.plugins.find((x) => x.name === name);
  if (!p || !config.enabled[name]) {
    return { ok: false, error: '插件未启用或不存在' };
  }
  try {
    let mod;
    if (p.local) {
      const modPath = path.resolve(path.dirname(manifestPath), p.local, 'index.js');
      mod = require(modPath);
    } else if (p.npm) {
      if (typeof p.npm === 'string') {
        mod = require(p.npm);
      } else if (p.npm && p.npm.name) {
        const sel = config.npmSelection[name] || p.npm;
        const pkgPath = path.join(storeRoot, sel.name, sel.version, 'node_modules', sel.name);
        if (fs.existsSync(pkgPath)) {
          mod = require(pkgPath);
        } else {
          throw new Error(`未找到已下载包：${sel.name}@${sel.version}`);
        }
      }
    }
    if (mod && typeof mod.openWindow === 'function') {
      const win = await mod.openWindow({ BrowserWindow, app, path });
      if (win) {
        windows.push(win);
        pluginWindows.set(p.name, win);
        win.on('closed', () => {
          windows = windows.filter((w) => w !== win);
          pluginWindows.delete(p.name);
        });
      }
      return { ok: true };
    }
    return { ok: false, error: '插件不支持打开窗口' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

module.exports.installNpm = async function installNpm(name, onProgress) {
  const p = manifest.plugins.find((x) => x.name === name);
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

// -------- ZIP 安装插件 --------
function expandZip(zipPath, dest) {
  return new Promise((resolve) => {
    // 使用 PowerShell Expand-Archive 以避免额外依赖
    const child = spawn('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${dest}' -Force`], { shell: true });
    let err = '';
    child.stderr.on('data', (d) => (err += String(d)));
    child.on('close', (code) => {
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, error: err || 'Expand-Archive 失败' });
    });
  });
}

module.exports.installFromZip = async function installFromZip(zipPath) {
  try {
    const pluginsRootLocal = path.dirname(manifestPath);
    const tempId = `plugin_${Date.now()}`;
    const dest = path.join(pluginsRootLocal, tempId);
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const unzip = await expandZip(zipPath, dest);
    if (!unzip.ok) return { ok: false, error: unzip.error };

    // 读取插件元数据
    let meta = {};
    const metaPath = path.join(dest, 'plugin.json');
    if (fs.existsSync(metaPath)) {
      meta = readJsonSafe(metaPath, {});
    }
    const indexPath = path.join(dest, 'index.js');
    if (!fs.existsSync(indexPath)) {
      return { ok: false, error: '安装包缺少 index.js' };
    }
    const pluginName = meta.name || tempId;

    // Node 模块补全：如果声明packages，尝试下载，否则要求手动导入
    if (Array.isArray(meta.packages)) {
      for (const pkg of meta.packages) {
        const versions = Array.isArray(pkg.versions) ? pkg.versions : (pkg.version ? [pkg.version] : []);
        for (const v of versions) {
          const destPath = path.join(storeRoot, pkg.name, v, 'node_modules', pkg.name);
          if (fs.existsSync(destPath)) continue; // 已有版本
          const dl = await module.exports.downloadPackageVersion(pkg.name, v);
          if (!dl.ok) {
            // 无法下载且本地不存在
            return { ok: false, error: `无法下载依赖 ${pkg.name}@${v}，请手动导入到 src/npm_store/${pkg.name}/${v}/node_modules/${pkg.name}` };
          }
        }
      }
    }

    // 更新内存清单（下次启动会通过目录扫描重建，无需写入集中式文件）
    const rel = path.relative(path.dirname(manifestPath), dest).replace(/\\/g, '/');
    manifest.plugins.push({ name: pluginName, local: rel, enabled: true, icon: meta.icon || null, description: meta.description || '', actions: meta.actions || [{ id: 'openWindow', icon: 'ri-window-line', text: '打开窗口' }], packages: meta.packages });
    if (typeof config.enabled[pluginName] !== 'boolean') {
      config.enabled[pluginName] = true;
      writeJsonSafe(configPath, config);
    }
    return { ok: true, name: pluginName };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

// -------- 插件 API / 事件总线 --------
module.exports.registerFunctions = function registerFunctions(pluginId, functions, senderWC) {
  if (!apiRegistry.has(pluginId)) apiRegistry.set(pluginId, new Set());
  const set = apiRegistry.get(pluginId);
  for (const fn of functions) set.add(fn);
  // 将 webContents 记录，供路由调用
  const win = pluginWindows.get(pluginId);
  if (!win || win.webContents.id !== senderWC.id) {
    // 如果调用来自不同 webContents（异常情况），仍以最新 sender 为准
    pluginWindows.set(pluginId, { webContents: senderWC, isProxy: true });
  }
  return { ok: true };
};

// 自动化事件注册/查询
module.exports.registerAutomationEvents = function registerAutomationEvents(pluginId, events) {
  if (!Array.isArray(events)) return { ok: false, error: 'events_invalid' };
  const filtered = events.filter((e) => e && e.expose !== false).map((e) => ({
    id: e.id || e.name,
    name: e.name || e.id,
    desc: e.desc || '',
    params: Array.isArray(e.params) ? e.params : []
  }));
  automationEventRegistry.set(pluginId, filtered);
  return { ok: true, count: filtered.length };
};
module.exports.listAutomationEvents = function listAutomationEvents(pluginId) {
  return { ok: true, events: automationEventRegistry.get(pluginId) || [] };
};

module.exports.callFunction = function callFunction(targetPluginId, fnName, args) {
  return new Promise(async (resolve) => {
    // 优先后端函数，无需窗口
    const backendMap = backendRegistry.get(targetPluginId);
    if (backendMap && backendMap.has(fnName)) {
      try {
        const result = await Promise.resolve(backendMap.get(fnName)(...(Array.isArray(args) ? args : [])));
        return resolve({ ok: true, result });
      } catch (e) {
        return resolve({ ok: false, error: e.message });
      }
    }

    // 回退到插件窗口注册的函数
    const win = pluginWindows.get(targetPluginId);
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
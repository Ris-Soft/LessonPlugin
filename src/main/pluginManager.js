const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const extract = require('extract-zip');
const { v4: uuidv4 } = require('uuid');
const zlib = require('zlib');
const Module = require('module');
const { app, webContents } = require('electron');
const https = require('https');
const http = require('http');
let tar = null;

let manifestPath = '';
let pluginsRoot = '';
let configPath = '';
let manifest = { plugins: [] };
let config = { enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} };
  let nameToId = new Map(); // 名称/原始ID/清洗ID -> 规范ID 映射
let windows = [];
let pluginWindows = new Map(); // pluginId -> BrowserWindow
let apiRegistry = new Map();
let actionRegistry = null;
let behaviorRegistry = null;
let automationEventRegistry = new Map(); // pluginId -> Array<{ id, name, desc, params, expose }>
let functionRegistry = new Map(); // pluginId -> Map(fnName -> function)
let eventSubscribers = new Map(); // eventName -> Set(webContentsId)
let storeRoot = '';
let progressReporter = null; // 供插件在初始化期间更新启动页文本
// 引入自动化管理器引用，供插件入口 API 使用
let automationManagerRef = null;
try { tar = require('tar'); } catch {}

function ensureTar() {
  if (!tar) {
    try { tar = require('tar'); } catch {}
  }
  return !!tar;
}

function extractWithSystemTar(file, cwd) {
  return new Promise((resolve, reject) => {
    try {
      const args = process.platform === 'win32'
        ? ['-x', '-f', file, '-C', cwd]
        : ['-x', '-z', '-f', file, '-C', cwd];
      const proc = spawn('tar', args, { stdio: 'ignore' });
      proc.on('error', (e) => reject(e));
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar_exit_${code}`));
      });
    } catch (e) {
      reject(e);
    }
  });
}

function extractTgzPureJS(file, cwd) {
  return new Promise((resolve, reject) => {
    try {
      const gz = fs.readFileSync(file);
      const tarBuf = zlib.gunzipSync(gz);
      let i = 0;
      const isEmptyHeader = (buf) => {
        for (let j = 0; j < 512; j++) { if (buf[j] !== 0) return false; }
        return true;
      };
      while (i + 512 <= tarBuf.length) {
        const header = tarBuf.slice(i, i + 512);
        if (isEmptyHeader(header)) break;
        const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
        const sizeStr = header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim();
        const typeflag = header[156];
        const size = parseInt(sizeStr, 8) || 0;
        i += 512;
        const data = tarBuf.slice(i, i + size);
        i += size;
        const pad = (512 - (size % 512)) % 512;
        i += pad;
        const safe = String(name || '').replace(/\\/g, '/');
        const outPath = path.join(cwd, safe);
        if (!outPath.startsWith(path.resolve(cwd))) continue;
        if (typeflag === 53) {
          try { fs.mkdirSync(outPath, { recursive: true }); } catch {}
        } else {
          try { fs.mkdirSync(path.dirname(outPath), { recursive: true }); } catch {}
          fs.writeFileSync(outPath, data);
        }
      }
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

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
      // 支持 scope 目录：@scope 下的多个包
      const packageDirs = name.startsWith('@')
        ? fs.readdirSync(nameDir).map((pkg) => path.join(nameDir, pkg)).filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } })
        : [nameDir];
      for (const pkgDir of packageDirs) {
        let versions = [];
        try { versions = fs.readdirSync(pkgDir); } catch { versions = []; }
        for (const v of versions) {
          const nm = path.join(pkgDir, v, 'node_modules');
          try {
            if (fs.existsSync(nm) && fs.statSync(nm).isDirectory()) {
              if (!Module.globalPaths.includes(nm)) Module.globalPaths.push(nm);
            }
          } catch {}
        }
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
      // 读取 plugin.json 元数据（如有）
      let meta = {};
      const metaPath = path.join(full, 'plugin.json');
      if (fs.existsSync(metaPath)) {
        meta = readJsonSafe(metaPath, {});
      }
      // 判断是否为组件：允许无 index.js，仅要求 plugin.json 声明 type=component 且存在入口HTML
      const indexPath = path.join(full, 'index.js');
      const isComponent = String(meta?.type || '').toLowerCase() === 'component';
      const entryHtml = meta?.entry || 'index.html';
      const entryPath = path.join(full, entryHtml);
      if (!fs.existsSync(indexPath)) {
        if (!isComponent || !fs.existsSync(entryPath)) continue;
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

      // 生成稳定 id：优先 meta.id（清洗为规范），否则根据 name 生成 slug；若 slug 为空则回退到目录名或随机
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
        type: String(meta.type || 'plugin'),
        group: meta.group || null,
        entry: isComponent ? (meta.entry || 'index.html') : undefined,
        // 统一 npmDependencies：仅接收对象（非数组）；dependencies 为数组表示插件依赖
        npmDependencies: (() => {
          if (meta && typeof meta.npmDependencies === 'object' && !Array.isArray(meta.npmDependencies)) return meta.npmDependencies;
          if (meta && typeof meta.dependencies === 'object' && !Array.isArray(meta.dependencies)) return meta.dependencies;
          if (pkg && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)) return pkg.dependencies;
          return undefined;
        })(),
        // 兼容新旧清单：优先顶层 actions，其次回退到 functions.actions（旧格式）
        actions: Array.isArray(meta.actions) ? meta.actions : (Array.isArray(meta?.functions?.actions) ? meta.functions.actions : []),
        // 新增：behaviors 与 actions 区分（优先顶层 behaviors）
        behaviors: Array.isArray(meta.behaviors) ? meta.behaviors : [],
        behaviors: Array.isArray(meta.behaviors) ? meta.behaviors : [],
        // 保留 functions 以备后续扩展（如声明 backend 名称等）
        functions: typeof meta.functions === 'object' ? meta.functions : undefined,
        packages: Array.isArray(meta.packages) ? meta.packages : undefined,
        version: detectedVersion,
        studentColumns: Array.isArray(meta.studentColumns) ? meta.studentColumns : [],
        // 统一插件依赖为 dependencies（数组），兼容旧字段 pluginDepends
        dependencies: Array.isArray(meta.dependencies) ? meta.dependencies : (Array.isArray(meta.pluginDepends) ? meta.pluginDepends : undefined),
        // 新增：插件变量声明（数组或对象{name: fnName}）
        variables: (() => {
          try {
            if (Array.isArray(meta.variables)) return meta.variables.map((x) => String(x));
            if (meta && typeof meta.variables === 'object' && meta.variables) return meta.variables;
          } catch {}
          return undefined;
        })(),
        configSchema: (() => {
          try {
            if (Array.isArray(meta.configSchema)) return meta.configSchema;
            if (meta && typeof meta.configSchema === 'object' && meta.configSchema) return meta.configSchema;
            if (Array.isArray(meta.config)) return meta.config;
            if (meta && typeof meta.config === 'object' && meta.config) return meta.config;
          } catch {}
          return undefined;
        })()
      });
      // 建立多路映射：name、原始id（可能含点号）、清洗id、规范id本身
      try {
        if (name) nameToId.set(String(name), id);
        if (rawId) nameToId.set(String(rawId), id);
        if (cleanId) nameToId.set(String(cleanId), id);
        if (slugFromName) nameToId.set(String(slugFromName), id);
        nameToId.set(String(id), id);
      } catch {}
    }
  } catch {}
  // 组件目录：%USER_DATA%/LessonPlugin/components
  try {
    const componentsRoot = path.resolve(pluginsRoot, '..', 'components');
    const entries = fs.existsSync(componentsRoot) ? fs.readdirSync(componentsRoot) : [];
    for (const entry of entries) {
      const full = path.join(componentsRoot, entry);
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue;
      const metaPath = path.join(full, 'plugin.json');
      if (!fs.existsSync(metaPath)) continue;
      const meta = readJsonSafe(metaPath, {});
      const entryHtml = meta?.entry || 'index.html';
      const entryPath = path.join(full, entryHtml);
      if (!fs.existsSync(entryPath)) continue;
      const pkgPath = path.join(full, 'package.json');
      let pkg = null;
      if (fs.existsSync(pkgPath)) { try { pkg = readJsonSafe(pkgPath, {}); } catch {} }
      let detectedVersion = meta.version || (pkg?.version || null);
      const rel = path.relative(pluginsRoot, full).replace(/\\/g, '/');
      let name = meta.name || entry;
      const rawId = String(meta.id || '').trim();
      const cleanId = rawId.toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      const slugFromName = String(name || '').toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      let id = cleanId || slugFromName || String(entry).toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
      if (!id) id = `component_${Date.now()}`;
      manifest.plugins.push({
        id,
        name,
        npm: meta.npm || null,
        local: rel,
        enabled: meta.enabled !== undefined ? !!meta.enabled : true,
        icon: meta.icon || null,
        description: meta.description || '',
        author: (meta.author !== undefined ? meta.author : (pkg?.author || null)),
        type: 'component',
        group: meta.group || null,
        entry: meta.entry || 'index.html',
        npmDependencies: (() => {
          if (meta && typeof meta.npmDependencies === 'object' && !Array.isArray(meta.npmDependencies)) return meta.npmDependencies;
          if (pkg && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)) return pkg.dependencies;
          return undefined;
        })(),
        actions: Array.isArray(meta.actions) ? meta.actions : [],
        behaviors: Array.isArray(meta.behaviors) ? meta.behaviors : [],
        functions: typeof meta.functions === 'object' ? meta.functions : undefined,
        packages: Array.isArray(meta.packages) ? meta.packages : undefined,
        version: detectedVersion,
        studentColumns: Array.isArray(meta.studentColumns) ? meta.studentColumns : [],
        dependencies: Array.isArray(meta.dependencies) ? meta.dependencies : (Array.isArray(meta.pluginDepends) ? meta.pluginDepends : undefined),
        variables: undefined
      });
      try {
        if (name) nameToId.set(String(name), id);
        if (rawId) nameToId.set(String(rawId), id);
        if (cleanId) nameToId.set(String(cleanId), id);
        if (slugFromName) nameToId.set(String(slugFromName), id);
        nameToId.set(String(id), id);
      } catch {}
    }
  } catch {}
  config = readJsonSafe(configPath, { enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} });
  // 确保 config 对象包含所有必要的属性
  if (!config.enabled) config.enabled = {};
  if (!config.registry) config.registry = 'https://registry.npmmirror.com';
  if (!config.npmSelection) config.npmSelection = {};
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
  actionRegistry = null;
  behaviorRegistry = null;
};

// 统一插件ID规范化：支持中文名、带点号ID、清洗后ID与规范ID
function canonicalizePluginId(key) {
  const s = String(key || '').trim();
  if (!s) return s;
  // 直接映射命中
  if (nameToId.has(s)) return nameToId.get(s);
  // 尝试清洗点号与非法字符
  const normalized = s.toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (nameToId.has(normalized)) return nameToId.get(normalized);
  // 回退：若传入本就是规范ID则原样返回
  return normalized || s;
}

// 暴露规范化函数供主进程其它模块与IPC使用
module.exports.canonicalizePluginId = canonicalizePluginId;

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
    type: p.type || 'plugin',
    group: p.group || null,
    entry: p.entry || null,
    npmDependencies: (typeof p.npmDependencies === 'object' && !Array.isArray(p.npmDependencies) ? p.npmDependencies : undefined),
    actions: Array.isArray(p.actions) ? p.actions : [],
    version: p.version || (config.npmSelection[p.id]?.version || config.npmSelection[p.name]?.version || null),
    studentColumns: Array.isArray(p.studentColumns) ? p.studentColumns : [],
    // 输出标准插件依赖字段 dependencies（数组），兼容旧存储
    dependencies: Array.isArray(p.dependencies) ? p.dependencies : (Array.isArray(p.pluginDepends) ? p.pluginDepends : undefined),
    configSchema: (Array.isArray(p.configSchema) || (p.configSchema && typeof p.configSchema === 'object')) ? p.configSchema : undefined
  }));
};

module.exports.listVariables = function listVariables(idOrName) {
  const p = findPluginByIdOrName(idOrName);
  if (!p || !p.variables) return { variables: [] };
  if (Array.isArray(p.variables)) return { variables: p.variables };
  if (typeof p.variables === 'object') return { variables: Object.keys(p.variables) };
  return { variables: [] };
};

module.exports.getVariable = async function getVariable(idOrName, varName) {
  const p = findPluginByIdOrName(idOrName);
  if (!p) return null;
  const canonId = p.id;
  
  let targetFn = null;
  if (Array.isArray(p.variables)) {
    if (p.variables.includes(varName)) targetFn = varName;
  } else if (p.variables && typeof p.variables === 'object') {
    targetFn = p.variables[varName];
  }

  if (!targetFn) return null;

  const fnMap = functionRegistry.get(canonId);
  if (!fnMap) return null;

  const impl = fnMap.get(targetFn);
  if (typeof impl !== 'function') return null;

  try {
    return await Promise.resolve(impl());
  } catch (e) {
    console.error(`[plugin] getVariable error: ${p.name}.${varName}`, e);
    return null;
  }
};

function findPluginByIdOrName(key) {
  const canon = canonicalizePluginId(key);
  // 直接按规范ID匹配；同时兼容名称精确匹配
  return manifest.plugins.find((p) => p.id === canon || p.name === key || p.name === canon);
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

module.exports.toggle = async function toggle(idOrName, enabled) {
  const p = findPluginByIdOrName(idOrName);
  if (!p) return { ok: false, error: 'not_found' };
  const logs = [];
  const canonId = p.id || p.name;
  // 更新配置
  config.enabled[p.id] = !!enabled;
  // 兼容旧键
  config.enabled[p.name] = !!enabled;
  writeJsonSafe(configPath, config);

  try {
    if (!enabled) {
      try { console.info('plugin:toggle', { id: p.id, name: p.name, enabled: false }); } catch {}
      logs.push(`[disable] 开始禁用插件 ${p.name}`);
      // 调用插件导出的生命周期函数进行清理
      try {
        const fnMap = functionRegistry.get(canonId);
        const disabledFn = fnMap && (fnMap.get('disabled') || fnMap.get('__plugin_disabled__'));
        if (typeof disabledFn === 'function') {
          disabledFn({ pluginId: canonId, name: p.name, version: p.version });
          logs.push('[disable] 已调用插件的禁用生命周期（disabled / __plugin_disabled__）');
        }
      } catch (e) {
        logs.push(`[disable] 调用禁用生命周期失败: ${e?.message || e}`);
      }
      // 触发插件禁用事件，便于插件自行清理资源（保持兼容事件名）
      try { module.exports.emitEvent('__plugin_disabled__', { pluginId: canonId, name: p.name, version: p.version }); } catch {}
      // 清理事件订阅
      try {
        const winById = pluginWindows.get(p.id);
        const winByName = pluginWindows.get(p.name);
        const pluginWebContentsIds = [];
        if (winById?.webContents?.id) pluginWebContentsIds.push(winById.webContents.id);
        if (winByName?.webContents?.id && winByName !== winById) pluginWebContentsIds.push(winByName.webContents.id);
        for (const [eventName, subscriberSet] of eventSubscribers.entries()) {
          try { pluginWebContentsIds.forEach(id => subscriberSet.delete(id)); } catch {}
          if (subscriberSet.size === 0) { try { eventSubscribers.delete(eventName); } catch {} }
        }
      } catch {}
      try { apiRegistry.delete(canonId); logs.push('[disable] 已清理已注册 API'); } catch {}
      try { functionRegistry.delete(canonId); logs.push('[disable] 已清理已注册函数'); } catch {}
      try { automationEventRegistry.delete(canonId); logs.push('[disable] 已清理自动化事件'); } catch {}
      // 关闭窗口
      try {
        const winById = pluginWindows.get(p.id);
        const winByName = pluginWindows.get(p.name);
        if (winById) {
          try { if (winById.webContents && !winById.webContents.isDestroyed()) winById.webContents.destroy(); } catch {}
          try { if (winById.destroy && !winById.isDestroyed()) winById.destroy(); } catch {}
        }
        if (winByName && winByName !== winById) {
          try { if (winByName.webContents && !winByName.webContents.isDestroyed()) winByName.webContents.destroy(); } catch {}
          try { if (winByName.destroy && !winByName.isDestroyed()) winByName.destroy(); } catch {}
        }
        pluginWindows.delete(p.id);
        pluginWindows.delete(p.name);
        logs.push('[disable] 已关闭相关窗口');
      } catch {}
      // 清理自动化触发器
      try {
        if (automationManagerRef) {
          try { automationManagerRef.clearPluginMinuteTriggers(canonId); logs.push('[disable] 已清理分钟触发器'); } catch {}
          try { if (typeof automationManagerRef.clearPluginTimers === 'function') automationManagerRef.clearPluginTimers(canonId); } catch {}
        }
      } catch {}
      logs.push(`[disable] 插件 ${p.name} 已禁用`);
    } else {
      try { console.info('plugin:toggle', { id: p.id, name: p.name, enabled: true }); } catch {}
      logs.push(`[enable] 开始启用插件 ${p.name}`);
      const baseDir = p.local ? path.join(path.dirname(manifestPath), p.local) : null;
      const modPath = baseDir ? path.resolve(baseDir, 'index.js') : null;
      try { if (modPath) { delete require.cache[require.resolve(modPath)]; } } catch {}
      if (modPath && fs.existsSync(modPath)) {
        try {
          // 启用前确保依赖注入到插件目录
          try {
            const depsRes = await module.exports.ensureDeps(p.id);
            try { console.info('plugin:deps', { id: p.id, name: p.name, ok: !!depsRes?.ok }); } catch {}
          } catch {}
          const mod = require(modPath);
          // 注册函数
          const fnObj = (mod && typeof mod.functions === 'object') ? mod.functions : null;
          if (fnObj) {
            if (!functionRegistry.has(p.id)) functionRegistry.set(p.id, new Map());
            const map = functionRegistry.get(p.id);
            for (const [fn, impl] of Object.entries(fnObj)) {
              if (fn === 'actions') continue;
              if (typeof impl === 'function') map.set(fn, impl);
            }
            logs.push('[enable] 已注册后端函数');
          }
          // 注册自动化事件
          if (mod && Array.isArray(mod.automationEvents)) {
            module.exports.registerAutomationEvents(p.id, mod.automationEvents);
            logs.push('[enable] 已注册自动化事件');
          }
          // 执行 init
          if (mod && typeof mod.init === 'function') {
            logs.push(`[enable] 正在初始化 ${p.name} ...`);
            try {
              await Promise.resolve(mod.init(createPluginApi(p.id)));
              logs.push(`[enable] 插件 ${p.name} 初始化完成`);
              try { console.info('plugin:init_done', { id: p.id, name: p.name }); } catch {}
            } catch (e) {
              logs.push(`[enable] 插件 ${p.name} 初始化失败：${e?.message || e}`);
              try { console.info('plugin:init_failed', { id: p.id, name: p.name, error: e?.message || String(e) }); } catch {}
            }
          }
        } catch (e) {
          logs.push(`[enable] 启用失败：${e?.message || String(e)}`);
          try { console.info('plugin:enable_failed', { id: p.id, name: p.name, error: e?.message || String(e) }); } catch {}
        }
      } else {
        logs.push('[enable] 未找到本地入口 index.js，跳过注册/初始化');
      }
    }
  } catch {}

  return { ok: true, id: p.id, name: p.name, enabled: !!enabled, logs };
};

// 选择已安装的最新版本（简单策略）
function pickInstalledLatest(name) {
  try {
    const segs = String(name).split('/').filter(Boolean);
    const nameDir = path.join(storeRoot, ...segs);
    if (!fs.existsSync(nameDir) || !fs.statSync(nameDir).isDirectory()) return null;
    const versions = fs.readdirSync(nameDir).filter((v) => {
      const vDir = path.join(nameDir, v, 'node_modules', ...segs);
      return fs.existsSync(vDir);
    }).sort((a, b) => {
      const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
      const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const da = pa[i] || 0; const db = pb[i] || 0;
        if (da !== db) return da - db;
      }
      return 0;
    });
    return versions[versions.length - 1] || null;
  } catch { return null; }
}

function linkDepToPlugin(pluginDir, pkgName, version) {
  try {
    const pluginNm = path.join(pluginDir, 'node_modules');
    const segs = String(pkgName).split('/').filter(Boolean);
    const target = path.join(pluginNm, ...segs);
    const storePkg = path.join(storeRoot, ...segs, version, 'node_modules', ...segs);
    if (!fs.existsSync(storePkg)) return { ok: false, error: 'store_package_missing' };
    try { if (!fs.existsSync(pluginNm)) fs.mkdirSync(pluginNm, { recursive: true }); } catch {}
    try {
      if (fs.existsSync(target)) {
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || stat.isDirectory()) {
          fs.rmSync(target, { recursive: true, force: true });
        } else {
          fs.unlinkSync(target);
        }
      }
    } catch {}
    // 确保父目录存在（处理 scope 嵌套）
    try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch {}
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    try {
      fs.symlinkSync(storePkg, target, type);
      return { ok: true, method: 'link' };
    } catch (e) {
      // 在部分 Windows 环境下可能没有创建符号链接的权限；回退为复制目录
      try {
        const copyDir = (src, dst) => {
          const items = fs.readdirSync(src);
          for (const it of items) {
            const sp = path.join(src, it);
            const dp = path.join(dst, it);
            const st = fs.statSync(sp);
            if (st.isDirectory()) {
              if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true });
              copyDir(sp, dp);
            } else {
              fs.copyFileSync(sp, dp);
            }
          }
        };
        if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
        copyDir(storePkg, target);
        return { ok: true, method: 'copy' };
      } catch (copyErr) {
        return { ok: false, error: (copyErr?.message || String(copyErr)) };
      }
    }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function collectPluginDeps(p) {
  const deps = [];
  try {
    const obj = (typeof p.npmDependencies === 'object' && !Array.isArray(p.npmDependencies) && p.npmDependencies) ? p.npmDependencies : {};
    for (const name of Object.keys(obj)) deps.push({ name, range: String(obj[name] || '').trim() });
    if (Array.isArray(p.packages)) {
      for (const pkg of p.packages) {
        const name = pkg?.name; if (!name) continue;
        const versions = Array.isArray(pkg.versions) ? pkg.versions : (pkg.version ? [pkg.version] : []);
        if (versions.length) {
          for (const v of versions) deps.push({ name, explicit: String(v) });
        } else {
          deps.push({ name });
        }
      }
    }
  } catch {}
  return deps;
}

module.exports.ensureDeps = async function ensureDeps(idOrName, options) {
  try {
    const opts = options || {};
    const downloadIfMissing = (opts.downloadIfMissing !== undefined) ? !!opts.downloadIfMissing : true;
    const p = findPluginByIdOrName(idOrName);
    if (!p) return { ok: false, error: 'plugin_not_found' };
    if (!p.local) return { ok: true, logs: ['[deps] 插件未安装到本地目录，跳过依赖链接'] };
    const baseDir = path.join(path.dirname(manifestPath), p.local);
    const deps = collectPluginDeps(p);
    // 确保 config.npmSelection 存在，防止 undefined 错误
    if (!config.npmSelection) config.npmSelection = {};
    const selMap = (config.npmSelection[p.id] || config.npmSelection[p.name] || {});
    const logs = [];
    let hadError = false;
    logs.push(`[deps] 开始处理插件依赖：${p.name}（${deps.length} 项）`);
    console.log('deps:ensure', p.name, deps);
    for (const d of deps) {
      const name = d.name;
      let version = selMap[name] || d.explicit || null;
      if (!version) version = pickInstalledLatest(name);
      const segs = String(name).split('/').filter(Boolean);
      const storePath = version ? path.join(storeRoot, ...segs, version, 'node_modules', ...segs) : null;
      if (!version || !storePath || !fs.existsSync(storePath)) {
        if (!downloadIfMissing) {
          logs.push(`[deps] ${name} 缺少已安装版本，暂不下载（启动加速）`);
          continue;
        }
        let pick = d.explicit || null;
        if (!pick) {
          const list = await module.exports.getPackageVersions(name);
          if (list.ok && Array.isArray(list.versions) && list.versions.length) {
            pick = list.versions[list.versions.length - 1];
          }
        }
        if (pick) {
          const dl = await module.exports.downloadPackageVersion(name, pick, (status) => {
            try { if (progressReporter) progressReporter(status); } catch {}
          });
          if (dl.ok) {
            version = pick;
            logs.push(`[deps] 下载 ${name}@${pick} 完成`);
          } else {
            logs.push(`[deps] 下载 ${name}@${pick} 失败：${dl.error}`);
            hadError = true;
            continue;
          }
        } else {
          logs.push(`[deps] 未能确定 ${name} 可用版本`);
          hadError = true;
          continue;
        }
      }
      try { if (progressReporter) progressReporter({ stage: 'npm', message: `链接 ${name}@${version} 到插件...` }); } catch {}
      const link = linkDepToPlugin(baseDir, name, version);
      if (!link.ok) {
        logs.push(`[deps] 链接 ${name}@${version} 到插件失败：${link.error}`);
        try { console.error('deps:link:failed', name, version, link.error); } catch {}
        hadError = true;
      } else {
        const method = link.method === 'copy' ? '复制' : '链接';
        logs.push(`[deps] 已${method} ${name}@${version} 到插件`);
        try { console.log('deps:link:success', name, version, method); } catch {}
        try { if (progressReporter) progressReporter({ stage: 'npm', message: `已${method} ${name}@${version}` }); } catch {}
      }
    }
    return { ok: !hadError, logs };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

module.exports.getPluginDependencyStatus = function getPluginDependencyStatus(idOrName) {
  try {
    const p = findPluginByIdOrName(idOrName);
    if (!p) return { ok: false, error: 'plugin_not_found' };
    const baseDir = p.local ? path.join(path.dirname(manifestPath), p.local) : null;
    const deps = collectPluginDeps(p);
    const status = [];
    for (const d of deps) {
      const name = d.name;
      const segs = String(name).split('/').filter(Boolean);
      const installed = [];
      try {
        const nameDir = path.join(storeRoot, ...segs);
        if (fs.existsSync(nameDir)) {
          const versions = fs.readdirSync(nameDir).filter((v) => {
            const vDir = path.join(nameDir, v, 'node_modules', ...segs);
            return fs.existsSync(vDir);
          });
          installed.push(...versions);
        }
      } catch {}
      const linked = baseDir ? fs.existsSync(path.join(baseDir, 'node_modules', ...segs)) : false;
      status.push({ name, installed, linked });
    }
    return { ok: true, status };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

module.exports.loadPlugins = async function loadPlugins(onProgress) {
  // 保存进度报告函数，供插件入口通过 API 更新启动页状态
  progressReporter = typeof onProgress === 'function' ? onProgress : null;
  const statuses = [];
  for (const p of manifest.plugins) {
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
      const isEnabled = !!(config.enabled[p.id] ?? config.enabled[p.name]);
      if (!isEnabled) {
        status.stage = 'disabled';
        status.message = '插件已禁用，跳过初始化';
        onProgress && onProgress({ ...status });
        continue;
      }
      const localPath = path.resolve(path.dirname(manifestPath), p.local);
      if (fs.existsSync(localPath)) {
        status.stage = 'local';
        status.message = '本地插件就绪';
        // 组件不注册后端函数与自动化事件
        if (isComponent) { onProgress && onProgress({ ...status }); continue; }
        // 注册后端函数（如存在），使插件无需打开窗口即可被调用
        try {
          const modPath = path.resolve(localPath, 'index.js');
          if (fs.existsSync(modPath)) {
            // 启动阶段仅链接已有依赖，不触发下载以加速启动
            try { await module.exports.ensureDeps(p.id, { downloadIfMissing: false }); } catch {}
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
    if (res.ok) {
      if (!config.npmSelection[p.id]) config.npmSelection[p.id] = {};
      config.npmSelection[p.id][job.name] = job.version;
      writeJsonSafe(configPath, config);
    }
  }
  try { await module.exports.ensureDeps(p.id, { downloadIfMissing: false }); } catch {}
  return { ok: results.every((r) => r.ok), results };
};

module.exports.closeAllWindows = function closeAllWindows() {
  for (const w of windows) {
    try {
      if (!w.isDestroyed()) w.destroy();
    } catch {}
  }
  windows = [];
  // 同步清理插件窗口与事件订阅
  try {
    for (const [key, w] of pluginWindows.entries()) {
      const wc = (w && w.webContents) ? w.webContents : null;
      try { if (wc && !wc.isDestroyed()) wc.destroy(); } catch {}
      try { if (w && typeof w.destroy === 'function' && !w.isDestroyed()) w.destroy(); } catch {}
    }
    pluginWindows.clear();
  } catch {}
  try { eventSubscribers.clear(); } catch {}
};

// --------- Registry 访问与下载 ---------
function httpGet(url) {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(httpGet(res.headers.location));
        }
        if ((res.statusCode || 0) !== 200) {
          let err = '';
          res.on('data', (d) => { err += String(d || ''); });
          res.on('end', () => resolve({ ok: false, error: `HTTP_${res.statusCode}: ${err}` }));
          return;
        }
        const chunks = [];
        res.on('data', (d) => chunks.push(Buffer.from(d)));
        res.on('end', () => resolve({ ok: true, buffer: Buffer.concat(chunks) }));
      });
      req.on('error', (e) => resolve({ ok: false, error: e?.message || String(e) }));
    } catch (e) {
      resolve({ ok: false, error: e?.message || String(e) });
    }
  });
}

function fetchJson(url) {
  return httpGet(url).then((res) => {
    if (!res.ok) return { ok: false, error: res.error };
    try { return { ok: true, json: JSON.parse(res.buffer.toString('utf-8')) }; }
    catch (e) { return { ok: false, error: e?.message || 'json_parse_error' }; }
  });
}

function encodePkgPath(name) {
  const base = String(config.registry || 'https://registry.npmmirror.com').replace(/\/+$/g, '');
  const segs = String(name).split('/').filter(Boolean).map((s) => encodeURIComponent(s));
  return `${base}/${segs.join('/')}`;
}

module.exports.getPackageVersions = async function getPackageVersions(name) {
  const url = encodePkgPath(name);
  const res = await fetchJson(url);
  if (!res.ok) return { ok: false, error: res.error || 'registry 请求失败' };
  const data = res.json || {};
  try {
    const versionsObj = data.versions || {};
    let versions = Object.keys(versionsObj);
    try {
      const cmp = require('semver-compare');
      versions.sort(cmp);
    } catch {}
    return { ok: true, versions };
  } catch (e) {
    return { ok: false, error: e?.message || '解析版本失败' };
  }
};

module.exports.downloadPackageVersion = async function downloadPackageVersion(name, version, onProgress) {
  const segs = String(name).split('/').filter(Boolean);
  const dest = path.join(storeRoot, ...segs, version);
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const nm = path.join(dest, 'node_modules');
  if (!fs.existsSync(nm)) { try { fs.mkdirSync(nm, { recursive: true }); } catch {} }
  const directPath = path.join(nm, ...segs);
  if (fs.existsSync(directPath)) return { ok: true, path: directPath };
  onProgress && onProgress({ stage: 'npm', message: `下载 ${name}@${version} ...` });
  const metaRes = await fetchJson(`${encodePkgPath(name)}`);
  if (!metaRes.ok) return { ok: false, error: metaRes.error || '获取包信息失败' };
  const data = metaRes.json || {};
  const verData = (data.versions && data.versions[version]) ? data.versions[version] : null;
  const tarball = verData && verData.dist && verData.dist.tarball ? verData.dist.tarball : null;
  if (!tarball) return { ok: false, error: '缺少 tarball 地址' };
  const tgz = await httpGet(tarball);
  if (!tgz.ok) return { ok: false, error: tgz.error || '下载失败' };
  const tmpDir = path.join(dest, '__tmp__');
  try { if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
  const tmpTgz = path.join(tmpDir, `${segs[segs.length - 1]}-${version}.tgz`);
  try { fs.writeFileSync(tmpTgz, tgz.buffer); } catch (e) { return { ok: false, error: e?.message || '写入临时文件失败' }; }
  {
    let extractedOk = false;
    let extractErr = null;
    if (ensureTar()) {
      try { await tar.x({ file: tmpTgz, cwd: tmpDir }); extractedOk = true; }
      catch (e) { extractErr = e; }
    }
    if (!extractedOk) {
      try { await extractWithSystemTar(tmpTgz, tmpDir); extractedOk = true; }
      catch (e) { extractErr = e; }
    }
    if (!extractedOk) {
      try { await extractTgzPureJS(tmpTgz, tmpDir); extractedOk = true; }
      catch (e) { extractErr = e; }
    }
    if (!extractedOk) {
      return { ok: false, error: `解压失败：${extractErr?.message || 'tar不可用'}` };
    }
  }
  const extracted = path.join(tmpDir, 'package');
  if (!fs.existsSync(extracted)) return { ok: false, error: '解压内容缺失' };
  try {
    fs.mkdirSync(path.dirname(directPath), { recursive: true });
    const copyDir = (src, dst) => {
      const items = fs.readdirSync(src);
      if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
      for (const it of items) {
        const s = path.join(src, it);
        const d = path.join(dst, it);
        const st = fs.statSync(s);
        if (st.isDirectory()) { copyDir(s, d); }
        else { fs.copyFileSync(s, d); }
      }
    };
    copyDir(extracted, directPath);
  } catch (e) {
    return { ok: false, error: e?.message || '复制解压内容失败' };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
  try { if (!Module.globalPaths.includes(nm)) Module.globalPaths.push(nm); } catch {}
  onProgress && onProgress({ stage: 'npm', message: `完成 ${name}@${version}` });
  return { ok: fs.existsSync(directPath), path: directPath };
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
      if (name.startsWith('@')) {
        // 处理 scope 下的包
        const pkgs = fs.readdirSync(nameDir).filter((p) => {
          const pDir = path.join(nameDir, p);
          try { return fs.statSync(pDir).isDirectory(); } catch { return false; }
        });
        for (const p of pkgs) {
          const pkgDir = path.join(nameDir, p);
          const versions = fs.readdirSync(pkgDir).filter((v) => {
            const vDir = path.join(pkgDir, v, 'node_modules', name, p);
            return fs.existsSync(vDir);
          });
          // 仅在存在有效版本时纳入列表；无版本则尝试清理空目录
          if (versions.length > 0) {
            result.push({ name: `${name}/${p}`, versions });
          } else {
            try {
              // 尝试移除空包目录（不影响其他包）
              const entries = fs.readdirSync(pkgDir);
              if (!entries.length) fs.rmSync(pkgDir, { recursive: true, force: true });
              // 若 scope 目录已空，也尝试清理
              const remain = fs.readdirSync(nameDir).filter((n) => {
                try { return fs.statSync(path.join(nameDir, n)).isDirectory(); } catch { return false; }
              });
              if (!remain.length) fs.rmSync(nameDir, { recursive: true, force: true });
            } catch {}
          }
        }
      } else {
        // 普通包
        const versions = fs.readdirSync(nameDir).filter((v) => {
          const vDir = path.join(nameDir, v, 'node_modules', name);
          return fs.existsSync(vDir);
        });
        if (versions.length > 0) {
          result.push({ name, versions });
        } else {
          // 清理空包目录
          try {
            const entries = fs.readdirSync(nameDir);
            if (!entries.length) fs.rmSync(nameDir, { recursive: true, force: true });
          } catch {}
        }
      }
    }
    return { ok: true, packages: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

// 查询某个 NPM 包的占用情况（哪些插件当前已链接到该包及其版本）
module.exports.listPackageUsers = function listPackageUsers(pkgName) {
  try {
    const users = [];
    const segs = String(pkgName).split('/').filter(Boolean);
    for (const p of (manifest.plugins || [])) {
      const baseDir = p.local ? path.join(path.dirname(manifestPath), p.local) : null;
      if (!baseDir) continue;
      const linkedPath = path.join(baseDir, 'node_modules', ...segs);
      if (fs.existsSync(linkedPath)) {
        let realLinked = null;
        let version = null;
        try {
          realLinked = fs.realpathSync(linkedPath);
          // 解析版本：storeRoot/[...segs]/<version>/node_modules/[...segs]
          const rel = path.relative(storeRoot, realLinked).replace(/\\/g, '/');
          const parts = rel.split('/').filter(Boolean);
          // 普通包：name/version/...
          // scope 包：@scope/pkg/version/...
          if (parts.length >= 2 && parts[0].startsWith('@')) {
            version = parts[2] || null;
          } else {
            version = parts[1] || null;
          }
        } catch {}
        users.push({ pluginId: p.id, pluginName: p.name, version: version || null });
      }
    }
    return { ok: true, users };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

// 删除指定 NPM 包的某些版本（删除前检查当前链接占用）
module.exports.removePackageVersions = function removePackageVersions(pkgName, versions) {
  try {
    const segs = String(pkgName).split('/').filter(Boolean);
    const blocked = [];
    const removed = [];
    const errors = [];
    // 检查占用
    const usesRes = module.exports.listPackageUsers(pkgName);
    const uses = (usesRes?.ok && Array.isArray(usesRes.users)) ? usesRes.users : [];
    const inUseVersions = new Set(uses.filter(u => u.version).map(u => String(u.version)));
    for (const v of (Array.isArray(versions) ? versions : [])) {
      const ver = String(v);
      if (inUseVersions.has(ver)) {
        blocked.push(ver);
        continue;
      }
      try {
        const verDir = path.join(storeRoot, ...segs, ver);
        if (fs.existsSync(verDir)) {
          // 递归删除版本目录
          fs.rmSync(verDir, { recursive: true, force: true });
          removed.push(ver);
        } else {
          errors.push({ version: ver, error: 'version_not_found' });
        }
      } catch (e) {
        errors.push({ version: ver, error: e?.message || String(e) });
      }
    }
    // 若该包已无有效版本，清理包目录及空的 scope 目录
    try {
      const pkgBase = path.join(storeRoot, ...segs);
      const isScoped = segs[0]?.startsWith('@');
      const pkgDir = isScoped && segs.length >= 2 ? path.join(storeRoot, segs[0], segs[1]) : (segs.length ? path.join(storeRoot, segs[0]) : pkgBase);
      const existsPkgDir = fs.existsSync(pkgDir) && fs.statSync(pkgDir).isDirectory();
      if (existsPkgDir) {
        // 检查是否还存在有效版本（node_modules/...segs 路径存在）
        const verNames = fs.readdirSync(pkgDir).filter((vn) => {
          const vPath = path.join(pkgDir, vn, 'node_modules', ...segs);
          return fs.existsSync(vPath);
        });
        if (verNames.length === 0) {
          // 没有有效版本，删除包目录
          try { fs.rmSync(pkgDir, { recursive: true, force: true }); } catch {}
          // 若为 scoped 包，scope 目录为空则删除
          if (isScoped) {
            const scopeDir = path.join(storeRoot, segs[0]);
            try {
              const remain = fs.readdirSync(scopeDir).filter((n) => {
                try { return fs.statSync(path.join(scopeDir, n)).isDirectory(); } catch { return false; }
              });
              if (remain.length === 0) fs.rmSync(scopeDir, { recursive: true, force: true });
            } catch {}
          }
        }
      }
    } catch {}
    // 删除后刷新全局模块路径（避免残留）
    try { refreshGlobalModulePaths(); } catch {}
    const ok = errors.length === 0;
    return { ok, removed, blocked, errors, uses };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
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
    try { console.info('plugin:uninstall', { id: p.id, name: p.name }); } catch {}
    // 仅支持卸载本地插件
    if (!p.local) return { ok: false, error: 'not_local_plugin' };
    const fullDir = path.join(path.dirname(manifestPath), p.local);
    
    // 获取插件的规范化ID用于清理各种注册项
    const canonId = p.id || p.name;
    // 调用插件导出的生命周期函数进行清理
    try {
      const fnMap = functionRegistry.get(canonId);
      const uninstallFn = fnMap && (fnMap.get('uninstall') || fnMap.get('__plugin_uninstall__'));
      if (typeof uninstallFn === 'function') {
        uninstallFn({ pluginId: canonId, name: p.name, version: p.version });
        console.log(`[uninstall] 已调用插件 ${p.name} 的卸载生命周期（uninstall / __plugin_uninstall__）`);
      }
    } catch (e) {
      console.log(`[uninstall] 调用插件 ${p.name} 的卸载生命周期失败: ${e?.message || e}`);
    }
    // 触发插件卸载事件，通知前端与其他插件及时清理（保持兼容事件名）
    try { module.exports.emitEvent('__plugin_uninstall__', { pluginId: canonId, name: p.name, version: p.version }); } catch {}
    
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
          const segs = String(pkgDef.name).split('/').filter(Boolean);
          const destPath = path.join(storeRoot, ...segs, v, 'node_modules', ...segs);
          if (fs.existsSync(destPath)) continue; // 已有版本
          const dl = await module.exports.downloadPackageVersion(pkgDef.name, v);
          if (!dl.ok) {
            // 无法下载且本地不存在
            return { ok: false, error: `无法下载依赖 ${pkgDef.name}@${v}，请手动导入到 src/npm_store/${segs.join('/')}/${v}/node_modules/${segs.join('/')}` };
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
        } catch {}
        return undefined;
      })(),
      configSchema: (() => {
        try {
          if (Array.isArray(meta.configSchema)) return meta.configSchema;
          if (meta && typeof meta.configSchema === 'object' && meta.configSchema) return meta.configSchema;
          if (Array.isArray(meta.config)) return meta.config;
          if (meta && typeof meta.config === 'object' && meta.config) return meta.config;
        } catch {}
        return undefined;
      })()
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
    const logs = [];
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
          logs.push('[install] 已注册自动化事件');
        }
        // 执行插件初始化
        if (mod && typeof mod.init === 'function') {
          try {
            progressReporter && progressReporter({ stage: 'plugin:init', message: `初始化插件 ${pluginName}...` });
            await Promise.resolve(mod.init(createPluginApi(pluginId)));
            progressReporter && progressReporter({ stage: 'plugin:init', message: `插件 ${pluginName} 初始化完成` });
            logs.push(`[install] 插件 ${pluginName} 初始化完成`);
            try { console.info('plugin:init_done', { id: pluginId, name: pluginName }); } catch {}
          } catch (e) {
            progressReporter && progressReporter({ stage: 'plugin:error', message: `插件 ${pluginName} 初始化失败：${e?.message || e}` });
            logs.push(`[install] 插件 ${pluginName} 初始化失败：${e?.message || e}`);
            try { console.info('plugin:init_failed', { id: pluginId, name: pluginName, error: e?.message || String(e) }); } catch {}
          }
        }
      }
    } catch {}

    try { console.info('plugin:install_success', { id: pluginId, name: pluginName }); } catch {}
    return { ok: true, id: pluginId, name: pluginName, author: (meta.author !== undefined ? meta.author : (pkg?.author || null)), npmDependencies: updated.npmDependencies, dependencies: (typeof meta.dependencies === 'object' ? meta.dependencies : (pkg?.dependencies || undefined)), pluginDepends: Array.isArray(meta.pluginDepends) ? meta.pluginDepends : undefined, logs };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};

// -------- 插件 API / 事件总线 --------
module.exports.registerFunctions = function registerFunctions(pluginId, functions, senderWC) {
  const canonId = canonicalizePluginId(pluginId);
  // 覆盖式API注册，避免重复与陈旧条目导致冲突
  apiRegistry.set(canonId, new Set(Array.isArray(functions) ? functions : []));
  // 将 webContents 记录，供路由调用
  const win = pluginWindows.get(canonId);
  if (!win || win.webContents.id !== senderWC.id) {
    // 如果调用来自不同 webContents（异常情况），仍以最新 sender 为准
    pluginWindows.set(canonId, { webContents: senderWC, isProxy: true });
  }
  try { console.info('plugin:window_registered', { pluginId: canonId, webContentsId: senderWC.id }); } catch {}
  return { ok: true };
};

// 自动化事件注册/查询
module.exports.registerAutomationEvents = function registerAutomationEvents(pluginId, events) {
  const canonId = canonicalizePluginId(pluginId);
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
  const canonId = canonicalizePluginId(pluginId);
  return { ok: true, events: automationEventRegistry.get(canonId) || [] };
};

module.exports.callFunction = function callFunction(targetPluginId, fnName, args, callerPluginId) {
  return new Promise(async (resolve) => {
    const canonId = canonicalizePluginId(targetPluginId);
    try { console.info('plugin:call_function:start', { pluginId: canonId, fn: fnName, caller: callerPluginId || null }); } catch {}
    // 优先主进程注册的函数，无需窗口
    const fnMap = functionRegistry.get(canonId);
    if (fnMap && fnMap.has(fnName)) {
      try {
        const result = await Promise.resolve(fnMap.get(fnName)(...(Array.isArray(args) ? args : [])));
        try { console.info('plugin:call_function:done', { pluginId: canonId, fn: fnName, ok: true, caller: callerPluginId || null }); } catch {}
        return resolve({ ok: true, result });
      } catch (e) {
        try { console.info('plugin:call_function:done', { pluginId: canonId, fn: fnName, ok: false, error: e?.message || String(e), caller: callerPluginId || null }); } catch {}
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
      try { console.info('plugin:call_function:done', { pluginId: canonId, fn: fnName, ok: !!payload?.ok, caller: callerPluginId || null }); } catch {}
      resolve(payload);
    };
    module.exports._ipcMain.on('plugin:invoke:result', onResult);
    wc.send('plugin:invoke', { id: reqId, fn: fnName, args: Array.isArray(args) ? args : [] });
  });
};

module.exports.getPluginIdByWebContentsId = function getPluginIdByWebContentsId(wcId) {
  try {
    for (const [pid, win] of pluginWindows.entries()) {
      const wc = win?.webContents || win;
      if (wc && wc.id === wcId) return pid;
    }
  } catch {}
  return null;
};

// 为插件入口提供主进程侧可用的 API
function createPluginApi(pluginId) {
  return {
    call: (targetPluginId, fnName, args) => module.exports.callFunction(targetPluginId, fnName, args, pluginId),
    callByAction: async (actionId, args) => {
      try { const res = await module.exports.callAction(actionId, Array.isArray(args) ? args : []); return res; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    callByBehavior: async (behaviorId, args) => {
      try { const res = await module.exports.callBehavior(behaviorId, Array.isArray(args) ? args : []); return res; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    emit: (eventName, payload) => module.exports.emitEvent(eventName, payload),
    registerAutomationEvents: (events) => module.exports.registerAutomationEvents(pluginId, events),
    components: {
      list: (group) => {
        try { return module.exports.listComponents(group); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
      },
      entryUrl: (idOrName) => {
        try { return module.exports.getComponentEntryUrl(idOrName); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
      }
    },
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
  // 精确根据订阅的 webContents.id 投递事件，支持多个窗口
  for (const pid of subs) {
    try {
      const wc = webContents.fromId(pid);
      if (wc && !wc.isDestroyed()) {
        wc.send('plugin:event', { name: eventName, payload });
        delivered++;
      }
    } catch {}
  }
  try { console.info('plugin:event_emit', { event: eventName, delivered }); } catch {}
  return { ok: true, delivered };
};

// -------- 动作名：聚合、默认映射与调用 --------
function buildActionRegistry() {
  const map = new Map();
  try {
    for (const p of manifest.plugins) {
      const acts = Array.isArray(p.actions) ? p.actions : [];
      for (const a of acts) {
        const id = String(a?.id || '').trim();
        const target = String(a?.target || '').trim();
        if (!id || !target) continue;
        const arr = map.get(id) || [];
        arr.push({ pluginId: p.id, pluginName: p.name, target, text: a.text || a.label || '', icon: a.icon || '' });
        map.set(id, arr);
      }
    }
  } catch {}
  return map;
}

module.exports.listActions = function listActions() {
  try {
    if (!actionRegistry) actionRegistry = buildActionRegistry();
    const out = [];
    for (const [id, providers] of actionRegistry.entries()) {
      out.push({ id, providers });
    }
    return { ok: true, actions: out };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

module.exports.callAction = async function callAction(actionId, args, preferredPluginId) {
  try {
    const id = String(actionId || '').trim();
    if (!id) return { ok: false, error: 'action_required' };
    if (!actionRegistry) actionRegistry = buildActionRegistry();
    const providers = actionRegistry.get(id) || [];
    if (!providers.length) return { ok: false, error: 'action_not_found' };
    let targetEntry = null;
    if (preferredPluginId) {
      const canon = canonicalizePluginId(preferredPluginId);
      targetEntry = providers.find((p) => canonicalizePluginId(p.pluginId) === canon);
    }
    if (!targetEntry) {
      let defPid = null;
      try {
        const store = require('./store');
        const sys = store.getAll('system') || {};
        const defMap = sys.defaultActions || {};
        defPid = defMap[id];
      } catch {}
      if (defPid) {
        const canon = canonicalizePluginId(defPid);
        targetEntry = providers.find((p) => canonicalizePluginId(p.pluginId) === canon) || null;
      }
    }
    if (!targetEntry) {
      // 若只有一个提供者，直接使用
      if (providers.length === 1) targetEntry = providers[0];
      else return { ok: false, error: 'multiple_providers' };
    }
    try { console.info('plugin:action:start', { actionId: id, pluginId: targetEntry.pluginId, fn: targetEntry.target }); } catch {}
    return module.exports.callFunction(targetEntry.pluginId, targetEntry.target, Array.isArray(args) ? args : []);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

module.exports.setDefaultAction = function setDefaultAction(actionId, pluginId) {
  try {
    const store = require('./store');
    const sys = store.getAll('system') || {};
    const defMap = Object(sys.defaultActions || {});
    defMap[String(actionId)] = canonicalizePluginId(pluginId);
    store.set('system', 'defaultActions', defMap);
    return { ok: true, defaults: defMap };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

// -------- 行为（behavior）：与 actions 区分的能力集合 --------
function buildBehaviorRegistry() {
  const map = new Map();
  try {
    for (const p of manifest.plugins) {
      const defs = Array.isArray(p.behaviors) ? p.behaviors : [];
      for (const b of defs) {
        const id = String(b?.id || '').trim();
        const target = String(b?.target || '').trim();
        if (!id || !target) continue;
        const arr = map.get(id) || [];
        arr.push({ pluginId: p.id, pluginName: p.name, target, text: b.text || b.label || '', icon: b.icon || '' });
        map.set(id, arr);
      }
    }
  } catch {}
  return map;
}

module.exports.listBehaviors = function listBehaviors() {
  try {
    if (!behaviorRegistry) behaviorRegistry = buildBehaviorRegistry();
    const out = [];
    for (const [id, providers] of behaviorRegistry.entries()) {
      out.push({ id, providers });
    }
    // 回退：若未声明任何 behaviors，则以 actions 作为候选（便于过渡期）
    if (!out.length) {
      if (!actionRegistry) actionRegistry = buildActionRegistry();
      for (const [id, providers] of actionRegistry.entries()) out.push({ id, providers });
    }
    return { ok: true, actions: out };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

module.exports.callBehavior = async function callBehavior(behaviorId, args, preferredPluginId) {
  try {
    const id = String(behaviorId || '').trim();
    if (!id) return { ok: false, error: 'behavior_required' };
    if (!behaviorRegistry) behaviorRegistry = buildBehaviorRegistry();
    let providers = behaviorRegistry.get(id) || [];
    // 回退：未声明 behaviors 时，使用 actions 作为替代
    if (!providers.length) {
      if (!actionRegistry) actionRegistry = buildActionRegistry();
      providers = actionRegistry.get(id) || [];
    }
    if (!providers.length) return { ok: false, error: 'behavior_not_found' };
    let targetEntry = null;
    if (preferredPluginId) {
      const canon = canonicalizePluginId(preferredPluginId);
      targetEntry = providers.find((p) => canonicalizePluginId(p.pluginId) === canon);
    }
    if (!targetEntry) {
      // 使用行为默认映射
      let defPid = null;
      try {
        const store = require('./store');
        const sys = store.getAll('system') || {};
        const defMap = sys.defaultBehaviors || {};
        defPid = defMap[id];
      } catch {}
      if (defPid) {
        const canon = canonicalizePluginId(defPid);
        targetEntry = providers.find((p) => canonicalizePluginId(p.pluginId) === canon) || null;
      }
    }
    if (!targetEntry) {
      if (providers.length === 1) targetEntry = providers[0];
      else return { ok: false, error: 'multiple_providers' };
    }
    try { console.info('plugin:behavior:start', { behaviorId: id, pluginId: targetEntry.pluginId, fn: targetEntry.target }); } catch {}
    return module.exports.callFunction(targetEntry.pluginId, targetEntry.target, Array.isArray(args) ? args : []);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

module.exports.setDefaultBehavior = function setDefaultBehavior(behaviorId, pluginId) {
  try {
    const store = require('./store');
    const sys = store.getAll('system') || {};
    const defMap = Object(sys.defaultBehaviors || {});
    defMap[String(behaviorId)] = canonicalizePluginId(pluginId);
    store.set('system', 'defaultBehaviors', defMap);
    return { ok: true, defaults: defMap };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
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
          try { return Object.keys(meta.dependencies).map(k => `${k}@${meta.dependencies[k]}`); } catch {}
        }
        if (Array.isArray(meta.pluginDepends)) return meta.pluginDepends;
        return undefined;
      })(),
      // 变量声明（仅预览用途）
      variables: (() => {
        try {
          if (Array.isArray(meta.variables)) return meta.variables.map((x) => String(x));
          if (meta && typeof meta.variables === 'object' && meta.variables) return Object.keys(meta.variables);
        } catch {}
        return undefined;
      })()
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
    // 依赖此插件的其他插件（按 dependencies 声明，支持 name@version 形式）
    const pluginDeps = (manifest.plugins || []).filter((p) => {
      const deps = Array.isArray(p.dependencies) ? p.dependencies : (Array.isArray(p.pluginDepends) ? p.pluginDepends : []);
      return deps.some((d) => {
        const base = String(d).split('@')[0].trim();
        const targetCanon = nameToId.get(base) || base;
        return targetCanon === canonId;
      });
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

// -------- 插件变量：列表与取值 --------
module.exports.listVariables = async function listVariables(idOrName) {
  try {
    const p = findPluginByIdOrName(idOrName);
    if (!p) return { ok: false, error: 'plugin_not_found' };
    let names = [];
    try {
      if (Array.isArray(p.variables)) {
        names = p.variables.map((x) => String(x));
      } else if (p.variables && typeof p.variables === 'object') {
        names = Object.keys(p.variables);
      }
    } catch {}
    if (names.length) return { ok: true, variables: names };
    // 回退：调用插件的 listVariables 函数（若实现）
    try {
      const res = await module.exports.callFunction(p.id || p.name, 'listVariables', []);
      const payload = res?.result ?? res;
      if (res?.ok) {
        if (Array.isArray(payload)) return { ok: true, variables: payload.map((x) => String(x)) };
        if (payload && typeof payload === 'object') return { ok: true, variables: Object.keys(payload) };
      }
    } catch {}
    return { ok: true, variables: [] };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

module.exports.getVariable = async function getVariable(idOrName, varName) {
  try {
    const p = findPluginByIdOrName(idOrName);
    if (!p) return { ok: false, error: 'plugin_not_found' };
    const name = String(varName || '').trim();
    if (!name) return { ok: false, error: 'variable_required' };
    // 若 plugin.json.variables 为对象 { key: fnName }，优先按映射调用
    try {
      if (p.variables && typeof p.variables === 'object' && !Array.isArray(p.variables)) {
        const fn = p.variables[name];
        if (fn && typeof fn === 'string') {
          return module.exports.callFunction(p.id || p.name, fn, []);
        }
      }
    } catch {}
    // 标准函数：getVariable(name)
    return module.exports.callFunction(p.id || p.name, 'getVariable', [name]);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
};

// -------- 组件：按组列出与入口URL --------
module.exports.listComponents = function listComponents(group) {
  try {
    const items = (manifest.plugins || []).filter((p) => String(p.type || '').toLowerCase() === 'component');
    const baseDir = path.dirname(manifestPath);
    const out = [];
    const seenCanon = new Set();
    const seenUrl = new Set();
    const seenDisplay = new Set();
    const seenId = new Set();
    for (const p of items) {
      if (group && String(p.group || '').trim() && String(p.group).trim() !== String(group).trim()) continue;
      const entryRel = p.entry || 'index.html';
      const fullDir = p.local ? path.join(baseDir, p.local) : null;
      const entryPath = fullDir ? path.join(fullDir, entryRel) : null;
      let url = null;
      try {
        if (entryPath && fs.existsSync(entryPath)) {
          const u = require('url').pathToFileURL(entryPath.replace(/\\/g, '/')).href;
          url = u;
        }
      } catch {}
      const canon = canonicalizePluginId(p.id || p.name || '');
      const urlKey = String(url || '').trim();
      const displayKey = `${String(p.name || '').trim().toLowerCase()}|${String(p.group || '').trim().toLowerCase()}`;
      const idKey = String(p.id || '').trim().toLowerCase();
      if (idKey && seenId.has(idKey)) continue;
      if (canon && seenCanon.has(canon)) continue;
      if (urlKey && seenUrl.has(urlKey)) continue;
      if (displayKey && seenDisplay.has(displayKey)) continue;
      if (idKey) seenId.add(idKey);
      if (canon) seenCanon.add(canon);
      if (urlKey) seenUrl.add(urlKey);
      if (displayKey) seenDisplay.add(displayKey);
      out.push({ id: p.id, name: p.name, group: p.group || null, entry: entryRel, url });
    }
    return { ok: true, components: out };
  } catch (e) { return { ok: false, error: e?.message || String(e) }; }
};

module.exports.getComponentEntryUrl = function getComponentEntryUrl(idOrName) {
  try {
    const p = findPluginByIdOrName(idOrName);
    if (!p || String(p.type || '').toLowerCase() !== 'component') return null;
    const baseDir = path.dirname(manifestPath);
    const fullDir = p.local ? path.join(baseDir, p.local) : null;
    if (!fullDir || !fs.existsSync(fullDir)) return null;
    const entryRel = p.entry || 'index.html';
    const entryPath = path.join(fullDir, entryRel);
    if (!fs.existsSync(entryPath)) return null;
    const u = require('url').pathToFileURL(entryPath.replace(/\\/g, '/')).href;
    return u;
  } catch { return null; }
};

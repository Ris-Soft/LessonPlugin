const path = require('path');
const Utils = require('./Utils');

class PluginRegistry {
  constructor() {
    this.manifestPath = '';
    this.configPath = '';
    this.pluginsRoot = '';
    this.storeRoot = '';

    this.manifest = { plugins: [] };
    this.config = { enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} };
    
    this.nameToId = new Map(); // 名称/原始ID/清洗ID -> 规范ID 映射
    this.pluginWindows = new Map(); // pluginId -> BrowserWindow
    this.apiRegistry = new Map();
    this.actionRegistry = null;
    this.behaviorRegistry = null;
    this.automationEventRegistry = new Map(); // pluginId -> Array<{ id, name, desc, params, expose }>
    this.functionRegistry = new Map(); // pluginId -> Map(fnName -> function)
    this.eventSubscribers = new Map(); // eventName -> Set(webContentsId)
    
    this.progressReporter = null;
    this.missingPluginHandler = null;
    this.automationManagerRef = null;
  }

  init(paths) {
    this.manifestPath = paths.manifestPath;
    this.configPath = paths.configPath;
    this.pluginsRoot = path.dirname(this.manifestPath);
    this.storeRoot = path.resolve(this.pluginsRoot, '..', 'npm_store');
    
    // Load config immediately if available, manifest is usually rebuilt by scanner
    if (this.configPath) {
      this.config = Utils.readJsonSafe(this.configPath, { enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} });
      if (!this.config.enabled) this.config.enabled = {};
      if (!this.config.registry) this.config.registry = 'https://registry.npmmirror.com';
      if (!this.config.npmSelection) this.config.npmSelection = {};
    }
  }

  saveConfig() {
    if (this.configPath) {
      Utils.writeJsonSafe(this.configPath, this.config);
    }
  }

  // 统一插件ID规范化：支持中文名、带点号ID、清洗后ID与规范ID
  canonicalizePluginId(key) {
    const s = String(key || '').trim();
    if (!s) return s;
    // 直接映射命中
    if (this.nameToId.has(s)) return this.nameToId.get(s);
    // 尝试清洗点号与非法字符
    const normalized = s.toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (this.nameToId.has(normalized)) return this.nameToId.get(normalized);
    // 回退：若传入本就是规范ID则原样返回
    return normalized || s;
  }

  findPluginByIdOrName(key) {
    const canon = this.canonicalizePluginId(key);
    // 直接按规范ID匹配；同时兼容名称精确匹配
    return this.manifest.plugins.find((p) => p.id === canon || p.name === key || p.name === canon);
  }

  getPluginDir(idOrName) {
    const p = this.findPluginByIdOrName(idOrName);
    if (!p || !p.local) return null;
    return path.resolve(this.pluginsRoot, p.local);
  }

  // Setters/Getters
  setMissingPluginHandler(handler) {
    this.missingPluginHandler = handler;
  }

  setAutomationManager(am) {
    this.automationManagerRef = am || null;
  }
  
  setProgressReporter(reporter) {
    this.progressReporter = reporter;
  }
}

module.exports = new PluginRegistry();

const { webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const Registry = require('./Registry');
const store = require('../Store/Main');
const win32 = require('../../System/Win32');
const backendLog = require('../../Debug/backendLog');

// -------- API / 事件总线 --------

function registerFunctions(pluginId, functions, senderWC) {
  const canonId = Registry.canonicalizePluginId(pluginId);
  // 覆盖式API注册，避免重复与陈旧条目导致冲突
  Registry.apiRegistry.set(canonId, new Set(Array.isArray(functions) ? functions : []));
  // 将 webContents 记录，供路由调用
  const win = Registry.pluginWindows.get(canonId);
  if (!win || win.webContents.id !== senderWC.id) {
    // 如果调用来自不同 webContents（异常情况），仍以最新 sender 为准
    Registry.pluginWindows.set(canonId, { webContents: senderWC, isProxy: true });
  }
  try { console.info('plugin:window_registered', { pluginId: canonId, webContentsId: senderWC.id }); } catch (e) {}
  return { ok: true };
}

function registerAutomationEvents(pluginId, events) {
  const canonId = Registry.canonicalizePluginId(pluginId);
  if (!Array.isArray(events)) return { ok: false, error: 'events_invalid' };
  const filtered = events.filter((e) => e && e.expose !== false).map((e) => ({
    id: e.id || e.name,
    name: e.name || e.id,
    desc: e.desc || '',
    params: Array.isArray(e.params) ? e.params : []
  }));
  Registry.automationEventRegistry.set(canonId, filtered);
  return { ok: true, count: filtered.length };
}

function listAutomationEvents(pluginId) {
  const canonId = Registry.canonicalizePluginId(pluginId);
  return { ok: true, events: Registry.automationEventRegistry.get(canonId) || [] };
}

function callFunction(targetPluginId, fnName, args, callerPluginId, ipcMain) {
  return new Promise(async (resolve) => {
    const canonId = Registry.canonicalizePluginId(targetPluginId);
    try { console.info('plugin:call_function:start', { pluginId: canonId, fn: fnName, caller: callerPluginId || null }); } catch (e) {}
    // 优先主进程注册的函数，无需窗口
    const fnMap = Registry.functionRegistry.get(canonId);
    if (fnMap && fnMap.has(fnName)) {
      try {
        const result = await Promise.resolve(fnMap.get(fnName)(...(Array.isArray(args) ? args : [])));
        try { console.info('plugin:call_function:done', { pluginId: canonId, fn: fnName, ok: true, caller: callerPluginId || null }); } catch (e) {}
        return resolve({ ok: true, result });
      } catch (e) {
        try { console.info('plugin:call_function:done', { pluginId: canonId, fn: fnName, ok: false, error: e?.message || String(e), caller: callerPluginId || null }); } catch (e) {}
        return resolve({ ok: false, error: e.message });
      }
    }

    // 回退到插件窗口注册的函数
    const win = Registry.pluginWindows.get(canonId);
    const wc = win?.webContents || win;
    if (!wc) {
      if (typeof Registry.missingPluginHandler === 'function') {
        try { Registry.missingPluginHandler(targetPluginId); } catch (e) {}
      }
      return resolve({ ok: false, error: '目标插件未打开窗口或未注册' });
    }
    const reqId = uuidv4();
    const onResult = (event, id, payload) => {
      if (id !== reqId) return;
      try { ipcMain.removeListener('plugin:invoke:result', onResult); } catch (e) {}
      try { console.info('plugin:call_function:done', { pluginId: canonId, fn: fnName, ok: !!payload?.ok, caller: callerPluginId || null }); } catch (e) {}
      resolve(payload);
    };
    ipcMain.on('plugin:invoke:result', onResult);
    wc.send('plugin:invoke', { id: reqId, fn: fnName, args: Array.isArray(args) ? args : [] });

    // 增加5秒超时保护，防止插件无响应导致主进程卡死
    setTimeout(() => {
      try { ipcMain.removeListener('plugin:invoke:result', onResult); } catch (e) {}
      resolve({ ok: false, error: 'timeout_waiting_for_plugin_response' });
    }, 5000);
  });
}

function getPluginIdByWebContentsId(wcId) {
  try {
    for (const [pid, win] of Registry.pluginWindows.entries()) {
      const wc = win?.webContents || win;
      if (wc && wc.id === wcId) return pid;
    }
  } catch (e) {}
  return null;
}

function subscribeEvent(eventName, senderWC) {
  if (!Registry.eventSubscribers.has(eventName)) Registry.eventSubscribers.set(eventName, new Set());
  Registry.eventSubscribers.get(eventName).add(senderWC.id);
  return { ok: true };
}

function emitEvent(eventName, payload) {
  const subs = Registry.eventSubscribers.get(eventName);
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
    } catch (e) {}
  }
  try { console.info('plugin:event_emit', { event: eventName, delivered }); } catch (e) {}
  return { ok: true, delivered };
}

// -------- 动作名：聚合、默认映射与调用 --------
function buildActionRegistry() {
  const map = new Map();
  try {
    for (const p of Registry.manifest.plugins) {
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
  } catch (e) {}
  return map;
}

function listActions() {
  try {
    if (!Registry.actionRegistry) Registry.actionRegistry = buildActionRegistry();
    const out = [];
    for (const [id, providers] of Registry.actionRegistry.entries()) {
      out.push({ id, providers });
    }
    return { ok: true, actions: out };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function callAction(actionId, args, preferredPluginId, ipcMain) {
  try {
    const id = String(actionId || '').trim();
    if (!id) return { ok: false, error: 'action_required' };
    if (!Registry.actionRegistry) Registry.actionRegistry = buildActionRegistry();
    const providers = Registry.actionRegistry.get(id) || [];
    if (!providers.length) return { ok: false, error: 'action_not_found' };
    let targetEntry = null;
    if (preferredPluginId) {
      const canon = Registry.canonicalizePluginId(preferredPluginId);
      targetEntry = providers.find((p) => Registry.canonicalizePluginId(p.pluginId) === canon);
    }
    if (!targetEntry) {
      let defPid = null;
      try {
        const sys = store.getAll('system') || {};
        const defMap = sys.defaultActions || {};
        defPid = defMap[id];
      } catch (e) {}
      if (defPid) {
        const canon = Registry.canonicalizePluginId(defPid);
        targetEntry = providers.find((p) => Registry.canonicalizePluginId(p.pluginId) === canon) || null;
      }
    }
    if (!targetEntry) {
      // 若只有一个提供者，直接使用
      if (providers.length === 1) targetEntry = providers[0];
      else return { ok: false, error: 'multiple_providers' };
    }
    try { console.info('plugin:action:start', { actionId: id, pluginId: targetEntry.pluginId, fn: targetEntry.target }); } catch (e) {}
    return callFunction(targetEntry.pluginId, targetEntry.target, Array.isArray(args) ? args : [], null, ipcMain);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function setDefaultAction(actionId, pluginId) {
  try {
    const sys = store.getAll('system') || {};
    const defMap = Object(sys.defaultActions || {});
    defMap[String(actionId)] = Registry.canonicalizePluginId(pluginId);
    store.set('system', 'defaultActions', defMap);
    return { ok: true, defaults: defMap };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// -------- 行为（behavior）：与 actions 区分的能力集合 --------
function buildBehaviorRegistry() {
  const map = new Map();
  try {
    for (const p of Registry.manifest.plugins) {
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
  } catch (e) {}
  return map;
}

function listBehaviors() {
  try {
    if (!Registry.behaviorRegistry) Registry.behaviorRegistry = buildBehaviorRegistry();
    const out = [];
    for (const [id, providers] of Registry.behaviorRegistry.entries()) {
      out.push({ id, providers });
    }
    // 回退：若未声明任何 behaviors，则以 actions 作为候选（便于过渡期）
    if (!out.length) {
      if (!Registry.actionRegistry) Registry.actionRegistry = buildActionRegistry();
      for (const [id, providers] of Registry.actionRegistry.entries()) out.push({ id, providers });
    }
    return { ok: true, actions: out };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function callBehavior(behaviorId, args, preferredPluginId, ipcMain) {
  try {
    const id = String(behaviorId || '').trim();
    if (!id) return { ok: false, error: 'behavior_required' };
    if (!Registry.behaviorRegistry) Registry.behaviorRegistry = buildBehaviorRegistry();
    let providers = Registry.behaviorRegistry.get(id) || [];
    // 回退：未声明 behaviors 时，使用 actions 作为替代
    if (!providers.length) {
      if (!Registry.actionRegistry) Registry.actionRegistry = buildActionRegistry();
      providers = Registry.actionRegistry.get(id) || [];
    }
    if (!providers.length) return { ok: false, error: 'behavior_not_found' };
    let targetEntry = null;
    if (preferredPluginId) {
      const canon = Registry.canonicalizePluginId(preferredPluginId);
      targetEntry = providers.find((p) => Registry.canonicalizePluginId(p.pluginId) === canon);
    }
    if (!targetEntry) {
      // 使用行为默认映射
      let defPid = null;
      try {
        const sys = store.getAll('system') || {};
        const defMap = sys.defaultBehaviors || {};
        defPid = defMap[id];
      } catch (e) {}
      if (defPid) {
        const canon = Registry.canonicalizePluginId(defPid);
        targetEntry = providers.find((p) => Registry.canonicalizePluginId(p.pluginId) === canon) || null;
      }
    }
    if (!targetEntry) {
      if (providers.length === 1) targetEntry = providers[0];
      else return { ok: false, error: 'multiple_providers' };
    }
    try { console.info('plugin:behavior:start', { behaviorId: id, pluginId: targetEntry.pluginId, fn: targetEntry.target }); } catch (e) {}
    return callFunction(targetEntry.pluginId, targetEntry.target, Array.isArray(args) ? args : [], null, ipcMain);
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function setDefaultBehavior(behaviorId, pluginId) {
  try {
    const sys = store.getAll('system') || {};
    const defMap = Object(sys.defaultBehaviors || {});
    defMap[String(behaviorId)] = Registry.canonicalizePluginId(pluginId);
    store.set('system', 'defaultBehaviors', defMap);
    return { ok: true, defaults: defMap };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// -------- 组件：按组列出与入口URL --------
function listComponents(group) {
  try {
    const items = (Registry.manifest.plugins || []).filter((p) => String(p.type || '').toLowerCase() === 'component');
    const baseDir = path.dirname(Registry.manifestPath);
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
      } catch (e) {}
      const canon = Registry.canonicalizePluginId(p.id || p.name || '');
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
      
      const isEnabled = !!(Registry.config.enabled[p.id] ?? Registry.config.enabled[p.name] ?? p.enabled);

      out.push({ 
        id: p.id, 
        name: p.name, 
        group: p.group || null, 
        entry: entryRel, 
        url,
        enabled: isEnabled,
        usage: p.usage,
        recommendedSize: p.recommendedSize,
        configSchema: (Array.isArray(p.configSchema) || (p.configSchema && typeof p.configSchema === 'object')) ? p.configSchema : undefined,
        sourcePlugin: p.sourcePlugin || undefined
      });
    }
    return { ok: true, components: out };
  } catch (e) { return { ok: false, error: e?.message || String(e) }; }
}

function getComponentEntryUrl(idOrName) {
  try {
    const p = Registry.findPluginByIdOrName(idOrName);
    if (!p || String(p.type || '').toLowerCase() !== 'component') return null;
    const baseDir = path.dirname(Registry.manifestPath);
    const fullDir = p.local ? path.join(baseDir, p.local) : null;
    if (!fullDir || !fs.existsSync(fullDir)) return null;
    const entryRel = p.entry || 'index.html';
    const entryPath = path.join(fullDir, entryRel);
    if (!fs.existsSync(entryPath)) return null;
    const u = require('url').pathToFileURL(entryPath.replace(/\\/g, '/')).href;
    return u;
  } catch (e) { return null; }
}

// 为插件入口提供主进程侧可用的 API
function createPluginApi(pluginId, ipcMain) {
  return {
    call: (targetPluginId, fnName, args) => callFunction(targetPluginId, fnName, args, pluginId, ipcMain),
    callByAction: async (actionId, args) => {
      try { const res = await callAction(actionId, Array.isArray(args) ? args : [], pluginId, ipcMain); return res; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    callByBehavior: async (behaviorId, args) => {
      try { const res = await callBehavior(behaviorId, Array.isArray(args) ? args : [], pluginId, ipcMain); return res; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    emit: (eventName, payload) => emitEvent(eventName, payload),
    registerAutomationEvents: (events) => registerAutomationEvents(pluginId, events),
    components: {
      list: (group) => {
        try { return listComponents(group); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
      },
      entryUrl: (idOrName) => {
        try { return getComponentEntryUrl(idOrName); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
      }
    },
    // 为插件提供自动化计时器接口（减少插件自行创建定时器）
    automation: {
      // 新增：注册“分钟触发器”（仅 HH:MM 列表与回调）
      registerMinuteTriggers: (times, cb) => {
        try {
          if (!Registry.automationManagerRef) return { ok: false, error: 'automation_manager_missing' };
          return Registry.automationManagerRef.registerPluginMinuteTriggers(pluginId, Array.isArray(times) ? times : [], cb);
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },
      clearMinuteTriggers: () => {
        try {
          if (!Registry.automationManagerRef) return { ok: false, error: 'automation_manager_missing' };
          return Registry.automationManagerRef.clearPluginMinuteTriggers(pluginId);
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },
      listMinuteTriggers: () => {
        try {
          if (!Registry.automationManagerRef) return { ok: true, times: [] };
          return Registry.automationManagerRef.listPluginMinuteTriggers(pluginId) || { ok: true, times: [] };
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      },
      // 为插件提供“创建动作快捷方式到桌面”的接口
      createActionShortcut: (options) => {
        try {
          if (!Registry.automationManagerRef) return { ok: false, error: 'automation_manager_missing' };
          return Registry.automationManagerRef.createActionShortcut(pluginId, options || {});
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      }
    },
    // 启动页文本控制：插件可在初始化期间更新启动页状态文本
    splash: {
      setStatus: (stage, message) => {
        try {
          const msg = String(message || '');
          backendLog.logFromPlugin(pluginId, 'info', msg);
        } catch (e) {}
        
        const p = Registry.findPluginByIdOrName(pluginId);
        const prefix = p ? `[${p.name}] ` : `[${pluginId}] `;
        const msg = String(message || '');
        const finalMsg = msg.startsWith('[') ? msg : prefix + msg;
        
        try { Registry.progressReporter && Registry.progressReporter({ stage: stage || 'plugin:init', message: finalMsg }); } catch (e) {}
      },
      progress: (stage, message) => {
        try {
          const msg = String(message || '');
          backendLog.logFromPlugin(pluginId, 'info', msg);
        } catch (e) {}

        const p = Registry.findPluginByIdOrName(pluginId);
        const prefix = p ? `[${p.name}] ` : `[${pluginId}] `;
        const msg = String(message || '');
        const finalMsg = msg.startsWith('[') ? msg : prefix + msg;
        try { Registry.progressReporter && Registry.progressReporter({ stage: stage || 'plugin:init', message: finalMsg }); } catch (e) {}
      }
    },
    // 为插件提供配置存储访问能力
    store: {
      get: (key) => store.get(pluginId, key),
      set: (key, value) => store.set(pluginId, key, value),
      getAll: () => store.getAll(pluginId),
      setAll: (obj) => store.setAll(pluginId, obj)
    },
    // 为插件提供桌面窗口能力
    desktop: {
      attachToDesktop: (browserWindow) => {
        try {
          if (!browserWindow) return { ok: false, error: 'window_required' };
          const hwnd = browserWindow.getNativeWindowHandle();
          const desktop = win32.getDesktopWindow();
          if (desktop) {
            win32.setParent(hwnd, desktop);
            return { ok: true };
          }
          return { ok: false, error: 'desktop_not_found' };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
    },
    // 获取学生列定义（聚合所有插件的配置）
    getStudentColumnDefs: () => {
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
      } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    }
  };
}

module.exports = {
  registerFunctions,
  registerAutomationEvents,
  listAutomationEvents,
  callFunction,
  getPluginIdByWebContentsId,
  subscribeEvent,
  emitEvent,
  listActions,
  callAction,
  setDefaultAction,
  listBehaviors,
  callBehavior,
  setDefaultBehavior,
  listComponents,
  getComponentEntryUrl,
  createPluginApi
};

const { contextBridge, ipcRenderer } = require('electron');

// 在嵌入的 webview 中暴露与主进程交互的 lowbarAPI 子集
// 供浮层页面（如多维单词的 dict/externallib 等）直接调用插件后端
try {
  contextBridge.exposeInMainWorld('lowbarAPI', {
    pluginCall: (targetPluginId, fnName, args) => ipcRenderer.invoke('plugin:call', targetPluginId, fnName, args),
    emitEvent: (name, payload) => ipcRenderer.invoke('plugin:event:emit', name, payload),
    subscribe: (eventName) => ipcRenderer.send('plugin:event:subscribe', eventName),
    onEvent: (handler) => { try { ipcRenderer.on('plugin:event', (_e, { name, payload }) => handler && handler(name, payload)); } catch {} },
    configGetAll: (scope) => ipcRenderer.invoke('config:getAll', scope),
    configGet: (scope, key) => ipcRenderer.invoke('config:get', scope, key),
    configSet: (scope, key, value) => ipcRenderer.invoke('config:set', scope, key, value),
    configEnsureDefaults: (scope, defaults) => ipcRenderer.invoke('config:ensureDefaults', scope, defaults)
  });
} catch {}

try {
  const send = (level, args) => {
    try { ipcRenderer.sendToHost('webview-console', { level, args }); } catch {}
  };
  ['log','info','warn','error','debug'].forEach((m) => {
    const orig = console[m] && console[m].bind(console);
    if (!orig) return;
    console[m] = (...args) => { try { send(m, args); } catch {} try { orig(...args); } catch {} };
  });
  window.addEventListener('error', (e) => {
    const msg = e && e.message != null ? String(e.message) : 'Error';
    const src = e && e.filename ? String(e.filename) : '';
    const pos = (e && e.lineno != null ? String(e.lineno) : '0') + ':' + (e && e.colno != null ? String(e.colno) : '0');
    const stack = e && e.error && e.error.stack ? String(e.error.stack) : '';
    send('error', [msg, src + ':' + pos, stack]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e && e.reason ? (e.reason.stack || e.reason.message || String(e.reason)) : 'UnhandledRejection';
    send('error', ['UnhandledRejection', reason]);
  });
} catch {}
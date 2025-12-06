const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pluginAPI', {
  windowControl: (action) => ipcRenderer.invoke('window:control', action),
  register: (pluginId, functions) => {
    ipcRenderer.send('plugin:register', pluginId, functions);
  },
  call: (targetPluginId, fnName, args) => ipcRenderer.invoke('plugin:call', targetPluginId, fnName, args),
  onInvoke: (handler) => {
    ipcRenderer.on('plugin:invoke', async (_e, payload) => {
      try {
        const result = await handler(payload.fn, payload.args);
        ipcRenderer.send('plugin:invoke:result', payload.id, { ok: true, result });
      } catch (err) {
        ipcRenderer.send('plugin:invoke:result', payload.id, { ok: false, error: err?.message || String(err) });
      }
    });
  },
  subscribe: (eventName) => ipcRenderer.send('plugin:event:subscribe', eventName),
  emit: (eventName, payload) => ipcRenderer.invoke('plugin:event:emit', eventName, payload),
  onEvent: (handler) => {
    ipcRenderer.on('plugin:event', (_e, { name, payload }) => handler(name, payload));
  },
  // 档案管理/系统配置存取
  configGetAll: (scope) => ipcRenderer.invoke('config:getAll', scope),
  configGet: (scope, key) => ipcRenderer.invoke('config:get', scope, key),
  configSet: (scope, key, value) => ipcRenderer.invoke('config:set', scope, key, value),
  configEnsureDefaults: (scope, defaults) => ipcRenderer.invoke('config:ensureDefaults', scope, defaults),
  // 学生列表列定义（聚合自所有插件）
  profilesGetColumnDefs: () => ipcRenderer.invoke('profiles:columnDefs'),
  // 获取当前时间（按系统设置偏移与精确开关）
  getCurrentTime: () => ipcRenderer.invoke('system:getTime')
  ,
  // 资源与UI辅助：提供统一的资源URL与快捷插入标题栏/主题
  asset: (relPath) => ipcRenderer.invoke('asset:url', relPath),
  ui: {
    ensureStyles: async () => {
      const add = (href) => { try { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; document.head.appendChild(link); } catch {} };
      const paths = ['titlebar.css', 'settings.css', 'remixicon-local.css', 'fonts-local.css'];
      for (const p of paths) { try { const url = await ipcRenderer.invoke('asset:url', p); if (url) add(url); } catch {} }
    },
    insertTitlebar: (titleText) => {
      try {
        if (document.querySelector('.titlebar')) return;
        const bar = document.createElement('div'); bar.className = 'titlebar';
        const drag = document.createElement('div'); drag.className = 'drag'; drag.textContent = titleText || document.title || '';
        const actions = document.createElement('div'); actions.className = 'window-actions';
        const mkBtn = (act, cls, icon) => { const b = document.createElement('button'); b.className = 'win-btn' + (cls ? (' ' + cls) : ''); b.dataset.act = act; b.title = act; b.innerHTML = `<i class=\"${icon}\"></i>`; b.addEventListener('click', () => ipcRenderer.invoke('window:control', act)); return b; };
        actions.appendChild(mkBtn('minimize', '', 'ri-subtract-line'));
        actions.appendChild(mkBtn('maximize', '', 'ri-checkbox-blank-line'));
        actions.appendChild(mkBtn('close', 'close', 'ri-close-line'));
        bar.appendChild(drag); bar.appendChild(actions);
        document.body.insertBefore(bar, document.body.firstChild);
      } catch {}
    },
    applyWindowTheme: (opts = {}) => {
      try {
        const darkBg = opts.bg || '#0b1520';
        const fg = opts.fg || '#e6f1ff';
        document.body.style.background = darkBg; document.body.style.color = fg;
        const style = document.createElement('style');
        style.textContent = `.wrap{padding:20px}.box{padding:12px;border-radius:8px;background:rgba(255,255,255,0.06)}.btn{padding:8px 12px;border:none;border-radius:8px;cursor:pointer}.btn.primary{background:#22c55e;color:#071a12}.btn.secondary{background:#334155;color:#e6f1ff}.titlebar{display:flex;align-items:center;justify-content:space-between;height:36px;padding:0 8px;background:${darkBg};color:${fg};-webkit-app-region:drag}.titlebar .window-actions{display:flex;gap:6px;-webkit-app-region:no-drag}.titlebar .win-btn{width:28px;height:28px;border:none;border-radius:6px;background:rgba(255,255,255,0.08);color:${fg};cursor:pointer}.titlebar .win-btn.close{background:#ef4444;color:#fff}`;
        document.head.appendChild(style);
      } catch {}
    }
  }
});

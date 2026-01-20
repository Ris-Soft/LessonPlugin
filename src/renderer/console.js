(() => {
  const actions = document.querySelectorAll('.win-btn');
  actions.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      if (act === 'menu') {
        try { await window.consoleAPI?.showAppMenu?.({}); } catch (e) {}
        return;
      }
      try { await window.consoleAPI?.windowControl?.(act); } catch (e) {}
    });
  });

  const logList = document.getElementById('console-log-list');
  const logsCopyAllBtn = document.getElementById('logs-copy-all');
  const logsExportBtn = document.getElementById('logs-export');
  const srcTypeSel = document.getElementById('filter-source-type');
  const srcIdSel = document.getElementById('filter-source-id');
  const chkLog = document.getElementById('level-log');
  const chkInfo = document.getElementById('level-info');
  const chkWarn = document.getElementById('level-warn');
  const chkError = document.getElementById('level-error');
  const clearBtn = document.getElementById('clear-console');
  const tabs = document.querySelectorAll('.subnav .sub-item');
  const logsPanel = document.getElementById('console-logs');
  const metricsPanel = document.getElementById('console-metrics');
  const windowsPanel = document.getElementById('console-windows');
  const metricsContent = document.getElementById('metrics-content');
  const metricsRefresh = document.getElementById('metrics-refresh');
  const metricsAutoChk = document.getElementById('metrics-auto');
  const windowsList = document.getElementById('windows-list');
  const windowsRefresh = document.getElementById('windows-refresh');
  const windowsAutoChk = document.getElementById('windows-auto');
  let metricsTimer = null;
  let windowsTimer = null;

  const state = {
    entries: [],
    sourceType: 'all',
    sourceId: 'all',
    levels: new Set(['log', 'info', 'warn', 'error']),
    selected: new Set(),
    lastSelectedIndex: null
  };

  function levelColor(level) {
    switch (String(level).toLowerCase()) {
      case 'info': return '#0284C7';
      case 'warn': return '#F59E0B';
      case 'error': return '#DC2626';
      default: return '#9CA3AF';
    }
  }

  function formatSource(e) {
    if (e.sourceType === 'plugin') return `插件/${e.sourceId}`;
    if (e.sourceType === 'system') return `系统/${e.module}`;
    return e.sourceId || e.module || '未知';
  }

  function renderOptions() {
    try {
      const ids = new Set();
      for (const e of state.entries) {
        const key = `${e.sourceType}:${e.sourceId || e.module || ''}`;
        if (!key) continue;
        ids.add(key);
      }
      const prev = state.sourceId;
      srcIdSel.innerHTML = '';
      const allOpt = document.createElement('option');
      allOpt.value = 'all';
      allOpt.textContent = '全部来源';
      srcIdSel.appendChild(allOpt);
      for (const key of Array.from(ids).sort()) {
        const opt = document.createElement('option');
        opt.value = key;
        const [t, id] = key.split(':');
        opt.textContent = t === 'plugin' ? `插件/${id}` : `系统/${id}`;
        srcIdSel.appendChild(opt);
      }
      const hasPrev = Array.from(ids).includes(prev);
      srcIdSel.value = hasPrev ? prev : 'all';
    } catch (e) {}
  }

  function renderList(options) {
    const opts = options || {};
    const prevScrollTop = logList.scrollTop || 0;
    const prevScrollHeight = logList.scrollHeight || 0;
    const clientH = logList.clientHeight || 0;
    const wasNearBottom = (prevScrollTop >= (prevScrollHeight - clientH - 4));
    try {
      logList.innerHTML = '';
      const entries = state.entries.filter((e) => {
        if (!state.levels.has(String(e.level))) return false;
        if (state.sourceType !== 'all' && e.sourceType !== state.sourceType) return false;
        if (state.sourceId !== 'all') {
          const key = `${e.sourceType}:${e.sourceId || e.module || ''}`;
          if (key !== state.sourceId) return false;
        }
        return true;
      });
      entries.forEach((e, i) => {
        const row = document.createElement('div');
        row.className = 'log-row';
        const color = levelColor(e.level);
        const badge = document.createElement('span');
        badge.textContent = String(e.level).toUpperCase();
        badge.style.display = 'inline-block';
        badge.style.padding = '0 6px';
        badge.style.marginRight = '8px';
        badge.style.borderRadius = '4px';
        badge.style.background = color;
        badge.style.color = '#fff';
        const src = document.createElement('span');
        src.textContent = `[${formatSource(e)}]`;
        src.style.marginRight = '8px';
        src.style.color = '#93C5FD';
        const ts = document.createElement('span');
        ts.textContent = new Date(e.ts || Date.now()).toLocaleString();
        ts.style.marginRight = '8px';
        ts.style.color = '#A3A3A3';
        const msg = document.createElement('span');
        msg.textContent = e.text || '';
        row.appendChild(badge);
        row.appendChild(ts);
        row.appendChild(src);
        row.appendChild(msg);
        const idx = state.entries.indexOf(e);
        row.dataset.index = String(idx);
        if (state.selected.has(idx)) row.classList.add('selected');
        row.addEventListener('click', (ev) => {
          const cur = idx;
          if (ev.shiftKey && state.lastSelectedIndex != null) {
            const [a, b] = [state.lastSelectedIndex, cur].sort((x, y) => x - y);
            for (let k = a; k <= b; k++) state.selected.add(k);
          } else {
            if (state.selected.has(cur)) state.selected.delete(cur);
            else state.selected.add(cur);
            state.lastSelectedIndex = cur;
          }
          renderList({ autoScroll: false });
          renderSelectionTools();
        });
        logList.appendChild(row);
      });
      const shouldScroll = opts.autoScroll === true || (opts.autoScroll === undefined && wasNearBottom);
      if (shouldScroll) {
        logList.scrollTop = logList.scrollHeight;
      } else {
        // preserve approximate position by anchoring around the lastSelectedIndex if possible
        // otherwise restore previous scrollTop (best effort)
        try { logList.scrollTop = prevScrollTop; } catch (e) {}
      }
    } catch (e) {}
  }

  srcTypeSel.addEventListener('change', () => {
    state.sourceType = srcTypeSel.value || 'all';
    renderList();
  });
  srcIdSel.addEventListener('change', () => {
    state.sourceId = srcIdSel.value || 'all';
    renderList();
  });
  function bindLevel(chk, level) {
    chk.addEventListener('change', () => {
      const lv = String(level);
      if (chk.checked) state.levels.add(lv); else state.levels.delete(lv);
      renderList();
    });
  }
  bindLevel(chkLog, 'log');
  bindLevel(chkInfo, 'info');
  bindLevel(chkWarn, 'warn');
  bindLevel(chkError, 'error');
  clearBtn.addEventListener('click', () => {
    logList.innerHTML = '';
  });
  logsCopyAllBtn?.addEventListener('click', async () => {
    try {
      const text = getVisibleEntries().map(formatEntryText).join('\n');
      await navigator.clipboard.writeText(text);
    } catch (e) {}
  });
  logsExportBtn?.addEventListener('click', async () => {
    try {
      const text = getVisibleEntries().map(formatEntryText).join('\n');
      await window.consoleAPI?.exportText?.(text, 'backend.log');
    } catch (e) {}
  });

  function getVisibleEntries() {
    return state.entries.filter((e) => {
      if (!state.levels.has(String(e.level))) return false;
      if (state.sourceType !== 'all' && e.sourceType !== state.sourceType) return false;
      if (state.sourceId !== 'all') {
        const key = `${e.sourceType}:${e.sourceId || e.module || ''}`;
        if (key !== state.sourceId) return false;
      }
      return true;
    });
  }
  function formatEntryText(e) {
    return `[${new Date(e.ts || Date.now()).toLocaleString()}] [${String(e.level).toUpperCase()}] [${formatSource(e)}] ${e.text || ''}`;
  }
  function renderSelectionTools() {
    let bar = document.getElementById('logs-selection-tools');
    const count = state.selected.size;
    if (count === 0) {
      if (bar) { try { bar.remove(); } catch (e) {} }
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'logs-selection-tools';
      bar.className = 'inline';
      bar.style.gap = '8px';
      bar.style.alignItems = 'center';
      bar.style.paddingTop = '2px';
      const copyBtn = document.createElement('button');
      copyBtn.id = 'logs-copy-selected';
      copyBtn.className = 'btn secondary';
      copyBtn.innerHTML = '<i class="ri-file-copy-2-line"></i> 复制所选文本';
      const delBtn = document.createElement('button');
      delBtn.id = 'logs-delete-selected';
      delBtn.className = 'btn danger';
      delBtn.innerHTML = '<i class="ri-delete-bin-6-line"></i> 删除';
      bar.appendChild(copyBtn);
      bar.appendChild(delBtn);
      logList.parentElement?.appendChild(bar);
      copyBtn.addEventListener('click', async () => {
        try {
          const idxs = Array.from(state.selected.values()).sort((a, b) => a - b);
          const text = idxs.map(i => formatEntryText(state.entries[i])).join('\n');
          await navigator.clipboard.writeText(text);
        } catch (e) {}
      });
      delBtn.addEventListener('click', () => {
        try {
          const idxs = Array.from(state.selected.values()).sort((a, b) => b - a); // delete from end
          for (const i of idxs) {
            if (i >= 0 && i < state.entries.length) state.entries.splice(i, 1);
          }
          state.selected.clear();
          state.lastSelectedIndex = null;
          renderList({ autoScroll: false });
          renderSelectionTools();
        } catch (e) {}
      });
    }
  }

  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const sub = t.dataset.sub;
      logsPanel.hidden = sub !== 'logs';
      metricsPanel.hidden = sub !== 'metrics';
      windowsPanel.hidden = sub !== 'windows';
      if (sub === 'metrics') {
        refreshMetrics();
        try { if (metricsTimer) clearInterval(metricsTimer); } catch (e) {}
        if (!metricsAutoChk || metricsAutoChk.checked) {
          metricsTimer = setInterval(refreshMetrics, 1000);
        } else {
          metricsTimer = null;
        }
        try { if (windowsTimer) clearInterval(windowsTimer); } catch (e) {}
        windowsTimer = null;
      } else if (sub === 'windows') {
        refreshWindows();
        try { if (windowsTimer) clearInterval(windowsTimer); } catch (e) {}
        if (!windowsAutoChk || windowsAutoChk.checked) {
          windowsTimer = setInterval(refreshWindows, 1000);
        } else {
          windowsTimer = null;
        }
        try { if (metricsTimer) clearInterval(metricsTimer); } catch (e) {}
        metricsTimer = null;
      } else {
        try { if (metricsTimer) clearInterval(metricsTimer); } catch (e) {}
        metricsTimer = null;
        try { if (windowsTimer) clearInterval(windowsTimer); } catch (e) {}
        windowsTimer = null;
      }
    });
  });
  metricsAutoChk?.addEventListener('change', () => {
    try { if (metricsTimer) clearInterval(metricsTimer); } catch (e) {}
    metricsTimer = metricsAutoChk.checked ? setInterval(refreshMetrics, 1000) : null;
  });
  windowsAutoChk?.addEventListener('change', () => {
    try { if (windowsTimer) clearInterval(windowsTimer); } catch (e) {}
    windowsTimer = windowsAutoChk.checked ? setInterval(refreshWindows, 1000) : null;
  });

  async function refreshMetrics() {
    try {
      const res = await window.consoleAPI?.getMetrics?.();
      metricsContent.innerHTML = '';
      if (!res?.ok) { metricsContent.innerHTML = `<div class="muted">获取失败：${res?.error || '未知错误'}</div>`; return; }
      const info = res.info || {};
      const top = document.createElement('div');
      top.className = 'metrics-top';
      const panelMain = document.createElement('div');
      panelMain.className = 'panel metrics-card';
      panelMain.innerHTML = `
        <div class="section-title"><i class="ri-information-line"></i> 主程序</div>
        <div style="padding:8px 0;">
          <div class="muted">RSS：${Number(info.process?.memory?.rss || 0).toLocaleString()} bytes</div>
          <div class="muted">Heap Used：${Number(info.process?.memory?.heapUsed || 0).toLocaleString()} / ${Number(info.process?.memory?.heapTotal || 0).toLocaleString()} bytes</div>
          <div class="muted">CPU：user ${info.process?.cpu?.user || 0}μs / system ${info.process?.cpu?.system || 0}μs</div>
          <div class="muted">Uptime：${(info.process?.uptimeSec || 0).toFixed(1)} s</div>
        </div>
      `;
      const panelPlugins = document.createElement('div');
      panelPlugins.className = 'panel metrics-card';
      panelPlugins.innerHTML = `
        <div class="section-title"><i class="ri-puzzle-line"></i> 插件</div>
        <div style="padding:8px 0;">
          <div class="muted">已加载：${info.plugins?.total || 0}</div>
          <div class="muted">已启用：${info.plugins?.enabled || 0}</div>
        </div>
      `;
      top.appendChild(panelMain);
      top.appendChild(panelPlugins);
      const panelDetails = document.createElement('div');
      panelDetails.className = 'panel metrics-card';
      const am = Array.isArray(info.appMetrics) ? info.appMetrics : [];
      const topN = am.slice(0, 10);
      panelDetails.innerHTML = `
        <div class="section-title"><i class="ri-pulse-line"></i> 详细占用（前10项）</div>
        <div style="padding:8px 0;">
          ${topN.map(m => {
            const type = m.type || 'unknown';
            const pid = m.pid || '?';
            const mem = Number(m.memory?.workingSetSize || 0).toLocaleString();
            return `<div class="muted">PID ${pid} [${type}] 内存：${mem} bytes</div>`;
          }).join('')}
        </div>
      `;
      top.appendChild(panelDetails);
      metricsContent.appendChild(top);
    } catch (e) {
      metricsContent.innerHTML = `<div class="muted">异常：${e?.message || String(e)}</div>`;
    }
  }
  metricsRefresh?.addEventListener('click', refreshMetrics);

  async function refreshWindows() {
    try {
      const res = await window.consoleAPI?.listWindows?.();
      windowsList.innerHTML = '';
      if (!res?.ok) { windowsList.innerHTML = `<div class="muted">获取失败：${res?.error || '未知错误'}</div>`; return; }
      const items = Array.isArray(res.windows) ? res.windows : [];
      if (!items.length) { windowsList.innerHTML = `<div class="muted">当前没有窗口</div>`; return; }
      try { windowsList.style.display = 'block'; } catch (e) {}
      items.forEach(w => {
        const card = document.createElement('div');
        card.className = 'panel';
        const h = document.createElement('div');
        h.className = 'plugins-header';
        h.innerHTML = `
          <div class="header-left">
            <h2 style="margin:0;font-size:16px;">窗口 #${w.id} ${w.title || ''}</h2>
            <p class="muted window-url" title="${w.url || ''}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${w.url || ''}</p>
          </div>
          <div class="header-right">
            <button class="btn secondary" data-act="focus"><i class="ri-focus-2-line"></i> 聚焦</button>
            <button class="btn" data-act="devtools"><i class="ri-code-line"></i> 打开开发者工具</button>
            <button class="btn" data-act="more"><i class="ri-more-2-fill"></i> 更多</button>
          </div>
        `;
        card.appendChild(h);
        const meta = document.createElement('div');
        meta.style.padding = '8px 0 12px';
        const sizeText = w.bounds ? `${w.bounds.width}×${w.bounds.height}` : '—';
        meta.innerHTML = `
          <span class="pill small">可见 ${w.isVisible ? '是' : '否'}</span>
          <span class="pill small" style="margin-left:8px;">聚焦 ${w.isFocused ? '是' : '否'}</span>
          <span class="pill small" style="margin-left:8px;">最小化 ${w.isMinimized ? '是' : '否'}</span>
          <span class="pill small" style="margin-left:8px;">最大化 ${w.isMaximized ? '是' : '否'}</span>
          <span class="pill small" style="margin-left:8px;">全屏 ${w.isFullScreen ? '是' : '否'}</span>
          <span class="pill small" style="margin-left:8px;">尺寸 ${sizeText}</span>
          ${w.pluginId ? `<span class="pill small" style="margin-left:8px;">插件 ${w.pluginId}</span>` : ''}
          ${w.webContentsId ? `<span class="pill small" style="margin-left:8px;">WC ${w.webContentsId}</span>` : ''}
        `;
        card.appendChild(meta);
        const btnFocus = h.querySelector('button[data-act="focus"]');
        const btnDev = h.querySelector('button[data-act="devtools"]');
        const btnMore = h.querySelector('button[data-act="more"]');
        btnFocus.addEventListener('click', async () => { try { await window.consoleAPI?.focusWindow?.(w.id); } catch (e) {} });
        btnDev.addEventListener('click', async () => { try { await window.consoleAPI?.openDevTools?.(w.id); } catch (e) {} });
        btnMore.addEventListener('click', () => {
          try {
            const old = document.querySelector('.app-menu-overlay');
            if (old) old.remove();
          } catch (e) {}
          const overlay = document.createElement('div');
          overlay.className = 'app-menu-overlay';
          const menu = document.createElement('div');
          menu.className = 'app-menu';
          const items = [
            { icon: 'ri-focus-2-line', text: '聚焦', action: async () => { await window.consoleAPI?.focusWindow?.(w.id); } },
            { icon: 'ri-code-line', text: '开发者工具', action: async () => { await window.consoleAPI?.openDevTools?.(w.id); } },
            { sep: true },
            { icon: 'ri-refresh-line', text: '刷新', action: async () => { await window.consoleAPI?.controlWindow?.(w.id, 'reload'); } },
            { icon: 'ri-subtract-line', text: '最小化', action: async () => { await window.consoleAPI?.controlWindow?.(w.id, 'minimize'); } },
            { icon: 'ri-checkbox-blank-line', text: '最大化/还原', action: async () => { await window.consoleAPI?.controlWindow?.(w.id, 'maximize'); } },
            { icon: 'ri-window-2-line', text: '切换全屏', action: async () => { await window.consoleAPI?.controlWindow?.(w.id, 'fullscreen'); } },
            { icon: 'ri-eye-off-line', text: '隐藏', action: async () => { await window.consoleAPI?.controlWindow?.(w.id, 'hide'); } },
            { sep: true },
            { icon: 'ri-close-line', text: '关闭', action: async () => { await window.consoleAPI?.controlWindow?.(w.id, 'close'); } }
          ];
          items.forEach(it => {
            if (it.sep) { const s = document.createElement('div'); s.className = 'app-menu-sep'; menu.appendChild(s); return; }
            const btn = document.createElement('div');
            btn.className = 'app-menu-item';
            btn.innerHTML = `<i class="${it.icon}"></i><span>${it.text}</span>`;
            btn.addEventListener('click', async () => { try { await it.action(); } catch (e) {} try { overlay.remove(); } catch (e) {} });
            menu.appendChild(btn);
          });
          overlay.appendChild(menu);
          document.body.appendChild(overlay);
          try {
            const r = btnMore.getBoundingClientRect();
            const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
            const vh = window.innerHeight || document.documentElement.clientHeight || 768;
            const mw = menu.offsetWidth || 220;
            const mh = menu.offsetHeight || 240;
            let left = r.right - mw;
            let top = r.bottom + 6;
            const pad = 8;
            if (left < pad) left = pad;
            if (left + mw > vw - pad) left = vw - mw - pad;
            if (top + mh > vh - pad) top = r.top - mh - 6;
            if (top < pad) top = pad;
            menu.style.left = `${Math.round(left)}px`;
            menu.style.top = `${Math.round(top)}px`;
          } catch (e) { menu.style.right = '8px'; menu.style.top = '40px'; }
          const close = (e) => {
            const t = e.target;
            if (!menu.contains(t)) { try { overlay.remove(); document.removeEventListener('mousedown', close); } catch (e) {} }
          };
          document.addEventListener('mousedown', close);
        });
        windowsList.appendChild(card);
      });
    } catch (e) {
      windowsList.innerHTML = `<div class="muted">异常：${e?.message || String(e)}</div>`;
    }
  }
  windowsRefresh?.addEventListener('click', refreshWindows);
  window.addEventListener('beforeunload', () => {
    try { if (metricsTimer) clearInterval(metricsTimer); } catch (e) {}
    try { if (windowsTimer) clearInterval(windowsTimer); } catch (e) {}
  });

  (async () => {
    try {
      const last = await window.consoleAPI?.backendLogsGetEntries?.(500);
      if (Array.isArray(last)) {
        state.entries = last;
        renderOptions();
        renderList({ autoScroll: true });
      }
    } catch (e) {}
    try {
      window.consoleAPI?.onBackendLogEntry?.((entry) => {
        try {
          state.entries.push(entry);
          renderOptions();
          renderList();
        } catch (e) {}
      });
    } catch (e) {}
  })();
})();

async function fetchPlugins() {
  if (!window.settingsAPI) {
    return [
      { name: 'ExamplePlugin', npm: null, local: './src/plugins/example-plugin', enabled: true, icon: 'ri-puzzle-line', description: '示例插件，演示窗口与接口', actions: [ { id: 'openWindow', icon: 'ri-window-line', text: '打开窗口' }, { id: 'installNpm', icon: 'ri-download-2-line', text: '安装NPM' } ] }
    ];
  }
  return await window.settingsAPI.getPlugins();
}

function renderPlugin(item) {
  const el = document.createElement('div');
  el.className = 'plugin-card';
  const versionText = item.version ? `v${item.version}` : '未知版本';
  const actionsHtml = Array.isArray(item.actions) && item.actions.length
    ? item.actions.map(a => `<button class="action-btn" data-action="${a.id}"><i class="${a.icon || ''}"></i> ${a.text || ''}</button>`).join('')
    : '<span class="muted">无操作</span>';
  const authorText = (() => {
    const a = item.author;
    if (!a) return '未知作者';
    if (typeof a === 'string') return a;
    if (typeof a === 'object') return a.name || JSON.stringify(a);
    return String(a);
  })();
  const depsObj = (item && typeof item.npmDependencies === 'object' && item.npmDependencies) ? item.npmDependencies : null;
  const depsKeys = depsObj ? Object.keys(depsObj) : [];
  const depsHtml = depsKeys.length
    ? depsKeys.slice(0, 4).map(k => `<span class="pill small">${k}</span>`).join(' ') + (depsKeys.length > 4 ? ` <span class="pill small muted">+${depsKeys.length - 4}</span>` : '')
    : '<span class="muted">无依赖</span>';
  el.innerHTML = `
    <div class="card-header">
      <i class="${item.icon || 'ri-puzzle-line'}"></i>
      <div>
        <div class="card-title">${item.name} <span class="pill small plugin-version">${versionText}</span></div>
        <div class="card-desc">${item.description || ''}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${item.enabled ? 'checked' : ''} />
        <span class="slider"></span>
      </label>
    </div>
    <div class="card-actions">
      <div class="actions-left">${actionsHtml}</div>
      <div class="actions-right">
        <button class="icon-btn about-btn" title="关于插件"><i class="ri-information-line"></i></button>
        <button class="icon-btn create-shortcut-btn" title="创建快捷方式"><i class="ri-links-line"></i></button>
        <button class="icon-btn uninstall-btn" title="卸载"><i class="ri-delete-bin-line"></i></button>
      </div>
    </div>
  `;

  // 初始根据启用状态禁用/启用动作按钮
  try {
    el.querySelectorAll('.action-btn').forEach((btn) => { btn.disabled = !item.enabled; });
  } catch {}

  // 开发环境：追加“重载”按钮
  try {
    if (window.__isDev__) {
      const right = el.querySelector('.actions-right');
      const reloadBtn = document.createElement('button');
      reloadBtn.className = 'icon-btn reload-btn';
      reloadBtn.title = '重载（开发环境）';
      reloadBtn.innerHTML = '<i class="ri-refresh-line"></i>';
      right.appendChild(reloadBtn);
      reloadBtn.addEventListener('click', async () => {
        const key = item.id || item.name;
        const res = await window.settingsAPI?.reloadPlugin?.(key);
        if (!res?.ok) {
          await showAlert(`重载失败：${res?.error || '未知错误'}`);
          return;
        }
        // 重新刷新插件列表
        const container = document.getElementById('plugins');
        const list = await fetchPlugins();
        container.innerHTML = '';
        list.filter((p) => Array.isArray(p.actions) && p.actions.length > 0).forEach((p) => container.appendChild(renderPlugin(p)));
        await showAlert('已重载插件（开发目录 -> 用户目录）');
      });
    }
  } catch {}

  el.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.action;
      const meta = (item.actions || []).find(a => a.id === act);
      // 若 actions 配置了 target（指向插件 index.js 的 functions 中的函数），则直接调用
      if (meta && typeof meta.target === 'string' && meta.target) {
        const key = item.id || item.name;
        await window.settingsAPI?.pluginCall?.(key, meta.target, Array.isArray(meta.args) ? meta.args : []);
        console.log(key, meta.target, meta.args);
        return;
      }
      // 保留内置动作：安装NPM
      if (act === 'installNpm') {
        btn.disabled = true; btn.textContent = '安装中...';
        const key = item.id || item.name;
        await window.settingsAPI?.installNpm(key);
        btn.disabled = false; btn.innerHTML = `<i class="ri-download-2-line"></i> 安装NPM`;
      }
    });
  });
  const uninstallBtn = el.querySelector('.uninstall-btn');
  uninstallBtn?.addEventListener('click', async () => {
    const key = item.id || item.name;
    // 先查询依赖反向引用
    let dep = null;
    try { dep = await window.settingsAPI?.pluginDependents?.(key); } catch {}
    const pluginNames = Array.isArray(dep?.plugins) ? dep.plugins.map(p => p.name).join('，') : '';
    const autoNames = Array.isArray(dep?.automations) ? dep.automations.map(a => `${a.name}${a.enabled ? '(已启用)' : ''}`).join('，') : '';
    const extra = [
      pluginNames ? `被以下插件依赖：${pluginNames}` : '',
      autoNames ? `被以下自动化引用：${autoNames}` : ''
    ].filter(Boolean).join('\n');
    const msg = extra ? `确认卸载插件：${item.name}？\n${extra}\n您可以选择继续卸载，已启用的自动化将被禁用。` : `确认卸载插件：${item.name}？\n这将删除其目录与相关文件。`;
    const res = await showModal({ title: '卸载插件', message: msg, confirmText: '卸载', cancelText: '取消' });
    if (!res) return;
    // 自动禁用引用该插件的已启用自动化
    try {
      if (Array.isArray(dep?.automations)) {
        for (const a of dep.automations) {
          if (a.enabled) {
            try { await window.settingsAPI?.automationToggle?.(a.id, false); } catch {}
          }
        }
      }
    } catch {}
    const out = await window.settingsAPI?.uninstallPlugin?.(key);
    if (!out?.ok) { await showAlert(`卸载失败：${out?.error || '未知错误'}`); return; }
    // 重新刷新插件列表
    const container = document.getElementById('plugins');
    const list = await fetchPlugins();
    container.innerHTML = '';
    list.forEach((p) => container.appendChild(renderPlugin(p)));
  });
  // 关于插件
  const aboutBtn = el.querySelector('.about-btn');
  aboutBtn?.addEventListener('click', () => {
    showPluginAboutModal(item);
  });
  // 创建快捷方式（选择 action；若唯一则直接创建）
  const shortcutBtn = el.querySelector('.create-shortcut-btn');
  shortcutBtn?.addEventListener('click', async () => {
    const pluginId = item.id || item.name;
    // 收集可用的动作：来自 plugin.json 的 actions（需有 target），以及插件声明的 automationEvents
    const metaActions = Array.isArray(item.actions) ? item.actions.filter(a => typeof a.target === 'string' && a.target) : [];
    let eventDefs = [];
    try {
      const evRes = await window.settingsAPI?.pluginAutomationListEvents?.(pluginId);
      eventDefs = Array.isArray(evRes?.events) ? evRes.events : [];
    } catch {}
    const candidates = [];
    for (const a of metaActions) {
      candidates.push({ kind: 'meta', id: a.id || a.target, label: a.text || a.id || a.target, icon: a.icon || item.icon || 'ri-links-line', target: a.target, args: Array.isArray(a.args) ? a.args : [] });
    }
    for (const e of eventDefs) {
      candidates.push({ kind: 'event', id: e.id || e.name, label: e.name || e.id, icon: item.icon || 'ri-links-line', def: e });
    }
    if (!candidates.length) { await showAlert('该插件未定义可用于快捷方式的动作'); return; }
    // 选择或直接使用唯一项
    let chosen = null;
    let params = [];
    if (candidates.length === 1) {
      chosen = candidates[0];
      if (chosen.kind === 'event' && Array.isArray(chosen.def?.params) && chosen.def.params.length) {
        const edited = await showParamsEditorForEvent(chosen.def.params, []);
        if (edited === null) return;
        params = edited;
      } else if (chosen.kind === 'meta') {
        params = Array.isArray(chosen.args) ? chosen.args : [];
      }
    } else {
      const sel = await showActionSelector(candidates);
      if (!sel) return;
      chosen = candidates.find(c => c.kind === sel.kind && c.id === sel.id);
      if (!chosen) return;
      if (chosen.kind === 'event' && Array.isArray(chosen.def?.params) && chosen.def.params.length) {
        const edited = await showParamsEditorForEvent(chosen.def.params, []);
        if (edited === null) return;
        params = edited;
      } else if (chosen.kind === 'meta') {
        params = Array.isArray(chosen.args) ? chosen.args : [];
      }
    }
    // 构造自动化动作，弹出预览与选项对话框并确认创建
    const eventName = (chosen.kind === 'meta') ? chosen.target : (chosen.def?.name || chosen.def?.id);
    const action = (chosen.kind === 'meta')
      ? { type: 'pluginAction', pluginId, target: eventName, params: Array.isArray(params) ? params : [] }
      : { type: 'pluginEvent', pluginId, event: eventName, params: Array.isArray(params) ? params : [] };
    const ok = await showShortcutCreateDialog(item, chosen, pluginId, action);
    if (ok?.res) {
      const proto = ok.res?.protocolText ? `LessonPlugin://task/${encodeURIComponent(ok.res.protocolText)}` : '';
      const msg = proto ? `已在桌面创建快捷方式\n协议：${proto}` : '已在桌面创建快捷方式';
      await showAlert(msg);
    }
  });
  // 启用/禁用切换，启用前检查缺失依赖
  const toggleEl = el.querySelector('.toggle input[type="checkbox"]');
  toggleEl?.addEventListener('change', async (e) => {
    try {
      const checked = !!e.target.checked;
      const key = item.id || item.name;
      if (checked) {
        // 启用前检查 dependencies 是否满足（支持 name@version 范式）
        const list = await fetchPlugins();
        const depends = Array.isArray(item.dependencies) ? item.dependencies : (Array.isArray(item.pluginDepends) ? item.pluginDepends : []);
        const parseVer = (v) => { const m = String(v||'0.0.0').split('.').map(x=>parseInt(x,10)||0); return { m:m[0]||0, n:m[1]||0, p:m[2]||0 }; };
        const cmp = (a,b)=>{ if(a.m!==b.m) return a.m-b.m; if(a.n!==b.n) return a.n-b.n; return a.p-b.p; };
        const satisfies = (ver, range) => {
          if (!range) return !!ver;
          const v = parseVer(ver);
          const r = String(range).trim();
          const plain = r.replace(/^[~^]/, '');
          const base = parseVer(plain);
          if (r.startsWith('^')) return (v.m === base.m) && (cmp(v, base) >= 0);
          if (r.startsWith('~')) return (v.m === base.m) && (v.n === base.n) && (cmp(v, base) >= 0);
          if (r.startsWith('>=')) return cmp(v, parseVer(r.slice(2))) >= 0;
          if (r.startsWith('>')) return cmp(v, parseVer(r.slice(1))) > 0;
          if (r.startsWith('<=')) return cmp(v, parseVer(r.slice(2))) <= 0;
          if (r.startsWith('<')) return cmp(v, parseVer(r.slice(1))) < 0;
          const exact = parseVer(r);
          return cmp(v, exact) === 0;
        };
        const problems = [];
        for (const d of depends) {
          const [depName, depRange] = String(d).split('@');
          const target = list.find(pp => (pp.id === depName) || (pp.name === depName));
          if (!target || !target.enabled) { problems.push(`${depName}（未安装或未启用）`); continue; }
          if (!satisfies(target.version, depRange)) { problems.push(`${depName}（版本不满足，已装${target.version || '未知'}）`); }
        }
        if (problems.length) {
          const ok = await showConfirm(`该插件存在以下依赖问题：\n${problems.join('，')}\n仍要启用吗？`);
          if (!ok) { e.target.checked = false; return; }
        }
      }
      const res = await window.settingsAPI?.togglePlugin?.(key, checked);
      try { el.querySelectorAll('.action-btn').forEach((btn) => { btn.disabled = !checked; }); } catch {}
      // 启用时显示初始化日志（若返回）
      if (checked && Array.isArray(res?.logs) && res.logs.length) {
        try { await showLogModal('插件初始化日志', res.logs); } catch {}
      }
    } catch {}
  });
  return el;
}
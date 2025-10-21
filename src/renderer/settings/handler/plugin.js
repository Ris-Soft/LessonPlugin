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
  const depsObj = (item && typeof item.dependencies === 'object' && item.dependencies) ? item.dependencies : null;
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

  const checkbox = el.querySelector('input[type="checkbox"]');
  checkbox.addEventListener('change', async (e) => {
    const key = item.id || item.name;
    await window.settingsAPI?.togglePlugin(key, e.target.checked);
  });

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
    const res = await showModal({ title: '卸载插件', message: `确认卸载插件：${item.name}？\n这将删除其目录与相关文件。`, confirmText: '卸载', cancelText: '取消' });
    console.log('卸载插件确认结果:', res);
    if (!res) return;
    const key = item.id || item.name;
    const out = await window.settingsAPI?.uninstallPlugin?.(key);
    console.log('卸载插件结果:', out);
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
  return el;
}
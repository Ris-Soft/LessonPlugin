async function fetchPlugins() {
  if (!window.settingsAPI) {
    return [
      { name: 'ExamplePlugin', npm: null, local: './src/plugins/example-plugin', enabled: true, icon: 'ri-puzzle-line', description: '示例插件，演示窗口与接口', actions: [ { id: 'openWindow', icon: 'ri-window-line', text: '打开窗口' }, { id: 'installDeps', icon: 'ri-download-2-line', text: '安装依赖' } ] }
    ];
  }
  return await window.settingsAPI.getPlugins();
}

// 自动安装插件声明的 NPM 依赖（Node 模块），用于供插件调用
async function autoInstallNpmDependencies(dependencies, options = {}) {
  const { silent = false, onProgress = null } = options;
  if (!dependencies || typeof dependencies !== 'object' || !Object.keys(dependencies).length) {
    return { ok: true, installed: [], skipped: [], errors: [] };
  }
  const results = { ok: true, installed: [], skipped: [], errors: [] };
  try {
    const installedPkgs = await window.settingsAPI?.npmListInstalled?.();
    const installedList = (installedPkgs?.ok && Array.isArray(installedPkgs.packages)) ? installedPkgs.packages : [];
    const hasPkg = (name) => installedList.some(p => p.name === name && Array.isArray(p.versions) && p.versions.length);
    const missing = Object.keys(dependencies).filter(name => !hasPkg(name));
    if (!missing.length) { onProgress && !silent && onProgress({ stage: 'npm', message: '所有依赖已安装' }); return results; }
    for (const name of missing) {
      try {
        onProgress && !silent && onProgress({ stage: 'npm', message: `获取版本：${name}` });
        const verRes = await window.settingsAPI?.npmGetVersions?.(name);
        const versions = (verRes?.ok && Array.isArray(verRes.versions)) ? verRes.versions : [];
        if (!versions.length) { results.errors.push({ name, error: '无可用版本' }); results.ok = false; continue; }
        const latestVersion = versions[versions.length - 1];
        onProgress && !silent && onProgress({ stage: 'npm', message: `下载：${name}@${latestVersion}` });
        const dl = await window.settingsAPI?.npmDownload?.(name, latestVersion);
        if (!dl?.ok) { results.errors.push({ name, error: dl?.error || '下载失败' }); results.ok = false; }
        else { results.installed.push({ name, version: latestVersion }); onProgress && !silent && onProgress({ stage: 'npm', message: `已安装：${name}@${latestVersion}` }); }
      } catch (e) { results.errors.push({ name, error: e?.message || '未知错误' }); results.ok = false; }
    }
    onProgress && !silent && onProgress({ stage: 'npm', message: `完成：安装 ${results.installed.length} 个，失败 ${results.errors.length} 个` });
  } catch (e) { results.ok = false; results.errors.push({ name: 'system', error: e?.message || '系统错误' }); }
  return results;
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
        list.filter((p) => String(p.type || 'plugin').toLowerCase() === 'plugin' && Array.isArray(p.actions) && p.actions.length > 0).forEach((p) => container.appendChild(renderPlugin(p)));
        await showAlert('已重载插件（开发目录 -> 用户目录）');
      });
    }
  } catch {}

  try {
    const actionsLeft = el.querySelector('.actions-left');
    const actionsBox = el.querySelector('.card-actions');
    if (actionsLeft && actionsBox) {
      const moreBtn = document.createElement('button');
      moreBtn.className = 'icon-btn more-btn';
      moreBtn.title = '展开操作';
      moreBtn.innerHTML = '<i class="ri-arrow-down-s-line"></i> 展开操作';
      const overflowMenu = document.createElement('div');
      overflowMenu.className = 'overflow-menu';
      actionsLeft.appendChild(moreBtn);
      actionsLeft.appendChild(overflowMenu);

      const recompute = () => {
        try {
          const moved = Array.from(overflowMenu.querySelectorAll('.action-btn'));
          moved.forEach(btn => {
            actionsLeft.insertBefore(btn, moreBtn);
          });
        } catch {}
        overflowMenu.innerHTML = '';

        const prevWrap = actionsLeft.style.flexWrap;
        actionsLeft.style.flexWrap = 'nowrap';

        const getLeftBtns = () => Array.from(actionsLeft.children).filter(n => n.classList && n.classList.contains('action-btn'));

        moreBtn.style.display = 'none';
        let safety = 100;
        while (actionsLeft.scrollWidth > actionsLeft.clientWidth && safety-- > 0) {
          const btns = getLeftBtns();
          if (btns.length <= 0) break;
          overflowMenu.appendChild(btns[btns.length - 1]);
        }

        const hasOverflow = overflowMenu.children.length > 0;

        if (hasOverflow) {
          moreBtn.style.display = '';
          moreBtn.classList.remove('text');
          moreBtn.innerHTML = '<i class="ri-arrow-down-s-line"></i>';
          moreBtn.style.visibility = 'hidden';
          safety = 100;
          while (actionsLeft.scrollWidth > actionsLeft.clientWidth && safety-- > 0) {
            const btns = getLeftBtns();
            if (btns.length <= 0) break;
            overflowMenu.appendChild(btns[btns.length - 1]);
          }
          moreBtn.style.visibility = '';
        }

        actionsLeft.style.flexWrap = prevWrap || '';

        const visibleCount = getLeftBtns().length;
        if (overflowMenu.children.length) {
          moreBtn.style.display = '';
          if (visibleCount >= 1) {
            moreBtn.classList.remove('text');
            moreBtn.innerHTML = '<i class="ri-arrow-down-s-line"></i>';
          } else {
            moreBtn.classList.add('text');
            moreBtn.innerHTML = '<i class="ri-arrow-down-s-line"></i> 展开操作';
            const wrapPrev = actionsLeft.style.flexWrap;
            actionsLeft.style.flexWrap = 'nowrap';
            if (actionsLeft.scrollWidth > actionsLeft.clientWidth) {
              moreBtn.classList.remove('text');
              moreBtn.innerHTML = '<i class="ri-arrow-down-s-line"></i>';
            }
            actionsLeft.style.flexWrap = wrapPrev || '';
          }
        } else {
          moreBtn.style.display = 'none';
        }
      };

      setTimeout(recompute, 0);

      try {
        const ro = new ResizeObserver(() => recompute());
        ro.observe(actionsBox);
      } catch {}
      window.addEventListener('resize', recompute);

      let isOpen = false;
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isOpen = !isOpen;
        overflowMenu.classList.toggle('overflow-open', isOpen);
        try {
          const icon = moreBtn.querySelector('i');
          if (icon) {
            icon.className = isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line';
          }
        } catch {}
      });
      document.addEventListener('click', (e) => {
        if (!el.contains(e.target)) {
          isOpen = false;
          overflowMenu.classList.remove('overflow-open');
          try {
            const icon = moreBtn.querySelector('i');
            if (icon) icon.className = 'ri-arrow-down-s-line';
          } catch {}
        }
      });
    }
  } catch {}

  el.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.action;
      const meta = (item.actions || []).find(a => a.id === act);
      if (meta && typeof meta.target === 'string' && meta.target) {
        const key = item.id || item.name;
        await window.settingsAPI?.pluginCall?.(key, meta.target, Array.isArray(meta.args) ? meta.args : []);
        console.log(key, meta.target, meta.args);
        return;
      }
      if (act === 'installDeps' || act === 'installNpm') {
        btn.disabled = true; btn.textContent = '安装依赖中...';
        const key = item.id || item.name;
        const status = await window.settingsAPI?.pluginDepsStatus?.(key);
        if (!status?.ok) {
          await showAlert(`无法查询依赖状态：${status?.error || '未知错误'}`);
          btn.disabled = false; btn.innerHTML = `<i class="ri-download-2-line"></i> 安装依赖`;
          return;
        }
        const ensure = await window.settingsAPI?.pluginEnsureDeps?.(key);
        if (!ensure?.ok) {
          await showAlert(`依赖安装/链接失败：${ensure?.error || '未知错误'}`);
        } else {
          await showAlertWithLogs('依赖处理完成', `已确保并链接插件依赖：${item.name}`, Array.isArray(ensure.logs) ? ensure.logs : []);
          try {
            const list = await fetchPlugins();
            const cur = Array.isArray(list) ? list.find(p => (p.id === key) || (p.name === key)) : null;
            if (cur && cur.enabled) {
              await window.settingsAPI?.togglePlugin?.(key, false);
              const restarted = await window.settingsAPI?.togglePlugin?.(key, true);
              if (Array.isArray(restarted?.logs) && restarted.logs.length) {
                await showLogModal('插件重启日志', restarted.logs);
              }
              showToast(`已重启插件：${item.name}`, { type: 'success', duration: 2000 });
            }
          } catch {}
        }
        btn.disabled = false; btn.innerHTML = `<i class="ri-download-2-line"></i> 安装依赖`;
      }
    });
  });
  const uninstallBtn = el.querySelector('.uninstall-btn');
  uninstallBtn?.addEventListener('click', async () => {
    const { confirmed, dep } = await showUninstallConfirm(item);
    if (!confirmed) return;
    const key = item.id || item.name;
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
    list.filter((p) => String(p.type || 'plugin').toLowerCase() === 'plugin').forEach((p) => container.appendChild(renderPlugin(p)));
    showToast(`已卸载插件：${item.name}`, { type: 'success', duration: 2000 });
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
        const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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
          const depKey = norm(depName);
          const target = list.find(pp => norm(pp.id || pp.name) === depKey);
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

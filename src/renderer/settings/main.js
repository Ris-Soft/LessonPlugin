async function main() {
  if (window.__settingsMainRan) return;
  window.__settingsMainRan = true;
  // 获取开发环境标记
  let isDev = true;
  try {
    const info = await window.settingsAPI?.getAppInfo?.();
    isDev = !!info?.isDev;
  } catch (e) {}
  window.__isDev__ = isDev;

  // 左侧导航切换
  const navItems = document.querySelectorAll('.nav-item');
  const pages = {
    plugins: document.getElementById('page-plugins'),
    market: document.getElementById('page-market'),
    components: document.getElementById('page-components'),
    general: document.getElementById('page-general'),
    config: document.getElementById('page-config'),
    defaults: document.getElementById('page-defaults'),
    automation: document.getElementById('page-automation'),
    npm: document.getElementById('page-npm'),
    debug: document.getElementById('page-debug'),
    about: document.getElementById('page-about')
  };
  // 根据配置显示/隐藏调试页，并可默认进入运行管理
  try {
    const devMode = await window.settingsAPI?.configGet?.('system', 'developerMode');
    const debugBtn = Array.from(navItems).find(b => b.dataset.page === 'debug');
    if (debugBtn) {
      debugBtn.style.display = devMode ? '' : 'none';
      if (devMode) {
        // 默认进入调试页
        debugBtn.click();
      }
    }
  } catch (e) {}
  navItems.forEach((btn) => {
    btn.addEventListener('click', async () => {
      navItems.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.page;
      for (const key of Object.keys(pages)) {
        pages[key].hidden = key !== page;
      }
      if (page === 'npm') {
        window.renderInstalled?.();
      } else if (page === 'general') {
        initGeneralSettings();
      } else if (page === 'config') {
        try { initConfigOverview(); } catch (e) {}
      } else if (page === 'automation') {
        initAutomationSettings();
      } else if (page === 'debug') {
        initDebugSettings();
      } else if (page === 'market') {
        initMarketPage();
      } else if (page === 'plugins') {
        try { await window.initPluginsPage?.(); } catch (e) {}
      } else if (page === 'components') {
        try { window.initComponentsPage?.(); } catch (e) {}
      } else if (page === 'defaults') {
        try { window.initDefaultsPage?.(); } catch (e) {}
      } else if (page === 'about') {
        initAboutPage();
      }
    });
  });

  // 已移除全局安装进度展示（global-progress）

  const navigateToPage = async (page) => {
    try {
      const btn = Array.from(navItems).find(b => b.dataset.page === page);
      navItems.forEach((b) => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      for (const key of Object.keys(pages)) {
        pages[key].hidden = key !== page;
      }
    if (page === 'npm') {
    window.renderInstalled?.();
  } else if (page === 'general') {
    initGeneralSettings();
  } else if (page === 'config') {
    try { initConfigOverview(); } catch (e) {}
  } else if (page === 'automation') {
    initAutomationSettings();
  } else if (page === 'debug') {
    initDebugSettings();
  } else if (page === 'market') {
      initMarketPage();
    } else if (page === 'plugins') {
      try { await window.initPluginsPage?.(); } catch (e) {}
    } else if (page === 'components') {
      try { window.initComponentsPage?.(); } catch (e) {}
    } else if (page === 'defaults') {
      try { window.initDefaultsPage?.(); } catch (e) {}
    } else if (page === 'about') {
      initAboutPage();
    }
    } catch (e) {}
  };
  window.settingsAPI?.onNavigate?.((page) => { try { navigateToPage(page); } catch (e) {} });
  window.settingsAPI?.onOpenPluginInfo?.(async (pluginKey) => {
    try {
      await navigateToPage('plugins');
      const list = await fetchPlugins();
      const filtered = list.filter((p) => String(p.type || 'plugin').toLowerCase() === 'plugin' && Array.isArray(p.actions) && p.actions.length > 0);
      const item = filtered.find((p) => (p.id || p.name) === pluginKey);
      if (item) {
        showPluginAboutModal(item);
      } else {
        await showAlert(`未找到插件：${pluginKey}`);
      }
    } catch (e) {}
  });

  window.settingsAPI?.onOpenStoreItem?.(async (payload) => {
    try {
      await navigateToPage('market');
      const base = await getMarketBase();
      const catlog = await fetchMarket('/api/market/catalog');
      const type = String(payload?.type || 'plugin');
      const id = String(payload?.id || '').trim();
      const arr = type === 'automation' ? (catlog.automation || []) : (type === 'component' || type === 'components' ? (catlog.components || []) : (catlog.plugins || []));
      const item = arr.find((x) => String(x.id || x.name) === id);
      if (item) {
        showStorePluginModal(item);
      } else {
        await showAlert(`未找到：${id}`);
      }
    } catch (e) {}
  });

  window.settingsAPI?.onMarketInstall?.(async (payload) => {
    try {
      await navigateToPage('market');
      const catlog = await fetchMarket('/api/market/catalog');
      const type = String(payload?.type || 'plugin');
      const id = String(payload?.id || '').trim();
      const arr = type === 'automation' ? (catlog.automation || []) : (type === 'component' || type === 'components' ? (catlog.components || []) : (catlog.plugins || []));
      const item = arr.find((x) => String(x.id || x.name) === id);
      if (!item) { await showAlert(`未找到：${id}`); return; }
      
      const ok = await showConfirm(`检测到缺失插件/功能：${item.name || id}，是否查看详情并安装？`);
      if (ok) {
        showStorePluginModal(item);
      }
    } catch (e) {}
  });

  // 渲染插件列表
  const container = document.getElementById('plugins');
  try { await window.initPluginsPage?.(); } catch (e) {}

  // 打开设置页时检查缺失依赖并提示安装（避免占用启动时间）
  let depsPrompted = false;
  async function checkMissingDepsPrompt() {
    if (depsPrompted) return;
    depsPrompted = true;
    try {
      const all = await window.settingsAPI?.getPlugins?.();
      const enabledList = (all || []).filter(p => p.enabled);
      for (const p of enabledList) {
        const res = await window.settingsAPI?.pluginDepsStatus?.(p.id || p.name);
        const st = Array.isArray(res?.status) ? res.status : [];
        const missing = st.filter(s => !Array.isArray(s.installed) || s.installed.length === 0).map(s => s.name);
        if (missing.length) {
          const ok = await showConfirm(`插件 ${p.name} 缺少依赖：${missing.join('，')}，是否现在安装？`);
          if (!ok) continue;
          // 显示安装进度并绑定事件
          const progressModal = showProgressModal('安装依赖', `准备安装 ${p.name} 依赖...`);
          const handler = (payload) => {
            try {
              if (payload && String(payload.stage).toLowerCase() === 'npm') {
                progressModal.update(payload);
              }
            } catch (e) {}
          };
          let unsubscribe = null;
          try { unsubscribe = window.settingsAPI?.onProgress?.(handler); } catch (e) {}
          const ensure = await window.settingsAPI?.pluginEnsureDeps?.(p.id || p.name);
          try { unsubscribe && unsubscribe(); } catch (e) {}
          try { progressModal?.close?.(); } catch (e) {}
          if (ensure?.ok) {
            await showToast(`已安装 ${p.name} 依赖`);
          } else {
            await showAlert(`安装失败：${ensure?.error || '未知错误'}`);
          }
        }
      }
    } catch (e) {}
  }
  // 触发一次检查
  checkMissingDepsPrompt();

  // 自定义标题栏按钮
  document.querySelectorAll('.win-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'menu') {
        try {
          const r = b.getBoundingClientRect();
          window.showAppMenu({ x: r.right - 180, y: r.bottom + 6 });
        } catch (e) {}
      } else {
        window.settingsAPI?.windowControl(act);
      }
    });
  });

  try {
    const titlebar = document.querySelector('.titlebar');
    titlebar?.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.showAppMenu({ x: e.clientX, y: e.clientY });
    });
  } catch (e) {}

  // 标题栏版本显示与跳转关于
  try {
    const info = await window.settingsAPI?.getAppInfo?.();
    const v = info?.appVersion || '';
    const vEl = document.getElementById('title-version');
    if (vEl) vEl.textContent = v || '—';
    const pill = document.getElementById('title-version-pill');
    pill?.addEventListener('click', () => {
      const btn = Array.from(document.querySelectorAll('.nav-item')).find(b => b.dataset.page === 'about');
      if (btn) btn.click();
    });
    // 启动时检查是否有更新，若有则在版本 pill 显示“旧版本→新版本”，并高亮为绿色白字
    try {
      const res = await window.settingsAPI?.checkUpdate?.(true);
      if (res?.ok && res.hasUpdate) {
        if (vEl) vEl.textContent = `${res.currentVersion} → ${res.remoteVersion}`;
        if (pill) {
          pill.classList.add('primary');
          pill.style.background = 'var(--accent)';
          pill.style.color = '#ffffff';
        }
      }
    } catch (e) {}
  } catch (e) {}

  // NPM 管理逻辑（仅展示已安装列表）
  const installedEl = document.getElementById('npm-installed');
  const versionsEl = document.getElementById('npm-versions');
  const searchInput = document.getElementById('npm-search-input');
  const searchBtn = document.getElementById('npm-search-btn');

  async function renderInstalled() {
    installedEl.innerHTML = '加载已安装模块...';
    const res = await window.settingsAPI?.npmListInstalled();
    if (!res?.ok) {
      installedEl.innerHTML = `<div class="panel">获取失败：${res?.error || '未知错误'}</div>`;
      return;
    }
    const { packages } = res;
    installedEl.innerHTML = '';
    packages.forEach((pkg) => {
      const div = document.createElement('div');
      div.className = 'pkg';
      div.innerHTML = `
        <div class="pkg-header">
          <div class="pkg-name"><i class="ri-box-3-line"></i> ${pkg.name}</div>
          <div class="count">${pkg.versions.length} 个版本</div>
          <div class="spacer"></div>
          <button class="btn danger small" data-act="delete">删除</button>
        </div>
        <div class="versions">${pkg.versions.map(v => `<span class="pill">v${v}</span>`).join(' ')}</div>
        <div class="pkg-actions" hidden></div>
      `;
      const delBtn = div.querySelector('button[data-act="delete"]');
      const actions = div.querySelector('.pkg-actions');
      delBtn.addEventListener('click', async () => {
        // 展示版本选择并检查占用
        const name = pkg.name;
        actions.hidden = false;
        actions.innerHTML = '正在加载占用信息...';
        const usesRes = await window.settingsAPI?.npmModuleUsers?.(name);
        const usedMap = new Map();
        if (usesRes?.ok && Array.isArray(usesRes.users)) {
          usesRes.users.forEach(u => {
            if (u.version) usedMap.set(String(u.version), (usedMap.get(String(u.version)) || 0) + 1);
          });
        }
        actions.innerHTML = `
          <div class="inline" style="gap:8px;align-items:center;margin-top:8px;">
            <span class="muted">选择要删除的版本：</span>
            ${pkg.versions.map(v => {
              const used = usedMap.has(String(v));
              const hint = used ? `（被${usedMap.get(String(v))}个插件占用）` : '';
              return `<label class="inline" style="gap:6px;">
                <input type="checkbox" name="ver" value="${v}" ${used ? 'disabled' : ''} />
                <span>v${v} ${hint}</span>
              </label>`;
            }).join(' ')}
            <div class="spacer"></div>
            <button class="btn secondary small" data-act="cancel">取消</button>
            <button class="btn danger small" data-act="confirm">确认删除</button>
          </div>
        `;
        const cancelBtn = actions.querySelector('button[data-act="cancel"]');
        const confirmBtn = actions.querySelector('button[data-act="confirm"]');
        cancelBtn.addEventListener('click', () => { actions.hidden = true; actions.innerHTML = ''; });
        confirmBtn.addEventListener('click', async () => {
          const selected = Array.from(actions.querySelectorAll('input[name="ver"]:checked')).map(i => i.value);
          if (!selected.length) { await showAlert('请至少选择一个可删除的版本'); return; }
          const rmRes = await window.settingsAPI?.npmRemove?.(name, selected);
          if (!rmRes?.ok) {
            await showAlert(`删除失败：${rmRes?.error || (rmRes?.errors?.[0]?.error) || '未知错误'}`);
            return;
          }
          if (rmRes.blocked?.length) {
            await showAlert(`以下版本当前被插件占用，未删除：${rmRes.blocked.join('，')}`);
          }
          if (rmRes.removed?.length) {
            await showToast(`已删除版本：${rmRes.removed.join('，')}`);
          }
          actions.hidden = true; actions.innerHTML = '';
          await renderInstalled();
        });
      });
      installedEl.appendChild(div);
    });
  }
  // 初次进入NPM页面时加载
  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav?.dataset.page === 'npm') {
    renderInstalled();
  }

  // 版本搜索与下载
  async function renderVersions(name) {
    versionsEl.innerHTML = '';
    const res = await window.settingsAPI?.npmGetVersions?.(name);
    if (!res?.ok) {
      versionsEl.innerHTML = `<div class="panel">获取版本失败：${res?.error || '未知错误'}</div>`;
      return;
    }
    const { versions } = res;
    if (!Array.isArray(versions) || versions.length === 0) {
      versionsEl.innerHTML = `<div class="muted">未查询到版本</div>`;
      return;
    }
    versionsEl.innerHTML = `<div class="muted">找到 ${versions.length} 个版本，点击下载所需版本</div>`;
    const grid = document.createElement('div');
    grid.className = 'versions-grid';
    grid.style.display = 'flex';
    grid.style.flexWrap = 'wrap';
    grid.style.gap = '8px';
    versions.forEach(v => {
      const pill = document.createElement('button');
      pill.className = 'btn small';
      pill.textContent = `v${v}`;
      pill.addEventListener('click', async () => {
        const ok = await showConfirm(`下载 ${name}@${v} 吗？`);
        if (!ok) return;
        try {
          // 显示下载/安装进度模态框，并绑定进度事件
          const progressModal = showProgressModal('下载/安装进度', `准备下载 ${name}@${v} ...`);
          const handler = (payload) => {
            try {
              // 仅处理 npm 阶段，且信息包含当前包名与版本，避免串扰
              if (payload && String(payload.stage).toLowerCase() === 'npm') {
                const msg = String(payload.message || '');
                if (msg.includes(`${name}@${v}`) || msg.includes(name)) {
                  progressModal.update(payload);
                }
              }
            } catch (e) {}
          };
          const unsubscribe = window.settingsAPI?.onProgress?.(handler);
          const dl = await window.settingsAPI?.npmDownload?.(name, v);
          // 解绑进度并关闭模态框
          try { unsubscribe && unsubscribe(); } catch (e) {}
          try { progressModal?.close?.(); } catch (e) {}
          if (!dl?.ok) {
            await showAlert(`下载失败：${dl?.error || '未知错误'}`);
            return;
          }
          await showToast(`已下载 ${name}@${v}`);
          await renderInstalled();
        } catch (e) { await showAlert(`下载异常：${e?.message || String(e)}`); }
      });
      grid.appendChild(pill);
    });
    versionsEl.appendChild(grid);
  }
  if (searchBtn) {
    searchBtn.addEventListener('click', async () => {
      const name = searchInput?.value?.trim();
      if (!name) { await showAlert('请输入 NPM 包名'); return; }
      await renderVersions(name);
    });
  }

  

  // 拖拽安装ZIP
  const drop = document.getElementById('drop-install');
  // 安装确认由统一入口处理，不再直接使用本地模态框
  let pendingZipPath = null;
  let pendingZipData = null; // { name, data: Uint8Array }
  let pendingItemMeta = null; // 用于统一入口的依赖引导与展示
  ['dragenter','dragover'].forEach(evt => drop.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(evt => drop.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', async (e) => {
    const files = e.dataTransfer?.files || [];
    const file = files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) { showAlert('请拖入ZIP插件安装包'); return; }
    pendingZipPath = file.path || null;
    pendingZipData = null;
    if (!pendingZipPath) {
      // 回退：读取数据并通过IPC传输安装，避免路径不可用导致失败
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        pendingZipData = { name: file.name, data: buf };
      } catch (err) {
        await showAlert('读取文件失败，请重试或手动选择安装');
        return;
      }
    }
    // 安装前检查ZIP以展示依赖与安全提示，并记录元信息供统一入口使用
    try {
      let inspect = null;
      if (pendingZipPath) inspect = await window.settingsAPI?.inspectPluginZip?.(pendingZipPath);
      else inspect = await window.settingsAPI?.inspectPluginZipData?.(pendingZipData.name, pendingZipData.data);
      if (inspect?.ok) {
        const name = inspect.name || file.name.replace(/\.zip$/i, '');
        const author = (typeof inspect.author === 'object') ? (inspect.author?.name || JSON.stringify(inspect.author)) : (inspect.author || '未知作者');
        const pluginDepends = Array.isArray(inspect.dependencies) ? inspect.dependencies : [];
        const depsObj = (typeof inspect.npmDependencies === 'object' && !Array.isArray(inspect.npmDependencies) && inspect.npmDependencies) ? inspect.npmDependencies : null;
        const depNames = depsObj ? Object.keys(depsObj) : [];
        // 记录供统一入口使用的元信息
        pendingItemMeta = {
          id: inspect.id || name,
          name,
          icon: 'ri-puzzle-line',
          dependencies: pluginDepends,
          npmDependencies: depsObj || null,
        };
        // 计算插件依赖的安装状态（支持 name@version 范式）
        const list = await window.settingsAPI?.getPlugins?.();
        const installed = Array.isArray(list) ? list : [];
        const parseVer = (v) => {
          const m = String(v || '0.0.0').split('.').map(x => parseInt(x, 10) || 0);
          return { m: m[0]||0, n: m[1]||0, p: m[2]||0 };
        };
        const cmp = (a, b) => {
          if (a.m !== b.m) return a.m - b.m;
          if (a.n !== b.n) return a.n - b.n;
          return a.p - b.p;
        };
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
          // 精确匹配 x.y.z
          const exact = parseVer(r);
          return cmp(v, exact) === 0;
        };
        const depPills = pluginDepends.map(d => {
          const [depName, depRange] = String(d).split('@');
          const target = installed.find(pp => (pp.id === depName) || (pp.name === depName));
          const ok = !!target && satisfies(target?.version, depRange);
          const hint = !target ? '（未安装）' : (!satisfies(target?.version, depRange) ? `（版本不满足，已装${target?.version || '未知'}）` : '');
          return `<span class="pill small${ok ? '' : ' danger'}">${depName}${depRange ? '@'+depRange : ''}${hint}</span>`;
        }).join(' ');
        const npmPills = depNames.map(k => `<span class="pill small">${k}</span>`).join(' ');
        const msg = `
将安装：${name}
作者：${author}
插件依赖：${pluginDepends.length ? pluginDepends.join('，') : '无'}
NPM依赖：${depNames.length ? depNames.join('，') : '无'}
`;
        // 风险确认与依赖选择将由统一安装入口统一处理
      }
    } catch (e) {}
    // 直接调用统一安装入口，交由其处理确认与依赖引导
    try {
      if (pendingZipPath) {
        await window.unifiedPluginInstall({ kind: 'zipPath', item: pendingItemMeta || {}, zipPath: pendingZipPath });
      } else if (pendingZipData) {
        await window.unifiedPluginInstall({ kind: 'zipData', item: pendingItemMeta || {}, zipName: pendingZipData.name, zipData: pendingZipData.data });
      }
    } finally {
      pendingZipPath = null; pendingZipData = null; pendingItemMeta = null;
    }
  });
}

main();

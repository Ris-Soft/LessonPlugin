async function main() {
  // 获取开发环境标记
  let isDev = true;
  try {
    const info = await window.settingsAPI?.getAppInfo?.();
    isDev = !!info?.isDev;
  } catch {}
  window.__isDev__ = isDev;

  // 左侧导航切换
  const navItems = document.querySelectorAll('.nav-item');
  const pages = {
    plugins: document.getElementById('page-plugins'),
    market: document.getElementById('page-market'),
    general: document.getElementById('page-general'),
    profiles: document.getElementById('page-profiles'),
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
  } catch {}
  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      navItems.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.page;
      for (const key of Object.keys(pages)) {
        pages[key].hidden = key !== page;
      }
      if (page === 'npm') {
        renderInstalled();
      } else if (page === 'general') {
        initGeneralSettings();
      } else if (page === 'profiles') {
        initProfilesSettings();
      } else if (page === 'automation') {
        initAutomationSettings();
      } else if (page === 'debug') {
        initDebugSettings();
      } else if (page === 'market') {
        initMarketPage();
      } else if (page === 'plugins') {
        (async () => {
          try {
            const container = document.getElementById('plugins');
            const list = await fetchPlugins();
            container.innerHTML = '';
            const filtered = list.filter((p) => Array.isArray(p.actions) && p.actions.length > 0);
            filtered.forEach((p) => container.appendChild(renderPlugin(p)));
          } catch {}
        })();
      } else if (page === 'about') {
        initAboutPage();
      }
    });
  });

  // 全局进度显示区域（用于 Node 模块安装/下载等主进程推送的进度事件）
  const progressUI = (() => {
    const box = document.createElement('div'); box.id = 'global-progress'; box.className = 'global-progress'; box.hidden = true;
    const header = document.createElement('div'); header.className = 'progress-header'; header.innerHTML = '<i class="ri-time-line"></i> 安装进度';
    const list = document.createElement('div'); list.className = 'progress-list';
    box.appendChild(header); box.appendChild(list);
    document.body.appendChild(box);
    return { box, list };
  })();
  window.settingsAPI?.onProgress?.((payload) => {
    try {
      const stage = payload?.stage || payload?.type || 'progress';
      // 仅显示 NPM 下载阶段，避免非下载提示出现在此区域
      if (stage !== 'npm') return;
      const line = document.createElement('div'); line.className = 'progress-item';
      const ts = new Date(); const hh = String(ts.getHours()).padStart(2, '0'); const mm = String(ts.getMinutes()).padStart(2, '0'); const ss = String(ts.getSeconds()).padStart(2, '0');
      const time = `${hh}:${mm}:${ss}`;
      const msg = payload?.message || payload?.msg || '';
      const detail = payload?.detail || '';
      line.textContent = `[${time}] ${msg}${detail ? ' ' + detail : ''}`;
      progressUI.list.appendChild(line);
      progressUI.box.hidden = false;
      progressUI.list.scrollTop = progressUI.list.scrollHeight;
    } catch {}
  });

  const navigateToPage = (page) => {
    try {
      const btn = Array.from(navItems).find(b => b.dataset.page === page);
      navItems.forEach((b) => b.classList.remove('active'));
      if (btn) btn.classList.add('active');
      for (const key of Object.keys(pages)) {
        pages[key].hidden = key !== page;
      }
      if (page === 'npm') {
      renderInstalled();
    } else if (page === 'general') {
      initGeneralSettings();
    } else if (page === 'profiles') {
      initProfilesSettings();
    } else if (page === 'automation') {
      initAutomationSettings();
    } else if (page === 'debug') {
      initDebugSettings();
    } else if (page === 'market') {
      initMarketPage();
    } else if (page === 'plugins') {
      (async () => {
        try {
          const container = document.getElementById('plugins');
          const list = await fetchPlugins();
          container.innerHTML = '';
          const filtered = list.filter((p) => Array.isArray(p.actions) && p.actions.length > 0);
          filtered.forEach((p) => container.appendChild(renderPlugin(p)));
        } catch {}
      })();
    } else if (page === 'about') {
      initAboutPage();
    }
    } catch {}
  };
  window.settingsAPI?.onNavigate?.((page) => navigateToPage(page));
  window.settingsAPI?.onOpenPluginInfo?.(async (pluginKey) => {
    try {
      navigateToPage('plugins');
      const list = await fetchPlugins();
      const filtered = list.filter((p) => Array.isArray(p.actions) && p.actions.length > 0);
      const item = filtered.find((p) => (p.id || p.name) === pluginKey);
      if (item) {
        showPluginAboutModal(item);
      } else {
        await showAlert(`未找到插件：${pluginKey}`);
      }
    } catch {}
  });

  // 渲染插件列表
  const container = document.getElementById('plugins');
  const list = await fetchPlugins();
  container.innerHTML = '';
  // 需求：无动作的插件不应在插件列表显示（但不影响自动化编辑器的插件选择）
  const filtered = list.filter((p) => Array.isArray(p.actions) && p.actions.length > 0);
  filtered.forEach((p) => container.appendChild(renderPlugin(p)));

  // 自定义标题栏按钮
  document.querySelectorAll('.win-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      window.settingsAPI?.windowControl(act);
    });
  });

  // NPM 管理逻辑（仅展示已安装列表）
  const installedEl = document.getElementById('npm-installed');
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
        </div>
        <div class="versions">${pkg.versions.map(v => `<span class="pill">v${v}</span>`).join(' ')}</div>
      `;
      installedEl.appendChild(div);
    });
  }
  // 初次进入NPM页面时加载
  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav?.dataset.page === 'npm') {
    renderInstalled();
  }

  // 如果初次进入为档案管理，初始化
  if (activeNav?.dataset.page === 'profiles') {
    initProfilesSettings();
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
        const depsObj = (typeof inspect.npmDependencies === 'object' && inspect.npmDependencies) ? inspect.npmDependencies : null;
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
    } catch {}
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
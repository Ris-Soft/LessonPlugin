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
  const modal = document.getElementById('install-modal');
  const btnCancel = document.getElementById('install-cancel');
  const btnConfirm = document.getElementById('install-confirm');
  let pendingZipPath = null;
  let pendingZipData = null; // { name, data: Uint8Array }
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
    // 安装前检查ZIP以展示依赖与安全提示
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
        const ok = await showConfirm(msg);
        if (!ok) return;
      }
    } catch {}
    modal.hidden = false;
  });
  btnCancel?.addEventListener('click', () => { pendingZipPath = null; pendingZipData = null; modal.hidden = true; });
  btnConfirm?.addEventListener('click', async () => {
    if (!pendingZipPath && !pendingZipData) return;
    btnConfirm.disabled = true; btnConfirm.innerHTML = '<i class="ri-loader-4-line"></i> 安装中...';
    let res;
    if (pendingZipPath) {
      res = await window.settingsAPI?.installPluginZip(pendingZipPath);
    } else {
      res = await window.settingsAPI?.installPluginZipData(pendingZipData.name, pendingZipData.data);
    }
    btnConfirm.disabled = false; btnConfirm.innerHTML = '<i class="ri-checkbox-circle-line"></i> 确认安装';
    if (!res?.ok) {
      showAlert(`安装失败：${res?.error || '未知错误'}\n如需手动导入Node模块，请将对应包拷贝至 src/npm_store/<name>/<version>/node_modules/<name>`);
      return;
    }
    modal.hidden = true; pendingZipPath = null; pendingZipData = null;
    const metaAuthor = (typeof res.author === 'object') ? (res.author?.name || JSON.stringify(res.author)) : (res.author || '未知作者');
    const depsObj = (typeof res.npmDependencies === 'object' && res.npmDependencies) ? res.npmDependencies : null;
    const depNames = depsObj ? Object.keys(depsObj) : [];
    await showAlertWithLogs(
      '安装完成',
      `安装成功：${res.name}\n作者：${metaAuthor}\n依赖：${depNames.length ? depNames.join(', ') : '无'}`,
      Array.isArray(res?.logs) ? res.logs : []
    );
    // 重新刷新插件列表（仅显示包含动作的插件）
    const container = document.getElementById('plugins');
    const list = await fetchPlugins();
    const filtered = list.filter((p) => Array.isArray(p.actions) && p.actions.length > 0);
    container.innerHTML = '';
    filtered.forEach((p) => container.appendChild(renderPlugin(p)));
  });
}

main();
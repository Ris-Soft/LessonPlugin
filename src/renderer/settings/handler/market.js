
// 辅助：加载本地 JSON（相对 settings.html 路径）
async function fetchJson(path) {
  const url = new URL(path, location.href).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error('加载失败: ' + path);
  return await res.json();
}

// 市场页面初始化（应用商店布局：顶部大类 Tabs + 左侧小类）
async function initMarketPage() {
  try {
    const storeTabs = document.querySelectorAll('#page-market .store-tabs .sub-item');
    const subnavEl = document.getElementById('store-subnav');
    const gridEl = document.getElementById('store-grid');
    const emptyEl = document.getElementById('store-empty');
    const searchInput = document.getElementById('market-search-input');
    const searchBtn = document.getElementById('market-search-btn');
    const leftContainer = document.querySelector('#page-market .store-left');
    const storePanel = document.querySelector('#page-market .store-panel');

    let currentTab = 'comprehensive';
    let currentSub = 'all';
    let pluginList = [];
    try { pluginList = await fetchPlugins(); } catch { pluginList = []; }

    const market = { categories: {}, catalog: { plugins: [], automation: [], components: [] } };
    try {
      market.categories.plugins = await fetchJson('./mock/market/categories/plugins.json');
      market.categories.automation = await fetchJson('./mock/market/categories/automation.json');
      market.categories.components = await fetchJson('./mock/market/categories/components.json');
      market.catalog.plugins = await fetchJson('./mock/market/catalog/plugins.json');
      market.catalog.automation = await fetchJson('./mock/market/catalog/automation.json');
      market.catalog.components = await fetchJson('./mock/market/catalog/components.json');
    } catch {}

    const iconForSub = (tab, id) => {
      if (tab === 'plugins') return { all: 'ri-apps-2-line', hot: 'ri-fire-line', assist: 'ri-book-read-line', notify: 'ri-notification-2-line', tools: 'ri-tools-line', system: 'ri-settings-3-line', other: 'ri-more-line' }[id] || 'ri-apps-2-line';
      if (tab === 'automation') return { all: 'ri-apps-2-line', class: 'ri-school-line', notify: 'ri-notification-2-line', tools: 'ri-tools-line' }[id] || 'ri-apps-2-line';
      if (tab === 'components') return { all: 'ri-apps-2-line', ui: 'ri-layout-grid-line', basic: 'ri-shape-line' }[id] || 'ri-apps-2-line';
      return 'ri-apps-2-line';
    };

    const buildSubnav = (tab) => {
      subnavEl.innerHTML = '';
      // 综合与功能更新不显示左侧分类容器
      if (tab === 'comprehensive' || tab === 'updates') { subnavEl.hidden = true; return; }
      subnavEl.hidden = false;
      const defs = Array.isArray(market?.categories?.[tab]) ? market.categories[tab] : [];
      for (const d of defs) {
        const btn = document.createElement('button');
        btn.className = 'sub-item';
        btn.dataset.sub = d.id;
        const icon = d.icon || iconForSub(tab, d.id);
        btn.innerHTML = `<i class="${icon}"></i> ${d.label || d.name || d.id}`;
        subnavEl.appendChild(btn);
      }
      const buttons = subnavEl.querySelectorAll('.sub-item');
      buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
          buttons.forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          currentSub = btn.dataset.sub;
          renderGrid();
        });
      });
      buttons.forEach((b) => b.classList.toggle('active', b.dataset.sub === 'all'));
      currentSub = 'all';
    };

    const filterPluginsBySub = (items) => {
      const matchAny = (p, re) => re.test(p.name || '') || re.test(p.description || '');
      const notMatchAny = (p, re) => !(re.test(p.name || '') || re.test(p.description || ''));
      const catRe = {
        assist: /早读|课堂|看板|助手/i,
        notify: /通知|消息|提醒|notify/i,
        tools: /工具|tool|utils/i,
        system: /系统|system|设置/i
      };
      switch (currentSub) {
        case 'hot':
          return items.filter((p) => matchAny(p, /示例|notify|助手|看板/i));
        case 'assist':
          return items.filter((p) => matchAny(p, catRe.assist));
        case 'notify':
          return items.filter((p) => matchAny(p, catRe.notify));
        case 'tools':
          return items.filter((p) => matchAny(p, catRe.tools));
        case 'system':
          return items.filter((p) => matchAny(p, catRe.system));
        case 'other':
          return items.filter((p) => (
            notMatchAny(p, catRe.assist) && notMatchAny(p, catRe.notify) && notMatchAny(p, catRe.tools) && notMatchAny(p, catRe.system)
          ));
        case 'all':
        default:
          return items;
      }
    };

    const renderGrid = async () => {
      gridEl.innerHTML = '';
      // 左侧分类容器在综合/功能更新隐藏，并让右侧占满
      const hideLeft = currentTab === 'comprehensive' || currentTab === 'updates';
      if (leftContainer) leftContainer.hidden = hideLeft;
      if (storePanel) storePanel.classList.toggle('compact', hideLeft);
      subnavEl.hidden = hideLeft ? true : subnavEl.hidden;

      let items = [];
      const q = String(searchInput?.value || '').trim().toLowerCase();

      if (currentTab === 'plugins') {
        items = market.catalog.plugins.slice();
        if (q) items = items.filter((p) => ((p.name || '') + ' ' + (p.description || '')).toLowerCase().includes(q));
        items = filterPluginsBySub(items);
      } else if (currentTab === 'automation') {
        items = market.catalog.automation.slice();
        if (q) items = items.filter((p) => ((p.name || '') + ' ' + (p.description || '')).toLowerCase().includes(q));
      } else if (currentTab === 'components') {
        items = market.catalog.components.slice();
        if (q) items = items.filter((p) => ((p.name || '') + ' ' + (p.description || '')).toLowerCase().includes(q));
      } else if (currentTab === 'updates') {
        // 只显示可更新的（安装且有新版本）
        const updates = [];
        for (const p of pluginList.slice()) {
          try {
            if (!p?.npm || !p?.version) continue;
            const res = await window.settingsAPI?.npmGetVersions?.(p.npm);
            const versions = (res?.ok && Array.isArray(res.versions)) ? res.versions : [];
            const latest = versions.length ? versions[versions.length - 1] : null;
            if (latest && latest !== p.version) updates.push({ ...p, latest });
          } catch {}
        }
        items = updates;
      } else {
        // 综合：合并三大类
        items = [
          ...market.catalog.plugins,
          ...market.catalog.automation,
          ...market.catalog.components
        ];
        if (q) items = items.filter((p) => ((p.name || '') + ' ' + (p.description || '')).toLowerCase().includes(q));
      }

      emptyEl.hidden = items.length > 0;
      if (!items.length) return;
      if (currentTab === 'updates') {
        items.forEach((p) => gridEl.appendChild(renderUpdateCard(p)));
      } else {
        items.forEach((p) => gridEl.appendChild(renderStoreCard(p)));
      }
    };

    // 顶部大类 Tabs 切换
    storeTabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        storeTabs.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentTab = btn.dataset.storeTab;
        buildSubnav(currentTab);
        renderGrid();
      });
    });

    // 默认显示“综合”大类
    const defaultTabBtn = Array.from(storeTabs).find((b) => b.dataset.storeTab === 'comprehensive') || storeTabs[0];
    defaultTabBtn?.click?.();

    // 搜索绑定
    if (searchBtn && searchBtn.dataset.bound !== '1') {
      searchBtn.dataset.bound = '1';
      searchBtn.addEventListener('click', () => renderGrid());
    }
  } catch {}
}

function renderStoreCard(item) {
  const el = document.createElement('div');
  el.className = 'store-card plugin-card';
  const versionText = item.version ? `v${item.version}` : '';
  const authorText = (() => {
    const a = item.author;
    if (!a) return '未知作者';
    if (typeof a === 'string') return a;
    if (typeof a === 'object') return a.name || JSON.stringify(a);
    return String(a);
  })();
  const pkg = item.npm || item.id || item.name;
  el.innerHTML = `
    <div class="card-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div style="display:flex;gap:12px;">
        <i class="${item.icon || 'ri-puzzle-line'}"></i>
        <div>
          <div class="card-title">${item.name} ${versionText ? `<span class=\"pill small plugin-version\">${versionText}</span>` : ''}</div>
          <div class="card-desc">${item.description || ''}</div>
          <div class="muted">作者：${authorText}</div>
        </div>
      </div>
      <div class="card-action" style="flex-shrink:0;">
        <button class="btn primary" data-action="install"><i class="ri-download-2-line"></i> 安装</button>
      </div>
    </div>
  `;
  const btnInstall = el.querySelector('button[data-action="install"]');
  const isInstalled = !!item.local || !!item.version;
  const isPluginType = (item.type || 'plugin') === 'plugin';
  if (!isPluginType) {
    btnInstall.disabled = true;
    btnInstall.innerHTML = '<i class="ri-eye-line"></i> 预览';
  }
  const setInstallButton = async () => {
    try {
      if (!isPluginType) { return; }
      if (!isInstalled) { btnInstall.disabled = false; btnInstall.innerHTML = '<i class="ri-download-2-line"></i> 安装'; return; }
      if (!item.npm) { btnInstall.disabled = true; btnInstall.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装'; return; }
      const res = await window.settingsAPI?.npmGetVersions?.(item.npm);
      const versions = (res?.ok && Array.isArray(res.versions)) ? res.versions : [];
      const latest = versions.length ? versions[versions.length - 1] : null;
      if (latest && item.version && latest !== item.version) {
        btnInstall.disabled = false; btnInstall.innerHTML = `<i class=\"ri-refresh-line\"></i> 更新到 v${latest}`;
        btnInstall.dataset.latest = latest;
      } else {
        btnInstall.disabled = true; btnInstall.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装';
      }
    } catch { btnInstall.disabled = isInstalled; btnInstall.innerHTML = isInstalled ? '<i class="ri-checkbox-circle-line"></i> 已安装' : '<i class="ri-download-2-line"></i> 安装'; }
  };
  if (isPluginType) {
    setInstallButton();
    btnInstall.addEventListener('click', async (e) => {
      try {
        const latest = btnInstall.dataset.latest;
        btnInstall.disabled = true; btnInstall.innerHTML = '<i class="ri-loader-4-line"></i> 处理中...';
        if (latest) {
          const dl = await window.settingsAPI?.npmDownload?.(item.npm, latest);
          if (!dl?.ok) throw new Error(dl?.error || '下载失败');
          const sw = await window.settingsAPI?.npmSwitch?.(item.id || item.name, item.npm, latest);
          if (!sw?.ok) throw new Error(sw?.error || '切换版本失败');
          await showAlert('已更新到最新版本');
        } else {
          const pkg = item.npm || item.id || item.name;
          const res = await window.settingsAPI?.installNpm?.(pkg);
          if (!res?.ok) throw new Error(res?.error || '安装失败');
          await showAlert('安装完成');
        }
        const active = Array.from(document.querySelectorAll('#page-market .store-tabs .sub-item')).find(b => b.classList.contains('active'));
        active?.click?.();
      } catch (err) {
        alert(err?.message || '操作失败');
        setInstallButton();
      }
    });
  }
  el.addEventListener('click', (evt) => {
    if (evt.target === btnInstall || btnInstall.contains(evt.target)) return;
    try { showStorePluginModal(item); } catch {}
  });
  return el;
}

function renderUpdateCard(p) {
  const el = document.createElement('div');
  el.className = 'store-card plugin-card';
  el.style.width = '100%';
  const versionText = p.version ? `v${p.version}` : '';
  const latestText = p.latest ? `v${p.latest}` : '';
  el.innerHTML = `
    <div class=\"card-header\" style=\"display:flex;justify-content:space-between;align-items:flex-start;gap:12px;\">
      <div style=\"display:flex;gap:12px;\">
        <i class=\"${p.icon || 'ri-refresh-line'}\"></i>
        <div>
          <div class=\"card-title\">${p.name} <span class=\\\"pill small\\\">当前 ${versionText}</span> <span class=\\\"pill small primary\\\">最新 ${latestText}</span></div>
          <div class=\"card-desc\">${p.description || ''}</div>
          <div class=\"muted\">提示：该功能可更新</div>
        </div>
      </div>
      <div class=\"card-action\" style=\"flex-shrink:0;\">
        <button class=\"btn primary\"><i class=\"ri-download-2-line\"></i> 更新到 ${latestText}</button>
      </div>
    </div>
  `;
  const btn = el.querySelector('button.btn.primary');
  btn.addEventListener('click', async () => {
    try {
      btn.disabled = true; btn.innerHTML = '<i class=\"ri-loader-4-line\"></i> 更新中...';
      const dl = await window.settingsAPI?.npmDownload?.(p.npm, p.latest);
      if (!dl?.ok) throw new Error(dl?.error || '下载失败');
      const sw = await window.settingsAPI?.npmSwitch?.(p.id || p.name, p.npm, p.latest);
      if (!sw?.ok) throw new Error(sw?.error || '切换版本失败');
      await showAlert('已更新到最新版本');
      const btnNav = Array.from(document.querySelectorAll('#page-market .store-tabs .sub-item')).find(b => b.dataset.storeTab === 'updates');
      btnNav?.click?.();
    } catch (e) {
      alert('更新失败：' + (e?.message || '未知错误'));
      btn.disabled = false; btn.innerHTML = `<i class=\"ri-download-2-line\"></i> 更新到 ${latestText}`;
    }
  });
  return el;
}
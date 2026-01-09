// 新增：从配置读取市场接口地址并请求
async function getMarketBase() {
  try {
    const svc = await window.settingsAPI?.configGet?.('system', 'serviceBase');
    if (typeof svc === 'string' && svc) return svc;
    const legacy = await window.settingsAPI?.configGet?.('system', 'marketApiBase');
    return (typeof legacy === 'string' && legacy) ? legacy : 'https://orbiboard.3r60.top/';
  } catch (e) {
    return 'https://orbiboard.3r60.top/';
  }
}
async function fetchMarket(route) {
  const base = await getMarketBase();
  const url = new URL(route, base).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error('加载失败: ' + url);
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

    // 渲染令牌：避免并发 renderGrid 造成重复追加
    let renderToken = 0;

    let currentTab = 'comprehensive';
    let currentSub = 'all';
    let pluginList = [];
    try { pluginList = await fetchPlugins(); } catch (e) { pluginList = []; }

    const market = { categories: {}, catalog: { plugins: [], automation: [], components: [] } };
    const reloadMarket = async () => {
      try {
        // 优先从接口加载最新数据
        const cats = await fetchMarket('/api/market/categories');
        const catlog = await fetchMarket('/api/market/catalog');
        market.categories = cats || {};
        market.catalog = catlog || { plugins: [], automation: [], components: [] };
      } catch (e) {}
      // 若接口不可用则显示空列表（不回退本地假数据）
      market.categories.plugins = Array.isArray(market?.categories?.plugins) ? market.categories.plugins : [];
      market.categories.automation = Array.isArray(market?.categories?.automation) ? market.categories.automation : [];
      market.categories.components = Array.isArray(market?.categories?.components) ? market.categories.components : [];
      market.catalog.plugins = Array.isArray(market?.catalog?.plugins) ? market.catalog.plugins : [];
      market.catalog.automation = Array.isArray(market?.catalog?.automation) ? market.catalog.automation : [];
      market.catalog.components = Array.isArray(market?.catalog?.components) ? market.catalog.components : [];
      try {
        window.__marketCatalog__ = market.catalog.plugins.slice();
        window.__marketCatalogUpdatedAt__ = Date.now();
      } catch (e) {}
    };
    // 首次加载数据
    await reloadMarket();
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
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
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
      const myToken = ++renderToken;
      gridEl.innerHTML = '';

      // 功能更新页面改为满宽纵向排列
      if (currentTab === 'updates') {
        gridEl.style.display = 'flex';
        gridEl.style.flexDirection = 'column';
        gridEl.style.gap = '12px';
      } else {
        gridEl.style.display = '';
        gridEl.style.flexDirection = '';
        gridEl.style.gap = '';
      }

      // 左侧分类容器在综合/功能更新隐藏，并让右侧占满
      const hideLeft = currentTab === 'comprehensive' || currentTab === 'updates';
      if (leftContainer) leftContainer.hidden = hideLeft;
      if (storePanel) storePanel.classList.toggle('compact', hideLeft);
      subnavEl.hidden = hideLeft ? true : subnavEl.hidden;

      // 刷新本地插件列表，确保安装/更新后状态正确
      try { pluginList = await fetchPlugins(); } catch (e) { pluginList = []; }
      if (renderToken !== myToken) return; // 若已有更新请求，取消旧渲染

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
          if (renderToken !== myToken) return; // 并发保护
          let foundUpdate = false;
          
          // 1. 优先检查市场目录（支持 ZIP 与 NPM）
          // 优先匹配 ID，其次 Name
          const marketItem = market.catalog.plugins.find(m => m.id === p.id || m.name === p.name);
          if (marketItem && marketItem.version && compareVersions(marketItem.version, p.version) > 0) {
             updates.push({
               ...p,
               latest: marketItem.version,
               zip: marketItem.zip,
               npm: marketItem.npm, // 市场条目可能同时包含 npm
               description: marketItem.description || p.description,
               icon: marketItem.icon || p.icon
             });
             foundUpdate = true;
          }
          
          if (foundUpdate) continue;

          // 2. 检查 NPM（仅当本地插件声明 npm 且未在市场找到更新时）
          try {
            if (!p?.npm || !p?.version) continue;
            const res = await window.settingsAPI?.npmGetVersions?.(p.npm);
            const versions = (res?.ok && Array.isArray(res.versions)) ? res.versions : [];
            const latest = versions.length ? versions[versions.length - 1] : null;
            if (latest && latest !== p.version) updates.push({ ...p, latest });
          } catch (e) {}
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

      if (renderToken !== myToken) return; // 最终并发保护
      emptyEl.hidden = items.length > 0;
      if (!items.length) return;
      if (currentTab === 'updates') {
        items.forEach((p) => gridEl.appendChild(renderUpdateCard(p)));
      } else {
        items.forEach((p) => gridEl.appendChild(renderStoreCard(p, pluginList)));
      }
    };

    // 顶部大类 Tabs 切换（仅绑定一次）
    storeTabs.forEach((btn) => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
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
    // 刷新绑定：重新获取市场数据并重建当前视图
    const refreshBtn = document.getElementById('market-refresh-btn');
    if (refreshBtn && refreshBtn.dataset.bound !== '1') {
      refreshBtn.dataset.bound = '1';
      refreshBtn.addEventListener('click', async () => {
        try {
          refreshBtn.disabled = true; refreshBtn.innerHTML = '<i class="ri-loader-4-line"></i> 刷新中...';
          if (loadingEl) loadingEl.hidden = false;
          await reloadMarket();
          buildSubnav(currentTab);
          await renderGrid();
        } finally {
          refreshBtn.disabled = false; refreshBtn.innerHTML = '<i class="ri-refresh-line"></i> 刷新';
          if (loadingEl) loadingEl.hidden = true;
        }
      });
    }
  } catch (e) {}
}
// 自动安装 NPM 依赖的函数
async function autoInstallNpmDependencies(dependencies, options = {}) {
  const { silent = false, onProgress = null } = options;
  
  if (!dependencies || typeof dependencies !== 'object' || !Object.keys(dependencies).length) {
    return { ok: true, installed: [], skipped: [], errors: [] };
  }

  const results = {
    ok: true,
    installed: [],
    skipped: [],
    errors: []
  };

  try {
    // 获取已安装的 NPM 包列表
    const installedPkgs = await window.settingsAPI?.npmListInstalled?.();
    const installedList = (installedPkgs?.ok && Array.isArray(installedPkgs.packages)) ? installedPkgs.packages : [];
    const hasPkg = (name) => installedList.some(p => p.name === name && Array.isArray(p.versions) && p.versions.length);

    // 筛选出缺失的依赖
    const missing = Object.keys(dependencies).filter(name => !hasPkg(name));
    
    if (!missing.length) {
      if (!silent) {
        onProgress && onProgress({ stage: 'npm', message: '所有 NPM 依赖已安装' });
      }
      return results;
    }

    if (!silent) {
      onProgress && onProgress({ stage: 'npm', message: `开始自动安装 ${missing.length} 个 NPM 依赖...` });
    }

    // 逐个安装缺失的依赖
    for (const name of missing) {
      try {
        if (!silent) {
          onProgress && onProgress({ stage: 'npm', message: `正在获取 ${name} 的版本信息...` });
        }

        // 获取可用版本
        const verRes = await window.settingsAPI?.npmGetVersions?.(name);
        const versions = (verRes?.ok && Array.isArray(verRes.versions)) ? verRes.versions : [];
        
        if (!versions.length) {
          results.errors.push({ name, error: '无可用版本' });
          results.ok = false;
          continue;
        }

        // 选择最新版本
        const latestVersion = versions[versions.length - 1];
        
        if (!silent) {
          onProgress && onProgress({ stage: 'npm', message: `正在下载 ${name}@${latestVersion}...` });
        }

        // 下载依赖
        const dl = await window.settingsAPI?.npmDownload?.(name, latestVersion);
        
        if (!dl?.ok) {
          results.errors.push({ name, error: dl?.error || '下载失败' });
          results.ok = false;
        } else {
          results.installed.push({ name, version: latestVersion });
          if (!silent) {
            onProgress && onProgress({ stage: 'npm', message: `已安装 ${name}@${latestVersion}` });
          }
        }
      } catch (e) {
        results.errors.push({ name, error: e?.message || '未知错误' });
        results.ok = false;
      }
    }

    if (!silent && results.installed.length) {
      onProgress && onProgress({ 
        stage: 'npm', 
        message: `自动安装完成：${results.installed.length} 个依赖已安装${results.errors.length ? `，${results.errors.length} 个失败` : ''}` 
      });
    }

  } catch (e) {
    results.ok = false;
    results.errors.push({ name: 'system', error: e?.message || '系统错误' });
  }

  return results;
}

async function showStorePluginModal(item) {
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const box = document.createElement('div'); box.className = 'modal-box market-plugin';
  const title = document.createElement('div'); title.className = 'modal-title';
  const body = document.createElement('div'); body.className = 'modal-body';

  const versionText = item.version ? `v${item.version}` : '未知版本';
  const authorText = (() => {
    const a = item.author;
    if (!a) return '未知作者';
    if (typeof a === 'string') return a;
    if (typeof a === 'object') return a.name || JSON.stringify(a);
    return String(a);
  })();

  title.style.display = 'flex';
  title.style.justifyContent = 'space-between';
  title.style.alignItems = 'center';
  title.innerHTML = `<span><i class="${item.icon || 'ri-puzzle-line'}"></i> 插件详情 — ${item.name} <span class=\"pill small plugin-version\">${versionText}</span></span>`;
  const closeBtn = document.createElement('button'); closeBtn.className = 'btn secondary'; closeBtn.innerHTML = '<i class="ri-close-line"></i>';
  closeBtn.addEventListener('click', () => { try { overlay.remove(); } catch (e) {} });
  title.appendChild(closeBtn);

  const depsObj = (item && typeof item.npmDependencies === 'object' && item.npmDependencies) ? item.npmDependencies : null;
  const depsKeys = depsObj ? Object.keys(depsObj) : [];
  const npmDepsHtml = depsKeys.length
    ? depsKeys.slice(0, 6).map(k => `<span class="pill small">${k}</span>`).join(' ') + (depsKeys.length > 6 ? ` <span class="pill small muted">+${depsKeys.length - 6}</span>` : '')
    : '<span class="muted">无依赖</span>';
  // 依赖满足状态：获取已安装插件列表并进行版本对比
  let installedList = [];
  try { const res = await window.settingsAPI?.getPlugins?.(); installedList = Array.isArray(res) ? res : []; } catch (e) {}
  const parseVer = (v) => { const m = String(v||'0.0.0').split('.').map(x=>parseInt(x,10)||0); return { m:m[0]||0, n:m[1]||0, p:m[2]||0 }; };
  const cmp = (a,b)=>{ if(a.m!==b.m) return a.m-b.m; if(a.n!==b.n) return a.n-b.n; return a.p-b.p; };
  const satisfies = (ver, range) => {
    if (!range) return !!ver; const v=parseVer(ver); const r=String(range).trim(); const plain=r.replace(/^[~^]/,''); const base=parseVer(plain);
    if (r.startsWith('^')) return (v.m===base.m) && (cmp(v,base)>=0);
    if (r.startsWith('~')) return (v.m===base.m) && (v.n===base.n) && (cmp(v,base)>=0);
    if (r.startsWith('>=')) return cmp(v, parseVer(r.slice(2)))>=0;
    if (r.startsWith('>')) return cmp(v, parseVer(r.slice(1)))>0;
    if (r.startsWith('<=')) return cmp(v, parseVer(r.slice(2)))<=0;
    if (r.startsWith('<')) return cmp(v, parseVer(r.slice(1)))<0;
    const exact=parseVer(r); return cmp(v, exact)===0;
  };
  const pluginDepsArray = Array.isArray(item.dependencies) ? item.dependencies : [];
  const pluginDepsHtml = pluginDepsArray.length ? pluginDepsArray.slice(0, 6).map(d => {
    const [depName, depRange] = String(d).split('@');
    const target = installedList.find(pp => (pp.id === depName) || (pp.name === depName));
    const ok = !!target && satisfies(target?.version, depRange);
    const icon = ok ? 'ri-check-line' : 'ri-close-line';
    const cls = ok ? 'pill small ok' : 'pill small danger';
    return `<span class="${cls}"><i class="${icon}"></i> ${depName}${depRange ? '@'+depRange : ''}</span>`;
  }).join(' ') + (pluginDepsArray.length > 6 ? ` <span class="pill small muted">+${pluginDepsArray.length - 6}</span>` : '') : '<span class="muted">无依赖</span>';

  const readmeBox = document.createElement('div'); readmeBox.className = 'modal-readme';
  readmeBox.style.overflowX = 'hidden';
  readmeBox.style.wordBreak = 'break-word';
  readmeBox.style.whiteSpace = 'normal';
  readmeBox.innerHTML = '<div class=\"muted\">加载说明文档...</div>';

  body.innerHTML = `
    <div class=\"setting-item\">
      <div class=\"setting-icon\"><i class=\"${item.icon || 'ri-puzzle-line'}\"></i></div>
      <div class=\"setting-main\">
        <div class=\"setting-title\">${item.name}</div>
        <div class=\"setting-desc\">作者：${authorText}</div>
      </div>
      <div class=\"setting-action\"></div>
    </div>
    <br>
    <div class=\"section-title\"><i class=\"ri-git-repository-line\"></i> 插件依赖</div>
    <div>${pluginDepsHtml}</div>
    <div class=\"section-title\" style=\"margin-top:8px;\"><i class=\"ri-box-3-line\"></i> NPM 依赖</div>
    <div id=\"npm-deps-box\">${npmDepsHtml}</div>
    <div class=\"section-title\" style=\"margin-top:12px;\"><i class=\"ri-file-text-line\"></i> 插件说明</div>
  `;
  body.appendChild(readmeBox);

  // 自动化条目预览（触发条件、执行条件、执行动作）
  const autoBox = document.createElement('div');
  const autoTitle = document.createElement('div'); autoTitle.className = 'section-title'; autoTitle.innerHTML = '<i class="ri-timer-line"></i> 自动化预览';
  const autoContent = document.createElement('div'); autoContent.className = 'automation-preview';
  if ((item.type || 'plugin') === 'automation') {
    body.appendChild(autoTitle);
    body.appendChild(autoContent);
  }

  // 操作按钮
  const actionBox = body.querySelector('.setting-action');
  const actionBtn = document.createElement('button'); actionBtn.className = 'btn primary'; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装';
  const uninstallBtn = document.createElement('button'); uninstallBtn.className = 'btn danger'; uninstallBtn.innerHTML = '<i class="ri-delete-bin-line"></i> 卸载';
  actionBox.appendChild(actionBtn);

  // 自动化安装（与插件安装分支）
  if ((item.type || 'plugin') === 'automation') {
    uninstallBtn.hidden = true;
    actionBtn.disabled = false;
    actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装自动化';
    actionBtn.dataset.action = 'install-automation';
    actionBtn.addEventListener('click', async () => {
      try {
        actionBtn.disabled = true; actionBtn.innerHTML = '<i class="ri-loader-4-line"></i> 安装中...';
        const base = await (async () => {
          try {
            const svc = await window.settingsAPI?.configGet?.('system', 'serviceBase');
            if (typeof svc === 'string' && svc) return svc;
            const legacy = await window.settingsAPI?.configGet?.('system', 'marketApiBase');
            return (typeof legacy === 'string' && legacy) ? legacy : 'http://localhost:3030/';
          } catch (e) { return 'http://localhost:3030/'; }
        })();
        let autoJson = null;
        if (item.automation) {
          const url = new URL(item.automation, base).toString();
          const res = await fetch(url);
          if (res.ok) autoJson = await res.json();
        } else if (item.id) {
          const url = new URL(`/data/plugins/${item.id}/automation.json`, base).toString();
          const res = await fetch(url);
          if (res.ok) autoJson = await res.json();
        }
        if (!autoJson) throw new Error('未获取到自动化配置');
        const id = String(autoJson.id || item.id || ('automation-' + Date.now()));
        const payload = {
          name: autoJson.name || item.name || '未命名自动化',
          triggers: Array.isArray(autoJson.triggers) ? autoJson.triggers : [],
          conditions: (autoJson.conditions && typeof autoJson.conditions === 'object') ? autoJson.conditions : { mode:'and', groups:[] },
          actions: Array.isArray(autoJson.actions) ? autoJson.actions : [],
          confirm: (autoJson.confirm && typeof autoJson.confirm === 'object') ? autoJson.confirm : { enabled:false, timeout:60 }
          ,source: 'plugin:market'
          ,id: id
        };
        const existed = await window.settingsAPI?.automationGet?.(id);
        if (existed) {
          const ok = await showConfirm('同名自动化已存在，是否覆盖当前配置？');
          if (!ok) { actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装自动化'; return; }
          const out = await window.settingsAPI?.automationUpdate?.(id, payload);
          if (!out?.ok) throw new Error(out?.error || '覆盖失败');
          await window.settingsAPI?.automationToggle?.(id, true);
          await showAlert('已覆盖并启用');
        } else {
          const out = await window.settingsAPI?.automationCreate?.({ id, ...payload });
          if (!out?.ok) throw new Error(out?.error || '安装失败');
          await window.settingsAPI?.automationToggle?.(id, true);
          await showAlert('已安装并启用');
        }
        try { overlay.remove(); } catch (e) {}
        const btn = Array.from(document.querySelectorAll('.nav-item')).find(b => b.dataset.page === 'automations');
        btn?.click?.();
      } catch (e) {
        await showAlert('安装失败：' + (e?.message || '未知错误'));
        actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装自动化';
      }
    });
  }

  // 插件安装逻辑（仅当类型为插件时启用）
  if ((item.type || 'plugin') !== 'automation') {
    const setActionButton = async () => {
      try {
        const list = await window.settingsAPI?.getPlugins?.();
        const installed = Array.isArray(list) ? list.find((p) => (
          (item.id && (p.id === item.id)) ||
          (item.name && (p.name === item.name)) ||
          (item.npm && (p.npm === item.npm))
        )) : null;
        // 控制卸载按钮展示
        uninstallBtn.hidden = !installed;
        if (!installed) {
          actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装'; actionBtn.dataset.action = 'install'; return;
        }
        // 已安装：无 npm 源时仅展示“已安装”
        if (!item.npm) { actionBtn.disabled = true; actionBtn.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装'; actionBtn.dataset.action = 'installed'; return; }
        const res = await window.settingsAPI?.npmGetVersions?.(item.npm);
        const versions = (res?.ok && Array.isArray(res.versions)) ? res.versions : [];
        const latest = versions.length ? versions[versions.length - 1] : null;
        if (latest && item.version && latest !== item.version) {
          actionBtn.disabled = false; actionBtn.innerHTML = `<i class="ri-refresh-line"></i> 更新到 v${latest}`; actionBtn.dataset.action = 'update'; actionBtn.dataset.latest = latest;
        } else {
          actionBtn.disabled = true; actionBtn.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装'; actionBtn.dataset.action = 'installed';
        }
      } catch (e) {
        actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装'; actionBtn.dataset.action = 'install';
        uninstallBtn.hidden = true;
      }
    };
    setActionButton();

    actionBtn.addEventListener('click', async () => {
      const action = actionBtn.dataset.action;
      try {
        actionBtn.disabled = true; actionBtn.innerHTML = '<i class="ri-loader-4-line"></i> 处理中...';
        if (action === 'install') {
          // 支持 ZIP 安装（优先）
          if (item.zip) {
            const base = await (async () => {
              try {
                const svc = await window.settingsAPI?.configGet?.('system', 'serviceBase');
                if (typeof svc === 'string' && svc) return svc;
                const legacy = await window.settingsAPI?.configGet?.('system', 'marketApiBase');
                return (typeof legacy === 'string' && legacy) ? legacy : 'http://localhost:3030/';
              } catch (e) { return 'http://localhost:3030/'; }
            })();
            const url = new URL(item.zip, base).toString();
            const res = await fetch(url);
            if (!res.ok) throw new Error('ZIP 下载失败');
            const buf = await res.arrayBuffer();
            // 名称不带 .zip 后缀：优先使用插件名称，其次回退到 id，最后回退默认名
            const name = item.name ? item.name : (item.id ? item.id : 'plugin');
            // 安装前检查ZIP显示依赖并确认（保持与卡片安装一致）
            let inspect = null;
            try {
              inspect = await window.settingsAPI?.inspectPluginZipData?.(name, new Uint8Array(buf));
              if (inspect?.ok) {
                // 美化安装确认弹窗：展示作者、插件依赖状态与 NPM 依赖
                const installedList = await window.settingsAPI?.getPlugins?.();
                const installed = Array.isArray(installedList) ? installedList : [];
                const normalizeAuthor = (a) => {
                  if (a === null || a === undefined) return null;
                  if (typeof a === 'object') return a?.name || null;
                  return String(a);
                };
                const authorVal = normalizeAuthor(inspect?.author) || normalizeAuthor(item?.author) || '未知作者';
                const pluginDepends = Array.isArray(inspect.dependencies) ? inspect.dependencies : (Array.isArray(item.dependencies) ? item.dependencies : []);
                const depsObjZip = (typeof inspect.npmDependencies === 'object' && inspect.npmDependencies) ? inspect.npmDependencies : null;
                const depNames = depsObjZip ? Object.keys(depsObjZip) : [];

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
                  const exact = parseVer(r); return cmp(v, exact) === 0;
                };
                const depPills = pluginDepends.map(d => {
                  const [depName, depRange] = String(d).split('@');
                  const target = installed.find(pp => (pp.id === depName) || (pp.name === depName));
                  const ok = !!target && satisfies(target?.version, depRange);
                  const icon = ok ? 'ri-check-line' : 'ri-close-line';
                  const cls = ok ? 'pill small ok' : 'pill small danger';
                  return `<span class="${cls}"><i class="${icon}"></i> ${depName}${depRange ? '@'+depRange : ''}</span>`;
                }).join(' ');
                const hasUnsatisfied = pluginDepends.some(d => {
                  const [depName, depRange] = String(d).split('@');
                  const target = installed.find(pp => (pp.id === depName) || (pp.name === depName));
                  return !(!!target && satisfies(target?.version, depRange));
                });
                const npmPills = depNames.map(k => `<span class="pill small">${k}</span>`).join(' ');

                // 依赖引导由统一安装入口处理，此处移除本地弹窗
              }
            } catch (e) {}
              // 将 inspect 得到的依赖信息合并到 item，确保统一安装入口能正确触发 NPM 安装向导
              const depsObj = (inspect && typeof inspect.npmDependencies === 'object' && !Array.isArray(inspect.npmDependencies) && inspect.npmDependencies) ? inspect.npmDependencies : null;
              const enrichedItem = {
                ...item,
                id: inspect?.id || item.id || name,
                name: name,
                author: (typeof inspect?.author === 'object') ? (inspect.author?.name || JSON.stringify(inspect.author)) : (inspect?.author || item.author),
                // 插件依赖（数组）保持与检查结果一致
                dependencies: Array.isArray(inspect?.dependencies) ? inspect.dependencies : (Array.isArray(item?.dependencies) ? item.dependencies : []),
                // NPM 依赖（对象，非数组）用于触发安装向导
                npmDependencies: depsObj || (typeof item?.npmDependencies === 'object' && !Array.isArray(item.npmDependencies) ? item.npmDependencies : null)
              };
              await window.unifiedPluginInstall({ kind: 'zipData', item: enrichedItem, zipName: name, zipData: new Uint8Array(buf) });
          } else {
            // NPM 安装前引导依赖选择
            const installedList2 = await window.settingsAPI?.getPlugins?.();
            const installed2 = Array.isArray(installedList2) ? installedList2 : [];
            const pluginDepends2 = Array.isArray(item.dependencies) ? item.dependencies : [];
            const hasUnsatisfied2 = pluginDepends2.some(d => {
              const [depName, depRange] = String(d).split('@');
              const target = installed2.find(pp => (pp.id === depName) || (pp.name === depName));
              return !(!!target && satisfies(target?.version, depRange));
            });
            // 依赖引导由统一安装入口处理，此处不再弹本地向导
            const pkg2 = item.npm || item.id || item.name;
              await window.unifiedPluginInstall({ kind: 'npm', item, pkg: pkg2 });
            actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装';
            return;
          }
        } else if (action === 'update') {
          await showAlert('当前不支持更新 NPM 源插件。');
          actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装';
          return;
        }
        try { overlay.remove(); } catch (e) {}
        const activeTab = Array.from(document.querySelectorAll('#page-market .store-tabs .sub-item')).find(b => b.classList.contains('active'));
        activeTab?.click?.();
      } catch (e) {
        await showAlert('操作失败：' + (e?.message || '未知错误'));
        setActionButton();
      }
    });

    uninstallBtn.addEventListener('click', async () => {
      try {
        const { confirmed, dep } = await showUninstallConfirm(item);
        if (!confirmed) return;
        const list = await window.settingsAPI?.getPlugins?.();
        const installed = Array.isArray(list) ? list.find((p) => (
          (item.id && (p.id === item.id)) ||
          (item.name && (p.name === item.name)) ||
          (item.npm && (p.npm === item.npm))
        )) : null;
        const key = installed ? (installed.id || installed.name) : (item.id || item.name);
        uninstallBtn.disabled = true; uninstallBtn.innerHTML = '<i class="ri-loader-4-line"></i> 卸载中...';
        // 自动禁用引用该插件的已启用自动化
        try {
          if (Array.isArray(dep?.automations)) {
            for (const a of dep.automations) {
              if (a.enabled) {
                try { await window.settingsAPI?.automationToggle?.(a.id, false); } catch (e) {}
              }
            }
          }
        } catch (e) {}
        const out = await window.settingsAPI?.uninstallPlugin?.(key);
        if (!out?.ok) throw new Error(out?.error || '卸载失败');
        showToast(`已卸载插件：${item.name}`, { type: 'success', duration: 2000 });
        try { overlay.remove(); } catch (e) {}
        const activeTab = Array.from(document.querySelectorAll('#page-market .store-tabs .sub-item')).find(b => b.classList.contains('active'));
        activeTab?.click?.();
      } catch (e) {
        await showAlert('卸载失败：' + (e?.message || '未知错误'));
        uninstallBtn.disabled = false; uninstallBtn.innerHTML = '<i class="ri-delete-bin-line"></i> 卸载';
      }
    });

    actionBox.appendChild(uninstallBtn);
  }

  // 已移除重复的插件事件绑定，插件逻辑已置于条件分支中

  overlay.appendChild(box);
  box.appendChild(title);
  box.appendChild(body);
  document.body.appendChild(overlay);

  (async () => {
    try {
      // 优先从功能市场服务器读取 README
      const base = await (async () => {
        try {
          const svc = await window.settingsAPI?.configGet?.('system', 'serviceBase');
          if (typeof svc === 'string' && svc) return svc;
          const legacy = await window.settingsAPI?.configGet?.('system', 'marketApiBase');
          return (typeof legacy === 'string' && legacy) ? legacy : 'http://localhost:3030/';
        } catch (e) { return 'http://localhost:3030/'; }
      })();
      let mdText = null;
      if (item.readme) {
        const url = new URL(item.readme, base).toString();
        const res = await fetch(url);
        if (res.ok) mdText = await res.text();
      } else if (item.id) {
        // 回退：automation 类型仅尝试 /data/automation/<id>/README.md；其他类型走 /data/plugins
        if ((item.type || 'plugin') === 'automation') {
          const url = new URL(`/data/automation/${item.id}/README.md`, base).toString();
          const res = await fetch(url);
          if (res.ok) mdText = await res.text();
        } else {
          const url = new URL(`/data/plugins/${item.id}/README.md`, base).toString();
          const res = await fetch(url);
          if (res.ok) mdText = await res.text();
        }
      }
      if (!mdText) {
        // 再回退到在线 npm 镜像或本地
        const key = item.id || item.name;
        const online = await window.settingsAPI?.readmeOnline?.(key);
        mdText = online || (await window.settingsAPI?.getPluginReadme?.(key)) || (item.description || '暂无说明');
      }
      const html = renderMarkdown(mdText || (item.description || '暂无说明'));
      readmeBox.innerHTML = html;

      // 从市场补充 plugin.json 以渲染 NPM 依赖（包含范围），并显示下载状态
      try {
        let pluginJson = null;
        if (item.plugin) {
          const url = new URL(item.plugin, base).toString();
          const res = await fetch(url);
          if (res.ok) pluginJson = await res.json();
        } else if (item.id && (item.type || 'plugin') !== 'automation') {
          const url = new URL(`/data/plugins/${item.id}/plugin.json`, base).toString();
          const res = await fetch(url);
          if (res.ok) pluginJson = await res.json();
        }
        const box = document.getElementById('npm-deps-box');
        const deps = (pluginJson && typeof pluginJson.npmDependencies === 'object') ? pluginJson.npmDependencies : (typeof item.npmDependencies === 'object' ? item.npmDependencies : null);
        if (box && deps && Object.keys(deps).length) {
          const installed = await (async () => { try { const r = await window.settingsAPI?.npmListInstalled?.(); return (r?.ok && Array.isArray(r.packages)) ? r.packages : []; } catch (e) { return []; } })();
          const has = (name) => installed.some(p => p.name === name && Array.isArray(p.versions) && p.versions.length);
          const html2 = Object.keys(deps).map(name => {
            const ok = has(name);
            const cls = ok ? 'pill small ok' : 'pill small danger';
            const icon = ok ? 'ri-check-line' : 'ri-close-line';
            const range = deps[name] ? String(deps[name]) : '';
            return `<span class=\"${cls}\"><i class=\"${icon}\"></i> ${name}${range ? '@'+range : ''}</span>`;
          }).join(' ');
          box.innerHTML = html2;
        }
      } catch (e) {}

      // 自动化预览：加载并呈现触发/条件/动作
      if ((item.type || 'plugin') === 'automation') {
        try {
          let autoJson = null;
          if (item.automation) {
            const url = new URL(item.automation, base).toString();
            const res = await fetch(url);
            if (res.ok) autoJson = await res.json();
          } else if (item.id) {
            // 回退：automation 仅从 /data/automation/<id>/automation.json 加载
            const url = new URL(`/data/automation/${item.id}/automation.json`, base).toString();
            const res = await fetch(url);
            if (res.ok) autoJson = await res.json();
          }
          const renderTrig = (trigs) => window.AutomationView.renderTriggersHTML(trigs);
          const renderConds = (conds) => window.AutomationView.renderConditionsHTML(conds);
          const renderActs = (acts) => window.AutomationView.renderActionsHTML(acts);
          const summaryHtml = window.AutomationView.renderSummaryHTML(autoJson);
          autoContent.innerHTML = `
            ${summaryHtml}
            <div style="margin-top:8px;">触发条件</div>
            ${renderTrig(autoJson?.triggers)}
            <div style="margin-top:8px;">执行条件</div>
            ${renderConds(autoJson?.conditions)}
            <div style="margin-top:8px;">执行动作</div>
            ${renderActs(autoJson?.actions)}
          `;
        } catch (e) {
          autoContent.innerHTML = '<div class="muted">未能加载自动化示例</div>';
        }
      }
    } catch (e) {
      readmeBox.innerHTML = renderMarkdown(item.description || '暂无说明');
    }
  })();
}

// 辅助：加载本地 JSON（相对 settings.html 路径）
async function fetchJson(path) {
  const url = new URL(path, location.href).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error('加载失败: ' + path);
  return await res.json();
}

// 自动安装 NPM 依赖的函数（与 modals/market.js 中的函数保持一致）
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



function renderStoreCard(item, installedList) {
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
  const isPluginType = (item.type || 'plugin') === 'plugin';
  const installed = Array.isArray(installedList) ? installedList.find((p) => (
    (item.id && (p.id === item.id)) ||
    (item.name && (p.name === item.name)) ||
    (item.npm && (p.npm === item.npm))
  )) : null;
  const isInstalled = !!installed;

  // 非插件类型：统一进入插件安装弹窗。若存在 npm 源，则文案显示“安装”以保持一致体验
  if (!isPluginType) {
    btnInstall.disabled = false;
    const hasNpmSource = !!item.npm;
    btnInstall.innerHTML = hasNpmSource ? '<i class="ri-download-2-line"></i> 安装' : '<i class="ri-eye-line"></i> 预览';
    btnInstall.addEventListener('click', () => { try { showStorePluginModal(item); } catch {} });
  }

  const setInstallButton = async () => {
    try {
      if (!isPluginType) return;
      // ZIP 安装或 NPM 安装的按钮状态
      if (!isInstalled) {
        btnInstall.disabled = false;
        btnInstall.innerHTML = '<i class="ri-download-2-line"></i> 安装';
        return;
      }
      // 已安装：若无 npm 源，则仅显示“已安装”
      if (!item.npm) {
        btnInstall.disabled = true;
        btnInstall.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装';
        return;
      }
      const res = await window.settingsAPI?.npmGetVersions?.(item.npm);
      const versions = (res?.ok && Array.isArray(res.versions)) ? res.versions : [];
      const latest = versions.length ? versions[versions.length - 1] : null;
      const installedVersion = installed?.version || null;
      if (latest && installedVersion && latest !== installedVersion) {
        btnInstall.disabled = false;
        btnInstall.innerHTML = `<i class=\"ri-refresh-line\"></i> 更新到 v${latest}`;
        btnInstall.dataset.latest = latest;
      } else {
        btnInstall.disabled = true;
        btnInstall.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装';
        btnInstall.dataset.latest = '';
      }
    } catch {
      btnInstall.disabled = isInstalled;
      btnInstall.innerHTML = isInstalled ? '<i class="ri-checkbox-circle-line"></i> 已安装' : '<i class="ri-download-2-line"></i> 安装';
    }
  };

  if (isPluginType) {
    setInstallButton();
    btnInstall.addEventListener('click', async () => {
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
          // 若存在 ZIP 字段，走 ZIP 安装
          if (item.zip) {
            try {
              const base = await getMarketBase();
              const url = new URL(item.zip, base).toString();
              const res = await fetch(url);
              if (!res.ok) throw new Error('ZIP 下载失败');
              const buf = await res.arrayBuffer();
              // 名称不带 .zip 后缀：优先使用插件名称，其次回退到 id，最后回退默认名
              const name = item.name ? item.name : (item.id ? item.id : 'plugin');
              // 安装前检查ZIP并弹出美化确认窗口
              let inspect = null;
              try {
                inspect = await window.settingsAPI?.inspectPluginZipData?.(name, new Uint8Array(buf));
                if (inspect?.ok) {
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
                    if (!range) return !!ver; const v=parseVer(ver); const r=String(range).trim(); const plain=r.replace(/^[~^]/,''); const base=parseVer(plain);
                    if (r.startsWith('^')) return (v.m===base.m) && (cmp(v,base)>=0);
                    if (r.startsWith('~')) return (v.m===base.m) && (v.n===base.n) && (cmp(v,base)>=0);
                    if (r.startsWith('>=')) return cmp(v, parseVer(r.slice(2)))>=0;
                    if (r.startsWith('>')) return cmp(v, parseVer(r.slice(1)))>0;
                    if (r.startsWith('<=')) return cmp(v, parseVer(r.slice(2)))<=0;
                    if (r.startsWith('<')) return cmp(v, parseVer(r.slice(1)))<0;
                    const exact=parseVer(r); return cmp(v, exact)===0;
                  };
                  const depPills = pluginDepends.map(d => {
                    const [depName, depRange] = String(d).split('@');
                    const target = installed.find(pp => (pp.id === depName) || (pp.name === depName));
                    const ok = !!target && satisfies(target?.version, depRange);
                    const icon = ok ? 'ri-check-line' : 'ri-close-line';
                    const cls = ok ? 'pill small ok' : 'pill small danger';
                    return `<span class=\"${cls}\"><i class=\"${icon}\"></i> ${depName}${depRange ? '@'+depRange : ''}</span>`;
                  }).join(' ');
                  const hasUnsatisfied = pluginDepends.some(d => {
                    const [depName, depRange] = String(d).split('@');
                    const target = installed.find(pp => (pp.id === depName) || (pp.name === depName));
                    return !(!!target && satisfies(target?.version, depRange));
                  });
                  const npmPills = depNames.map(k => `<span class=\"pill small\">${k}</span>`).join(' ');
                  // 引导依赖安装弹窗：展示依赖（含上级依赖），可多选，默认市场可安装的依赖选中；已满足或未在市场找到的禁用
                  const catalog = Array.isArray(window.__marketCatalog__) ? window.__marketCatalog__ : [];
                  const findMarketItem = (name) => catalog.find((x) => (x.id === name) || (x.name === name));
                  const resolveClosure = (deps) => {
                    const seen = new Set(); const out = []; const queue = Array.isArray(deps) ? deps.slice() : [];
                    while (queue.length) {
                      const raw = queue.shift(); const [depName, depRange] = String(raw).split('@');
                      const key = depName.trim(); if (!key || seen.has(key)) continue; seen.add(key);
                      const mi = findMarketItem(key) || null; out.push({ name: key, range: depRange || '', market: mi });
                      const next = Array.isArray(mi?.dependencies) ? mi.dependencies.slice() : []; queue.push(...next);
                    }
                    return out;
                  };
                  // 本地安装向导已移除，依赖引导与安装由统一入口处理
                }
              } catch {}
              // 将 inspect 结果合并到 item，确保统一安装入口能识别 NPM 依赖
              const depsObj = (inspect && typeof inspect.npmDependencies === 'object' && !Array.isArray(inspect.npmDependencies) && inspect.npmDependencies) ? inspect.npmDependencies : null;
              const enrichedItem = {
                ...item,
                id: inspect?.id || item.id || name,
                name: name,
                author: (typeof inspect?.author === 'object') ? (inspect.author?.name || JSON.stringify(inspect.author)) : (inspect?.author || item.author),
                dependencies: Array.isArray(inspect?.dependencies) ? inspect.dependencies : (Array.isArray(item?.dependencies) ? item.dependencies : []),
                npmDependencies: depsObj || (typeof item?.npmDependencies === 'object' && !Array.isArray(item.npmDependencies) ? item.npmDependencies : null)
              };
              await window.unifiedPluginInstall({ kind: 'zipData', item: enrichedItem, zipName: name, zipData: new Uint8Array(buf) });
            } catch (e) {
              throw e;
            }
          } else {
            const pkg = item.npm || item.id || item.name;
            // 本地向导移除，直接调用统一安装入口处理依赖与安装
            try {} catch {}
            await window.unifiedPluginInstall({ kind: 'npm', item, pkg });
          }
        }
        const active = Array.from(document.querySelectorAll('#page-market .store-tabs .sub-item')).find(b => b.classList.contains('active'));
        active?.click?.();
        // 安装或更新成功后刷新插件管理页面（仅显示包含动作的插件）
        try {
          const container = document.getElementById('plugins');
          const list = await fetchPlugins();
          const filtered = list.filter((p) => Array.isArray(p.actions) && p.actions.length > 0);
          container.innerHTML = '';
          filtered.forEach((p) => container.appendChild(renderPlugin(p)));
        } catch {}
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
      // 更新成功后刷新插件管理页面
      try {
        const container = document.getElementById('plugins');
        const list = await fetchPlugins();
        const filtered = list.filter((pp) => Array.isArray(pp.actions) && pp.actions.length > 0);
        container.innerHTML = '';
        filtered.forEach((pp) => container.appendChild(renderPlugin(pp)));
      } catch {}
    } catch (e) {
      alert('更新失败：' + (e?.message || '未知错误'));
      btn.disabled = false; btn.innerHTML = `<i class=\"ri-download-2-line\"></i> 更新到 ${latestText}`;
    }
  });
  return el;
}